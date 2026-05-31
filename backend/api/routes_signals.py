"""
api/routes_signals.py
신호(Signal) 집계 API
  GET  /api/intel/daily                              — 날짜별 브리핑
  GET  /api/intel/macro                              — 매크로 신호 목록
  GET  /api/intel/sectors                            — 섹터별 신호 집계
  GET  /api/intel/portfolio/remind                   — 보유 종목 관련 신호
  GET  /api/intel/stocks/{symbol}/shared-signals     — 종목 공유 신호 (차트)
  GET  /api/intel/stocks/{symbol}/related            — 날짜별 연관 분석
  POST /api/intel/signals/backfill                   — 기존 분석 백필
"""
import json
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from config.database import (
    get_db, Stock,
    IntelContent, MacroSignal, SectorSignal, StockSignal,
)
from core.signal_extractor import backfill_all_signals
from core.signal_related import find_related_analysis, get_shared_signals_for_stock

signals_router = APIRouter()


# ── 직렬화 헬퍼 ──────────────────────────────────────────────────
def _parse(val: Optional[str]) -> object:
    if not val:
        return None
    try:
        return json.loads(val)
    except Exception:
        return val


def _fmt_dt(dt: Optional[datetime]) -> Optional[str]:
    if not dt:
        return None
    return dt.strftime("%Y-%m-%d %H:%M")


def _serialize_content(c: IntelContent) -> dict:
    return {
        "id": c.id,
        "source_type": c.source_type,
        "source_url": c.source_url,
        "source_title": c.source_title,
        "channel_name": c.channel_name,
        "summary": c.summary,
        "sentiment": c.sentiment,
        "analyzed_at": _fmt_dt(c.analyzed_at),
    }


def _serialize_macro(m: MacroSignal) -> dict:
    return {
        "id": m.id,
        "content_id": m.content_id,
        "topic": m.topic,
        "summary": m.summary,
        "sentiment": m.sentiment,
        "impact": m.impact,
        "event_date": m.event_date,
        "created_at": _fmt_dt(m.created_at),
    }


def _serialize_sector(s: SectorSignal) -> dict:
    return {
        "id": s.id,
        "content_id": s.content_id,
        "sector": s.sector,
        "summary": s.summary,
        "sentiment": s.sentiment,
        "outlook": s.outlook,
        "mentioned_stocks": _parse(s.mentioned_stocks),
        "event_date": s.event_date,
        "created_at": _fmt_dt(s.created_at),
    }


def _serialize_stock_signal(ss: StockSignal) -> dict:
    return {
        "id": ss.id,
        "content_id": ss.content_id,
        "symbol": ss.symbol,
        "stock_name": ss.stock_name,
        "is_portfolio": ss.is_portfolio,
        "summary": ss.summary,
        "sentiment": ss.sentiment,
        "event_date": ss.event_date,
        "created_at": _fmt_dt(ss.created_at),
    }


