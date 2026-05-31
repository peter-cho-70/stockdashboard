"""
core/watchlist_service.py
관심 종목(지켜보기) 등록·조회
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Optional

from sqlalchemy.orm import Session

from config.database import Stock, WatchlistItem
from core.sector_peers import normalize_sector


def resolve_symbol_by_name(name: str) -> Optional[str]:
    """KRX 종목명 → 종목코드 (pykrx)."""
    try:
        from pykrx import stock as krx
        today = date.today().strftime("%Y%m%d")
        for market in ("KOSPI", "KOSDAQ"):
            try:
                tickers = krx.get_market_ticker_list(today, market=market)
            except Exception:
                continue
            for t in tickers:
                try:
                    if krx.get_market_ticker_name(t) == name:
                        return t
                except Exception:
                    continue
    except Exception:
        pass
    return None


def ensure_stock_for_watch(
    db: Session,
    *,
    stock_name: str,
    symbol: Optional[str] = None,
    sector: Optional[str] = None,
    market: str = "KRX",
) -> Optional[Stock]:
    """차트·시세용 Stock 레코드 확보 (qty=0)."""
    sym = symbol or resolve_symbol_by_name(stock_name)
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
    sym = symbol or resolve_symbol_by_name(stock_name)
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
    return {
        "id": item.id,
        "symbol": item.symbol,
        "stock_name": item.stock_name,
        "sector": item.sector,
        "source_type": item.source_type,
        "source_id": item.source_id,
        "memo": item.memo,
        "current_price": stock.current_price if stock else None,
        "change_rate": stock.change_rate if stock else None,
        "created_at": item.created_at.isoformat() if item.created_at else None,
    }
