"""
core/price_updater.py
pykrx를 이용한 국내 주식 현재가 / 종가 갱신
KIS API 없이도 무료로 KRX 데이터 사용 가능
"""
import logging
from datetime import datetime
from typing import Optional
from sqlalchemy.orm import Session

from config.database import Stock, PriceHistory, PortfolioSnapshot
from core.portfolio import resolve_prev_close
from core.target_alerts import check_all_targets_for_stock, check_price_move_alert
from core.market_calendar import get_latest_trading_date, get_latest_trading_date_str

logger = logging.getLogger(__name__)


def fetch_krx_prices(symbols: list[str]) -> dict[str, dict]:
    """
    pykrx로 여러 종목 현재가/종가 일괄 조회
    반환: {symbol: {current_price, change_rate, open, high, low, volume}}
    """
    try:
        from pykrx import stock as krx
        import time

        trading_date = get_latest_trading_date_str()
        result = {}

        for symbol in symbols:
            try:
                df = krx.get_market_ohlcv_by_date(
                    trading_date, trading_date, symbol
                )
                # 장마감 직후엔 KRX가 당일 데이터를 아직 확정하지 않아 df가 비어있을 수 있다.
                # 예전엔 여기서 전일 데이터로 조용히 폴백해 "당일 종가"로 잘못 저장하는 버그가 있었다
                # (2026-07-10 스냅샷에 7/9 데이터가 그대로 중복 저장된 사고, DEVLOG 참고).
                # 데이터가 없으면 그냥 이번 갱신에서 스킵 — 이후 KIS 실시세 동기화나 다음 스케줄 실행이 채운다.
                if df.empty:
                    logger.info("%s: %s pykrx 데이터 아직 없음 (장마감 직후) — 이번 갱신 스킵", symbol, trading_date)
                    continue

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

        prev_close = resolve_prev_close(
            prev_close=0,
            current_price=new_price,
            change_rate=change_rate,
            fallback_prev=stock.prev_price if stock.prev_price > 0 else prev_price,
        )

        if change_rate == 0 and prev_close > 0 and new_price != prev_close:
            change_rate = (new_price - prev_close) / prev_close * 100

        stock.prev_price = prev_close if prev_close > 0 else prev_price
        stock.current_price = new_price
        stock.change_rate = change_rate
        stock.updated_at = datetime.utcnow()
        updated += 1

        # 급등락 감지 — 임계값을 넘은 최초 1회만 알림(재갱신마다 재알림 방지)
        alerts.extend(
            check_price_move_alert(
                db, stock,
                change_rate=change_rate, prev_close=prev_close, current_price=new_price,
                threshold=alert_threshold,
            )
        )

        alerts.extend(check_all_targets_for_stock(db, stock))

    db.commit()
    logger.info(f"✅ KRX 시세 갱신 완료: {updated}개 / 알림: {len(alerts)}건")
    return {"updated": updated, "alerts": alerts}


def save_daily_snapshot(db: Session):
    """일별 포트폴리오 스냅샷 저장 — 호출 시점(wall clock)이 아니라 최근 거래일 기준으로 저장한다.
    그래야 주말/휴일이나 자정을 넘겨 실행된 재동기화가 엉뚱한 날짜에 찍히지 않는다."""
    today = get_latest_trading_date().strftime("%Y-%m-%d")
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
