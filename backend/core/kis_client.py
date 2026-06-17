"""
core/kis_client.py
한국투자증권 Open API 클라이언트 (python-kis 2.x)
국내주식 + 해외주식 잔고/시세 조회
"""
import logging
import time
from typing import Optional
from dataclasses import dataclass

logger = logging.getLogger(__name__)

BALANCE_FETCH_DELAY_SEC = 0.6
ACCOUNT_FETCH_DELAY_SEC = 1.0

OVERSEAS_COUNTRIES = ("US", "HK", "JP", "VN", "CN")
CURRENCY_MAP = {
    "NASDAQ": "USD", "NYSE": "USD", "AMEX": "USD",
    "KRX": "KRW", "KOSPI": "KRW", "KOSDAQ": "KRW",
    "TSE": "JPY", "TYO": "JPY", "SEHK": "HKD", "HKEX": "HKD",
    "SSE": "CNY", "SZSE": "CNY",
}


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


def _resolve_hts_id(account_no: str, hts_id: str | None = None) -> str:
    explicit = (hts_id or "").strip()
    if explicit:
        return explicit
    from config.settings import get_settings
    global_id = (get_settings().kis_hts_id or "").strip()
    if global_id:
        return global_id
    parts = account_no.split("-")
    if len(parts) != 2:
        raise ValueError(f"계좌번호 형식 오류: {account_no} (형식: XXXXXXXX-XX)")
    return parts[0]


def _build_pykis(app_key: str, app_secret: str, account_no: str, is_mock: bool, hts_id: str | None = None):
    from pykis import PyKis

    login_id = _resolve_hts_id(account_no, hts_id)
    kwargs = dict(
        id=login_id,
        account=account_no,
        appkey=app_key,
        secretkey=app_secret,
        keep_token=True,
        use_websocket=False,
    )
    if is_mock:
        kwargs.update(
            virtual_id=login_id,
            virtual_appkey=app_key,
            virtual_secretkey=app_secret,
        )
    return PyKis(**kwargs)


def _to_float(value, default: float = 0.0) -> float:
    if value is None:
        return default
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _balance_stock_to_item(item) -> BalanceItem:
    market = str(getattr(item, "market", "") or "")
    currency = str(getattr(item, "currency", "") or "")
    if not currency:
        currency = CURRENCY_MAP.get(market.upper(), "USD" if market else "KRW")

    qty = _to_float(getattr(item, "qty", None) or getattr(item, "quantity", None))
    purchase_amount = _to_float(getattr(item, "purchase_amount", None))
    avg_price = _to_float(getattr(item, "purchase_price", None))
    if not avg_price and qty:
        avg_price = purchase_amount / qty

    current_price = _to_float(
        getattr(item, "current_price", None) or getattr(item, "price", None)
    )
    eval_amount = _to_float(getattr(item, "current_amount", None) or getattr(item, "amount", None))
    if not eval_amount and qty and current_price:
        eval_amount = qty * current_price

    profit_loss = _to_float(getattr(item, "profit", None))
    if not profit_loss and eval_amount:
        profit_loss = eval_amount - purchase_amount
    profit_rate = _to_float(getattr(item, "profit_rate", None) or getattr(item, "rate", None))

    return BalanceItem(
        symbol=str(getattr(item, "symbol", "")),
        name=str(getattr(item, "name", "") or ""),
        market=market or "KRX",
        currency=currency,
        qty=qty,
        avg_price=avg_price,
        current_price=current_price,
        purchase_amount=purchase_amount,
        eval_amount=eval_amount,
        profit_loss=profit_loss,
        profit_rate=profit_rate,
    )


