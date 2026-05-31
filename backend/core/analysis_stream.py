"""
core/analysis_stream.py
AI 분석 SSE 스트리밍 — 진행 로그를 실시간 전송
"""
import asyncio
import json
import threading
from typing import Any, Callable, Optional

from fastapi.responses import StreamingResponse

from config.database import SessionLocal
from core.ai_analyzer import (
    ProviderQuotaError,
    create_analyzer,
    serialize_intel,
    try_cached_intel,
)

LogCallback = Callable[[dict], None]

SSE_HEADERS = {
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
}


def _sse_event(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def run_intel_analysis(
    *,
    url: Optional[str],
    text: Optional[str],
    title: str,
    channel_name: str,
    analysis_provider: Optional[str],
    force_reanalyze: bool = False,
    skip_if_cached: bool = True,
    on_log: LogCallback,
) -> tuple[Any, list]:
    """동기 분석 실행 (워커 스레드에서 호출)."""
    db = SessionLocal()
    try:
        cached = try_cached_intel(
            db,
            url,
            skip_if_cached=skip_if_cached,
            force_reanalyze=force_reanalyze,
            on_log=on_log,
        )
        if cached:
            return cached

        analyzer = create_analyzer(db, on_log=on_log)
        if url:
            is_youtube = "youtube.com" in url or "youtu.be" in url
            if is_youtube:
                content = analyzer.analyze_youtube(url, channel_name, analysis_provider)
            else:
                content = analyzer.analyze_url(url, analysis_provider)
        else:
            content = analyzer.analyze_text(text or "", title, analysis_provider)
        return content, analyzer.logs
    finally:
        db.close()


def run_youtube_analysis(
    *,
    url: str,
    channel_name: str,
    analysis_provider: Optional[str],
    force_reanalyze: bool = False,
    skip_if_cached: bool = True,
    on_log: LogCallback,
) -> tuple[Any, list]:
    db = SessionLocal()
    try:
        cached = try_cached_intel(
            db,
            url,
            skip_if_cached=skip_if_cached,
            force_reanalyze=force_reanalyze,
            on_log=on_log,
        )
        if cached:
            return cached

        analyzer = create_analyzer(db, on_log=on_log)
        content = analyzer.analyze_youtube(url, channel_name, analysis_provider)
        return content, analyzer.logs
    finally:
        db.close()


async def stream_analysis(
    worker_fn: Callable[[LogCallback], tuple[Any, list]],
    serialize_result: Optional[Callable[[Any, list], dict]] = None,
):
    """워커 스레드에서 분석 실행 + SSE로 log/result/error 이벤트 전송."""
    loop = asyncio.get_running_loop()
    queue: asyncio.Queue[tuple[str, Any]] = asyncio.Queue()
    holder: dict[str, Any] = {"content": None, "logs": [], "error": None}

    def on_log(entry: dict):
        loop.call_soon_threadsafe(queue.put_nowait, ("log", entry))

    def worker():
        captured_logs: list[dict] = []

        def thread_on_log(entry: dict):
            captured_logs.append(entry)
            on_log(entry)

        try:
            content, logs = worker_fn(thread_on_log)
            holder["content"] = content
            holder["logs"] = logs
        except ProviderQuotaError as e:
            holder["error"] = {
                "status": 429,
                "message": f"{e.provider.upper()} API 한도 초과. {e.delay}초 후 재시도하거나 다른 AI를 선택하세요.",
                "logs": captured_logs,
            }
        except Exception as e:
            holder["error"] = {
                "status": 500,
                "message": str(e),
                "logs": captured_logs,
            }
        finally:
            loop.call_soon_threadsafe(queue.put_nowait, ("done", None))

    threading.Thread(target=worker, daemon=True).start()

    async def event_generator():
        yield _sse_event("start", {"message": "분석 시작"})
        while True:
            kind, data = await queue.get()
            if kind == "log":
                yield _sse_event("log", data)
            elif kind == "done":
                err = holder.get("error")
                if err:
                    yield _sse_event("error", err)
                    break
                content = holder.get("content")
                logs = holder.get("logs") or []
                if not content:
                    yield _sse_event(
                        "error",
                        {
                            "status": 500,
                            "message": "AI 분석 실패. API 키와 로그를 확인하세요.",
                            "logs": logs,
                        },
                    )
                    break
                if serialize_result:
                    payload = serialize_result(content, logs)
                else:
                    db = SessionLocal()
                    try:
                        payload = serialize_intel(content, db, logs)
                    finally:
                        db.close()
                yield _sse_event("result", payload)
                break

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers=SSE_HEADERS,
    )


def run_explain_move(
    *,
    stock_id: int,
    event_date: str,
    change_pct: float,
    direction: str,
    close_price: Optional[float],
    analysis_provider: Optional[str],
    force: bool = False,
    on_log: LogCallback,
) -> tuple[Any, list]:
    from config.database import Stock
    from core.move_explainer import explain_and_save

    db = SessionLocal()
    try:
        stock = db.query(Stock).filter(Stock.id == stock_id).first()
        if not stock:
            raise ValueError("종목 없음")
        row, logs = explain_and_save(
            db,
            stock,
            event_date=event_date,
            change_pct=change_pct,
            direction=direction,
            close_price=close_price,
            analysis_provider=analysis_provider,
            force=force,
            on_log=on_log,
        )
        return row, logs
    finally:
        db.close()
