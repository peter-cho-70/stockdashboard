"""
core/intel_digest.py
일일 AI 정리 문서 (Daily Digest) — Signal·분석 수집 후 Gemini 생성
"""
from __future__ import annotations

import json
import logging
from datetime import date, datetime, timedelta, timezone
from typing import Any, Optional

from sqlalchemy.orm import Session

from config.database import (
    IntelContent,
    IntelDailyDigest,
    MacroSignal,
    PriceMoveCause,
    SectorSignal,
    Stock,
    StockIssue,
    StockSignal,
    WatchlistItem,
)
from config.settings import get_settings
from core.content_scope import is_market_scope
from core.demo_mode import is_demo_mode
from core.intel_calendar import collect_calendar_events, _day_briefing_from_events

logger = logging.getLogger(__name__)


def _json_loads(raw: Optional[str], default: Any) -> Any:
    if not raw:
        return default
    try:
        return json.loads(raw)
    except Exception:
        return default


def serialize_digest(row: IntelDailyDigest) -> dict[str, Any]:
    return {
        "date": row.date,
        "title": row.title,
        "body_markdown": row.body_markdown,
        "stats": _json_loads(row.stats_json, {}),
        "source_content_ids": _json_loads(row.source_content_ids, []),
        "source_signal_ids": _json_loads(row.source_signal_ids, {}),
        "portfolio_highlight": _json_loads(row.portfolio_highlight, None),
        "generated_at": row.generated_at.isoformat() if row.generated_at else None,
        "model": row.model,
        "status": row.status,
        "error_message": row.error_message,
    }


def digests_in_range(db: Session, from_date: str, to_date: str) -> dict[str, dict[str, Any]]:
    """캘린더 📄 표시용 — date → {title, status}."""
    rows = (
        db.query(IntelDailyDigest)
        .filter(IntelDailyDigest.date >= from_date, IntelDailyDigest.date <= to_date)
        .all()
    )
    out: dict[str, dict[str, Any]] = {}
    for r in rows:
        if r.status == "ready" and r.body_markdown:
            out[r.date] = {"title": r.title or r.date, "status": "ready"}
        elif r.status == "pending":
            out[r.date] = {"title": r.title or "생성 중…", "status": "pending"}
        elif r.status == "failed":
            out[r.date] = {"title": "생성 실패", "status": "failed"}
    return out


def get_digest(db: Session, day: str) -> Optional[IntelDailyDigest]:
    return db.query(IntelDailyDigest).filter(IntelDailyDigest.date == day).first()


def list_digests(db: Session, from_date: str, to_date: str) -> list[dict[str, Any]]:
    rows = (
        db.query(IntelDailyDigest)
        .filter(IntelDailyDigest.date >= from_date, IntelDailyDigest.date <= to_date)
        .order_by(IntelDailyDigest.date.desc())
        .all()
    )
    return [serialize_digest(r) for r in rows]


