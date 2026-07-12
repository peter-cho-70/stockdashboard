"""
api/routes_trade_journal.py — 매매습관 일지 (체결 건별 매수 근거/감정/목표·손절가,
매도 사유·복기 메모) 조회·수정 및 습관 분석 대시보드
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from config.database import get_db
from core.demo_mode import demo_write_blocked
from core.trade_journal import (
    JOURNAL_OPTIONS,
    compute_analysis,
    list_journal_trades,
    upsert_journal_entry,
)

trade_journal_router = APIRouter(prefix="/portfolio/journal", tags=["trade-journal"])


class TradeJournalUpdate(BaseModel):
    buy_reason: Optional[str] = None
    conviction: Optional[int] = None
    entry_emotion: Optional[str] = None
    target_price: Optional[float] = None
    stop_price: Optional[float] = None
    sell_reason: Optional[str] = None
    note: Optional[str] = None


@trade_journal_router.get("")
def get_journal(
    start: Optional[str] = None,
    end: Optional[str] = None,
    symbol: Optional[str] = None,
    side: Optional[str] = Query(None, description="ALL(기본)|BUY|SELL"),
    only_annotated: bool = False,
    limit: int = 500,
    offset: int = 0,
    db: Session = Depends(get_db),
):
    """매매일지 — 체결내역 + 매수 근거/감정/목표·손절가 + 매도 사유·복기 + 자동 계산 지표"""
    items, total = list_journal_trades(
        db,
        start=start,
        end=end,
        symbol=symbol,
        side=None if not side or side.upper() == "ALL" else side.upper(),
        only_annotated=only_annotated,
        limit=limit,
        offset=offset,
    )
    return {"trades": items, "total": total, "options": JOURNAL_OPTIONS}


@trade_journal_router.get("/analysis")
def get_journal_analysis(
    start: Optional[str] = None,
    end: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """매매습관 분석 — 승률·손익비·손절 준수율·익절 타이밍·감정별 승률 등"""
    return compute_analysis(db, start=start, end=end)


@trade_journal_router.put("/trades/{trade_id}")
def update_journal_entry(trade_id: int, body: TradeJournalUpdate, db: Session = Depends(get_db)):
    """체결 1건에 매매일지 기록 저장 (매수 체결엔 근거/확신도/감정/목표·손절가, 매도 체결엔 사유·복기)"""
    demo_write_blocked()
    try:
        entry = upsert_journal_entry(db, trade_id, body.dict(exclude_unset=True))
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return {
        "trade_id": entry.trade_id,
        "buy_reason": entry.buy_reason,
        "conviction": entry.conviction,
        "entry_emotion": entry.entry_emotion,
        "target_price": entry.target_price,
        "stop_price": entry.stop_price,
        "sell_reason": entry.sell_reason,
        "note": entry.note,
    }
