"""
core/trade_what_if.py
시나리오 계산기 — "불타기·물타기", "매수 시나리오", "매도 후 기회비용" 세 가지를
같은 TradeWhatIf 레코드(kind로 구분)와 평가 로직으로 처리한다.

kind="sell_opportunity" (매도 후 기회비용): "팔지 않았다면", "다른 종목으로 갈아탔다면" 비교.
  1. 가상 매도만 (아직 실행하지 않은 매도 가정)
  2. 가상 매도 + 다른 종목 가상매수 (교체매매 가정)
  3. 실제 체결된 매도(+매수) 내역(PortfolioTrade)을 선택해서 그대로 분석
kind="mixed" (불타기·물타기): 같은 종목에 대한 매도+매수를 동시에 가정, 현재가 기준 평가손익까지 계산.
kind="buydate" (매수 시나리오): 특정 날짜 종가로 매수했다고 가정, 현재가(또는 특정일) 기준 손익 계산.
"""
from __future__ import annotations

import json
from datetime import date, datetime, timedelta
from typing import Optional

from sqlalchemy.orm import Session

from config.database import TradeWhatIf, Stock, PortfolioTrade
from core.watchlist_detail import resolve_name_from_symbol
from core.tax import net_sell_proceeds


def resolve_price(symbol: str, as_of: Optional[str] = None) -> float:
    """symbol의 현재가(as_of=None) 또는 특정 날짜 종가. 휴장일이면 직전 거래일까지 역추적."""
    from pykrx import stock as krx

    if not as_of:
        from core.price_updater import fetch_krx_prices

        prices = fetch_krx_prices([symbol])
        p = prices.get(symbol)
        if p:
            return float(p["current_price"])
        as_of = date.today().strftime("%Y-%m-%d")

    target = datetime.strptime(as_of, "%Y-%m-%d")
    start = (target - timedelta(days=10)).strftime("%Y%m%d")
    end = target.strftime("%Y%m%d")
    df = krx.get_market_ohlcv_by_date(start, end, symbol)
    if df.empty:
        raise ValueError(f"{symbol}의 {as_of} 무렵 시세를 찾을 수 없습니다.")
    col_map = {c.lower(): c for c in df.columns}
    close_col = col_map.get("종가") or col_map.get("close")
    return float(df.iloc[-1][close_col])


def _parse_sell_trade_ids(wif: TradeWhatIf) -> list[int]:
    if wif.sell_trade_ids:
        try:
            parsed = json.loads(wif.sell_trade_ids)
            if isinstance(parsed, list):
                return [int(x) for x in parsed if x is not None]
        except (TypeError, ValueError, json.JSONDecodeError):
            pass
    if wif.sell_trade_id:
        return [wif.sell_trade_id]
    return []


def _aggregate_sell_legs(legs: list[dict]) -> dict:
    if not legs:
        raise ValueError("매도 체결 내역을 선택해야 합니다.")
    symbols = {leg["symbol"] for leg in legs}
    if len(symbols) > 1:
        raise ValueError("같은 종목의 매도 내역만 함께 선택할 수 있습니다.")

    total_qty = sum(leg["qty"] for leg in legs)
    total_amount = sum(leg["qty"] * leg["price"] for leg in legs)
    if total_qty <= 0:
        raise ValueError("매도 수량이 올바르지 않습니다.")

    dates = sorted(leg["date"] for leg in legs)
    return {
        "symbol": legs[0]["symbol"],
        "name": legs[0]["name"],
        "qty": total_qty,
        "price": total_amount / total_qty,
        "date": dates[-1],
        "date_from": dates[0],
        "date_to": dates[-1],
        "trade_ids": [leg["trade_id"] for leg in legs],
    }


def _legs_from_trade_ids(db: Session, trade_ids: list[int], expected_side: str) -> list[dict]:
    seen: set[int] = set()
    legs: list[dict] = []
    for trade_id in trade_ids:
        if trade_id in seen:
            continue
        seen.add(trade_id)
        legs.append(_leg_from_trade(db, trade_id, expected_side))
    return legs


def _leg_from_trade(db: Session, trade_id: int, expected_side: str) -> dict:
    trade = db.query(PortfolioTrade).filter(PortfolioTrade.id == trade_id).first()
    if not trade:
        raise ValueError(f"체결 내역을 찾을 수 없습니다: id={trade_id}")
    if trade.side.upper() != expected_side:
        raise ValueError(f"{expected_side} 내역이 아닙니다: id={trade_id}")
    stock = db.query(Stock).filter(Stock.id == trade.stock_id).first()
    return {
        "symbol": stock.symbol if stock else None,
        "name": stock.name if stock else None,
        "qty": trade.qty,
        "price": trade.price,
        "date": trade.traded_at,
        "trade_id": trade.id,
    }


