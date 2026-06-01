"""
core/watchlist_detail.py
관심 종목 상세 — 3개월 차트 요약·주요 사항 타임라인
"""
from __future__ import annotations

from datetime import date, timedelta
from typing import Optional

from sqlalchemy.orm import Session

from config.database import Stock, StockIssue


def resolve_name_from_symbol(symbol: str) -> Optional[str]:
    sym = (symbol or "").strip()
    if len(sym) != 6 or not sym.isdigit():
        return None
    try:
        from pykrx import stock as krx

        return krx.get_market_ticker_name(sym)
    except Exception:
        return None


def fetch_chart_records(symbol: str, period_days: int = 90) -> list[dict]:
    from pykrx import stock as krx

    end_date = date.today()
    start_date = end_date - timedelta(days=period_days)
    df = krx.get_market_ohlcv_by_date(
        start_date.strftime("%Y%m%d"),
        end_date.strftime("%Y%m%d"),
        symbol,
    )
    if df is None or df.empty:
        return []

    col_map = {c.lower(): c for c in df.columns}

    def gcol(row, kw_list):
        for kw in kw_list:
            if kw in col_map:
                return float(row[col_map[kw]])
        return 0.0

    records = []
    for idx, row in df.iterrows():
        date_str = idx.strftime("%Y-%m-%d") if hasattr(idx, "strftime") else str(idx)[:10]
        records.append({
            "date": date_str,
            "open": gcol(row, ["시가", "open"]),
            "high": gcol(row, ["고가", "high"]),
            "low": gcol(row, ["저가", "low"]),
            "close": gcol(row, ["종가", "close"]),
            "volume": gcol(row, ["거래량", "volume"]),
        })
    return records


def chart_period_summary(records: list[dict]) -> dict:
    if not records:
        return {
            "period_days": 0,
            "start_date": None,
            "end_date": None,
            "start_close": 0,
            "end_close": 0,
            "period_return_pct": 0,
            "high": 0,
            "low": 0,
            "avg_volume": 0,
        }
    closes = [r["close"] for r in records if r.get("close")]
    volumes = [r["volume"] for r in records if r.get("volume")]
    first = records[0]["close"]
    last = records[-1]["close"]
    ret = ((last - first) / first * 100) if first > 0 else 0
    return {
        "period_days": len(records),
        "start_date": records[0]["date"],
        "end_date": records[-1]["date"],
        "start_close": round(first, 0),
        "end_close": round(last, 0),
        "period_return_pct": round(ret, 2),
        "high": round(max(closes), 0) if closes else 0,
        "low": round(min(closes), 0) if closes else 0,
        "avg_volume": round(sum(volumes) / len(volumes), 0) if volumes else 0,
    }


def price_move_highlights(records: list[dict], threshold: float = 5.0) -> list[dict]:
    out = []
    for i in range(1, len(records)):
        prev = records[i - 1]["close"]
        cur = records[i]["close"]
        if prev <= 0:
            continue
        chg = (cur - prev) / prev * 100
        if abs(chg) < threshold:
            continue
        out.append({
            "date": records[i]["date"],
            "kind": "price_move",
            "title": f"{'급등' if chg > 0 else '급락'} {chg:+.1f}%",
            "summary": f"종가 {cur:,.0f}원 (전일 대비)",
            "sentiment": "POSITIVE" if chg > 0 else "NEGATIVE",
            "change_pct": round(chg, 2),
        })
    return out


def issues_for_timeline(db: Session, stock: Stock, since: str, limit: int = 30) -> list[dict]:
    rows = (
        db.query(StockIssue)
        .filter(StockIssue.stock_id == stock.id)
        .order_by(StockIssue.created_at.desc())
        .limit(limit * 2)
        .all()
    )
    out = []
    for i in rows:
        ev = i.event_date or (i.created_at.strftime("%Y-%m-%d") if i.created_at else "")
        if ev and ev < since:
            continue
        out.append({
            "date": ev or since,
            "kind": "ai_issue",
            "title": "AI 분석 이슈",
            "summary": (i.issue_summary or "")[:300],
            "sentiment": i.sentiment or "NEUTRAL",
            "source_title": i.content.source_title if i.content else None,
            "source_url": i.content.source_url if i.content else None,
            "issue_id": i.id,
        })
        if len(out) >= limit:
            break
    return out


def build_timeline(issues: list[dict], price_moves: list[dict], limit: int = 25) -> list[dict]:
    merged = issues + price_moves
    merged.sort(key=lambda x: x.get("date") or "", reverse=True)
    return merged[:limit]
