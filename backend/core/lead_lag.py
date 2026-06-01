"""
core/lead_lag.py
PriceMoveCause × Signal 교차 분석 — 선행 일수(lead_days) 집계
"""
from __future__ import annotations

import logging
import statistics
from collections import defaultdict
from datetime import date, datetime, timedelta
from typing import Any, Optional

from sqlalchemy.orm import Session

from config.database import (
    MacroSignal,
    PriceMoveCause,
    SectorSignal,
    SignalLeadLag,
    Stock,
    StockSignal,
)
from core.sector_peers import normalize_sector, sectors_match, stock_name_in_mentioned

logger = logging.getLogger(__name__)

LEAD_LAG_WINDOW_DAYS = 15
MIN_SAMPLE = 5


def _parse_date(s: str) -> date:
    return datetime.strptime(s[:10], "%Y-%m-%d").date()


def _date_diff_days(later: str, earlier: str) -> int:
    """later_date - earlier_date (일수)."""
    return (_parse_date(later) - _parse_date(earlier)).days


def _in_window(signal_date: str, move_date: str, window: int = LEAD_LAG_WINDOW_DAYS) -> bool:
    if not signal_date or not move_date:
        return False
    try:
        delta = abs(_date_diff_days(move_date, signal_date))
        return delta <= window
    except ValueError:
        return False


def _move_is_up(cause: PriceMoveCause) -> bool:
    if (cause.direction or "").lower() == "up":
        return True
    if (cause.direction or "").lower() == "down":
        return False
    return (cause.change_pct or 0) > 0


def _sentiment_aligned(sentiment: Optional[str], move_up: bool) -> bool:
    s = (sentiment or "NEUTRAL").upper()
    if s == "NEUTRAL":
        return True
    if s == "POSITIVE":
        return move_up
    if s == "NEGATIVE":
        return not move_up
    return True


def _pair_exists(
    db: Session,
    symbol: str,
    move_date: str,
    signal_type: str,
    signal_id: int,
) -> bool:
    return (
        db.query(SignalLeadLag.id)
        .filter(
            SignalLeadLag.symbol == symbol,
            SignalLeadLag.move_date == move_date,
            SignalLeadLag.signal_type == signal_type,
            SignalLeadLag.signal_id == signal_id,
        )
        .first()
        is not None
    )


def _add_pair(
    db: Session,
    *,
    stock: Stock,
    cause: PriceMoveCause,
    signal_type: str,
    signal_id: int,
    signal_date: str,
    signal_sentiment: Optional[str],
    macro_topic: Optional[str] = None,
    window_days: int = LEAD_LAG_WINDOW_DAYS,
) -> bool:
    if not signal_date or not cause.event_date:
        return False
    if not _in_window(signal_date, cause.event_date, window_days):
        return False
    if _pair_exists(db, stock.symbol, cause.event_date, signal_type, signal_id):
        return False

    lead_days = _date_diff_days(cause.event_date, signal_date)
    move_up = _move_is_up(cause)
    db.add(
        SignalLeadLag(
            symbol=stock.symbol,
            move_date=cause.event_date,
            move_pct=cause.change_pct,
            move_direction="up" if move_up else "down",
            signal_type=signal_type,
            signal_id=signal_id,
            signal_date=signal_date,
            signal_sentiment=signal_sentiment,
            lead_days=lead_days,
            sector=normalize_sector(stock.sector, stock.symbol),
            macro_topic=macro_topic,
            sentiment_aligned=_sentiment_aligned(signal_sentiment, move_up),
        )
    )
    return True


def compute_lead_lag(db: Session, *, window_days: int = LEAD_LAG_WINDOW_DAYS) -> dict[str, int]:
    """
    PriceMoveCause와 ±window_days 내 Signal을 매칭해 lead_lag 행 생성.
    """
    stats = defaultdict(int)

    try:
        causes = db.query(PriceMoveCause).order_by(PriceMoveCause.event_date.desc()).all()
        for cause in causes:
            stock = db.get(Stock, cause.stock_id)
            if not stock or not cause.event_date:
                stats["skipped_no_stock"] += 1
                continue

            move_up = _move_is_up(cause)
            from_d = (_parse_date(cause.event_date) - timedelta(days=window_days)).strftime(
                "%Y-%m-%d"
            )
            to_d = (_parse_date(cause.event_date) + timedelta(days=window_days)).strftime(
                "%Y-%m-%d"
            )

            macros = (
                db.query(MacroSignal)
                .filter(
                    MacroSignal.event_date.isnot(None),
                    MacroSignal.event_date >= from_d,
                    MacroSignal.event_date <= to_d,
                )
                .all()
            )
            for macro in macros:
                sent = (macro.sentiment or "").upper()
                if sent == "NEUTRAL":
                    continue
                if not _sentiment_aligned(macro.sentiment, move_up):
                    continue
                if _add_pair(
                    db,
                    stock=stock,
                    cause=cause,
                    signal_type="macro",
                    signal_id=macro.id,
                    signal_date=macro.event_date,
                    signal_sentiment=macro.sentiment,
                    macro_topic=macro.topic,
                    window_days=window_days,
                ):
                    stats["created"] += 1

            sector_sigs = (
                db.query(SectorSignal)
                .filter(
                    SectorSignal.event_date.isnot(None),
                    SectorSignal.event_date >= from_d,
                    SectorSignal.event_date <= to_d,
                )
                .all()
            )
            for sec in sector_sigs:
                if not sectors_match(stock.sector, sec.sector, stock.symbol):
                    continue
                sent = (sec.sentiment or "").upper()
                if sent == "NEUTRAL":
                    continue
                if _add_pair(
                    db,
                    stock=stock,
                    cause=cause,
                    signal_type="sector",
                    signal_id=sec.id,
                    signal_date=sec.event_date,
                    signal_sentiment=sec.sentiment,
                    window_days=window_days,
                ):
                    stats["created"] += 1

            stock_sigs = (
                db.query(StockSignal)
                .filter(
                    StockSignal.event_date.isnot(None),
                    StockSignal.event_date >= from_d,
                    StockSignal.event_date <= to_d,
                )
                .all()
            )
            sym = (stock.symbol or "").strip()
            for ss in stock_sigs:
                ss_sym = (ss.symbol or "").strip()
                matches = (ss_sym and ss_sym == sym) or stock_name_in_mentioned(
                    stock.name, [ss.stock_name]
                )
                if not matches:
                    continue
                sent = (ss.sentiment or "").upper()
                if sent == "NEUTRAL":
                    continue
                if _add_pair(
                    db,
                    stock=stock,
                    cause=cause,
                    signal_type="stock",
                    signal_id=ss.id,
                    signal_date=ss.event_date,
                    signal_sentiment=ss.sentiment,
                    window_days=window_days,
                ):
                    stats["created"] += 1

        db.commit()
    except Exception:
        db.rollback()
        raise

    stats["total_pairs"] = db.query(SignalLeadLag).count()
    return dict(stats)


