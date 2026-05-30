"""
core/price_updater.py
pykrx를 이용한 국내 주식 현재가 / 종가 갱신
KIS API 없이도 무료로 KRX 데이터 사용 가능
"""
import logging
from datetime import datetime, date, timedelta
from typing import Optional
from sqlalchemy.orm import Session

from config.database import Stock, PriceHistory, PortfolioSnapshot, AlertHistory

logger = logging.getLogger(__name__)


def get_latest_trading_date() -> str:
    """최근 거래일 반환 (주말/휴일 제외)"""
    d = date.today()
    # 토요일(5), 일요일(6) 이면 금요일로
    while d.weekday() >= 5:
        d -= timedelta(days=1)
    return d.strftime("%Y%m%d")


def fetch_krx_prices(symbols: list[str]) -> dict[str, dict]:
    """
    pykrx로 여러 종목 현재가/종가 일괄 조회
    반환: {symbol: {current_price, change_rate, open, high, low, volume}}
    """
    try:
        from pykrx import stock as krx
        import time

        trading_date = get_latest_trading_date()
        result = {}

        for symbol in symbols:
            try:
                df = krx.get_market_ohlcv_by_date(
                    trading_date, trading_date, symbol
                )
                if df.empty:
                    # 전일 데이터 시도
                    prev_date = (
                        date.today() - timedelta(days=1)
                    ).strftime("%Y%m%d")
                    df = krx.get_market_ohlcv_by_date(prev_date, prev_date, symbol)

                if not df.empty:
                    row = df.iloc[-1]
                    result[symbol] = {
                        "current_price": float(row.get("종가", row.get("Close", 0))),
                        "open_price": float(row.get("시가", row.get("Open", 0))),
                        "high_price": float(row.get("고가", row.get("High", 0))),
                        "low_price": float(row.get("저가", row.get("Low", 0))),
                        "volume": float(row.get("거래량", row.get("Volume", 0))),
                        "change_rate": float(row.get("등락률", row.get("등락률", 0))),
                    }
                time.sleep(0.1)  # 요청 간격 조절
            except Exception as e:
                logger.warning(f"⚠️ {symbol} 시세 조회 실패: {e}")

        return result

    except ImportError:
        logger.error("❌ pykrx 미설치. 'pip install pykrx' 실행 필요")
        return {}
    except Exception as e:
        logger.error(f"❌ pykrx 조회 오류: {e}")
        return {}


def update_prices_from_krx(db: Session, alert_threshold: float = 5.0) -> dict:
    """
    KRX 데이터로 보유 종목 현재가 갱신 + 5% 알림 체크
    KIS API 없이 사용 가능한 대안
    """
    stocks = db.query(Stock).filter(
        Stock.is_active == True,
        Stock.market == "KRX"
    ).all()

    if not stocks:
        return {"updated": 0, "alerts": []}

    symbols = [s.symbol for s in stocks]
    logger.info(f"📈 KRX 시세 갱신 시작: {len(symbols)}개 종목")

    prices = fetch_krx_prices(symbols)
    if not prices:
        logger.warning("KRX 시세 데이터 없음 (장 휴장 또는 API 오류)")
        return {"updated": 0, "alerts": []}

    updated = 0
    alerts = []

    for stock in stocks:
        p = prices.get(stock.symbol)
        if not p or p["current_price"] == 0:
            continue

        prev_price = stock.current_price
        new_price = p["current_price"]
        change_rate = p["change_rate"]

        # 전일 대비 등락률이 없으면 직접 계산
        if change_rate == 0 and prev_price > 0:
            change_rate = (new_price - prev_price) / prev_price * 100

        stock.prev_price = prev_price
        stock.current_price = new_price
        stock.change_rate = change_rate
        stock.updated_at = datetime.utcnow()
        updated += 1

        # 5% 이상 변동 감지
        if abs(change_rate) >= alert_threshold:
            direction = "🚀 급등" if change_rate > 0 else "🔻 급락"
            msg = (
                f"{direction} [{stock.name}({stock.symbol})] "
                f"전일대비 {change_rate:+.2f}% "
                f"({prev_price:,.0f} → {new_price:,.0f}원)"
            )
            alert = AlertHistory(
                stock_symbol=stock.symbol,
                alert_type="PRICE_SURGE" if change_rate > 0 else "PRICE_DROP",
                message=msg,
                change_rate=change_rate,
            )
            db.add(alert)
            alerts.append({"symbol": stock.symbol, "name": stock.name,
                           "change_rate": change_rate, "message": msg})
            logger.warning(f"⚠️ {msg}")

    db.commit()
    logger.info(f"✅ KRX 시세 갱신 완료: {updated}개 / 알림: {len(alerts)}건")
    return {"updated": updated, "alerts": alerts}


def save_daily_snapshot(db: Session):
    """일별 포트폴리오 스냅샷 저장"""
    today = date.today().strftime("%Y-%m-%d")
    stocks = db.query(Stock).filter(Stock.is_active == True).all()

    total_value = sum(s.current_value for s in stocks)
    total_purchase = sum(s.purchase_amount for s in stocks)
    total_profit = total_value - total_purchase
    total_profit_rate = (total_profit / total_purchase * 100) if total_purchase > 0 else 0

    # 가격 이력 저장
    for stock in stocks:
        if stock.current_price == 0:
            continue
        existing_ph = db.query(PriceHistory).filter(
            PriceHistory.stock_id == stock.id,
            PriceHistory.date == today
        ).first()
        if existing_ph:
            existing_ph.close_price = stock.current_price
            existing_ph.change_rate = stock.change_rate
        else:
            db.add(PriceHistory(
                stock_id=stock.id,
                date=today,
                close_price=stock.current_price,
                change_rate=stock.change_rate,
            ))

    # 스냅샷 저장
    existing_snap = db.query(PortfolioSnapshot).filter(
        PortfolioSnapshot.date == today
    ).first()
    if existing_snap:
        existing_snap.total_value = total_value
        existing_snap.total_purchase = total_purchase
        existing_snap.total_profit = total_profit
        existing_snap.total_profit_rate = total_profit_rate
    else:
        db.add(PortfolioSnapshot(
            date=today,
            total_value=total_value,
            total_purchase=total_purchase,
            total_profit=total_profit,
            total_profit_rate=total_profit_rate,
        ))

    db.commit()
    logger.info(f"✅ 스냅샷 저장: {today} | 총평가 {total_value:,.0f}원 | 수익률 {total_profit_rate:.2f}%")