def _collect_day_sources(db: Session, day: str) -> dict[str, Any]:
    """대상일 D의 원천 데이터 (AI 프롬프트 입력)."""
    stock_by_id = {s.id: s for s in db.query(Stock).all()}

    macros = (
        db.query(MacroSignal)
        .filter(MacroSignal.event_date == day)
        .all()
    )
    sectors = (
        db.query(SectorSignal)
        .filter(SectorSignal.event_date == day)
        .all()
    )
    stocks = (
        db.query(StockSignal)
        .filter(StockSignal.event_date == day)
        .all()
    )
    issues = (
        db.query(StockIssue)
        .filter(StockIssue.event_date == day)
        .all()
    )
    moves = (
        db.query(PriceMoveCause)
        .filter(PriceMoveCause.event_date == day)
        .all()
    )

    contents: list[IntelContent] = []
    for c in db.query(IntelContent).all():
        if not is_market_scope(getattr(c, "content_scope", None)):
            continue
        pub = c.published_at.strftime("%Y-%m-%d") if c.published_at else None
        ana = c.analyzed_at.strftime("%Y-%m-%d") if c.analyzed_at else None
        if pub == day or ana == day:
            contents.append(c)

    content_ids = [c.id for c in contents]
    signal_ids = {
        "macro": [m.id for m in macros],
        "sector": [s.id for s in sectors],
        "stock": [s.id for s in stocks],
    }

    portfolio_lines: list[str] = []
    watch_lines: list[str] = []
    if not is_demo_mode(db):
        for s in db.query(Stock).filter(Stock.is_active == True, Stock.qty > 0).all():
            portfolio_lines.append(f"{s.name}({s.symbol})")
        for w in db.query(WatchlistItem).all():
            watch_lines.append(w.stock_name)

    def _issue_line(iss: StockIssue) -> dict:
        st = stock_by_id.get(iss.stock_id)
        return {
            "stock": st.name if st else "?",
            "symbol": st.symbol if st else None,
            "summary": (iss.issue_summary or "")[:400],
            "sentiment": iss.sentiment,
        }

    def _move_line(mv: PriceMoveCause) -> dict:
        st = stock_by_id.get(mv.stock_id)
        return {
            "stock": st.name if st else "?",
            "symbol": st.symbol if st else None,
            "change_pct": mv.change_pct,
            "direction": mv.direction,
            "reason": (mv.reason or "")[:300],
        }

    return {
        "date": day,
        "macro_signals": [
            {
                "topic": m.topic,
                "sentiment": m.sentiment,
                "summary": (m.summary or "")[:400],
                "impact": (m.impact or "")[:200],
            }
            for m in macros
        ],
        "sector_signals": [
            {
                "sector": s.sector,
                "sentiment": s.sentiment,
                "summary": (s.summary or "")[:400],
                "outlook": (s.outlook or "")[:200],
            }
            for s in sectors
        ],
        "stock_signals": [
            {
                "name": s.stock_name,
                "symbol": s.symbol,
                "sentiment": s.sentiment,
                "summary": (s.summary or "")[:300],
                "is_portfolio": s.is_portfolio,
            }
            for s in stocks
        ],
        "stock_issues": [_issue_line(i) for i in issues],
        "price_moves": [_move_line(m) for m in moves],
        "analyses": [
            {
                "id": c.id,
                "source_type": c.source_type,
                "title": c.source_title,
                "summary": (c.summary or "")[:500],
                "sentiment": c.sentiment,
            }
            for c in contents
        ],
        "portfolio_holdings": portfolio_lines[:20],
        "watchlist": watch_lines[:20],
        "content_ids": content_ids,
        "signal_ids": signal_ids,
    }


def _sections_to_markdown(data: dict[str, Any]) -> str:
    parts: list[str] = []
    note = (data.get("portfolio_note") or "").strip()
    if note:
        parts.append(f"## 내 포트·관심\n\n{note}\n")
    for sec in data.get("sections") or []:
        if not isinstance(sec, dict):
            continue
        heading = (sec.get("heading") or "요약").strip()
        body = (sec.get("body") or "").strip()
        if body:
            parts.append(f"## {heading}\n\n{body}\n")
    if not parts:
        return (data.get("body") or data.get("summary") or "").strip()
    return "\n".join(parts).strip()


def _build_stats(db: Session, day: str) -> dict[str, Any]:
    events = collect_calendar_events(db, day, day, date_mode="event")
    briefing = _day_briefing_from_events(day, events)
    return briefing


