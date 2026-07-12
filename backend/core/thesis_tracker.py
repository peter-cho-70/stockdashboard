"""
core/thesis_tracker.py
투자 가설 추적 (Phase 6, AI 호출 없음)

"왜 이 종목을 매수했는가"라는 가설(예: "반도체 업황 개선으로 실적 턴어라운드")을 등록해두면,
최근 7일 내 실제 Signal(매크로/섹터/종목)과 대조해 그 가설이 여전히 유효한지 자동 검증한다.
가설은 암묵적으로 긍정 논리이므로 POSITIVE Signal=지지, NEGATIVE Signal=반박으로 분류한다.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta
from typing import Any, Optional

from sqlalchemy.orm import Session

from config.database import InvestmentThesis, MacroSignal, SectorSignal, Stock, StockSignal
from core.sector_peers import sectors_match

logger = logging.getLogger(__name__)

VALID_CATEGORIES = {"macro", "sector", "product", "earnings"}
VALID_HORIZONS = {"short", "mid", "long"}
VALID_STATUSES = {"active", "confirmed", "invalidated", "expired"}

VALIDATION_WINDOW_DAYS = 7
MIN_VALIDATION_SAMPLE = 3
CONFIRM_THRESHOLD = 0.8
INVALIDATE_THRESHOLD = 0.2


def create_thesis(
    db: Session,
    *,
    stock_id: int,
    title: str,
    body: Optional[str],
    category: str,
    time_horizon: str = "mid",
) -> InvestmentThesis:
    if category not in VALID_CATEGORIES:
        raise ValueError(f"invalid category: {category}")
    if time_horizon not in VALID_HORIZONS:
        raise ValueError(f"invalid time_horizon: {time_horizon}")

    thesis = InvestmentThesis(
        stock_id=stock_id,
        title=title,
        body=body,
        category=category,
        time_horizon=time_horizon,
        status="active",
    )
    db.add(thesis)
    db.commit()
    db.refresh(thesis)
    return thesis


def _serialize(t: InvestmentThesis, stock: Optional[Stock]) -> dict[str, Any]:
    support = json.loads(t.supporting_signals) if t.supporting_signals else []
    contradict = json.loads(t.contradicting_signals) if t.contradicting_signals else []
    return {
        "id": t.id,
        "stock_id": t.stock_id,
        "symbol": stock.symbol if stock else None,
        "stock_name": stock.name if stock else None,
        "title": t.title,
        "body": t.body,
        "category": t.category,
        "time_horizon": t.time_horizon,
        "status": t.status,
        "supporting_signals": support,
        "contradicting_signals": contradict,
        "support_count": len(support),
        "contradict_count": len(contradict),
        "validation_score": t.validation_score,
        "last_validated_at": t.last_validated_at.isoformat() if t.last_validated_at else None,
        "created_at": t.created_at.isoformat() if t.created_at else None,
        "updated_at": t.updated_at.isoformat() if t.updated_at else None,
    }


def list_theses(db: Session, status: Optional[str] = None) -> list[dict[str, Any]]:
    q = db.query(InvestmentThesis)
    if status:
        q = q.filter(InvestmentThesis.status == status)
    rows = q.order_by(InvestmentThesis.created_at.desc()).all()
    stock_ids = {r.stock_id for r in rows}
    stocks = {s.id: s for s in db.query(Stock).filter(Stock.id.in_(stock_ids)).all()} if stock_ids else {}
    return [_serialize(r, stocks.get(r.stock_id)) for r in rows]


def update_thesis_status(db: Session, thesis_id: int, status: str) -> Optional[InvestmentThesis]:
    if status not in VALID_STATUSES:
        raise ValueError(f"invalid status: {status}")
    thesis = db.query(InvestmentThesis).filter(InvestmentThesis.id == thesis_id).first()
    if thesis is None:
        return None
    thesis.status = status
    thesis.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(thesis)
    return thesis


def _matching_signals(db: Session, thesis: InvestmentThesis, stock: Stock, window_start: str) -> list[dict[str, Any]]:
    if thesis.category == "macro":
        rows = db.query(MacroSignal).filter(MacroSignal.event_date >= window_start).all()
        return [{"id": r.id, "event_date": r.event_date, "sentiment": r.sentiment} for r in rows]
    if thesis.category == "sector":
        rows = db.query(SectorSignal).filter(SectorSignal.event_date >= window_start).all()
        return [
            {"id": r.id, "event_date": r.event_date, "sentiment": r.sentiment}
            for r in rows
            if sectors_match(stock.sector, r.sector, stock.symbol)
        ]
    # product | earnings — 종목 자체 언급 Signal
    rows = (
        db.query(StockSignal)
        .filter(StockSignal.symbol == stock.symbol, StockSignal.event_date >= window_start)
        .all()
    )
    return [{"id": r.id, "event_date": r.event_date, "sentiment": r.sentiment} for r in rows]


def validate_theses(db: Session) -> dict[str, int]:
    """활성 가설마다 최근 7일 Signal을 카테고리별로 매칭해 지지/반박을 재계산하고,
    표본 3건 이상에서 score>=0.8이면 confirmed, <=0.2면 invalidated로 전환."""
    stats = {"checked": 0, "confirmed": 0, "invalidated": 0, "insufficient_data": 0}
    window_start = (datetime.utcnow() - timedelta(days=VALIDATION_WINDOW_DAYS)).strftime("%Y-%m-%d")

    active = db.query(InvestmentThesis).filter(InvestmentThesis.status == "active").all()
    for thesis in active:
        stock = db.query(Stock).filter(Stock.id == thesis.stock_id).first()
        if stock is None:
            continue
        stats["checked"] += 1

        matched = _matching_signals(db, thesis, stock, window_start)
        support = [m for m in matched if m["sentiment"] == "POSITIVE"]
        contradict = [m for m in matched if m["sentiment"] == "NEGATIVE"]
        total = len(support) + len(contradict)

        thesis.supporting_signals = json.dumps(support)
        thesis.contradicting_signals = json.dumps(contradict)
        thesis.last_validated_at = datetime.utcnow()

        if total == 0:
            stats["insufficient_data"] += 1
            continue

        score = round(len(support) / total, 4)
        thesis.validation_score = score

        if total >= MIN_VALIDATION_SAMPLE and score >= CONFIRM_THRESHOLD:
            thesis.status = "confirmed"
            stats["confirmed"] += 1
        elif total >= MIN_VALIDATION_SAMPLE and score <= INVALIDATE_THRESHOLD:
            thesis.status = "invalidated"
            stats["invalidated"] += 1
        else:
            stats["insufficient_data"] += 1

    db.commit()
    logger.info(
        "✅ 투자 가설 검증 완료 — 점검 %d건, confirmed %d건, invalidated %d건, 표본부족/유지 %d건",
        stats["checked"], stats["confirmed"], stats["invalidated"], stats["insufficient_data"],
    )
    return stats