def _bucket_stats(rows: list[SignalLeadLag]) -> dict[str, Any]:
    if not rows:
        return {
            "sample_count": 0,
            "avg_lead_days": None,
            "median_lead_days": None,
            "pct_signal_leads": None,
            "insufficient_data": True,
        }
    leads = [r.lead_days for r in rows]
    signal_leads = sum(1 for d in leads if d > 0)
    return {
        "sample_count": len(rows),
        "avg_lead_days": round(statistics.mean(leads), 2),
        "median_lead_days": round(statistics.median(leads), 2),
        "pct_signal_leads": round(signal_leads / len(leads), 3),
        "insufficient_data": len(rows) < MIN_SAMPLE,
    }


def _describe_lead(avg: Optional[float], signal_type: str) -> str:
    if avg is None:
        return ""
    label = {"macro": "매크로", "sector": "섹터", "stock": "종목"}.get(signal_type, signal_type)
    if avg > 1:
        return f"{label} Signal이 주가 급변보다 평균 {avg:.0f}일 앞섬"
    if avg < -1:
        return f"주가 급변이 {label} Signal보다 평균 {abs(avg):.0f}일 앞섬"
    return f"{label} Signal과 주가 급변이 거의 동시(±1일)"


def get_lead_lag_summary(
    db: Session,
    *,
    sector: Optional[str] = None,
    symbol: Optional[str] = None,
    aligned_only: bool = True,
    window_days: int = LEAD_LAG_WINDOW_DAYS,
) -> dict[str, Any]:
    """Lead-Lag 집계 API용."""
    q = db.query(SignalLeadLag)
    if symbol:
        q = q.filter(SignalLeadLag.symbol == symbol)
    if sector:
        canon = normalize_sector(sector)
        q = q.filter(SignalLeadLag.sector == canon)
    if aligned_only:
        q = q.filter(SignalLeadLag.sentiment_aligned == True)  # noqa: E712

    rows = q.all()
    by_type: dict[str, dict] = {}
    for st in ("macro", "sector", "stock"):
        subset = [r for r in rows if r.signal_type == st]
        by_type[st] = _bucket_stats(subset)

    sector_breakdown: dict[str, Any] = {}
    sectors_seen = sorted({r.sector or "미분류" for r in rows})
    for sec in sectors_seen:
        sec_rows = [r for r in rows if (r.sector or "미분류") == sec]
        sector_breakdown[sec] = {
            st: _bucket_stats([r for r in sec_rows if r.signal_type == st])
            for st in ("macro", "sector", "stock")
        }

    by_macro_topic: dict[str, dict] = {}
    macro_rows = [r for r in rows if r.signal_type == "macro" and r.macro_topic]
    topics = {r.macro_topic for r in macro_rows}
    for topic in sorted(topics):
        by_macro_topic[topic] = _bucket_stats([r for r in macro_rows if r.macro_topic == topic])

    insights: list[str] = []
    for sec, types in sector_breakdown.items():
        if sec == "미분류":
            continue
        scored: list[tuple[str, float]] = []
        for st in ("sector", "macro", "stock"):
            bucket = types.get(st) or {}
            avg = bucket.get("avg_lead_days")
            cnt = bucket.get("sample_count") or 0
            if avg is not None and cnt >= MIN_SAMPLE:
                scored.append((st, float(avg)))
        if len(scored) >= 2:
            scored.sort(key=lambda x: -x[1])
            best_st, best_avg = scored[0]
            second_st, second_avg = scored[1]
            if best_avg - second_avg >= 2:
                insights.append(
                    f"{sec}: {_describe_lead(best_avg, best_st)} "
                    f"({second_st} 대비 {best_avg - second_avg:.0f}일 우위)"
                )
        elif len(scored) == 1:
            st, avg = scored[0]
            line = _describe_lead(avg, st)
            if line:
                insights.append(f"{sec}: {line}")

    return {
        "window_days": window_days,
        "total_pairs": len(rows),
        "aligned_only": aligned_only,
        "by_type": by_type,
        "by_sector": sector_breakdown,
        "by_macro_topic": by_macro_topic,
        "insights": insights[:12],
        "min_sample": MIN_SAMPLE,
        "disclaimer": (
            "급변일(PriceMoveCause)과 Signal event_date의 상관 관계이며, "
            "인과관계·미래 예측을 보장하지 않습니다."
        ),
    }
