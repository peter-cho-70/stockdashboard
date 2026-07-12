"""
core/leverage_analysis.py
대출(레버리지) 실행일 이후 매수한 종목의 투자 성과를 대출 이자비용과 비교한다.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy.orm import Session

from config.database import PortfolioTrade, Stock

DAYS_PER_MONTH = 30.4368


def _months_between(start: str, end: str) -> float:
    d1 = datetime.strptime(start[:10], "%Y-%m-%d")
    d2 = datetime.strptime(end[:10], "%Y-%m-%d")
    days = max((d2 - d1).days, 0)
    return days / DAYS_PER_MONTH


def analyze_leverage_investment(
    db: Session, *, start_date: str, principal: float, annual_rate: float
) -> dict[str, Any]:
    """대출 시작일 이후 매수한 종목들의 실현·추정 손익을 집계해 대출 이자비용과 비교한다."""
    buys = (
        db.query(PortfolioTrade)
        .filter(PortfolioTrade.side == "BUY")
        .filter(PortfolioTrade.traded_at >= start_date)
        .all()
    )

    months_elapsed = _months_between(start_date, datetime.utcnow().strftime("%Y-%m-%d"))
    monthly_interest = principal * (annual_rate / 100) / 12
    total_interest_cost = monthly_interest * months_elapsed

    if not buys:
        return {
            "start_date": start_date,
            "months_elapsed": round(months_elapsed, 2),
            "principal": principal,
            "annual_rate": annual_rate,
            "monthly_interest": round(monthly_interest, 0),
            "total_interest_cost": round(total_interest_cost, 0),
            "total_invested": 0,
            "total_realized_profit": 0,
            "investment_profit_post_loan_avg": 0,
            "investment_profit_overall_avg": 0,
            "net_profit_post_loan_avg": round(-total_interest_cost, 0),
            "net_profit_overall_avg": round(-total_interest_cost, 0),
            "net_return_on_principal_pct": round(-total_interest_cost / principal * 100, 2) if principal else 0.0,
            "items": [],
        }

    stock_ids = sorted({t.stock_id for t in buys})

    sells = (
        db.query(PortfolioTrade)
        .filter(PortfolioTrade.side == "SELL")
        .filter(PortfolioTrade.traded_at >= start_date)
        .filter(PortfolioTrade.stock_id.in_(stock_ids))
        .all()
    )

    by_stock_buy: dict[int, dict[str, float]] = {}
    for t in buys:
        agg = by_stock_buy.setdefault(t.stock_id, {"qty": 0.0, "cost": 0.0})
        agg["qty"] += t.qty
        agg["cost"] += t.qty * t.price

    realized_by_stock: dict[int, float] = {}
    sold_qty_by_stock: dict[int, float] = {}
    for t in sells:
        basis = t.avg_price_before if t.avg_price_before is not None else 0.0
        realized_by_stock[t.stock_id] = realized_by_stock.get(t.stock_id, 0.0) + (t.price - basis) * t.qty
        sold_qty_by_stock[t.stock_id] = sold_qty_by_stock.get(t.stock_id, 0.0) + t.qty

    stocks = {s.id: s for s in db.query(Stock).filter(Stock.id.in_(stock_ids)).all()}

    items: list[dict[str, Any]] = []
    total_invested = 0.0
    total_realized = 0.0
    total_unrealized_post_loan = 0.0
    total_unrealized_overall = 0.0

    for stock_id, agg in by_stock_buy.items():
        stock = stocks.get(stock_id)
        if not stock:
            continue
        post_loan_qty = agg["qty"]
        post_loan_avg_price = agg["cost"] / post_loan_qty if post_loan_qty else 0.0
        overall_avg_price = stock.avg_price or 0.0
        held_qty = stock.qty or 0.0
        current_price = stock.current_price or 0.0
        realized_profit = realized_by_stock.get(stock_id, 0.0)

        # 대출 후 매수분 중 실제로 아직 보유 중인 수량 (대출 후 매도분 차감, 전체 보유수량 상한)
        sold_qty = sold_qty_by_stock.get(stock_id, 0.0)
        post_loan_remaining_qty = min(max(post_loan_qty - sold_qty, 0.0), held_qty)

        unrealized_post_loan = (current_price - post_loan_avg_price) * post_loan_remaining_qty
        unrealized_overall = (current_price - overall_avg_price) * held_qty

        items.append({
            "symbol": stock.symbol,
            "name": stock.name,
            "post_loan_buy_qty": round(post_loan_qty, 4),
            "post_loan_avg_price": round(post_loan_avg_price, 2),
            "post_loan_cost": round(agg["cost"], 0),
            "post_loan_remaining_qty": round(post_loan_remaining_qty, 4),
            "overall_avg_price": round(overall_avg_price, 2),
            "held_qty": round(held_qty, 4),
            "current_price": round(current_price, 2),
            "realized_profit": round(realized_profit, 0),
            "unrealized_profit_post_loan_avg": round(unrealized_post_loan, 0),
            "unrealized_profit_overall_avg": round(unrealized_overall, 0),
        })
        total_invested += agg["cost"]
        total_realized += realized_profit
        total_unrealized_post_loan += unrealized_post_loan
        total_unrealized_overall += unrealized_overall

    investment_profit_post_loan_avg = total_realized + total_unrealized_post_loan
    investment_profit_overall_avg = total_realized + total_unrealized_overall

    return {
        "start_date": start_date,
        "months_elapsed": round(months_elapsed, 2),
        "principal": principal,
        "annual_rate": annual_rate,
        "monthly_interest": round(monthly_interest, 0),
        "total_interest_cost": round(total_interest_cost, 0),
        "total_invested": round(total_invested, 0),
        "total_realized_profit": round(total_realized, 0),
        "investment_profit_post_loan_avg": round(investment_profit_post_loan_avg, 0),
        "investment_profit_overall_avg": round(investment_profit_overall_avg, 0),
        "net_profit_post_loan_avg": round(investment_profit_post_loan_avg - total_interest_cost, 0),
        "net_profit_overall_avg": round(investment_profit_overall_avg - total_interest_cost, 0),
        "net_return_on_principal_pct": round(
            (investment_profit_post_loan_avg - total_interest_cost) / principal * 100, 2
        ) if principal else 0.0,
        "items": items,
    }
