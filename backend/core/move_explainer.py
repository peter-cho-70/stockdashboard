"""
core/move_explainer.py
주가 급등·급락 구간 AI 원인 검색 (뉴스 RSS + Claude/GPT/Gemini)

[신호 재사용 전략]
- 급변 날짜 ±7일 내 같은 섹터 또는 매크로 신호가 있으면 프롬프트에 컨텍스트로 주입
- AI 재호출을 줄이고 일관성 있는 분석 제공
"""
import json
import re
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta
from typing import Callable, Optional

import httpx
from sqlalchemy.orm import Session

from config.database import MacroSignal, PriceMoveCause, SectorSignal, Stock
from core.ai_analyzer import ProviderQuotaError, create_analyzer
from core.sector_peers import sectors_match
from core.signal_related import (
    build_reason_from_macro_signal,
    build_reason_from_sector_signal,
)

LogCallback = Callable[[dict], None]

EXPLAIN_PROMPT = """당신은 한국 주식 시장 애널리스트입니다.
아래 종목의 특정 날짜 주가 급변 원인을 뉴스·검색 결과를 바탕으로 분석하세요.

[종목] {name} ({symbol})
[섹터] {sector}
[날짜] {date}
[등락] {change_label} ({change_pct:+.2f}%)
[종가] {close_price}

[뉴스·검색 결과]
{news_block}
{signal_context}
JSON만 출력:
{{
  "reason": "2~4문장 한국어 — 해당 날짜 전후 급변의 핵심 원인",
  "sentiment": "POSITIVE 또는 NEGATIVE 또는 NEUTRAL",
  "key_factors": ["요인1", "요인2"],
  "confidence": "high 또는 medium 또는 low"
}}

뉴스에 명확한 근거가 없으면 confidence를 low로, reason에 불확실성을 명시하세요."""


def _fetch_google_news(stock_name: str, date: str, direction: str, max_items: int = 8) -> list[dict]:
    dir_word = "급등" if direction == "up" else "급락"
    queries = [
        f"{stock_name} {date}",
        f"{stock_name} {dir_word}",
        f"{stock_name} 주가 {date[:7]}",
    ]
    seen_titles: set[str] = set()
    items: list[dict] = []

    for q in queries:
        try:
            resp = httpx.get(
                "https://news.google.com/rss/search",
                params={"q": q, "hl": "ko", "gl": "KR", "ceid": "KR:ko"},
                timeout=12,
                follow_redirects=True,
                headers={"User-Agent": "Mozilla/5.0 (compatible; StockMind/1.0)"},
            )
            resp.raise_for_status()
            root = ET.fromstring(resp.text)
            for item in root.findall(".//item"):
                title_el = item.find("title")
                link_el = item.find("link")
                if title_el is None or not title_el.text:
                    continue
                title = title_el.text.strip()
                if title in seen_titles:
                    continue
                seen_titles.add(title)
                link = link_el.text.strip() if link_el is not None and link_el.text else ""
                pub = item.find("pubDate")
                pub_text = pub.text.strip() if pub is not None and pub.text else ""
                items.append({"title": title, "url": link, "published": pub_text})
                if len(items) >= max_items:
                    return items
        except Exception:
            continue
    return items


def _format_news_block(items: list[dict]) -> str:
    if not items:
        return "(관련 뉴스를 찾지 못했습니다. 일반적인 시장·섹터 맥락으로 추론하세요.)"
    lines = []
    for i, it in enumerate(items, 1):
        lines.append(f"{i}. {it['title']}")
        if it.get("published"):
            lines.append(f"   발행: {it['published']}")
        if it.get("url"):
            lines.append(f"   URL: {it['url']}")
    return "\n".join(lines)


def _fetch_related_signals(
    db: Session,
    stock: Stock,
    event_date: str,
    window_days: int = 7,
) -> tuple[list[MacroSignal], list[SectorSignal]]:
    """event_date ±window_days 범위의 매크로·섹터 신호 조회.

    섹터 매칭: stock.sector 값이 SectorSignal.sector에 부분 포함되거나 역포함.
    섹터 정보가 없을 경우 매크로만 반환.
    """
    dt = datetime.strptime(event_date, "%Y-%m-%d")
    since = (dt - timedelta(days=window_days)).strftime("%Y-%m-%d")
    until = (dt + timedelta(days=1)).strftime("%Y-%m-%d")

    macro_signals = (
        db.query(MacroSignal)
        .filter(MacroSignal.event_date >= since, MacroSignal.event_date <= until)
        .order_by(MacroSignal.event_date.desc())
        .limit(6)
        .all()
    )

    sector_signals: list[SectorSignal] = []
    rows = (
        db.query(SectorSignal)
        .filter(
            SectorSignal.event_date >= since,
            SectorSignal.event_date <= until,
        )
        .order_by(SectorSignal.event_date.desc())
        .limit(30)
        .all()
    )
    for row in rows:
        if sectors_match(stock.sector, row.sector, stock.symbol):
            sector_signals.append(row)
            if len(sector_signals) >= 6:
                break

    return macro_signals, sector_signals


