"""
core/broker_types.py
브로커(KIS/키움) 공용 데이터클래스 — 잔고/체결/시세 응답을 동일한 모양으로 표준화해서
portfolio.py가 브로커 종류와 무관하게 합산·처리할 수 있게 한다.
"""
from dataclasses import dataclass


@dataclass
class BalanceItem:
    """잔고 종목 데이터 클래스"""
    symbol: str
    name: str
    market: str
    currency: str
    qty: float
    avg_price: float
    current_price: float
    purchase_amount: float
    eval_amount: float
    profit_loss: float
    profit_rate: float


@dataclass
class FillRecord:
    """일별 체결내역 데이터 클래스"""
    symbol: str
    name: str
    market: str
    side: str  # BUY | SELL
    qty: float
    price: float
    traded_at: str  # YYYY-MM-DD
    external_id: str  # 계좌+지점+주문번호+일자 dedup 키


@dataclass
class PriceData:
    """시세 데이터 클래스"""
    symbol: str
    current_price: float
    prev_price: float
    change_rate: float
    volume: float
    high_price: float
    low_price: float
    open_price: float


def merge_balance_pair(a: BalanceItem, b: BalanceItem) -> BalanceItem:
    """동일 종목코드 잔고 합산 (수량·매입금액 합산, 평단 가중평균)."""
    qty = a.qty + b.qty
    purchase_a = (a.qty * a.avg_price) if a.qty else a.purchase_amount
    purchase_b = (b.qty * b.avg_price) if b.qty else b.purchase_amount
    purchase_amount = purchase_a + purchase_b
    avg_price = (purchase_amount / qty) if qty > 0 else 0.0
    current = b.current_price or a.current_price
    eval_amount = qty * current if current else a.eval_amount + b.eval_amount
    profit_loss = eval_amount - purchase_amount
    profit_rate = (profit_loss / purchase_amount * 100) if purchase_amount > 0 else 0.0
    return BalanceItem(
        symbol=a.symbol,
        name=a.name or b.name,
        market=a.market or b.market,
        currency=a.currency or b.currency,
        qty=qty,
        avg_price=round(avg_price, 4),
        current_price=current,
        purchase_amount=round(purchase_amount, 2),
        eval_amount=round(eval_amount, 2),
        profit_loss=round(profit_loss, 2),
        profit_rate=round(profit_rate, 2),
    )
