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


def format_price_alert_message(
    *,
    name: str,
    symbol: str,
    change_rate: float,
    prev_close: float,
    current_price: float,
    currency: str,
) -> str:
    direction = "🚀 급등" if change_rate > 0 else "🔻 급락"
    unit = "원" if currency == "KRW" else currency
    if prev_close > 0:
        change_amount = current_price - prev_close
        price_part = (
            f"{prev_close:,.0f} → {current_price:,.0f}{unit} "
            f"({change_amount:+,.0f}{unit})"
        )
    else:
        price_part = f"{current_price:,.0f}{unit}"
    return (
        f"{direction} [{name}({symbol})] "
        f"전일 대비 {change_rate:+.2f}% ({price_part})"
    )


def check_price_move_alert(
    db: Session,
    stock: Stock,
    *,
    change_rate: float,
    prev_close: float,
    current_price: float,
    threshold: float = 5.0,
) -> list[dict]:
    """급등락(±threshold%) 알림 — target_* 알림과 동일한 엣지 트리거 패턴.
    임계값을 넘은 최초 1회만 알리고, 임계값 아래로 돌아오면 플래그를 풀어
    다음 급등락 때 다시 알릴 수 있게 한다. 이게 없으면 시세가 갱신될 때마다
    (스케줄러·수동 동기화·시작 시 캐치업 등) 같은 상황에 대해 알림이 계속 새로
    쌓여서, 한번 읽음 처리해도 다음 갱신에서 또 안 읽음으로 나타나게 된다."""
    alerts: list[dict] = []

    is_surge = change_rate >= threshold
    is_drop = change_rate <= -threshold

    if is_surge and not stock.price_surge_alerted:
        msg = format_price_alert_message(
            name=stock.name, symbol=stock.symbol, change_rate=change_rate,
            prev_close=prev_close, current_price=current_price, currency=stock.currency or "KRW",
        )
        db.add(AlertHistory(stock_symbol=stock.symbol, alert_type="PRICE_SURGE", message=msg, change_rate=change_rate))
        alerts.append({"symbol": stock.symbol, "name": stock.name, "change_rate": change_rate, "message": msg, "type": "PRICE_SURGE"})
        stock.price_surge_alerted = True
        logger.warning("⚠️ %s", msg)
    elif not is_surge and stock.price_surge_alerted:
        stock.price_surge_alerted = False

    if is_drop and not stock.price_drop_alerted:
        msg = format_price_alert_message(
            name=stock.name, symbol=stock.symbol, change_rate=change_rate,
            prev_close=prev_close, current_price=current_price, currency=stock.currency or "KRW",
        )
        db.add(AlertHistory(stock_symbol=stock.symbol, alert_type="PRICE_DROP", message=msg, change_rate=change_rate))
        alerts.append({"symbol": stock.symbol, "name": stock.name, "change_rate": change_rate, "message": msg, "type": "PRICE_DROP"})
        stock.price_drop_alerted = True
        logger.warning("⚠️ %s", msg)
    elif not is_drop and stock.price_drop_alerted:
        stock.price_drop_alerted = False

    return alerts