def _create_sell_opportunity(
    db: Session,
    *,
    sell_symbol, sell_qty, sell_price, sell_date, sell_trade_id, sell_trade_ids,
    buy_symbol, buy_qty, buy_price, buy_date, buy_trade_id,
    memo,
) -> TradeWhatIf:
    source = "virtual"
    sell_avg_price = None
    sell_trade_ids_json = None

    trade_ids: list[int] = []
    if sell_trade_ids:
        trade_ids = [int(x) for x in sell_trade_ids if x is not None]
    elif sell_trade_id:
        trade_ids = [int(sell_trade_id)]

    if trade_ids:
        agg = _aggregate_sell_legs(_legs_from_trade_ids(db, trade_ids, "SELL"))
        sell_symbol = agg["symbol"]
        sell_qty = agg["qty"]
        sell_price = agg["price"]
        sell_date = agg["date_to"] if agg["date_from"] != agg["date_to"] else agg["date"]
        if agg["date_from"] != agg["date_to"]:
            sell_date = f"{agg['date_from']}~{agg['date_to']}"
        sell_name = agg["name"]
        sell_trade_id = agg["trade_ids"][0]
        sell_trade_ids_json = json.dumps(agg["trade_ids"])
        source = "real"
        if len(agg["trade_ids"]) > 1 and memo:
            memo = f"{len(agg['trade_ids'])}건 합산 · {memo}"
        elif len(agg["trade_ids"]) > 1:
            memo = f"{len(agg['trade_ids'])}건 합산"
    else:
        if not sell_symbol or not sell_qty or sell_qty <= 0 or not sell_price or sell_price <= 0:
            raise ValueError("매도 종목·수량·단가를 입력해야 합니다.")
        stock = db.query(Stock).filter(Stock.symbol == sell_symbol).first()
        if not stock:
            raise ValueError(f"보유 종목이 아닙니다: {sell_symbol}")
        if sell_qty > (stock.qty or 0):
            raise ValueError(f"보유 수량({stock.qty})보다 많이 매도할 수 없습니다.")
        sell_name = stock.name
        sell_avg_price = stock.avg_price or 0
        sell_date = sell_date or date.today().strftime("%Y-%m-%d")

    buy_name = None
    if buy_trade_id:
        leg = _leg_from_trade(db, buy_trade_id, "BUY")
        buy_symbol, buy_qty, buy_price, buy_date = (
            leg["symbol"], leg["qty"], leg["price"], leg["date"],
        )
        buy_name = leg["name"]
    elif buy_symbol:
        if not buy_qty or buy_qty <= 0 or not buy_price or buy_price <= 0:
            raise ValueError("매수 종목을 입력했다면 매수 수량·단가도 입력해야 합니다.")
        buy_name = resolve_name_from_symbol(buy_symbol)
        if not buy_name:
            raise ValueError(f"매수 종목을 찾을 수 없습니다: {buy_symbol}")
        buy_date = buy_date or sell_date

    return TradeWhatIf(
        kind="sell_opportunity",
        source=source,
        sell_symbol=sell_symbol,
        sell_name=sell_name,
        sell_qty=sell_qty,
        sell_price=sell_price,
        sell_avg_price=sell_avg_price,
        sell_date=sell_date,
        sell_trade_id=sell_trade_id,
        sell_trade_ids=sell_trade_ids_json,
        buy_symbol=buy_symbol,
        buy_name=buy_name,
        buy_qty=buy_qty if buy_symbol else None,
        buy_price=buy_price if buy_symbol else None,
        buy_date=buy_date if buy_symbol else None,
        buy_trade_id=buy_trade_id,
        memo=memo,
    )


def _create_mixed(
    db: Session,
    *,
    symbol, sell_qty, sell_price, buy_qty, buy_price, memo,
) -> TradeWhatIf:
    if not (sell_qty and sell_qty > 0) and not (buy_qty and buy_qty > 0):
        raise ValueError("매도 또는 매수 중 하나는 입력해야 합니다.")
    stock = db.query(Stock).filter(Stock.symbol == symbol).first()
    if not stock:
        raise ValueError(f"보유 종목이 아닙니다: {symbol}")
    if sell_qty and sell_qty > (stock.qty or 0):
        raise ValueError(f"보유 수량({stock.qty})보다 많이 매도할 수 없습니다.")

    today = date.today().strftime("%Y-%m-%d")
    return TradeWhatIf(
        kind="mixed",
        source="virtual",
        sell_symbol=symbol if sell_qty else None,
        sell_name=stock.name if sell_qty else None,
        sell_qty=sell_qty or None,
        sell_price=sell_price if sell_qty else None,
        sell_avg_price=stock.avg_price or 0,
        sell_date=today if sell_qty else None,
        buy_symbol=symbol if buy_qty else None,
        buy_name=stock.name if buy_qty else None,
        buy_qty=buy_qty or None,
        buy_price=buy_price if buy_qty else None,
        buy_date=today if buy_qty else None,
        position_qty_before=stock.qty or 0,
        memo=memo,
    )