def _try_reuse_shared_signal(
    db: Session,
    stock: Stock,
    event_date: str,
    change_pct: float,
    direction: str,
    close_price: Optional[float],
    sector_signals: list[SectorSignal],
    macro_signals: list[MacroSignal],
    on_log: Optional[LogCallback],
) -> Optional[PriceMoveCause]:
    """동일 날짜 섹터·매크로 신호가 있으면 AI 없이 PriceMoveCause 저장."""
    # 1) 동일 날짜 섹터 신호 우선
    same_day_sector = [s for s in sector_signals if s.event_date == event_date and (s.summary or "").strip()]
    if same_day_sector:
        sig = same_day_sector[0]
        reason = build_reason_from_sector_signal({
            "summary": sig.summary,
            "outlook": sig.outlook,
        })
        row = _upsert_move_cause(
            db, stock, event_date, change_pct, direction, close_price,
            reason=reason,
            sentiment=sig.sentiment or "NEUTRAL",
            key_factors=[sig.sector, "섹터 공유 신호"],
            confidence="medium",
            provider="sector_reuse",
        )
        if on_log:
            on_log({"level": "info", "msg": f"♻️ 섹터 신호 재사용 ({sig.sector}, AI 호출 생략)", "ts": _ts()})
        return row

    # 2) 동일 날짜 매크로 신호
    same_day_macro = [m for m in macro_signals if m.event_date == event_date and (m.summary or "").strip()]
    if same_day_macro:
        sig = same_day_macro[0]
        reason = build_reason_from_macro_signal({
            "summary": sig.summary,
            "impact": sig.impact,
        })
        row = _upsert_move_cause(
            db, stock, event_date, change_pct, direction, close_price,
            reason=reason,
            sentiment=sig.sentiment or "NEUTRAL",
            key_factors=[sig.topic, "매크로 공유 신호"],
            confidence="medium",
            provider="macro_reuse",
        )
        if on_log:
            on_log({"level": "info", "msg": f"♻️ 매크로 신호 재사용 ({sig.topic}, AI 호출 생략)", "ts": _ts()})
        return row

    return None


def _upsert_move_cause(
    db: Session,
    stock: Stock,
    event_date: str,
    change_pct: float,
    direction: str,
    close_price: Optional[float],
    *,
    reason: str,
    sentiment: str,
    key_factors: list[str],
    confidence: str,
    provider: str,
    source_urls: list[str] | None = None,
) -> PriceMoveCause:
    existing = (
        db.query(PriceMoveCause)
        .filter(PriceMoveCause.stock_id == stock.id, PriceMoveCause.event_date == event_date)
        .first()
    )
    urls_json = json.dumps(source_urls or [], ensure_ascii=False)
    factors_json = json.dumps(key_factors, ensure_ascii=False)

    if existing:
        row = existing
        row.change_pct = change_pct
        row.direction = direction
        row.close_price = close_price
        row.reason = reason
        row.sentiment = sentiment
        row.key_factors = factors_json
        row.source_urls = urls_json
        row.confidence = confidence
        row.analysis_provider = provider
    else:
        row = PriceMoveCause(
            stock_id=stock.id,
            event_date=event_date,
            change_pct=change_pct,
            direction=direction,
            close_price=close_price,
            reason=reason,
            sentiment=sentiment,
            key_factors=factors_json,
            source_urls=urls_json,
            confidence=confidence,
            analysis_provider=provider,
        )
        db.add(row)
    db.commit()
    db.refresh(row)
    return row


def _build_signal_context(
    macro_signals: list[MacroSignal],
    sector_signals: list[SectorSignal],
) -> str:
    """신호들을 프롬프트 컨텍스트 블록으로 변환."""
    if not macro_signals and not sector_signals:
        return ""

    lines = ["\n[기존 AI 분석 컨텍스트 — 동일 기간 매크로·섹터 신호]"]
    for m in macro_signals:
        summary = (m.summary or "").strip()
        impact = (m.impact or "").strip()
        line = f"• [매크로/{m.topic}] ({m.event_date}) {summary}"
        if impact:
            line += f" → {impact}"
        lines.append(line)
    for s in sector_signals:
        summary = (s.summary or "").strip()
        outlook = (s.outlook or "").strip()
        line = f"• [섹터/{s.sector}] ({s.event_date}) {summary}"
        if outlook:
            line += f" / 전망: {outlook}"
        lines.append(line)
    lines.append("")
    return "\n".join(lines) + "\n"