def generate_daily_digest(
    db: Session,
    day: str,
    *,
    force: bool = False,
    analysis_provider: Optional[str] = None,
) -> IntelDailyDigest:
    """
    단일일 digest 생성/재생성. Gemini(JSON) 사용.
    """
    settings = get_settings()
    if is_demo_mode(db):
        raise ValueError("데모 모드에서는 일일 digest 생성을 지원하지 않습니다.")

    existing = get_digest(db, day)
    if existing and existing.status == "ready" and not force:
        return existing

    row = existing or IntelDailyDigest(date=day, status="pending")
    if not existing:
        db.add(row)
    else:
        row.status = "pending"
        row.error_message = None
    db.commit()
    db.refresh(row)

    sources = _collect_day_sources(db, day)
    total_items = (
        len(sources["macro_signals"])
        + len(sources["sector_signals"])
        + len(sources["stock_signals"])
        + len(sources["stock_issues"])
        + len(sources["price_moves"])
        + len(sources["analyses"])
    )
    if total_items == 0:
        row.status = "failed"
        row.error_message = f"{day}에 수집된 Signal·분석이 없습니다."
        row.generated_at = datetime.utcnow()
        db.commit()
        return row

    stats = _build_stats(db, day)
    prompt = f"""당신은 한국 주식 시장 인텔리전스 에디터입니다.
아래 JSON은 {day} 하루 동안 DB에 기록된 사실만 담고 있습니다.
**없는 뉴스·수치·종목을 지어내지 마세요.** 근거에 없으면 "데이터 없음"이라고 쓰세요.
투자 권유·매수 매도 지시는 하지 마세요. 참고용 브리핑 톤으로 작성하세요.

=== FACTS (JSON) ===
{json.dumps(sources, ensure_ascii=False, indent=2)}

=== STATS ===
{json.dumps(stats, ensure_ascii=False)}

다음 JSON만 출력하세요 (마크다운 코드블록 없이):
{{
  "title": "{day} 시장·섹터 브리핑 (한 줄 제목)",
  "sections": [
    {{ "heading": "매크로", "body": "..." }},
    {{ "heading": "섹터", "body": "..." }},
    {{ "heading": "주요 종목", "body": "..." }},
    {{ "heading": "리스크·체크리스트", "body": "..." }}
  ],
  "portfolio_note": "보유·관심 종목과 관련된 당일 요약 (없으면 빈 문자열)"
}}
"""

    try:
        from core.ai_analyzer import AIAnalyzer

        analyzer = AIAnalyzer(db)
        provider = analysis_provider or "gemini"
        result = analyzer.analyze_json_prompt(
            prompt, provider, log_label=f"일일 digest {day}"
        )
        if not result:
            raise RuntimeError("AI 분석 결과가 비어 있습니다.")

        body_md = _sections_to_markdown(result)
        row.title = (result.get("title") or f"{day} 일일 브리핑")[:300]
        row.body_markdown = body_md
        row.stats_json = json.dumps(stats, ensure_ascii=False)
        row.source_content_ids = json.dumps(sources["content_ids"])
        row.source_signal_ids = json.dumps(sources["signal_ids"])
        row.portfolio_highlight = json.dumps(
            {
                "portfolio": sources["portfolio_holdings"],
                "watchlist": sources["watchlist"],
                "portfolio_note": result.get("portfolio_note"),
            },
            ensure_ascii=False,
        )
        row.model = settings.gemini_model if provider == "gemini" else provider
        row.status = "ready"
        row.generated_at = datetime.utcnow()
        row.error_message = None
    except Exception as e:
        logger.exception("digest %s failed: %s", day, e)
        row.status = "failed"
        row.error_message = str(e)[:500]
        row.generated_at = datetime.utcnow()

    db.commit()
    db.refresh(row)
    return row


def backfill_digests(
    db: Session,
    from_date: str,
    to_date: str,
    *,
    force: bool = False,
    analysis_provider: Optional[str] = None,
) -> dict[str, Any]:
    """기간 내 각 일자 digest 생성."""
    start = datetime.strptime(from_date[:10], "%Y-%m-%d").date()
    end = datetime.strptime(to_date[:10], "%Y-%m-%d").date()
    results: list[dict[str, Any]] = []
    cur = start
    while cur <= end:
        day = cur.strftime("%Y-%m-%d")
        try:
            row = generate_daily_digest(
                db, day, force=force, analysis_provider=analysis_provider
            )
            results.append({"date": day, "status": row.status, "error": row.error_message})
        except ValueError as e:
            results.append({"date": day, "status": "skipped", "error": str(e)})
        except Exception as e:
            results.append({"date": day, "status": "failed", "error": str(e)[:200]})
        cur += timedelta(days=1)
    ok = sum(1 for r in results if r["status"] == "ready")
    return {"from": from_date, "to": to_date, "generated": ok, "results": results}


def generate_yesterday_digest(db: Session) -> Optional[IntelDailyDigest]:
    yesterday = (date.today() - timedelta(days=1)).strftime("%Y-%m-%d")
    existing = get_digest(db, yesterday)
    if existing and existing.status == "ready":
        return existing
    return generate_daily_digest(db, yesterday, force=False)