# ── GET /api/intel/daily ─────────────────────────────────────────
@signals_router.get("/intel/daily")
def get_daily_briefing(
    days: int = Query(7, ge=1, le=30, description="최근 N일"),
    db: Session = Depends(get_db),
):
    """날짜별 브리핑: 최근 N일의 분석 수, 매크로·섹터·종목 신호 요약"""
    since = (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%d")

    contents = (
        db.query(IntelContent)
        .filter(IntelContent.analyzed_at >= since)
        .order_by(IntelContent.analyzed_at.desc())
        .all()
    )

    by_date: dict[str, dict] = {}
    for c in contents:
        day = (c.analyzed_at or c.created_at).strftime("%Y-%m-%d")
        if day not in by_date:
            by_date[day] = {
                "date": day,
                "content_count": 0,
                "macro_count": 0,
                "sector_count": 0,
                "stock_count": 0,
                "sentiment_counts": {"POSITIVE": 0, "NEUTRAL": 0, "NEGATIVE": 0},
                "top_topics": [],
                "contents": [],
            }
        by_date[day]["content_count"] += 1
        by_date[day]["macro_count"] += len(c.macro_signals)
        by_date[day]["sector_count"] += len(c.sector_signals)
        by_date[day]["stock_count"] += len(c.stock_signals)
        sent = c.sentiment or "NEUTRAL"
        by_date[day]["sentiment_counts"][sent] = by_date[day]["sentiment_counts"].get(sent, 0) + 1
        by_date[day]["contents"].append(_serialize_content(c))

    # top_topics per day
    for day, data in by_date.items():
        macro_rows = (
            db.query(MacroSignal)
            .join(IntelContent)
            .filter(MacroSignal.event_date == day)
            .all()
        )
        topic_counts: dict[str, int] = defaultdict(int)
        for m in macro_rows:
            topic_counts[m.topic] += 1
        data["top_topics"] = sorted(
            [{"topic": k, "count": v} for k, v in topic_counts.items()],
            key=lambda x: -x["count"],
        )[:5]

    return {"days": days, "since": since, "briefings": sorted(by_date.values(), key=lambda x: x["date"], reverse=True)}


# ── GET /api/intel/macro ─────────────────────────────────────────
@signals_router.get("/intel/macro")
def get_macro_signals(
    topic: Optional[str] = Query(None, description="특정 토픽 필터"),
    days: int = Query(30, ge=1, le=90),
    db: Session = Depends(get_db),
):
    """매크로 신호 목록 (최신순)"""
    since = (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%d")
    q = db.query(MacroSignal).filter(MacroSignal.event_date >= since)
    if topic:
        q = q.filter(MacroSignal.topic == topic)
    rows = q.order_by(MacroSignal.event_date.desc(), MacroSignal.created_at.desc()).all()

    topic_groups: dict[str, list] = defaultdict(list)
    for m in rows:
        topic_groups[m.topic].append(_serialize_macro(m))

    topics_list = [
        {"topic": t, "count": len(items), "signals": items}
        for t, items in sorted(topic_groups.items())
    ]
    return {
        "days": days,
        "total": len(rows),
        "topics": topics_list,
    }


# ── GET /api/intel/sectors ───────────────────────────────────────
@signals_router.get("/intel/sectors")
def get_sector_signals(
    sector: Optional[str] = Query(None),
    days: int = Query(30, ge=1, le=90),
    db: Session = Depends(get_db),
):
    """섹터 신호 집계"""
    since = (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%d")
    q = db.query(SectorSignal).filter(SectorSignal.event_date >= since)
    if sector:
        q = q.filter(SectorSignal.sector == sector)
    rows = q.order_by(SectorSignal.event_date.desc(), SectorSignal.created_at.desc()).all()

    sector_groups: dict[str, dict] = {}
    for s in rows:
        if s.sector not in sector_groups:
            sector_groups[s.sector] = {
                "sector": s.sector,
                "count": 0,
                "positive": 0,
                "neutral": 0,
                "negative": 0,
                "signals": [],
            }
        g = sector_groups[s.sector]
        g["count"] += 1
        sent = (s.sentiment or "NEUTRAL").upper()
        if sent == "POSITIVE":
            g["positive"] += 1
        elif sent == "NEGATIVE":
            g["negative"] += 1
        else:
            g["neutral"] += 1
        g["signals"].append(_serialize_sector(s))

    return {
        "days": days,
        "total": len(rows),
        "sectors": sorted(sector_groups.values(), key=lambda x: -x["count"]),
    }


# ── GET /api/intel/portfolio/remind ─────────────────────────────
@signals_router.get("/intel/portfolio/remind")
def get_portfolio_reminders(
    days: int = Query(30, ge=1, le=90),
    db: Session = Depends(get_db),
):
    """내 보유 종목에 대한 최근 신호 — 홈 화면 리마인드용"""
    since = (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%d")

    portfolio_stocks = db.query(Stock).filter(Stock.is_active == True).all()
    if not portfolio_stocks:
        return {"days": days, "reminders": []}

    symbol_set = {s.symbol for s in portfolio_stocks}
    stock_map = {s.symbol: s for s in portfolio_stocks}

    signals = (
        db.query(StockSignal)
        .filter(StockSignal.is_portfolio == True, StockSignal.event_date >= since)
        .order_by(StockSignal.event_date.desc())
        .all()
    )

    by_symbol: dict[str, dict] = {}
    for sig in signals:
        sym = sig.symbol or sig.stock_name
        if sym not in by_symbol:
            stock = stock_map.get(sym)
            by_symbol[sym] = {
                "symbol": sym,
                "stock_name": sig.stock_name,
                "current_price": stock.current_price if stock else None,
                "change_rate": stock.change_rate if stock else None,
                "signal_count": 0,
                "latest_date": sig.event_date,
                "latest_sentiment": sig.sentiment,
                "signals": [],
            }
        entry = by_symbol[sym]
        entry["signal_count"] += 1
        if sig.event_date and sig.event_date > entry["latest_date"]:
            entry["latest_date"] = sig.event_date
            entry["latest_sentiment"] = sig.sentiment
        entry["signals"].append(_serialize_stock_signal(sig))

    reminders = sorted(by_symbol.values(), key=lambda x: x["latest_date"] or "", reverse=True)
    return {"days": days, "total_signals": len(signals), "reminders": reminders}


# ── GET /api/intel/stocks/{symbol}/shared-signals ───────────────
@signals_router.get("/intel/stocks/{symbol}/shared-signals")
def get_stock_shared_signals(
    symbol: str,
    days: int = Query(90, ge=7, le=365),
    db: Session = Depends(get_db),
):
    """종목에 적용 가능한 섹터·매크로 공유 신호 (차트 매칭용)"""
    stock = db.query(Stock).filter(Stock.symbol == symbol).first()
    if not stock:
        raise HTTPException(status_code=404, detail=f"종목 없음: {symbol}")
    return get_shared_signals_for_stock(db, stock, days=days)


# ── GET /api/intel/stocks/{symbol}/related ──────────────────────
@signals_router.get("/intel/stocks/{symbol}/related")
def get_stock_related_analysis(
    symbol: str,
    date: str = Query(..., description="급변 날짜 YYYY-MM-DD"),
    window_days: int = Query(7, ge=1, le=30),
    limit: int = Query(10, ge=1, le=30),
    db: Session = Depends(get_db),
):
    """특정 날짜와 연관된 분석 목록 (키워드·섹터·매크로 점수순)"""
    stock = db.query(Stock).filter(Stock.symbol == symbol).first()
    if not stock:
        raise HTTPException(status_code=404, detail=f"종목 없음: {symbol}")
    items = find_related_analysis(db, stock, date, window_days=window_days, limit=limit)
    return {
        "symbol": symbol,
        "name": stock.name,
        "event_date": date,
        "window_days": window_days,
        "total": len(items),
        "related": items,
    }


# ── POST /api/intel/signals/backfill ────────────────────────────
@signals_router.post("/intel/signals/backfill")
def backfill_signals(db: Session = Depends(get_db)):
    """기존 IntelContent 전체 백필 (1회성)"""
    result = backfill_all_signals(db)
    return {"ok": True, "result": result}