def serialize_move_cause(row: PriceMoveCause) -> dict:
    return {
        "id": row.id,
        "event_date": row.event_date,
        "change_pct": row.change_pct,
        "direction": row.direction,
        "close_price": row.close_price,
        "reason": row.reason,
        "sentiment": row.sentiment,
        "key_factors": json.loads(row.key_factors or "[]"),
        "source_urls": json.loads(row.source_urls or "[]"),
        "confidence": row.confidence,
        "analysis_provider": row.analysis_provider,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


def explain_and_save(
    db: Session,
    stock: Stock,
    *,
    event_date: str,
    change_pct: float,
    direction: str,
    close_price: Optional[float] = None,
    analysis_provider: Optional[str] = None,
    force: bool = False,
    on_log: Optional[LogCallback] = None,
) -> tuple[Optional[PriceMoveCause], list]:
    """뉴스 수집 → AI 원인 분석 → DB 저장 (upsert)."""
    logs: list[dict] = []

    def _emit(level: str, msg: str):
        entry = {"level": level, "msg": msg, "ts": _ts()}
        logs.append(entry)
        if on_log:
            on_log(entry)

    if direction not in ("up", "down"):
        direction = "up" if change_pct >= 0 else "down"

    if not re.match(r"^\d{4}-\d{2}-\d{2}$", event_date):
        raise ValueError("event_date는 YYYY-MM-DD 형식이어야 합니다.")

    existing = (
        db.query(PriceMoveCause)
        .filter(PriceMoveCause.stock_id == stock.id, PriceMoveCause.event_date == event_date)
        .first()
    )
    if existing and not force:
        _emit("info", f"📦 저장된 AI 원인 반환 ({event_date}, AI 호출 생략)")
        return existing, logs

    analyzer = create_analyzer(db, on_log=on_log)
    logs = analyzer.logs

    _emit("info", f"🔍 {stock.name} {event_date} 원인 검색 시작")
    _emit("info", "📰 Google News RSS 수집 중...")

    news_items = _fetch_google_news(stock.name, event_date, direction)
    _emit("info", f"✅ 뉴스 {len(news_items)}건 수집")

    # 기존 신호 재사용
    macro_signals, sector_signals = _fetch_related_signals(db, stock, event_date)
    signal_context = _build_signal_context(macro_signals, sector_signals)
    if macro_signals or sector_signals:
        _emit(
            "info",
            f"♻️ 기존 신호 재사용 — 매크로 {len(macro_signals)}건, 섹터 {len(sector_signals)}건",
        )
    else:
        _emit("info", "ℹ️ 재사용 가능한 매크로·섹터 신호 없음")

    # 동일 날짜 섹터/매크로 신호 → AI 호출 없이 저장
    reused = _try_reuse_shared_signal(
        db, stock, event_date, change_pct, direction, close_price,
        sector_signals, macro_signals, on_log,
    )
    if reused:
        return reused, logs

    change_label = "급등" if direction == "up" else "급락"
    prompt = EXPLAIN_PROMPT.format(
        name=stock.name,
        symbol=stock.symbol,
        sector=stock.sector or "미분류",
        date=event_date,
        change_label=change_label,
        change_pct=change_pct,
        close_price=f"{close_price:,.0f}원" if close_price else "미상",
        news_block=_format_news_block(news_items),
        signal_context=signal_context,
    )

    result = analyzer.analyze_json_prompt(prompt, analysis_provider, log_label="급변 원인 분석")
    logs = analyzer.logs

    if not result or not result.get("reason"):
        if on_log:
            on_log({"level": "error", "msg": "❌ AI 원인 분석 실패", "ts": _ts()})
        return None, logs  # type: ignore[return-value]

    source_urls = [it["url"] for it in news_items if it.get("url")][:5]
    provider_used = analysis_provider or analyzer.default_provider

    row = _upsert_move_cause(
        db, stock, event_date, change_pct, direction, close_price,
        reason=result.get("reason", ""),
        sentiment=result.get("sentiment", "NEUTRAL"),
        key_factors=result.get("key_factors", []),
        confidence=result.get("confidence", "medium"),
        provider=provider_used,
        source_urls=source_urls,
    )

    if on_log:
        on_log({"level": "info", "msg": f"✅ 원인 저장 완료 (confidence: {row.confidence})", "ts": _ts()})

    return row, logs


def _ts() -> str:
    from datetime import datetime
    return datetime.utcnow().strftime("%H:%M:%S")


def get_move_causes_for_stock(
    db: Session,
    stock: Stock,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
) -> list[PriceMoveCause]:
    q = db.query(PriceMoveCause).filter(PriceMoveCause.stock_id == stock.id)
    if from_date:
        q = q.filter(PriceMoveCause.event_date >= from_date)
    if to_date:
        q = q.filter(PriceMoveCause.event_date <= to_date)
    return q.order_by(PriceMoveCause.event_date.desc()).all()
