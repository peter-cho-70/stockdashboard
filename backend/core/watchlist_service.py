"""
core/watchlist_service.py
관심 종목(지켜보기) 등록·조회
"""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy.orm import Session

from config.database import Stock, WatchlistItem
from core.sector_peers import normalize_sector
from core.stock_resolver import resolve_symbol
from core.watchlist_detail import resolve_name_from_symbol


def resolve_symbol_by_name(name: str, db: Optional[Session] = None) -> Optional[str]:
    """종목명 → 종목코드 (별칭·정적·pykrx)."""
    return resolve_symbol(name, db)


def ensure_stock_for_watch(
    db: Session,
    *,
    stock_name: str,
    symbol: Optional[str] = None,
    sector: Optional[str] = None,
    market: str = "KRX",
) -> Optional[Stock]:
    """차트·시세용 Stock 레코드 확보 (qty=0)."""
    sym = symbol or resolve_symbol_by_name(stock_name, db)
    if sym:
        existing = db.query(Stock).filter(Stock.symbol == sym).first()
        if existing:
            if sector and not existing.sector:
                existing.sector = sector
            existing.is_active = True
            return existing
        norm = normalize_sector(sector, sym)
        stock = Stock(
            symbol=sym,
            name=stock_name,
            market=market,
            sector=norm or sector,
            qty=0,
            avg_price=0,
            purchase_amount=0,
            is_active=True,
        )
        db.add(stock)
        db.flush()
        return stock
    return None


def add_to_watchlist(
    db: Session,
    *,
    stock_name: str,
    symbol: Optional[str] = None,
    sector: Optional[str] = None,
    source_type: Optional[str] = None,
    source_id: Optional[int] = None,
    memo: Optional[str] = None,
) -> WatchlistItem:
    sym = (symbol or "").strip() or None
    sym = sym or resolve_symbol_by_name(stock_name, db)
    if sym:
        official = resolve_name_from_symbol(sym)
        if official:
            stock_name = official
    existing = (
        db.query(WatchlistItem)
        .filter(WatchlistItem.stock_name == stock_name)
        .first()
    )
    if existing:
        if sym and not existing.symbol:
            existing.symbol = sym
        if sector:
            existing.sector = sector
        if memo:
            existing.memo = memo
        db.commit()
        db.refresh(existing)
        ensure_stock_for_watch(db, stock_name=stock_name, symbol=existing.symbol or sym, sector=sector)
        db.commit()
        return existing

    item = WatchlistItem(
        stock_name=stock_name,
        symbol=sym,
        sector=sector or normalize_sector(sector, sym),
        source_type=source_type,
        source_id=source_id,
        memo=memo,
    )
    db.add(item)
    db.flush()
    ensure_stock_for_watch(db, stock_name=stock_name, symbol=sym, sector=sector)
    db.commit()
    db.refresh(item)
    return item


def serialize_watchlist_item(item: WatchlistItem, stock: Optional[Stock] = None) -> dict:
    current = stock.current_price if stock and stock.current_price else None
    target = item.target_buy_price
    target_hit = False
    target_gap_pct: Optional[float] = None
    if target and target > 0 and current and current > 0:
        target_gap_pct = round((current - target) / target * 100, 2)
        target_hit = current <= target

    return {
        "id": item.id,
        "symbol": item.symbol,
        "stock_name": item.stock_name,
        "sector": item.sector,
        "source_type": item.source_type,
        "source_id": item.source_id,
        "memo": item.memo,
        "target_buy_price": target,
        "target_hit": target_hit,
        "target_gap_pct": target_gap_pct,
        "current_price": current,
        "change_rate": stock.change_rate if stock else None,
        "created_at": item.created_at.isoformat() if item.created_at else None,
    }