def _create_buydate(
    db: Session,
    *,
    symbol, buy_qty, buy_price, buy_date, memo,
) -> TradeWhatIf:
    if not buy_qty or buy_qty <= 0 or not buy_price or buy_price <= 0 or not buy_date:
        raise ValueError("매수 날짜·수량·단가를 모두 입력해야 합니다.")
    name = resolve_name_from_symbol(symbol)
    if not name:
        raise ValueError(f"종목을 찾을 수 없습니다: {symbol}")

    return TradeWhatIf(
        kind="buydate",
        source="virtual",
        buy_symbol=symbol,
        buy_name=name,
        buy_qty=buy_qty,
        buy_price=buy_price,
        buy_date=buy_date,
        memo=memo,
    )


def create_what_if(
    db: Session,
    *,
    kind: str = "sell_opportunity",
    sell_symbol: Optional[str] = None,
    sell_qty: Optional[float] = None,
    sell_price: Optional[float] = None,
    sell_date: Optional[str] = None,
    sell_trade_id: Optional[int] = None,
    sell_trade_ids: Optional[list[int]] = None,
    buy_symbol: Optional[str] = None,
    buy_qty: Optional[float] = None,
    buy_price: Optional[float] = None,
    buy_date: Optional[str] = None,
    buy_trade_id: Optional[int] = None,
    memo: Optional[str] = None,
) -> TradeWhatIf:
    if kind == "mixed":
        symbol = sell_symbol or buy_symbol
        if not symbol:
            raise ValueError("종목을 지정해야 합니다.")
        wif = _create_mixed(db, symbol=symbol, sell_qty=sell_qty, sell_price=sell_price, buy_qty=buy_qty, buy_price=buy_price, memo=memo)
    elif kind == "buydate":
        symbol = buy_symbol or sell_symbol
        if not symbol:
            raise ValueError("종목을 지정해야 합니다.")
        wif = _create_buydate(db, symbol=symbol, buy_qty=buy_qty, buy_price=buy_price, buy_date=buy_date, memo=memo)
    else:
        wif = _create_sell_opportunity(
            db,
            sell_symbol=sell_symbol, sell_qty=sell_qty, sell_price=sell_price, sell_date=sell_date,
            sell_trade_id=sell_trade_id, sell_trade_ids=sell_trade_ids,
            buy_symbol=buy_symbol, buy_qty=buy_qty, buy_price=buy_price, buy_date=buy_date, buy_trade_id=buy_trade_id,
            memo=memo,
        )

    db.add(wif)
    db.commit()
    db.refresh(wif)
    return wif


def _evaluate_buydate(wif: TradeWhatIf, as_of: Optional[str]) -> dict:
    compare_price = resolve_price(wif.buy_symbol, as_of)
    pnl = net_sell_proceeds(wif.buy_qty, compare_price) - wif.buy_qty * wif.buy_price
    rate = (pnl / (wif.buy_qty * wif.buy_price) * 100) if wif.buy_price else 0
    return {
        "id": wif.id,
        "kind": wif.kind,
        "source": wif.source,
        "buy_symbol": wif.buy_symbol,
        "buy_name": wif.buy_name,
        "buy_qty": wif.buy_qty,
        "buy_price": wif.buy_price,
        "buy_date": wif.buy_date,
        "buy_compare_price": compare_price,
        "pnl": pnl,
        "pnl_rate": rate,
        "memo": wif.memo,
        "created_at": wif.created_at.isoformat() if wif.created_at else None,
        "as_of": as_of or date.today().strftime("%Y-%m-%d"),
    }


