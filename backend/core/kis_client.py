"""
core/kis_client.py
한국투자증권 Open API 클라이언트
국내주식 + 해외주식 잔고/시세 조회
"""
import logging
from datetime import datetime
from typing import Optional
from dataclasses import dataclass

logger = logging.getLogger(__name__)


@dataclass
class BalanceItem:
    """잔고 종목 데이터 클래스"""
    symbol: str           # 종목코드
    name: str             # 종목명
    market: str           # KRX / NASDAQ / NYSE / etc
    currency: str         # KRW / USD
    qty: float            # 보유수량
    avg_price: float      # 평균매입단가
    current_price: float  # 현재가
    purchase_amount: float  # 매입금액
    eval_amount: float    # 평가금액
    profit_loss: float    # 수익금액
    profit_rate: float    # 수익률(%)


@dataclass
class PriceData:
    """시세 데이터 클래스"""
    symbol: str
    current_price: float
    prev_price: float
    change_rate: float    # 전일 대비 등락률(%)
    volume: float
    high_price: float
    low_price: float
    open_price: float


class KISClient:
    """
    한국투자증권 Open API 클라이언트

    사용법:
        client = KISClient(
            app_key="...",
            app_secret="...",
            account_no="12345678-01",
            is_mock=False
        )
        # 전체 잔고 조회 (국내 + 해외)
        balance = client.get_all_balance()
        for item in balance:
            print(f"{item.name}: {item.profit_rate:.2f}%")
    """

    def __init__(
        self,
        app_key: str,
        app_secret: str,
        account_no: str,
        is_mock: bool = False
    ):
        self.app_key = app_key
        self.app_secret = app_secret
        self.account_no = account_no
        self.is_mock = is_mock
        self._kis = None
        self._connected = False

    def connect(self) -> bool:
        """KIS API 연결 및 토큰 발급"""
        try:
            from pykis import PyKis

            # 계좌번호 파싱 (XXXXXXXX-XX → XXXXXXXX, XX)
            parts = self.account_no.split("-")
            if len(parts) != 2:
                raise ValueError(f"계좌번호 형식 오류: {self.account_no} (형식: XXXXXXXX-XX)")

            self._kis = PyKis(
                id=parts[0],              # HTS ID (계좌번호 앞자리로 대체)
                account=self.account_no,
                appkey=self.app_key,
                secretkey=self.app_secret,
                virtual_account=self.is_mock,
            )
            self._connected = True
            mode = "모의투자" if self.is_mock else "실전투자"
            logger.info(f"✅ KIS API 연결 성공 ({mode})")
            return True

        except ImportError:
            logger.error("❌ python-kis 미설치. 'pip install python-kis' 실행 필요")
            return False
        except Exception as e:
            logger.error(f"❌ KIS API 연결 실패: {e}")
            return False

    def get_domestic_balance(self) -> list[BalanceItem]:
        """국내주식 잔고 조회"""
        if not self._connected or not self._kis:
            logger.warning("KIS API 미연결. connect() 먼저 호출 필요")
            return []

        try:
            balance = self._kis.balance()
            result = []

            for item in balance:
                # 해외주식 제외 (국내만)
                if hasattr(item, 'market') and item.market not in ('KRX', 'KOSPI', 'KOSDAQ'):
                    continue

                result.append(BalanceItem(
                    symbol=str(item.symbol),
                    name=str(item.name) if hasattr(item, 'name') else "",
                    market="KRX",
                    currency="KRW",
                    qty=float(item.qty) if hasattr(item, 'qty') else 0,
                    avg_price=float(item.avg_price) if hasattr(item, 'avg_price') else 0,
                    current_price=float(item.current) if hasattr(item, 'current') else 0,
                    purchase_amount=float(item.purchase_amount) if hasattr(item, 'purchase_amount') else 0,
                    eval_amount=float(item.eval_amount) if hasattr(item, 'eval_amount') else 0,
                    profit_loss=float(item.profit_loss) if hasattr(item, 'profit_loss') else 0,
                    profit_rate=float(item.profit_rate) if hasattr(item, 'profit_rate') else 0,
                ))

            logger.info(f"✅ 국내주식 잔고 조회 완료: {len(result)}개 종목")
            return result

        except Exception as e:
            logger.error(f"❌ 국내주식 잔고 조회 실패: {e}")
            return []

    def get_overseas_balance(self) -> list[BalanceItem]:
        """해외주식 잔고 조회 (미국 + 기타)"""
        if not self._connected or not self._kis:
            return []

        try:
            # python-kis 에서 해외 잔고는 market 필터로 구분
            balance = self._kis.balance()
            result = []

            for item in balance:
                if not hasattr(item, 'market'):
                    continue
                if item.market in ('KRX', 'KOSPI', 'KOSDAQ'):
                    continue

                # 거래소 → 통화 매핑
                currency_map = {
                    'NASDAQ': 'USD', 'NYSE': 'USD', 'AMEX': 'USD',
                    'TSE': 'JPY', 'SEHK': 'HKD', 'SSE': 'CNY',
                }
                currency = currency_map.get(str(item.market).upper(), 'USD')

                result.append(BalanceItem(
                    symbol=str(item.symbol),
                    name=str(item.name) if hasattr(item, 'name') else "",
                    market=str(item.market),
                    currency=currency,
                    qty=float(item.qty) if hasattr(item, 'qty') else 0,
                    avg_price=float(item.avg_price) if hasattr(item, 'avg_price') else 0,
                    current_price=float(item.current) if hasattr(item, 'current') else 0,
                    purchase_amount=float(item.purchase_amount) if hasattr(item, 'purchase_amount') else 0,
                    eval_amount=float(item.eval_amount) if hasattr(item, 'eval_amount') else 0,
                    profit_loss=float(item.profit_loss) if hasattr(item, 'profit_loss') else 0,
                    profit_rate=float(item.profit_rate) if hasattr(item, 'profit_rate') else 0,
                ))

            logger.info(f"✅ 해외주식 잔고 조회 완료: {len(result)}개 종목")
            return result

        except Exception as e:
            logger.error(f"❌ 해외주식 잔고 조회 실패: {e}")
            return []

    def get_all_balance(self) -> list[BalanceItem]:
        """국내 + 해외 전체 잔고 조회"""
        domestic = self.get_domestic_balance()
        overseas = self.get_overseas_balance()
        all_balance = domestic + overseas
        logger.info(f"✅ 전체 잔고: 국내 {len(domestic)}개 + 해외 {len(overseas)}개 = {len(all_balance)}개")
        return all_balance

    def get_domestic_price(self, symbol: str) -> Optional[PriceData]:
        """국내주식 현재가 조회"""
        if not self._connected or not self._kis:
            return None
        try:
            stock = self._kis.stock(symbol)
            quote = stock.quote()
            return PriceData(
                symbol=symbol,
                current_price=float(quote.price),
                prev_price=float(quote.prev_price) if hasattr(quote, 'prev_price') else 0,
                change_rate=float(quote.change_rate) if hasattr(quote, 'change_rate') else 0,
                volume=float(quote.volume) if hasattr(quote, 'volume') else 0,
                high_price=float(quote.high) if hasattr(quote, 'high') else 0,
                low_price=float(quote.low) if hasattr(quote, 'low') else 0,
                open_price=float(quote.open) if hasattr(quote, 'open') else 0,
            )
        except Exception as e:
            logger.error(f"❌ 국내주식 현재가 조회 실패 ({symbol}): {e}")
            return None

    def get_overseas_price(self, symbol: str, market: str = "NASDAQ") -> Optional[PriceData]:
        """해외주식 현재가 조회"""
        if not self._connected or not self._kis:
            return None
        try:
            stock = self._kis.stock(symbol, market=market)
            quote = stock.quote()
            return PriceData(
                symbol=symbol,
                current_price=float(quote.price),
                prev_price=float(quote.prev_price) if hasattr(quote, 'prev_price') else 0,
                change_rate=float(quote.change_rate) if hasattr(quote, 'change_rate') else 0,
                volume=float(quote.volume) if hasattr(quote, 'volume') else 0,
                high_price=float(quote.high) if hasattr(quote, 'high') else 0,
                low_price=float(quote.low) if hasattr(quote, 'low') else 0,
                open_price=float(quote.open) if hasattr(quote, 'open') else 0,
            )
        except Exception as e:
            logger.error(f"❌ 해외주식 현재가 조회 실패 ({symbol}/{market}): {e}")
            return None


def create_kis_client_from_settings() -> KISClient:
    """설정에서 KIS 클라이언트 생성"""
    from config.settings import get_settings
    s = get_settings()
    client = KISClient(
        app_key=s.kis_app_key,
        app_secret=s.kis_app_secret,
        account_no=s.kis_account_no,
        is_mock=s.kis_is_mock,
    )
    client.connect()
    return client
