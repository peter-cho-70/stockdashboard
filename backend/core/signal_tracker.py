"""
core/signal_tracker.py
Signal → N일 후 주가 결과 역추적 및 적중률 집계 (AI 호출 없음)
"""
from __future__ import annotations

import logging
from collections import defaultdict
from datetime import date, datetime, timedelta
from typing import Any, Optional

from sqlalchemy.orm import Session

from config.database import (
    MacroSignal,
    PriceHistory,
    SectorSignal,
    SignalOutcome,
    Stock,
    StockSignal,
)
from core.sector_peers import sectors_match

logger = logging.getLogger(__name__)

CHECK_WINDOWS = (3, 5, 10, 20)
MACRO_AVG_SYMBOL = "__market_avg__"
MIN_SAMPLE_FOR_RATE = 10


def _parse_date(s: str) -> date:
    return datetime.strptime(s[:10], "%Y-%m-%d").date()


def _add_days(date_str: str, days: int) -> str:
    return (_parse_date(date_str) + timedelta(days=days)).strftime("%Y-%m-%d")


def _is_mature(event_date: str, check_days: int) -> bool:
    if not event_date:
        return False
    try:
        end = _parse_date(event_date) + timedelta(days=check_days)
        return end <= date.today()
    except ValueError:
        return False


def _sentiment_direction(sentiment: Optional[str]) -> Optional[bool]:
    """True=상승 예측, False=하락 예측, None=NEUTRAL(검증 제외)."""
    s = (sentiment or "NEUTRAL").upper()
    if s == "POSITIVE":
        return True
    if s == "NEGATIVE":
        return False
    return None


def _is_krx_stock(stock: Stock) -> bool:
    m = (stock.market or "").upper()
    return m in ("KRX", "KOSPI", "KOSDAQ", "") or stock.currency == "KRW"


def get_close_on_or_near(
    db: Session,
    stock_id: int,
    target: str,
    *,
    prefer_after: bool = False,
) -> Optional[float]:
    q = db.query(PriceHistory).filter(
        PriceHistory.stock_id == stock_id,
        PriceHistory.close_price > 0,
    )
    if prefer_after:
        row = (
            q.filter(PriceHistory.date >= target)
            .order_by(PriceHistory.date.asc())
            .first()
        )
    else:
        row = (
            q.filter(PriceHistory.date <= target)
            .order_by(PriceHistory.date.desc())
            .first()
        )
    return float(row.close_price) if row else None


def price_change_pct(
    db: Session,
    stock_id: int,
    event_date: str,
    check_days: int,
) -> Optional[float]:
    check_date = _add_days(event_date, check_days)
    before = get_close_on_or_near(db, stock_id, event_date, prefer_after=False)
    after = get_close_on_or_near(db, stock_id, check_date, prefer_after=True)
    if before and after and before > 0:
        return (after - before) / before * 100.0
    return None


def _outcome_exists(
    db: Session,
    signal_type: str,
    signal_id: int,
    symbol: str,
    check_days: int,
) -> bool:
    return (
        db.query(SignalOutcome.id)
        .filter(
            SignalOutcome.signal_type == signal_type,
            SignalOutcome.signal_id == signal_id,
            SignalOutcome.symbol == symbol,
            SignalOutcome.check_days == check_days,
        )
        .first()
        is not None
    )


def _record_outcome(
    db: Session,
    *,
    signal_type: str,
    signal_id: int,
    symbol: str,
    signal_date: str,
    signal_sentiment: Optional[str],
    check_days: int,
    actual_change: float,
    predicted_up: bool,
) -> None:
    check_date = _add_days(signal_date, check_days)
    actually_up = actual_change > 0
    db.add(
        SignalOutcome(
            signal_type=signal_type,
            signal_id=signal_id,
            symbol=symbol,
            signal_date=signal_date,
            signal_sentiment=signal_sentiment,
            check_days=check_days,
            check_date=check_date,
            actual_change=round(actual_change, 4),
            hit=(predicted_up == actually_up),
            hit_magnitude=round(abs(actual_change), 4),
        )
    )


def _stocks_for_sector_eval(db: Session, signal_sector: str) -> list[Stock]:
    stocks = db.query(Stock).filter(Stock.is_active == True).all()
    matched = [
        s
        for s in stocks
        if _is_krx_stock(s) and sectors_match(s.sector, signal_sector, s.symbol)
    ]
    if matched:
        return matched
    return [s for s in stocks if _is_krx_stock(s) and (s.qty or 0) > 0]


def _stocks_for_macro_eval(db: Session) -> list[Stock]:
    stocks = db.query(Stock).filter(Stock.is_active == True).all()
    krx = [s for s in stocks if _is_krx_stock(s)]
    with_history = []
    for s in krx:
        if (
            db.query(PriceHistory.id)
            .filter(PriceHistory.stock_id == s.id)
            .limit(1)
            .first()
        ):
            with_history.append(s)
    if with_history:
        return with_history
    return [s for s in krx if (s.qty or 0) > 0]


