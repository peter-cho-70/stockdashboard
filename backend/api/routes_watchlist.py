"""
api/routes_watchlist.py
관심 종목(지켜보기) + AI 추천 종목 API
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from config.database import Stock, WatchlistItem, get_db
from core.recommendations import get_stock_recommendations
from core.watchlist_service import add_to_watchlist, serialize_watchlist_item

watchlist_router = APIRouter()


class WatchlistCreate(BaseModel):
    stock_name: str
    symbol: Optional[str] = None
    sector: Optional[str] = None
    source_type: Optional[str] = "manual"
    source_id: Optional[int] = None
    memo: Optional[str] = None


@watchlist_router.get("/intel/recommendations")
def list_recommendations(
    sector: Optional[str] = Query(None),
    days: int = Query(30, ge=7, le=180),
    limit: int = Query(50, ge=1, le=100),
    db: Session = Depends(get_db),
):
    """섹터·AI 분석에서 언급된 추천 종목 (집계)"""
    items = get_stock_recommendations(db, sector=sector, days=days, limit=limit)
    return {"days": days, "sector": sector, "total": len(items), "recommendations": items}


@watchlist_router.get("/watchlist")
def get_watchlist(db: Session = Depends(get_db)):
    """관심 종목 목록"""
    items = db.query(WatchlistItem).order_by(WatchlistItem.created_at.desc()).all()
    result = []
    for item in items:
        stock = None
        if item.symbol:
            stock = db.query(Stock).filter(Stock.symbol == item.symbol).first()
        result.append(serialize_watchlist_item(item, stock))
    return {"total": len(result), "items": result}


@watchlist_router.post("/watchlist")
def create_watchlist_item(body: WatchlistCreate, db: Session = Depends(get_db)):
    """관심 종목 추가"""
    if not body.stock_name.strip():
        raise HTTPException(status_code=400, detail="stock_name 필요")
    item = add_to_watchlist(
        db,
        stock_name=body.stock_name.strip(),
        symbol=body.symbol,
        sector=body.sector,
        source_type=body.source_type,
        source_id=body.source_id,
        memo=body.memo,
    )
    stock = db.query(Stock).filter(Stock.symbol == item.symbol).first() if item.symbol else None
    return serialize_watchlist_item(item, stock)


@watchlist_router.delete("/watchlist/{item_id}")
def delete_watchlist_item(item_id: int, db: Session = Depends(get_db)):
    """관심 종목 삭제"""
    item = db.query(WatchlistItem).filter(WatchlistItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="항목 없음")
    db.delete(item)
    db.commit()
    return {"ok": True, "id": item_id}