class KISClient:
    """한국투자증권 Open API 클라이언트 (python-kis 2.x)"""

    def __init__(
        self,
        app_key: str,
        app_secret: str,
        account_no: str,
        is_mock: bool = False,
        hts_id: str | None = None,
    ):
        self.app_key = app_key
        self.app_secret = app_secret
        self.account_no = account_no
        self.is_mock = is_mock
        self.hts_id = hts_id
        self._kis = None
        self._connected = False

    def connect(self) -> bool:
        """KIS API 연결 및 토큰 발급"""
        try:
            if "-" not in self.account_no:
                raise ValueError(
                    f"계좌번호 형식 오류: {self.account_no} (형식: XXXXXXXX-XX)"
                )

            self._kis = _build_pykis(
                self.app_key,
                self.app_secret,
                self.account_no,
                self.is_mock,
                self.hts_id,
            )
            self._connected = True
            mode = "모의투자" if self.is_mock else "실전투자"
            logger.info("✅ KIS API 연결 성공 (%s, 계좌 %s)", mode, self.account_no)
            return True

        except ImportError:
            logger.error("❌ python-kis 미설치. 'pip install python-kis' 실행 필요")
            return False
        except Exception as e:
            logger.error("❌ KIS API 연결 실패: %s", e)
            self._kis = None
            self._connected = False
            return False

    def _account(self):
        if not self._connected or not self._kis:
            return None
        return self._kis.account(self.account_no)

    def _fetch_balance_by_country(self, country: str) -> list[BalanceItem]:
        account = self._account()
        if not account:
            logger.warning("KIS API 미연결. connect() 먼저 호출 필요")
            return []
        try:
            balance = account.balance(country=country)
            return [_balance_stock_to_item(item) for item in balance]
        except Exception as e:
            logger.warning("잔고 조회 실패 (%s): %s", country, e)
            return []

    def get_domestic_balance(self) -> list[BalanceItem]:
        """국내주식 잔고 조회"""
        result = self._fetch_balance_by_country("KR")
        logger.info("✅ 국내주식 잔고 조회 완료: %s개 종목", len(result))
        return result

    def get_overseas_balance(self) -> list[BalanceItem]:
        """해외주식 잔고 조회"""
        result: list[BalanceItem] = []
        for country in OVERSEAS_COUNTRIES:
            time.sleep(BALANCE_FETCH_DELAY_SEC)
            result.extend(self._fetch_balance_by_country(country))
        logger.info("✅ 해외주식 잔고 조회 완료: %s개 종목", len(result))
        return result

    def get_all_balance(self) -> list[BalanceItem]:
        """국내 + 해외 전체 잔고 조회"""
        domestic = self.get_domestic_balance()
        time.sleep(BALANCE_FETCH_DELAY_SEC)
        overseas = self.get_overseas_balance()
        all_balance = domestic + overseas
        logger.info(
            "✅ 전체 잔고: 국내 %s개 + 해외 %s개 = %s개",
            len(domestic), len(overseas), len(all_balance),
        )
        return all_balance

    def get_domestic_price(self, symbol: str) -> Optional[PriceData]:
        """국내주식 현재가 조회"""
        if not self._connected or not self._kis:
            return None
        try:
            quote = self._kis.stock(symbol, market="KRX").quote()
            return PriceData(
                symbol=symbol,
                current_price=_to_float(quote.price),
                prev_price=_to_float(getattr(quote, "prev_price", None)),
                change_rate=_to_float(getattr(quote, "rate", None)),
                volume=_to_float(getattr(quote, "volume", None)),
                high_price=_to_float(getattr(quote, "high", None)),
                low_price=_to_float(getattr(quote, "low", None)),
                open_price=_to_float(getattr(quote, "open", None)),
            )
        except Exception as e:
            logger.error("❌ 국내주식 현재가 조회 실패 (%s): %s", symbol, e)
            return None

    def get_overseas_price(self, symbol: str, market: str = "NASDAQ") -> Optional[PriceData]:
        """해외주식 현재가 조회"""
        if not self._connected or not self._kis:
            return None
        try:
            quote = self._kis.stock(symbol, market=market).quote()
            return PriceData(
                symbol=symbol,
                current_price=_to_float(quote.price),
                prev_price=_to_float(getattr(quote, "prev_price", None)),
                change_rate=_to_float(getattr(quote, "rate", None)),
                volume=_to_float(getattr(quote, "volume", None)),
                high_price=_to_float(getattr(quote, "high", None)),
                low_price=_to_float(getattr(quote, "low", None)),
                open_price=_to_float(getattr(quote, "open", None)),
            )
        except Exception as e:
            logger.error("❌ 해외주식 현재가 조회 실패 (%s/%s): %s", symbol, market, e)
            return None


def _resolve_kis_mock(cfg, settings) -> bool:
    if cfg.is_mock is not None:
        return cfg.is_mock
    return settings.kis_is_mock


def create_kis_client_from_settings(account_no: str | None = None) -> KISClient:
    """설정에서 KIS 클라이언트 생성 (account_no 생략 시 첫 번째 계좌)."""
    from config.settings import get_settings

    s = get_settings()
    accounts = s.get_kis_accounts()
    if not accounts:
        raise ValueError("KIS API가 설정되지 않았습니다 (.env — KIS_ACCOUNTS 또는 KIS_APP_KEY)")

    if account_no:
        cfg = s.kis_account_for(account_no)
        if not cfg:
            raise ValueError(f"KIS 계좌 설정 없음: {account_no}")
    else:
        cfg = accounts[0]

    client = KISClient(
        app_key=cfg.app_key,
        app_secret=cfg.app_secret,
        account_no=cfg.account_no,
        is_mock=_resolve_kis_mock(cfg, s),
        hts_id=s.kis_hts_id or None,
    )
    client.connect()
    return client


def _merge_balance_pair(a: BalanceItem, b: BalanceItem) -> BalanceItem:
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


def fetch_merged_balance_from_settings() -> list[BalanceItem]:
    """설정된 모든 KIS 계좌 잔고를 조회·종목별 합산 (계좌별 API 키 사용)."""
    from config.settings import get_settings

    s = get_settings()
    configs = s.get_kis_accounts()
    if not configs:
        return []

    merged: dict[str, BalanceItem] = {}
    for i, cfg in enumerate(configs):
        if i > 0:
            time.sleep(ACCOUNT_FETCH_DELAY_SEC)
        client = KISClient(
            app_key=cfg.app_key,
            app_secret=cfg.app_secret,
            account_no=cfg.account_no,
            is_mock=_resolve_kis_mock(cfg, s),
            hts_id=s.kis_hts_id or None,
        )
        if not client.connect():
            logger.warning("KIS 연결 실패 — 계좌 %s", cfg.account_no)
            continue
        items = client.get_all_balance()
        logger.info("계좌 %s: %s개 종목", cfg.account_no, len(items))
        for item in items:
            if item.symbol in merged:
                merged[item.symbol] = _merge_balance_pair(merged[item.symbol], item)
            else:
                merged[item.symbol] = item

    result = list(merged.values())
    logger.info("✅ KIS 합산 잔고: %s개 계좌 → %s개 종목", len(configs), len(result))
    return result