def _evaluate_mixed(wif: TradeWhatIf, as_of: Optional[str]) -> dict:
    symbol = wif.sell_symbol or wif.buy_symbol
    compare_price = resolve_price(symbol, as_of)
    avg_before = wif.sell_avg_price or 0
    qty_before = wif.position_qty_before or 0
    sell_qty = wif.sell_qty or 0
    buy_qty = wif.buy_qty or 0

    realized_pnl = net_sell_proceeds(sell_qty, wif.sell_price) - sell_qty * avg_before if sell_qty else 0.0
    remaining_qty = qty_before - sell_qty
    new_qty = remaining_qty + buy_qty
    new_avg = (
        (remaining_qty * avg_before + buy_qty * wif.buy_price) / new_qty
        if new_qty > 0 else 0.0
    )
    unrealized_pnl = new_qty * (compare_price - new_avg)

    return {
        "id": wif.id,
        "kind": wif.kind,
        "source": wif.source,
        "symbol": symbol,
        "name": wif.sell_name or wif.buy_name,
        "sell_qty": wif.sell_qty,
        "sell_price": wif.sell_price,
        "buy_qty": wif.buy_qty,
        "buy_price": wif.buy_price,
        "position_qty_before": qty_before,
        "avg_price_before": avg_before,
        "compare_price": compare_price,
        "realized_pnl": realized_pnl,
        "new_qty": new_qty,
        "new_avg": new_avg,
        "unrealized_pnl": unrealized_pnl,
        "total_pnl": realized_pnl + unrealized_pnl,
        "memo": wif.memo,
        "created_at": wif.created_at.isoformat() if wif.created_at else None,
        "as_of": as_of or date.today().strftime("%Y-%m-%d"),
    }


def _evaluate_sell_opportunity(wif: TradeWhatIf, as_of: Optional[str]) -> dict:
    sell_compare_price = resolve_price(wif.sell_symbol, as_of)
    holding_opportunity = wif.sell_qty * (sell_compare_price - wif.sell_price)

    sell_trade_ids = _parse_sell_trade_ids(wif)

    result = {
        "id": wif.id,
        "kind": wif.kind,
        "source": wif.source,
        "sell_symbol": wif.sell_symbol,
        "sell_name": wif.sell_name,
        "sell_qty": wif.sell_qty,
        "sell_price": wif.sell_price,
        "sell_avg_price": wif.sell_avg_price,
        "sell_date": wif.sell_date,
        "sell_trade_ids": sell_trade_ids or None,
        "sell_trade_count": len(sell_trade_ids) if sell_trade_ids else None,
        "sell_compare_price": sell_compare_price,
        "holding_opportunity": holding_opportunity,
        "buy_symbol": wif.buy_symbol,
        "buy_name": wif.buy_name,
        "buy_qty": wif.buy_qty,
        "buy_price": wif.buy_price,
        "buy_date": wif.buy_date,
        "memo": wif.memo,
        "created_at": wif.created_at.isoformat() if wif.created_at else None,
        "as_of": as_of or date.today().strftime("%Y-%m-%d"),
    }

    if wif.sell_avg_price is not None:
        result["realized_if_sold"] = net_sell_proceeds(wif.sell_qty, wif.sell_price) - wif.sell_qty * wif.sell_avg_price

    if wif.buy_symbol:
        buy_compare_price = resolve_price(wif.buy_symbol, as_of)
        buy_pnl = wif.buy_qty * (buy_compare_price - wif.buy_price)
        result["buy_compare_price"] = buy_compare_price
        result["buy_pnl"] = buy_pnl
        result["switch_advantage"] = buy_pnl - holding_opportunity

    return result


def evaluate_what_if(wif: TradeWhatIf, as_of: Optional[str] = None) -> dict:
    if wif.kind == "buydate":
        return _evaluate_buydate(wif, as_of)
    if wif.kind == "mixed":
        return _evaluate_mixed(wif, as_of)
    return _evaluate_sell_opportunity(wif, as_of)


def list_recent_trades(
    db: Session,
    side: str,
    limit: int = 500,
    symbol: Optional[str] = None,
    start: Optional[str] = None,
    end: Optional[str] = None,
) -> list[dict]:
    """선택 UI용 — 실제 매도/매수 내역 (모든 종목 또는 종목·기간 필터)"""
    q = (
        db.query(PortfolioTrade, Stock)
        .join(Stock, Stock.id == PortfolioTrade.stock_id)
        .filter(PortfolioTrade.side == side.upper())
    )
    if symbol:
        q = q.filter(Stock.symbol == symbol)
    if start:
        q = q.filter(PortfolioTrade.traded_at >= start)
    if end:
        q = q.filter(PortfolioTrade.traded_at <= end)
    rows = (
        q.order_by(PortfolioTrade.traded_at.desc(), PortfolioTrade.id.desc())
        .limit(limit)
        .all()
    )
    return [
        {
            "trade_id": trade.id,
            "symbol": stock.symbol,
            "name": stock.name,
            "qty": trade.qty,
            "price": trade.price,
            "traded_at": trade.traded_at,
            "memo": trade.memo,
        }
        for trade, stock in rows
    ]
