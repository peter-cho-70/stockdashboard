"""
core/intel_calendar.py
Signal·Content·Issue·PriceMove → 통합 캘린더 이벤트 집계
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from typing import Any, Optional

from sqlalchemy.orm import Session

from config.database import (
    IntelContent,
    MacroSignal,
    PriceMoveCause,
    SectorSignal,
    Stock,
    StockIssue,
    StockSignal,
    WatchlistItem,
)
from core.content_scope import is_market_scope


def _empty_sentiment() -> dict[str, int]:
    return {"POSITIVE": 0, "NEUTRAL": 0, "NEGATIVE": 0}


def _bump_sentiment(counts: dict[str, int], sentiment: Optional[str]) -> None:
    key = (sentiment or "NEUTRAL").upper()
    if key not in counts:
        key = "NEUTRAL"
    counts[key] = counts.get(key, 0) + 1


def _portfolio_symbols(db: Session) -> set[str]:
    rows = db.query(Stock.symbol).filter(Stock.is_active == True, Stock.qty > 0).all()
    return {r[0] for r in rows if r[0]}


def _watchlist_symbols(db: Session) -> set[str]:
    rows = db.query(WatchlistItem.symbol).filter(WatchlistItem.symbol.isnot(None)).all()
    return {r[0] for r in rows if r[0]}


def _day_key(d: date) -> str:
    return d.strftime("%Y-%m-%d")


def _iter_dates(from_d: date, to_d: date) -> list[str]:
    out: list[str] = []
    cur = from_d
    while cur <= to_d:
        out.append(_day_key(cur))
        cur += timedelta(days=1)
    return out


def _parse_iso(s: str) -> date:
    return datetime.strptime(s[:10], "%Y-%m-%d").date()


def _content_date(c: IntelContent, date_mode: str) -> Optional[str]:
    if date_mode == "analyzed":
        dt = c.analyzed_at or c.created_at
        return dt.strftime("%Y-%m-%d") if dt else None
    if c.published_at:
        return c.published_at.strftime("%Y-%m-%d")
    if c.analyzed_at:
        return c.analyzed_at.strftime("%Y-%m-%d")
    return c.created_at.strftime("%Y-%m-%d") if c.created_at else None


def _event_dict(
    *,
    eid: str,
    day: str,
    kind: str,
    title: str,
    summary: str = "",
    sentiment: Optional[str] = None,
    sector: Optional[str] = None,
    symbol: Optional[str] = None,
    stock_name: Optional[str] = None,
    source_type: Optional[str] = None,
    content_id: Optional[int] = None,
    source_url: Optional[str] = None,
    is_portfolio: bool = False,
    is_watchlist: bool = False,
    change_pct: Optional[float] = None,
) -> dict[str, Any]:
    return {
        "id": eid,
        "date": day,
        "kind": kind,
        "title": title,
        "summary": (summary or "")[:500],
        "sentiment": (sentiment or "NEUTRAL").upper() if sentiment else None,
        "sector": sector,
        "symbol": symbol,
        "stock_name": stock_name,
        "source_type": source_type,
        "content_id": content_id,
        "source_url": source_url,
        "is_portfolio": is_portfolio,
        "is_watchlist": is_watchlist,
        "change_pct": change_pct,
    }


def _passes_filters(
    ev: dict[str, Any],
    *,
    kinds: Optional[set[str]],
    portfolio_only: bool,
    watchlist_only: bool,
) -> bool:
    if kinds and ev["kind"] not in kinds:
        return False
    if portfolio_only and not ev.get("is_portfolio"):
        return False
    if watchlist_only and not ev.get("is_watchlist"):
        return False
    return True


def collect_calendar_events(
    db: Session,
    from_date: str,
    to_date: str,
    *,
    date_mode: str = "event",
    kinds: Optional[set[str]] = None,
    portfolio_only: bool = False,
    watchlist_only: bool = False,
) -> list[dict[str, Any]]:
    """기간 내 모든 캘린더 이벤트 (flat list)."""
    from_d = _parse_iso(from_date)
    to_d = _parse_iso(to_date)
    portfolio_syms = _portfolio_symbols(db)
    watch_syms = _watchlist_symbols(db)
    stock_by_id = {s.id: s for s in db.query(Stock).all()}

    events: list[dict[str, Any]] = []

    def in_range(day: Optional[str]) -> bool:
        if not day:
            return False
        try:
            d = _parse_iso(day)
            return from_d <= d <= to_d
        except ValueError:
            return False

    if date_mode == "analyzed":
        contents = (
            db.query(IntelContent)
            .filter(IntelContent.analyzed_at.isnot(None))
            .all()
        )
        for c in contents:
            if not is_market_scope(getattr(c, "content_scope", None)):
                continue
            day = _content_date(c, "analyzed")
            if not in_range(day):
                continue
            events.append(
                _event_dict(
                    eid=f"content-{c.id}",
                    day=day,
                    kind="content",
                    title=c.source_title or f"{c.source_type} 분석",
                    summary=c.summary or "",
                    sentiment=c.sentiment,
                    source_type=c.source_type,
                    content_id=c.id,
                    source_url=c.source_url,
                )
            )
    else:
        macros = db.query(MacroSignal).filter(MacroSignal.event_date.isnot(None)).all()
        for m in macros:
            if not in_range(m.event_date):
                continue
            events.append(
                _event_dict(
                    eid=f"macro-{m.id}",
                    day=m.event_date,
                    kind="macro",
                    title=m.topic,
                    summary=m.summary or m.impact or "",
                    sentiment=m.sentiment,
                    content_id=m.content_id,
                )
            )

        sectors = db.query(SectorSignal).filter(SectorSignal.event_date.isnot(None)).all()
        for s in sectors:
            if not in_range(s.event_date):
                continue
            events.append(
                _event_dict(
                    eid=f"sector-{s.id}",
                    day=s.event_date,
                    kind="sector",
                    title=s.sector,
                    summary=s.summary or s.outlook or "",
                    sentiment=s.sentiment,
                    sector=s.sector,
                    content_id=s.content_id,
                )
            )

        stock_sigs = db.query(StockSignal).filter(StockSignal.event_date.isnot(None)).all()
        for ss in stock_sigs:
            if not in_range(ss.event_date):
                continue
            sym = (ss.symbol or "").strip()
            events.append(
                _event_dict(
                    eid=f"stock-{ss.id}",
                    day=ss.event_date,
                    kind="stock",
                    title=ss.stock_name,
                    summary=ss.summary or "",
                    sentiment=ss.sentiment,
                    symbol=sym or None,
                    stock_name=ss.stock_name,
                    content_id=ss.content_id,
                    is_portfolio=bool(ss.is_portfolio),
                    is_watchlist=sym in watch_syms if sym else False,
                )
            )

        issues = db.query(StockIssue).filter(StockIssue.event_date.isnot(None)).all()
        for iss in issues:
            if not in_range(iss.event_date):
                continue
            st = stock_by_id.get(iss.stock_id)
            sym = st.symbol if st else None
            events.append(
                _event_dict(
                    eid=f"issue-{iss.id}",
                    day=iss.event_date,
                    kind="issue",
                    title=st.name if st else "종목 이슈",
                    summary=iss.issue_summary or "",
                    sentiment=iss.sentiment,
                    symbol=sym,
                    stock_name=st.name if st else None,
                    content_id=iss.content_id,
                    is_portfolio=sym in portfolio_syms if sym else False,
                    is_watchlist=sym in watch_syms if sym else False,
                )
            )

        moves = db.query(PriceMoveCause).all()
        for mv in moves:
            if not in_range(mv.event_date):
                continue
            st = stock_by_id.get(mv.stock_id)
            sym = st.symbol if st else None
            events.append(
                _event_dict(
                    eid=f"move-{mv.id}",
                    day=mv.event_date,
                    kind="price_move",
                    title=f"{st.name if st else sym} 급변",
                    summary=mv.reason[:500] if mv.reason else "",
                    sentiment=mv.sentiment,
                    symbol=sym,
                    stock_name=st.name if st else None,
                    is_portfolio=sym in portfolio_syms if sym else False,
                    is_watchlist=sym in watch_syms if sym else False,
                    change_pct=mv.change_pct,
                )
            )

        contents = db.query(IntelContent).all()
        for c in contents:
            if not is_market_scope(getattr(c, "content_scope", None)):
                continue
            day = _content_date(c, "event")
            if not in_range(day):
                continue
            if any(e["content_id"] == c.id and e["kind"] == "content" for e in events):
                continue
            events.append(
                _event_dict(
                    eid=f"content-{c.id}",
                    day=day,
                    kind="content",
                    title=c.source_title or f"{c.source_type} 분석",
                    summary=c.summary or "",
                    sentiment=c.sentiment,
                    source_type=c.source_type,
                    content_id=c.id,
                    source_url=c.source_url,
                )
            )

    if date_mode != "analyzed":
        from config.database import EconomicCalendarEvent

        econ_rows = (
            db.query(EconomicCalendarEvent)
            .filter(
                EconomicCalendarEvent.event_date >= from_date,
                EconomicCalendarEvent.event_date <= to_date,
            )
            .all()
        )
        imp_sent = {"high": "NEGATIVE", "medium": "NEUTRAL", "low": "NEUTRAL"}
        for row in econ_rows:
            if not in_range(row.event_date):
                continue
            events.append(
                _event_dict(
                    eid=f"economic-{row.id}",
                    day=row.event_date,
                    kind="economic",
                    title=row.title,
                    summary=row.summary or "",
                    sentiment=imp_sent.get((row.importance or "").lower(), "NEUTRAL"),
                    sector=row.region,
                    source_url=row.source_url,
                )
            )

    if kinds or portfolio_only or watchlist_only:
        events = [
            e
            for e in events
            if _passes_filters(
                e,
                kinds=kinds,
                portfolio_only=portfolio_only,
                watchlist_only=watchlist_only,
            )
        ]

    events.sort(key=lambda e: (e["date"], e["kind"], e["id"]))
    return events


def _day_meta(
    events: list[dict[str, Any]],
    *,
    has_digest: bool = False,
) -> dict[str, Any]:
    sentiment = _empty_sentiment()
    by_kind: dict[str, int] = defaultdict(int)
    for e in events:
        _bump_sentiment(sentiment, e.get("sentiment"))
        by_kind[e["kind"]] += 1
    return {
        "event_count": len(events),
        "sentiment": sentiment,
        "by_kind": dict(by_kind),
        "has_digest": has_digest,
    }


def build_calendar_response(
    db: Session,
    from_date: str,
    to_date: str,
    *,
    date_mode: str = "event",
    kinds: Optional[set[str]] = None,
    portfolio_only: bool = False,
    watchlist_only: bool = False,
    include_events: bool = False,
) -> dict[str, Any]:
    events = collect_calendar_events(
        db,
        from_date,
        to_date,
        date_mode=date_mode,
        kinds=kinds,
        portfolio_only=portfolio_only,
        watchlist_only=watchlist_only,
    )
    by_day: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for e in events:
        by_day[e["date"]].append(e)

    from core.intel_digest import digests_in_range

    digest_map = digests_in_range(db, from_date, to_date)

    from_d = _parse_iso(from_date)
    to_d = _parse_iso(to_date)
    days: dict[str, Any] = {}
    for day_str in _iter_dates(from_d, to_d):
        day_events = by_day.get(day_str, [])
        has_d = (
            day_str in digest_map
            and digest_map[day_str].get("status") == "ready"
        )
        meta = _day_meta(day_events, has_digest=has_d)
        if include_events:
            meta["events"] = day_events
        else:
            meta["events"] = []
        days[day_str] = meta

    kpi = _build_kpi(events, from_date, to_date)

    return {
        "from": from_date,
        "to": to_date,
        "date_mode": date_mode,
        "days": days,
        "digests": digest_map,
        "kpi": kpi,
        "total_events": len(events),
    }


def _build_kpi(events: list[dict], from_date: str, to_date: str) -> dict[str, Any]:
    sentiment = _empty_sentiment()
    sector_counts: dict[str, int] = defaultdict(int)
    content_count = 0
    portfolio_mentions = 0

    for e in events:
        _bump_sentiment(sentiment, e.get("sentiment"))
        if e["kind"] == "content":
            content_count += 1
        if e["kind"] == "sector" and e.get("sector"):
            sector_counts[e["sector"]] += 1
        if e.get("is_portfolio") or e.get("is_watchlist"):
            portfolio_mentions += 1

    total = len(events)
    top_sectors = sorted(
        [{"sector": k, "count": v} for k, v in sector_counts.items()],
        key=lambda x: -x["count"],
    )[:3]

    return {
        "from": from_date,
        "to": to_date,
        "content_count": content_count,
        "signal_count": sum(1 for e in events if e["kind"] in ("macro", "sector", "stock")),
        "total_events": total,
        "sentiment": sentiment,
        "top_sectors": top_sectors,
        "portfolio_related_count": portfolio_mentions,
    }


def build_calendar_day_response(
    db: Session,
    day: str,
    *,
    date_mode: str = "event",
    kinds: Optional[set[str]] = None,
    portfolio_only: bool = False,
    watchlist_only: bool = False,
) -> dict[str, Any]:
    events = collect_calendar_events(
        db,
        day,
        day,
        date_mode=date_mode,
        kinds=kinds,
        portfolio_only=portfolio_only,
        watchlist_only=watchlist_only,
    )
    from core.intel_digest import get_digest, serialize_digest

    digest_row = get_digest(db, day)
    has_d = bool(digest_row and digest_row.status == "ready" and digest_row.body_markdown)
    meta = _day_meta(events, has_digest=has_d)
    meta["events"] = events

    briefing = _day_briefing_from_events(day, events)
    digest_payload = None
    if digest_row and digest_row.status == "ready":
        digest_payload = serialize_digest(digest_row)
    elif digest_row and digest_row.status == "failed":
        digest_payload = serialize_digest(digest_row)

    return {
        "date": day,
        "date_mode": date_mode,
        "day": meta,
        "briefing": briefing,
        "digest": digest_payload,
        "disclaimer": "참고용 정보이며 투자 권유가 아닙니다.",
    }


def _day_briefing_from_events(day: str, events: list[dict]) -> dict[str, Any]:
    """일 뷰용 당일 요약 (기존 DailyBriefing 카드 대체)."""
    sentiment = _empty_sentiment()
    for e in events:
        _bump_sentiment(sentiment, e.get("sentiment"))
    return {
        "date": day,
        "content_count": sum(1 for e in events if e["kind"] == "content"),
        "macro_count": sum(1 for e in events if e["kind"] == "macro"),
        "sector_count": sum(1 for e in events if e["kind"] == "sector"),
        "stock_count": sum(1 for e in events if e["kind"] == "stock"),
        "issue_count": sum(1 for e in events if e["kind"] == "issue"),
        "price_move_count": sum(1 for e in events if e["kind"] == "price_move"),
        "economic_count": sum(1 for e in events if e["kind"] == "economic"),
        "sentiment_counts": sentiment,
        "event_count": len(events),
    }