def _evaluate_stock_signal(
    db: Session,
    sig: StockSignal,
    check_days: int,
    stats: dict[str, int],
) -> None:
    if not sig.event_date or not _is_mature(sig.event_date, check_days):
        return
    predicted_up = _sentiment_direction(sig.sentiment)
    if predicted_up is None:
        stats["skipped_neutral"] += 1
        return
    sym = (sig.symbol or "").strip()
    if not sym:
        stats["skipped_no_symbol"] += 1
        return
    stock = db.query(Stock).filter(Stock.symbol == sym).first()
    if not stock or not _is_krx_stock(stock):
        stats["skipped_no_price"] += 1
        return
    if _outcome_exists(db, "stock", sig.id, sym, check_days):
        return
    change = price_change_pct(db, stock.id, sig.event_date, check_days)
    if change is None:
        stats["skipped_no_price"] += 1
        return
    _record_outcome(
        db,
        signal_type="stock",
        signal_id=sig.id,
        symbol=sym,
        signal_date=sig.event_date,
        signal_sentiment=sig.sentiment,
        check_days=check_days,
        actual_change=change,
        predicted_up=predicted_up,
    )
    stats["created"] += 1


def _evaluate_sector_signal(
    db: Session,
    sig: SectorSignal,
    check_days: int,
    stats: dict[str, int],
) -> None:
    if not sig.event_date or not _is_mature(sig.event_date, check_days):
        return
    predicted_up = _sentiment_direction(sig.sentiment)
    if predicted_up is None:
        stats["skipped_neutral"] += 1
        return

    priced: list[tuple[str, float]] = []
    for stock in _stocks_for_sector_eval(db, sig.sector):
        change = price_change_pct(db, stock.id, sig.event_date, check_days)
        if change is not None:
            priced.append((stock.symbol, change))

    if not priced:
        stats["skipped_no_price"] += 1
        return

    for sym, change in priced:
        if _outcome_exists(db, "sector", sig.id, sym, check_days):
            continue
        _record_outcome(
            db,
            signal_type="sector",
            signal_id=sig.id,
            symbol=sym,
            signal_date=sig.event_date,
            signal_sentiment=sig.sentiment,
            check_days=check_days,
            actual_change=change,
            predicted_up=predicted_up,
        )
        stats["created"] += 1

    avg_sym = f"__sector_avg__:{sig.sector}"
    if not _outcome_exists(db, "sector", sig.id, avg_sym, check_days):
        avg = sum(c for _, c in priced) / len(priced)
        _record_outcome(
            db,
            signal_type="sector",
            signal_id=sig.id,
            symbol=avg_sym,
            signal_date=sig.event_date,
            signal_sentiment=sig.sentiment,
            check_days=check_days,
            actual_change=avg,
            predicted_up=predicted_up,
        )
        stats["created"] += 1


def _evaluate_macro_signal(
    db: Session,
    sig: MacroSignal,
    check_days: int,
    stats: dict[str, int],
) -> None:
    if not sig.event_date or not _is_mature(sig.event_date, check_days):
        return
    predicted_up = _sentiment_direction(sig.sentiment)
    if predicted_up is None:
        stats["skipped_neutral"] += 1
        return
    if _outcome_exists(db, "macro", sig.id, MACRO_AVG_SYMBOL, check_days):
        return

    changes: list[float] = []
    for stock in _stocks_for_macro_eval(db):
        ch = price_change_pct(db, stock.id, sig.event_date, check_days)
        if ch is not None:
            changes.append(ch)
    if not changes:
        stats["skipped_no_price"] += 1
        return
    avg = sum(changes) / len(changes)
    _record_outcome(
        db,
        signal_type="macro",
        signal_id=sig.id,
        symbol=MACRO_AVG_SYMBOL,
        signal_date=sig.event_date,
        signal_sentiment=sig.sentiment,
        check_days=check_days,
        actual_change=avg,
        predicted_up=predicted_up,
    )
    stats["created"] += 1


def evaluate_signal_outcomes(
    db: Session,
    *,
    check_days_list: tuple[int, ...] = CHECK_WINDOWS,
) -> dict[str, Any]:
    """
    N일이 지난 Signal의 실제 주가 결과를 기록.
    Returns: 집계 통계 (created, skipped_*)
    """
    totals: dict[str, int] = defaultdict(int)

    for check_days in check_days_list:
        cutoff = (date.today() - timedelta(days=check_days)).strftime("%Y-%m-%d")
        sector_sigs = (
            db.query(SectorSignal)
            .filter(SectorSignal.event_date.isnot(None), SectorSignal.event_date <= cutoff)
            .all()
        )
        for sig in sector_sigs:
            stats = defaultdict(int)
            _evaluate_sector_signal(db, sig, check_days, stats)
            for k, v in stats.items():
                totals[k] += v

        macro_sigs = (
            db.query(MacroSignal)
            .filter(MacroSignal.event_date.isnot(None), MacroSignal.event_date <= cutoff)
            .all()
        )
        for sig in macro_sigs:
            stats = defaultdict(int)
            _evaluate_macro_signal(db, sig, check_days, stats)
            for k, v in stats.items():
                totals[k] += v

        stock_sigs = (
            db.query(StockSignal)
            .filter(StockSignal.event_date.isnot(None), StockSignal.event_date <= cutoff)
            .all()
        )
        for sig in stock_sigs:
            stats = defaultdict(int)
            _evaluate_stock_signal(db, sig, check_days, stats)
            for k, v in stats.items():
                totals[k] += v

    try:
        db.commit()
    except Exception as e:
        db.rollback()
        logger.exception("signal outcomes commit failed: %s", e)
        raise

    totals["total_outcomes"] = db.query(SignalOutcome).count()
    return dict(totals)


