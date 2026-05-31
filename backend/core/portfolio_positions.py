"""
core/portfolio_positions.py
수동 잔고·매수/매도 처리
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Optional

from sqlalchemy.orm import Session

from config.database import PortfolioTrade, Stock


def recompute_purchase(stock: Stock) -> None:
    stock.purchase_amount = stock.qty * stock.avg_price


def serialize_stock(stock: Stock) -> dict:
    return {
        "id": stock.id,
        "symbol": stock.symbol,
        "name": stock.name,
        "market": stock.market,
        "sector": stock.sector,
        "currency": stock.currency,
        "qty": stock.qty,
        "avg_price": stock.avg_price,
        "current_price": stock.current_price,
        "change_rate": stock.change_rate,
        "profit_rate": stock.profit_rate,
        "profit_loss": stock.profit_loss,
        "current_value": stock.current_value,
        "memo": stock.memo,
        "position_source": stock.position_source or "kis",
        "last_synced_at": stock.last_synced_at.isoformat() if stock.last_synced_at else None,
    }


def get_stock_by_symbol(db: Session, symbol: str) -> Optional[Stock]:
    return db.query(Stock).filter(Stock.symbol == symbol).first()


def mark_manual(stock: Stock) -> None:
    stock.position_source = "manual"
    stock.updated_at = datetime.utcnow()


def apply_position(
    stock: Stock,
    *,
    qty: float,
    avg_price: float,
) -> None:
    if qty < 0:
        raise ValueError("수량은 0 이상이어야 합니다.")
    if qty > 0 and avg_price <= 0:
        raise ValueError("평균단가는 0보다 커야 합니다.")
    stock.qty = qty
    stock.avg_price = avg_price if qty > 0 else 0
    recompute_purchase(stock)
    stock.is_active = qty > 0
    mark_manual(stock)


def apply_buy(stock: Stock, qty: float, price: float) -> None:
    if qty <= 0 or price <= 0:
        raise ValueError("매수 수량·단가는 0보다 커야 합니다.")
    old_qty = stock.qty or 0
    old_avg = stock.avg_price or 0
    new_qty = old_qty + qty
    stock.avg_price = (old_qty * old_avg + qty * price) / new_qty if old_qty > 0 else price
    stock.qty = new_qty
    recompute_purchase(stock)
    stock.is_active = True
    if not stock.current_price:
        stock.current_price = price
    mark_manual(stock)


def apply_sell(stock: Stock, qty: float) -> None:
    if qty <= 0:
        raise ValueError("매도 수량은 0보다 커야 합니다.")
    if qty > (stock.qty or 0):
        raise ValueError(f"보유 수량({stock.qty})보다 많이 매도할 수 없습니다.")
    stock.qty = (stock.qty or 0) - qty
    recompute_purchase(stock)
    if stock.qty <= 0:
        stock.qty = 0
        stock.is_active = False
    mark_manual(stock)


def record_trade(
    db: Session,
    stock: Stock,
    *,
    side: str,
    qty: float,
    price: float,
    traded_at: Optional[str] = None,
    memo: Optional[str] = None,
) -> PortfolioTrade:
    day = traded_at or date.today().strftime("%Y-%m-%d")
    trade = PortfolioTrade(
        stock_id=stock.id,
        side=side.upper(),
        qty=qty,
        price=price,
        traded_at=day,
        memo=memo,
        source="manual",
    )
    db.add(trade)
    return trade


def execute_trade(
    db: Session,
    stock: Stock,
    *,
    side: str,
    qty: float,
    price: float,
    traded_at: Optional[str] = None,
    memo: Optional[str] = None,
) -> PortfolioTrade:
    side_u = side.upper()
    if side_u == "BUY":
        apply_buy(stock, qty, price)
    elif side_u == "SELL":
        apply_sell(stock, qty)
    else:
        raise ValueError("side는 BUY 또는 SELL 이어야 합니다.")
    return record_trade(db, stock, side=side_u, qty=qty, price=price, traded_at=traded_at, memo=memo)
