"""
core/portfolio.py
포트폴리오 관리 핵심 로직
- KIS API 잔고 동기화
- 수익률 계산
- 5% 변동 감지
- 일별 스냅샷 저장
"""
import logging
from datetime import datetime, date
from sqlalchemy.orm import Session

from config.database import Stock, PriceHistory, PortfolioSnapshot, AlertHistory
from core.kis_client import KISClient, BalanceItem

logger = logging.getLogger(__name__)


class PortfolioManager:
    """
    포트폴리오 관리자

    사용법:
        manager = PortfolioManager(db_session, kis_client)
        # 전체 동기화 (잔고 + 시세)
        result = manager.sync_all()
        print(result)  # {"synced": 15, "alerts": [...]}
    """

    def __init__(self, db: Session, kis: KISClient):
        self.db = db
        self.kis = kis

    # ─────────────────────────────────────────
    # 잔고 동기화
    # ─────────────────────────────────────────
    def sync_balance(self) -> dict:
        """
        KIS API에서 잔고를 가져와 DB 동기화
        반환: {"added": N, "updated": N, "removed": N}
        """
        balance_items = self.kis.get_all_balance()
        if not balance_items:
            logger.warning("잔고 데이터 없음 (API 응답 비어있음)")
            return {"added": 0, "updated": 0, "removed": 0}

        added, updated = 0, 0
        synced_symbols = set()

        for item in balance_items:
            synced_symbols.add(item.symbol)
            existing = self.db.query(Stock).filter(
                Stock.symbol == item.symbol
            ).first()

            if existing:
                # 기존 종목 업데이트
                existing.qty = item.qty
                existing.avg_price = item.avg_price
                existing.purchase_amount = item.purchase_amount
                existing.current_price = item.current_price
                existing.profit_rate = item.profit_rate
                existing.last_synced_at = datetime.utcnow()
                existing.updated_at = datetime.utcnow()
                updated += 1
            else:
                # 신규 종목 추가
                new_stock = Stock(
                    symbol=item.symbol,
                    name=item.name,
                    market=item.market,
                    currency=item.currency,
                    qty=item.qty,
                    avg_price=item.avg_price,
                    purchase_amount=item.purchase_amount,
                    current_price=item.current_price,
                    profit_rate=item.profit_rate,
                    last_synced_at=datetime.utcnow(),
                )
                self.db.add(new_stock)
                added += 1
                logger.info(f"✅ 신규 종목 추가: {item.name} ({item.symbol})")

        # 잔고에서 사라진 종목 비활성화 (매도)
        removed = 0
        active_stocks = self.db.query(Stock).filter(Stock.is_active == True).all()
        for stock in active_stocks:
            if stock.symbol not in synced_symbols:
                stock.is_active = False
                stock.qty = 0
                removed += 1
                logger.info(f"📤 종목 비활성화 (매도 감지): {stock.name} ({stock.symbol})")

        self.db.commit()
        result = {"added": added, "updated": updated, "removed": removed}
        logger.info(f"✅ 잔고 동기화 완료: {result}")
        return result

    # ─────────────────────────────────────────
    # 시세 갱신 + 5% 알림 체크
    # ─────────────────────────────────────────
    def refresh_prices(self, threshold: float = 5.0) -> list[dict]:
        """
        보유 종목 현재가 갱신 및 5% 변동 알림 체크
        반환: 알림 발생 종목 목록
        """
        stocks = self.db.query(Stock).filter(Stock.is_active == True).all()
        alerts = []

        for stock in stocks:
            # 시세 조회
            if stock.market == "KRX":
                price_data = self.kis.get_domestic_price(stock.symbol)
            else:
                price_data = self.kis.get_overseas_price(stock.symbol, stock.market)

            if not price_data:
                continue

            # 전일 대비 등락률 계산
            prev_price = stock.current_price  # 갱신 전 가격 = 전일 종가
            new_price = price_data.current_price
            change_rate = price_data.change_rate

            # DB 갱신
            stock.prev_price = prev_price
            stock.current_price = new_price
            stock.change_rate = change_rate
            stock.updated_at = datetime.utcnow()

            # 5% 이상 변동 감지
            if abs(change_rate) >= threshold:
                direction = "🚀 급등" if change_rate > 0 else "🔻 급락"
                alert_msg = (
                    f"{direction} [{stock.name}({stock.symbol})] "
                    f"전일 대비 {change_rate:+.2f}% "
                    f"({prev_price:,.0f} → {new_price:,.0f} {stock.currency})"
                )
                alert_type = "PRICE_SURGE" if change_rate > 0 else "PRICE_DROP"

                # 알림 이력 저장
                alert = AlertHistory(
                    stock_symbol=stock.symbol,
                    alert_type=alert_type,
                    message=alert_msg,
                    change_rate=change_rate,
                )
                self.db.add(alert)
                alerts.append({
                    "symbol": stock.symbol,
                    "name": stock.name,
                    "change_rate": change_rate,
                    "message": alert_msg,
                    "type": alert_type,
                })
                logger.warning(f"⚠️ 알림: {alert_msg}")

        self.db.commit()
        return alerts

    # ─────────────────────────────────────────
    # 가격 이력 저장
    # ─────────────────────────────────────────
    def save_price_history(self):
        """오늘 종가 이력 저장 (하루 1회 장마감 후 실행)"""
        today = date.today().strftime("%Y-%m-%d")
        stocks = self.db.query(Stock).filter(Stock.is_active == True).all()
        saved = 0

        for stock in stocks:
            # 오늘 이력이 이미 있으면 업데이트
            existing = self.db.query(PriceHistory).filter(
                PriceHistory.stock_id == stock.id,
                PriceHistory.date == today
            ).first()

            if existing:
                existing.close_price = stock.current_price
                existing.change_rate = stock.change_rate
            else:
                history = PriceHistory(
                    stock_id=stock.id,
                    date=today,
                    close_price=stock.current_price,
                    change_rate=stock.change_rate,
                )
                self.db.add(history)
            saved += 1

        self.db.commit()
        logger.info(f"✅ 가격 이력 저장: {saved}개 종목 / {today}")

    # ─────────────────────────────────────────
    # 포트폴리오 스냅샷
    # ─────────────────────────────────────────
    def save_portfolio_snapshot(self):
        """일별 포트폴리오 스냅샷 저장"""
        today = date.today().strftime("%Y-%m-%d")
        stocks = self.db.query(Stock).filter(Stock.is_active == True).all()

        total_value = sum(s.current_value for s in stocks)
        total_purchase = sum(s.purchase_amount for s in stocks)
        total_profit = total_value - total_purchase
        total_profit_rate = (total_profit / total_purchase * 100) if total_purchase > 0 else 0

        existing = self.db.query(PortfolioSnapshot).filter(
            PortfolioSnapshot.date == today
        ).first()

        if existing:
            existing.total_value = total_value
            existing.total_purchase = total_purchase
            existing.total_profit = total_profit
            existing.total_profit_rate = total_profit_rate
        else:
            snapshot = PortfolioSnapshot(
                date=today,
                total_value=total_value,
                total_purchase=total_purchase,
                total_profit=total_profit,
                total_profit_rate=total_profit_rate,
            )
            self.db.add(snapshot)

        self.db.commit()
        logger.info(
            f"✅ 포트폴리오 스냅샷 저장: {today} | "
            f"총 평가: {total_value:,.0f}원 | 수익률: {total_profit_rate:.2f}%"
        )

    # ─────────────────────────────────────────
    # 전체 동기화 (한 번에 실행)
    # ─────────────────────────────────────────
    def sync_all(self, alert_threshold: float = 5.0) -> dict:
        """
        전체 동기화 실행
        1. 잔고 동기화
        2. 시세 갱신 + 알림 체크
        3. 가격 이력 저장
        4. 포트폴리오 스냅샷 저장
        """
        logger.info("🔄 전체 포트폴리오 동기화 시작...")

        sync_result = self.sync_balance()
        alerts = self.refresh_prices(threshold=alert_threshold)
        self.save_price_history()
        self.save_portfolio_snapshot()

        result = {
            "timestamp": datetime.utcnow().isoformat(),
            "sync": sync_result,
            "alerts": alerts,
            "alert_count": len(alerts),
        }
        logger.info(f"✅ 전체 동기화 완료: {result}")
        return result

    # ─────────────────────────────────────────
    # 조회 메서드
    # ─────────────────────────────────────────
    def get_portfolio_summary(self) -> dict:
        """포트폴리오 요약 조회"""
        stocks = self.db.query(Stock).filter(Stock.is_active == True).all()

        total_value = sum(s.current_value for s in stocks)
        total_purchase = sum(s.purchase_amount for s in stocks)
        total_profit = total_value - total_purchase
        total_profit_rate = (total_profit / total_purchase * 100) if total_purchase > 0 else 0

        # 수익률 상위 5
        top_gainers = sorted(stocks, key=lambda x: x.change_rate, reverse=True)[:5]
        top_losers = sorted(stocks, key=lambda x: x.change_rate)[:5]

        return {
            "total_value": total_value,
            "total_purchase": total_purchase,
            "total_profit": total_profit,
            "total_profit_rate": total_profit_rate,
            "stock_count": len(stocks),
            "top_gainers": [
                {"symbol": s.symbol, "name": s.name, "change_rate": s.change_rate}
                for s in top_gainers if s.change_rate > 0
            ],
            "top_losers": [
                {"symbol": s.symbol, "name": s.name, "change_rate": s.change_rate}
                for s in top_losers if s.change_rate < 0
            ],
        }

    def get_unread_alerts(self) -> list[dict]:
        """읽지 않은 알림 조회"""
        alerts = self.db.query(AlertHistory).filter(
            AlertHistory.is_read == False
        ).order_by(AlertHistory.created_at.desc()).limit(50).all()

        return [
            {
                "id": a.id,
                "symbol": a.stock_symbol,
                "type": a.alert_type,
                "message": a.message,
                "change_rate": a.change_rate,
                "created_at": a.created_at.isoformat(),
            }
            for a in alerts
        ]