def _hit_rate(rows: list[SignalOutcome]) -> Optional[float]:
    scored = [r for r in rows if r.hit is not None]
    if not scored:
        return None
    return round(sum(1 for r in scored if r.hit) / len(scored), 4)


def _aggregate_bucket(rows: list[SignalOutcome]) -> dict[str, Any]:
    scored = [r for r in rows if r.hit is not None]
    rate = _hit_rate(rows)
    mags = [r.hit_magnitude for r in scored if r.hit_magnitude is not None]
    return {
        "hit_rate": rate,
        "sample_count": len(scored),
        "avg_magnitude": round(sum(mags) / len(mags), 2) if mags else None,
        "insufficient_data": len(scored) < MIN_SAMPLE_FOR_RATE,
    }


def get_signal_accuracy(db: Session) -> dict[str, Any]:
    """적중률 대시보드용 집계."""
    all_rows = db.query(SignalOutcome).filter(SignalOutcome.hit.isnot(None)).all()

    def by_type(signal_type: str) -> dict[str, Any]:
        typed = [r for r in all_rows if r.signal_type == signal_type]
        if not typed:
            return {
                "overall_hit_rate": None,
                "sample_count": 0,
                "by_check_days": {},
                "insufficient_data": True,
            }

        by_days: dict[str, dict] = {}
        for d in CHECK_WINDOWS:
            subset = [r for r in typed if r.check_days == d]
            by_days[str(d)] = _aggregate_bucket(subset)

        best_window = None
        best_rate = -1.0
        for d in CHECK_WINDOWS:
            bucket = by_days.get(str(d), {})
            hr = bucket.get("hit_rate")
            cnt = bucket.get("sample_count") or 0
            if hr is not None and cnt >= MIN_SAMPLE_FOR_RATE and hr > best_rate:
                best_rate = hr
                best_window = d

        overall = _aggregate_bucket(typed)
        result: dict[str, Any] = {
            "overall_hit_rate": overall["hit_rate"],
            "sample_count": overall["sample_count"],
            "avg_magnitude": overall["avg_magnitude"],
            "by_check_days": by_days,
            "insufficient_data": overall["insufficient_data"],
        }

        if signal_type == "sector":
            by_sector: dict[str, dict] = defaultdict(list)
            for r in typed:
                if r.symbol.startswith("__sector_avg__:"):
                    sector_name = r.symbol.split(":", 1)[-1]
                    by_sector[sector_name].append(r)
            result["by_sector"] = {
                sec: _aggregate_bucket(rows)
                for sec, rows in sorted(by_sector.items())
            }
        elif signal_type == "macro":
            by_topic: dict[str, list] = defaultdict(list)
            macro_ids = {r.signal_id for r in typed}
            macros = {
                m.id: m
                for m in db.query(MacroSignal).filter(MacroSignal.id.in_(macro_ids)).all()
            }
            for r in typed:
                m = macros.get(r.signal_id)
                topic = m.topic if m else "기타"
                by_topic[topic].append(r)
            result["by_topic"] = {
                topic: _aggregate_bucket(rows)
                for topic, rows in sorted(by_topic.items())
            }

        if best_window is not None:
            result["best_check_days"] = best_window
        return result

    sector = by_type("sector")
    macro = by_type("macro")
    stock = by_type("stock")

    global_best = None
    global_best_rate = -1.0
    for block in (sector, macro, stock):
        d = block.get("best_check_days")
        if d is None:
            continue
        hr = (block.get("by_check_days") or {}).get(str(d), {}).get("hit_rate")
        if hr is not None and hr > global_best_rate:
            global_best_rate = hr
            global_best = d

    return {
        "sector": sector,
        "macro": macro,
        "stock": stock,
        "best_signal_window_days": global_best,
        "total_outcomes": len(all_rows),
        "disclaimer": (
            "과거 Signal·가격 이력 기반 참고 지표이며, 미래 수익을 보장하지 않습니다. "
            f"표본 {MIN_SAMPLE_FOR_RATE}건 미만은 insufficient_data로 표시됩니다."
        ),
        "min_sample_for_rate": MIN_SAMPLE_FOR_RATE,
    }
