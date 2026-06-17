"""
보유 종목 분석 — 일별·주별 변동 이슈 + 네이버 투자정보 통합
"""
from __future__ import annotations

import logging
from collections import defaultdict
from datetime import date, datetime, timedelta
from typing import Any, Optional

from sqlalchemy.orm import Session

from config.database import PriceMoveCause, Stock, StockIssue
from core.move_explainer import serialize_move_cause
from core.stock_basics import fetch_stock_basics
from core.watchlist_detail import fetch_chart_records

logger = logging.getLogger(__name__)

DAILY_THRESHOLD_PCT = 5.0
WEEKLY_THRESHOLD_PCT = 8.0
VOL_MIN_PCT = 3.0
VOL_SPIKE_RATIO = 1.8


def _avg_volume(records: list[dict], end_index: int, period: int = 20) -> float:
    start = max(0, end_index - period)
    slice_ = records[start:end_index]
    if not slice_:
        return 0.0
    return sum(r.get("volume") or 0 for r in slice_) / len(slice_)


def detect_daily_moves(records: list[dict], *, limit: int = 15) -> list[dict[str, Any]]:
    if len(records) < 2:
        return []

    raw: list[dict[str, Any]] = []
    for i in range(1, len(records)):
        prev = records[i - 1]
        bar = records[i]
        prev_close = prev.get("close") or 0
        close = bar.get("close") or 0
        if prev_close <= 0:
            continue
        change_pct = (close - prev_close) / prev_close * 100
        avg_vol = _avg_volume(records, i)
        volume = bar.get("volume") or 0
        volume_ratio = (volume / avg_vol) if avg_vol > 0 else 1.0

        is_big = abs(change_pct) >= DAILY_THRESHOLD_PCT
        is_vol = abs(change_pct) >= VOL_MIN_PCT and volume_ratio >= VOL_SPIKE_RATIO
        if not is_big and not is_vol:
            continue

        raw.append({
            "date": bar["date"],
            "period": "daily",
            "change_pct": round(change_pct, 2),
            "direction": "up" if change_pct >= 0 else "down",
            "close": round(close, 0),
            "volume_ratio": round(volume_ratio, 2),
            "label": f"{'급등' if change_pct > 0 else '급락'} {change_pct:+.1f}%",
        })

    deduped: list[dict[str, Any]] = []
    for m in reversed(raw):
        if deduped and deduped[-1]["direction"] == m["direction"]:
            last_date = deduped[-1]["date"]
            if abs((date.fromisoformat(m["date"]) - date.fromisoformat(last_date)).days) <= 2:
                if abs(m["change_pct"]) > abs(deduped[-1]["change_pct"]):
                    deduped[-1] = m
                continue
        deduped.append(m)

    deduped.reverse()
    return deduped[-limit:]


def detect_weekly_moves(records: list[dict], *, limit: int = 8) -> list[dict[str, Any]]:
    if len(records) < 5:
        return []

    weeks: dict[tuple[int, int], list[dict]] = defaultdict(list)
    for r in records:
        d = date.fromisoformat(r["date"])
        key = (d.isocalendar().year, d.isocalendar().week)
        weeks[key].append(r)

    week_keys = sorted(weeks.keys())
    weekly: list[dict[str, Any]] = []

    for i in range(1, len(week_keys)):
        prev_key = week_keys[i - 1]
        cur_key = week_keys[i]
        prev_close = weeks[prev_key][-1].get("close") or 0
        cur_close = weeks[cur_key][-1].get("close") or 0
        if prev_close <= 0:
            continue
        change_pct = (cur_close - prev_close) / prev_close * 100
        if abs(change_pct) < WEEKLY_THRESHOLD_PCT:
            continue
        cur_days = weeks[cur_key]
        week_start = cur_days[0]["date"]
        week_end = cur_days[-1]["date"]
        weekly.append({
            "week_key": f"{cur_key[0]}-W{cur_key[1]:02d}",
            "date": week_end,
            "week_start": week_start,
            "week_end": week_end,
            "period": "weekly",
            "change_pct": round(change_pct, 2),
            "direction": "up" if change_pct >= 0 else "down",
            "close": round(cur_close, 0),
            "label": f"주간 {'상승' if change_pct > 0 else '하락'} {change_pct:+.1f}%",
        })

    return weekly[-limit:]


def _issues_by_date(db: Session, stock: Stock, since: str) -> dict[str, list[dict]]:
    rows = (
        db.query(StockIssue)
        .filter(StockIssue.stock_id == stock.id)
        .order_by(StockIssue.created_at.desc())
        .limit(50)
        .all()
    )
    grouped: dict[str, list[dict]] = defaultdict(list)
    for row in rows:
        ev = row.event_date or (row.created_at.strftime("%Y-%m-%d") if row.created_at else "")
        if ev and ev < since:
            continue
        grouped[ev].append({
            "summary": (row.issue_summary or "")[:200],
            "sentiment": row.sentiment or "NEUTRAL",
            "source_title": row.content.source_title if row.content else None,
            "source_url": row.content.source_url if row.content else None,
        })
    return grouped


def _causes_by_date(db: Session, stock: Stock, since: str) -> dict[str, dict]:
    rows = (
        db.query(PriceMoveCause)
        .filter(PriceMoveCause.stock_id == stock.id, PriceMoveCause.event_date >= since)
        .order_by(PriceMoveCause.event_date.desc())
        .all()
    )
    return {r.event_date: serialize_move_cause(r) for r in rows}


