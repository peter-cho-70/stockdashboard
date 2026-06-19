"""
core/portfolio_positions.py
수동 잔고·매수/매도 처리
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Optional

from sqlalchemy.orm import Session

from config.database import PortfolioTrade, Stock
from core.tax import net_sell_proceeds


def recompute_purchase(stock: Stock) -> None:
    stock.purchase_amount = stock.qty * stock.avg_price


def target_price_flags(stock: Stock) -> dict:
    """매수/매도 희망가 도달 여부·격차(%) 계산"""
    current = stock.current_price
    buy_target = stock.target_buy_price
    sell_target = stock.target_sell_price

    target_buy_hit = False
    target_buy_gap_pct = None
    if buy_target and buy_target > 0 and current and current > 0:
        target_buy_gap_pct = round((current - buy_target) / buy_target * 100, 2)
        target_buy_hit = current <= buy_target

    target_sell_hit = False
    target_sell_gap_pct = None
    if sell_target and sell_target > 0 and current and current > 0:
        target_sell_gap_pct = round((current - sell_target) / sell_target * 100, 2)
        target_sell_hit = current >= sell_target

    return {
        "target_buy_price": buy_target,
        "target_sell_price": sell_target,
        "target_buy_hit": target_buy_hit,
        "target_sell_hit": target_sell_hit,
        "target_buy_gap_pct": target_buy_gap_pct,
        "target_sell_gap_pct": target_sell_gap_pct,
    }


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
        **target_price_flags(stock),
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


def apply_mixed_trade(
    stock: Stock,
    *,
    sell_qty: float = 0,
    sell_price: float = 0,
    buy_qty: float = 0,
    buy_price: float = 0,
) -> float:
    """불타기·물타기 등 매도+매수를 한 번에 반영. 매도를 먼저 처리해 실현손익을 구하고,
    그 다음 매수로 평단가를 갱신한다 (매도는 평단가에 영향을 주지 않으므로 순서 무관).
    실현손익(매도분, 세금·수수료 차감 후)을 반환한다."""
    if sell_qty <= 0 and buy_qty <= 0:
        raise ValueError("매도 또는 매수 중 하나는 입력해야 합니다.")

    realized_pnl = 0.0
    if sell_qty > 0:
        if sell_price <= 0:
            raise ValueError("매도 단가는 0보다 커야 합니다.")
        realized_pnl = net_sell_proceeds(sell_qty, sell_price) - sell_qty * (stock.avg_price or 0)
        apply_sell(stock, sell_qty)
    if buy_qty > 0:
        if buy_price <= 0:
            raise ValueError("매수 단가는 0보다 커야 합니다.")
        apply_buy(stock, buy_qty, buy_price)
    return realized_pnl


def compute_realized_pnl_by_trade(db: Session) -> dict[int, dict]:
    """전체 체결내역을 종목별·일자별로 재생해 매도 건별 세후 실현손익을 계산.
    같은 날 같은 종목의 체결은 하루 단위로 합산해 원가를 배분한다.
    동기화/입력된 체결내역 범위 내에서만 매수 원가를 추적하므로,
    그 이전에 매수한 물량은 종목의 현재/마지막 평균단가를 fallback 원가로 사용하고
    estimated=True로 표시한다. 수동 매도처럼 avg_price_before 스냅샷이 있으면 그 값을 우선한다."""
    rows = (
        db.query(PortfolioTrade, Stock)
        .join(Stock, Stock.id == PortfolioTrade.stock_id)
        .order_by(Stock.symbol, PortfolioTrade.traded_at, PortfolioTrade.id)
        .all()
    )
    state: dict[str, tuple[float, float]] = {}  # symbol -> (qty, avg_price)
    realized: dict[int, dict] = {}
    i = 0
    while i < len(rows):
        first_trade, stock = rows[i]
        symbol = stock.symbol
        traded_at = first_trade.traded_at
        day_trades: list[PortfolioTrade] = []
        while i < len(rows):
            trade, row_stock = rows[i]
            if row_stock.symbol != symbol or trade.traded_at != traded_at:
                break
            day_trades.append(trade)
            i += 1

        qty, avg = state.get(symbol, (0.0, 0.0))
        buys = [t for t in day_trades if t.side == "BUY"]
        sells = [t for t in day_trades if t.side == "SELL"]
        buy_qty = sum(t.qty for t in buys)
        buy_cost = sum(t.qty * t.price for t in buys)
        buy_avg = (buy_cost / buy_qty) if buy_qty > 0 else 0.0

        if sells:
            total_sell_qty = sum(t.qty for t in sells)
            snapshot_qty = sum(t.qty for t in sells if t.avg_price_before is not None)
            snapshot_cost = sum(t.qty * (t.avg_price_before or 0.0) for t in sells if t.avg_price_before is not None)

            if snapshot_qty == total_sell_qty and total_sell_qty > 0:
                avg_price_used = snapshot_cost / total_sell_qty
                estimated = False
            else:
                non_snapshot_qty = total_sell_qty - snapshot_qty
                opening_sell_qty = min(non_snapshot_qty, qty) if qty > 0 else 0.0
                same_day_buy_sell_qty = min(max(non_snapshot_qty - opening_sell_qty, 0.0), buy_qty)
                missing_qty = max(non_snapshot_qty - opening_sell_qty - same_day_buy_sell_qty, 0.0)
                fallback_avg = stock.avg_price or avg or buy_avg or 0.0
                if missing_qty > 0 and fallback_avg <= 0:
                    for trade in sells:
                        realized[trade.id] = {
                            "realized_pnl": None,
                            "estimated": True,
                            "avg_price_used": None,
                        }
                else:
                    cost_basis = (
                        snapshot_cost
                        + opening_sell_qty * avg
                        + same_day_buy_sell_qty * buy_avg
                        + missing_qty * fallback_avg
                    )
                    avg_price_used = (cost_basis / total_sell_qty) if total_sell_qty > 0 else 0.0
                    estimated = missing_qty > 0 or same_day_buy_sell_qty > 0 or snapshot_qty > 0
                    for trade in sells:
                        realized[trade.id] = {
                            "realized_pnl": net_sell_proceeds(trade.qty, trade.price) - trade.qty * avg_price_used,
                            "estimated": estimated,
                            "avg_price_used": avg_price_used,
                        }

            if total_sell_qty > 0 and all(t.id not in realized for t in sells):
                for trade in sells:
                    realized[trade.id] = {
                        "realized_pnl": net_sell_proceeds(trade.qty, trade.price) - trade.qty * avg_price_used,
                        "estimated": estimated,
                        "avg_price_used": avg_price_used,
                    }

            remaining_open_qty = max(qty - total_sell_qty, 0.0)
            buy_qty_consumed_by_same_day_sell = min(max(total_sell_qty - qty, 0.0), buy_qty)
            remaining_buy_qty = max(buy_qty - buy_qty_consumed_by_same_day_sell, 0.0)
            end_qty = remaining_open_qty + remaining_buy_qty
            if end_qty > 0:
                avg = (remaining_open_qty * avg + remaining_buy_qty * buy_avg) / end_qty
                qty = end_qty
            else:
                qty, avg = 0.0, 0.0
        elif buys:
            new_qty = qty + buy_qty
            avg = (qty * avg + buy_cost) / new_qty if new_qty > 0 else 0.0
            qty = new_qty

        state[symbol] = (qty, avg)
    return realized


def list_all_trades(
    db: Session,
    *,
    side: Optional[str] = None,
    symbol: Optional[str] = None,
    source: Optional[str] = None,
    start: Optional[str] = None,
    end: Optional[str] = None,
    limit: int = 500,
    offset: int = 0,
) -> tuple[list[dict], int]:
    """전 종목 매매내역 조회 (체결내역 페이지용) — (목록, 전체건수) 반환"""
    realized_map = compute_realized_pnl_by_trade(db)
    q = db.query(PortfolioTrade, Stock).join(Stock, Stock.id == PortfolioTrade.stock_id)
    if side:
        q = q.filter(PortfolioTrade.side == side.upper())
    if symbol:
        q = q.filter(Stock.symbol == symbol)
    if source:
        q = q.filter(PortfolioTrade.source == source)
    if start:
        q = q.filter(PortfolioTrade.traded_at >= start)
    if end:
        q = q.filter(PortfolioTrade.traded_at <= end)

    total = q.count()
    rows = (
        q.order_by(PortfolioTrade.traded_at.desc(), PortfolioTrade.id.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    items = [
        {
            "id": trade.id,
            "symbol": stock.symbol,
            "name": stock.name,
            "side": trade.side,
            "qty": trade.qty,
            "price": trade.price,
            "amount": trade.qty * trade.price,
            "traded_at": trade.traded_at,
            "source": trade.source,
            "memo": trade.memo,
            "realized_pnl": (realized_map.get(trade.id) or {}).get("realized_pnl") if trade.side == "SELL" else None,
            "realized_pnl_estimated": (realized_map.get(trade.id) or {}).get("estimated", False) if trade.side == "SELL" else False,
            "realized_avg_price": (realized_map.get(trade.id) or {}).get("avg_price_used") if trade.side == "SELL" else None,
        }
        for trade, stock in rows
    ]
    return items, total


def record_trade(
    db: Session,
    stock: Stock,
    *,
    side: str,
    qty: float,
    price: float,
    traded_at: Optional[str] = None,
    memo: Optional[str] = None,
    avg_price_before: Optional[float] = None,
) -> PortfolioTrade:
    day = traded_at or date.today().strftime("%Y-%m-%d")
    trade = PortfolioTrade(
        stock_id=stock.id,
        side=side.upper(),
        qty=qty,
        price=price,
        avg_price_before=avg_price_before,
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
    avg_price_before = stock.avg_price if side_u == "SELL" else None
    if side_u == "BUY":
        apply_buy(stock, qty, price)
    elif side_u == "SELL":
        apply_sell(stock, qty)
    else:
        raise ValueError("side는 BUY 또는 SELL 이어야 합니다.")
    return record_trade(
        db,
        stock,
        side=side_u,
        qty=qty,
        price=price,
        traded_at=traded_at,
        memo=memo,
        avg_price_before=avg_price_before,
    )
