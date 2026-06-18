"""
core/target_alerts.py
보유/관심 종목 매수·매도 희망가 도달 알림
가격이 갱신되는 모든 경로(KRX 갱신, KIS 동기화, 해외 동기화)에서 호출한다.
"""
import logging
from sqlalchemy.orm import Session

from config.database import AlertHistory, Stock, WatchlistItem

logger = logging.getLogger(__name__)


def _check_one(
    *,
    db: Session,
    symbol: str,
    name: str,
    current_price: float,
    target_buy_price: float | None,
    target_sell_price: float | None,
    buy_alerted: bool,
    sell_alerted: bool,
    set_buy_alerted,
    set_sell_alerted,
) -> list[dict]:
    """매수/매도 희망가 도달 여부를 확인하고 AlertHistory를 생성한다.
    크로스(도달) 시 1회만 알리고, 가격이 목표 반대편으로 돌아가면 플래그를 초기화해
    다음 번 재도달 시 다시 알릴 수 있게 한다."""
    alerts: list[dict] = []
    if not current_price or current_price <= 0:
        return alerts

    if target_buy_price and target_buy_price > 0:
        hit = current_price <= target_buy_price
        if hit and not buy_alerted:
            msg = (
                f"🎯 매수 희망가 도달 [{name}({symbol})] "
                f"현재가 {current_price:,.0f} ≤ 희망가 {target_buy_price:,.0f}"
            )
            db.add(AlertHistory(stock_symbol=symbol, alert_type="TARGET_BUY", message=msg))
            alerts.append({"symbol": symbol, "name": name, "type": "TARGET_BUY", "message": msg})
            set_buy_alerted(True)
            logger.info("🎯 %s", msg)
        elif not hit and buy_alerted:
            set_buy_alerted(False)

    if target_sell_price and target_sell_price > 0:
        hit = current_price >= target_sell_price
        if hit and not sell_alerted:
            msg = (
                f"💰 매도 희망가 도달 [{name}({symbol})] "
                f"현재가 {current_price:,.0f} ≥ 희망가 {target_sell_price:,.0f}"
            )
            db.add(AlertHistory(stock_symbol=symbol, alert_type="TARGET_SELL", message=msg))
            alerts.append({"symbol": symbol, "name": name, "type": "TARGET_SELL", "message": msg})
            set_sell_alerted(True)
            logger.info("💰 %s", msg)
        elif not hit and sell_alerted:
            set_sell_alerted(False)

    return alerts


def check_stock_targets(db: Session, stock: Stock) -> list[dict]:
    """보유 종목(Stock) 자체의 매수/매도 희망가 체크."""

    def set_buy(v: bool) -> None:
        stock.target_buy_alerted = v

    def set_sell(v: bool) -> None:
        stock.target_sell_alerted = v

    return _check_one(
        db=db,
        symbol=stock.symbol,
        name=stock.name,
        current_price=stock.current_price,
        target_buy_price=stock.target_buy_price,
        target_sell_price=stock.target_sell_price,
        buy_alerted=bool(stock.target_buy_alerted),
        sell_alerted=bool(stock.target_sell_alerted),
        set_buy_alerted=set_buy,
        set_sell_alerted=set_sell,
    )


def check_watchlist_targets_for_symbol(db: Session, symbol: str, current_price: float) -> list[dict]:
    """동일 종목코드를 추적하는 관심 종목(WatchlistItem)들의 희망가 체크."""
    if not symbol:
        return []
    items = db.query(WatchlistItem).filter(WatchlistItem.symbol == symbol).all()
    alerts: list[dict] = []
    for item in items:
        def set_buy(v: bool, _item=item) -> None:
            _item.target_buy_alerted = v

        def set_sell(v: bool, _item=item) -> None:
            _item.target_sell_alerted = v

        alerts.extend(
            _check_one(
                db=db,
                symbol=symbol,
                name=item.stock_name,
                current_price=current_price,
                target_buy_price=item.target_buy_price,
                target_sell_price=item.target_sell_price,
                buy_alerted=bool(item.target_buy_alerted),
                sell_alerted=bool(item.target_sell_alerted),
                set_buy_alerted=set_buy,
                set_sell_alerted=set_sell,
            )
        )
    return alerts


def check_all_targets_for_stock(db: Session, stock: Stock) -> list[dict]:
    """가격 갱신 직후 호출 — 보유 종목 자체 + 동일 심볼 관심 종목 희망가를 모두 체크."""
    alerts = check_stock_targets(db, stock)
    alerts.extend(check_watchlist_targets_for_symbol(db, stock.symbol, stock.current_price))
    return alerts