def _attach_context(
    moves: list[dict[str, Any]],
    causes: dict[str, dict],
    issues: dict[str, list[dict]],
) -> list[dict[str, Any]]:
    enriched: list[dict[str, Any]] = []
    for move in moves:
        event_date = move.get("date") or ""
        cause = causes.get(event_date)
        day_issues = issues.get(event_date, [])
        reason = None
        cause_source = "none"
        if cause:
            reason = cause.get("reason")
            cause_source = "ai_saved"
        elif day_issues:
            reason = day_issues[0].get("summary")
            cause_source = "intel_issue"
        else:
            reason = (
                f"일간 {move['change_pct']:+.1f}% {move['label'].split()[0]} — "
                "저장된 원인 분석 없음 (차트에서 「원인 분석」 가능)"
                if move.get("period") == "daily"
                else f"{move['label']} — 주간 변동"
            )

        enriched.append({
            **move,
            "reason": reason,
            "cause_source": cause_source,
            "confidence": cause.get("confidence") if cause else None,
            "key_factors": cause.get("key_factors") if cause else [],
            "related_issues": day_issues[:2],
            "saved_cause_id": cause.get("id") if cause else None,
        })
    return list(reversed(enriched))


def _weekly_summaries(
    weekly_moves: list[dict[str, Any]],
    daily_enriched: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    summaries: list[dict[str, Any]] = []
    for wm in weekly_moves:
        start = wm.get("week_start") or ""
        end = wm.get("week_end") or ""
        inner = [
            d for d in daily_enriched
            if d.get("period") == "daily" and start <= (d.get("date") or "") <= end
        ]
        parts = [wm["label"]]
        if inner:
            parts.append(f"주중 급변 {len(inner)}건")
            top = max(inner, key=lambda x: abs(x.get("change_pct") or 0))
            parts.append(f"최대 {top['date']} {top['change_pct']:+.1f}%")
            if top.get("reason"):
                parts.append(top["reason"][:80])
        summaries.append({
            **wm,
            "summary": " · ".join(parts),
            "daily_moves_in_week": len(inner),
        })
    return summaries


def _build_headline(
    stock: Stock,
    daily: list[dict],
    weekly: list[dict],
    investment_info: dict,
) -> str:
    lines: list[str] = []
    if weekly:
        w = weekly[-1]
        lines.append(f"최근 주간 {w['change_pct']:+.1f}% ({w.get('week_start')}~{w.get('week_end')})")
    if daily:
        d = daily[-1]
        lines.append(f"최근 일간 {d['date']} {d['change_pct']:+.1f}%")
    target = investment_info.get("consensus_target_price") or investment_info.get("consensus_target_price_numeric")
    rating = investment_info.get("consensus_rating") or investment_info.get("consensus_rating_score")
    if rating or target:
        lines.append(f"컨센서스 {rating or ''} 목표 {target or ''}".strip())
    foreign = investment_info.get("foreign_exhaustion_rate") or investment_info.get("foreign_holding_rate")
    if foreign:
        lines.append(f"외국인 {foreign}")
    if not lines:
        return f"{stock.name} — 최근 뚜렷한 급변 구간 없음"
    return " · ".join(lines)


def build_holdings_analysis(
    db: Session,
    symbol: str,
    *,
    daily_days: int = 60,
    weekly_weeks: int = 12,
) -> dict[str, Any]:
    symbol = symbol.strip()
    stock = db.query(Stock).filter(Stock.symbol == symbol).first()
    if not stock:
        raise ValueError(f"종목 없음: {symbol}")

    is_holding = (stock.qty or 0) > 0
    basics = fetch_stock_basics(symbol)
    records = fetch_chart_records(symbol, period_days=max(daily_days, weekly_weeks * 7 + 14))
    since = (date.today() - timedelta(days=daily_days)).strftime("%Y-%m-%d")

    daily_raw = detect_daily_moves(records)
    weekly_raw = detect_weekly_moves(records)
    causes = _causes_by_date(db, stock, since)
    issues = _issues_by_date(db, stock, since)
    daily_issues = _attach_context(daily_raw, causes, issues)
    weekly_issues = _weekly_summaries(weekly_raw, daily_issues)

    headline = _build_headline(stock, daily_issues, weekly_issues, basics.get("investment_info") or {})

    result: dict[str, Any] = {
        "symbol": symbol,
        "name": stock.name,
        "is_holding": is_holding,
        "eligible": True,
        "headline": headline,
        "investment_info": basics.get("investment_info"),
        "quote": basics.get("quote"),
        "investment_table": basics.get("investment_table") or [],
        "quote_table": basics.get("quote_table") or [],
        "investor_trends": basics.get("investor_trends") or [],
        "financials": basics.get("financials"),
        "industry_peers": basics.get("industry_peers") or [],
        "research_reports": basics.get("research_reports") or [],
        "corporation_summary": basics.get("corporation_summary") or {},
        "overview": basics.get("overview"),
        "news": basics.get("news") or [],
        "daily_issues": daily_issues[-10:],
        "weekly_issues": weekly_issues[-6:],
        "fetched_at": datetime.utcnow().isoformat(),
        "source": "naver_finance+pykrx+signals",
    }
    if is_holding:
        result.update({
            "qty": stock.qty,
            "avg_price": stock.avg_price,
            "current_price": stock.current_price,
            "profit_rate": round(stock.profit_rate, 2),
        })
    else:
        result["message"] = "미보유 종목 — 투자정보·변동 이슈만 표시합니다."
    return result
