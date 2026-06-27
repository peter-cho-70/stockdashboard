"""
core/kis_client.py
한국투자증권 Open API 클라이언트 (python-kis 2.x)
국내주식 + 해외주식 잔고/시세 조회
"""
import logging
import time
from datetime import date, timedelta
from typing import Optional

from core.broker_types import BalanceItem, FillRecord, PriceData, merge_balance_pair

logger = logging.getLogger(__name__)

BALANCE_FETCH_DELAY_SEC = 0.6
ACCOUNT_FETCH_DELAY_SEC = 1.0
KIS_FILL_CHUNK_DAYS = 89
KIS_FILL_CHUNK_DELAY_SEC = 0.5
KIS_FILL_MAX_RETRIES = 4

OVERSEAS_COUNTRIES = ("US", "HK", "JP", "VN", "CN")
CURRENCY_MAP = {
    "NASDAQ": "USD", "NYSE": "USD", "AMEX": "USD",
    "KRX": "KRW", "KOSPI": "KRW", "KOSDAQ": "KRW",
    "TSE": "JPY", "TYO": "JPY", "SEHK": "HKD", "HKEX": "HKD",
    "SSE": "CNY", "SZSE": "CNY",
}


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

    def place_order(self, symbol: str, side: str, qty: int, price: Optional[float] = None) -> dict:
        """국내주식 매수·매도 주문 실행. side: 'buy' | 'sell'. price=None이면 시장가, 지정 시 지정가.

        반드시 connect()로 연결된 계좌(self.account_no)에만 주문이 들어간다 — 자동매매 엔진은
        호출 전 account_no가 전용 자동매매 계좌인지 별도로 검증해야 한다.
        """
        if not self._connected or not self._kis:
            raise RuntimeError("KIS API 미연결. connect() 먼저 호출 필요")
        if side not in ("buy", "sell"):
            raise ValueError(f"side는 'buy' 또는 'sell'이어야 합니다: {side}")
        result = self._kis.order(
            self.account_no, "KRX", symbol,
            order=side, price=price, qty=qty,
        )
        order_id = str(getattr(result, "number", "") or "")
        logger.info(
            "✅ KIS 주문 실행: %s %s %s주 @ %s (계좌 %s, 주문번호 %s)",
            "매수" if side == "buy" else "매도", symbol, qty, price or "시장가", self.account_no, order_id,
        )
        return {"order_id": order_id, "raw": str(result)}

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

    def _order_to_fill(self, order, range_start: date, range_end: date) -> Optional[FillRecord]:
        # pykis는 ccld_yn=Y를 canceled=True로 매핑하지만 KIS 응답에서는 '체결됨' 의미인 경우가 많다.
        symbol = str(getattr(order, "symbol", "") or "")
        name = str(getattr(order, "name", "") or "")
        if getattr(order, "rejected", False):
            logger.debug("⛔ [%s/%s] rejected=True → skip", symbol, name)
            return None
        qty = _to_float(getattr(order, "executed_qty", None))
        if qty <= 0:
            qty = _to_float(getattr(order, "executed_quantity", None))
        if qty <= 0:
            logger.debug("⛔ [%s/%s] qty=0 → skip", symbol, name)
            return None
        price = _to_float(getattr(order, "price", None)) or _to_float(getattr(order, "unit_price", None))
        if price <= 0:
            raw_price = getattr(order, "price", None)
            raw_unit = getattr(order, "unit_price", None)
            logger.warning("⛔ [%s/%s] price=0 (avg_prvs=%s, ord_unpr=%s) → skip", symbol, name, raw_price, raw_unit)
            return None
        traded_day = order.time_kst.date()
        if traded_day < range_start or traded_day > range_end:
            return None
        traded_at = traded_day.strftime("%Y-%m-%d")
        branch = getattr(order, "branch", "") or ""
        number = getattr(order, "number", "") or ""
        return FillRecord(
            symbol=str(getattr(order, "symbol", "")),
            name=str(getattr(order, "name", "") or ""),
            market=str(getattr(order, "market", "") or "KRX"),
            side="BUY" if order.type == "buy" else "SELL",
            qty=qty,
            price=price,
            traded_at=traded_at,
            external_id=f"{self.account_no}:{traded_at}:{branch}:{number}",
        )

    def _resolve_account_number(self, account):
        from pykis.client.account import KisAccountNumber

        if isinstance(account, KisAccountNumber):
            return account
        if hasattr(account, "account_number"):
            return account.account_number
        return KisAccountNumber(account)

    def _fetch_domestic_orders(self, account, start: date, end: date, is_recent: bool) -> list:
        """국내 체결 — 신규 TR 우선, 구 TR 폴백. 과거 API는 월 단위 조회 권장."""
        from pykis.api.account.daily_order import KisDomesticDailyOrders
        from pykis.client.page import KisPage

        account = self._resolve_account_number(account)

        tr_ids = DOMESTIC_FILL_TR_IDS[(not self.is_mock, is_recent)]
        last_error: Exception | None = None

        for tr_id in tr_ids:
            for attempt in range(KIS_FILL_MAX_RETRIES):
                try:
                    page = KisPage.first().to(100)
                    first = None
                    while True:
                        result = self._kis.fetch(
                            "/uapi/domestic-stock/v1/trading/inquire-daily-ccld",
                            api=tr_id,
                            params={
                                "INQR_STRT_DT": start.strftime("%Y%m%d"),
                                "INQR_END_DT": end.strftime("%Y%m%d"),
                                "SLL_BUY_DVSN_CD": "00",
                                "INQR_DVSN": "00",
                                "PDNO": "",
                                "CCLD_DVSN": "00",
                                "ORD_GNO_BRNO": "",
                                "ODNO": "",
                                "INQR_DVSN_3": "00",
                                "INQR_DVSN_1": "",
                            },
                            form=[account, page],
                            continuous=not page.is_first,
                            response_type=KisDomesticDailyOrders(account_number=account),
                        )
                        if first is None:
                            first = result
                        else:
                            first.orders.extend(result.orders)
                        if result.is_last:
                            break
                        page = result.next_page
                    orders_count = len(first.orders) if first else 0
                    logger.info(
                        "국내 체결 %s (%s~%s, recent=%s): %s건",
                        tr_id, start, end, is_recent, orders_count,
                    )
                    if first:
                        for o in first.orders:
                            logger.info(
                                "  ↳ [%s] %s %s qty=%s price=%s unit=%s rejected=%s",
                                getattr(o, "symbol", "?"),
                                getattr(o, "name", "?"),
                                getattr(o, "type", "?"),
                                getattr(o, "executed_quantity", "?"),
                                getattr(o, "price", "?"),
                                getattr(o, "unit_price", "?"),
                                getattr(o, "rejected", "?"),
                            )
                    return first.orders if first else []
                except Exception as e:
                    last_error = e
                    msg = str(e)
                    if "호출 횟수" in msg or "EGW00201" in msg:
                        wait = KIS_FILL_CHUNK_DELAY_SEC * (attempt + 2)
                        logger.warning(
                            "국내 체결 rate limit (%s~%s), %ss 후 재시도 (%s/%s)",
                            start,
                            end,
                            wait,
                            attempt + 1,
                            KIS_FILL_MAX_RETRIES,
                        )
                        time.sleep(wait)
                        continue
                    logger.warning("국내 체결 %s 실패 (%s~%s): %s", tr_id, start, end, e)
                    break

        if last_error:
            raise last_error
        return []

    def get_daily_fills(self, start, end=None) -> list[FillRecord]:
        """일별 체결내역 조회 (국내+해외 통합).

        3개월 이전은 CTSC9215R(월 단위), 이내는 TTTC0081R 사용. pykis daily_orders는 사용하지 않는다.
        """
        from pykis.api.account.daily_order import foreign_daily_orders

        end = end or date.today()
        if start > end:
            start, end = end, start

        account = self._account()
        if not account or not self._kis:
            logger.warning("KIS API 미연결. connect() 먼저 호출 필요")
            return []

        account_no = self._resolve_account_number(account)
        records: list[FillRecord] = []
        seen_ids: set[str] = set()

        for sub_start, sub_end, is_recent in _iter_kis_domestic_ranges(start, end):
            try:
                orders = self._fetch_domestic_orders(account_no, sub_start, sub_end, is_recent)
                for order in orders:
                    rec = self._order_to_fill(order, sub_start, sub_end)
                    if rec and rec.external_id not in seen_ids:
                        seen_ids.add(rec.external_id)
                        records.append(rec)
            except Exception as e:
                logger.error(
                    "❌ 국내 체결내역 조회 실패 (%s~%s): %s",
                    sub_start,
                    sub_end,
                    e,
                )

            time.sleep(KIS_FILL_CHUNK_DELAY_SEC)

            try:
                frn = foreign_daily_orders(self._kis, account_no, sub_start, sub_end)
                for order in frn.orders:
                    rec = self._order_to_fill(order, sub_start, sub_end)
                    if rec and rec.external_id not in seen_ids:
                        seen_ids.add(rec.external_id)
                        records.append(rec)
            except Exception as e:
                logger.error(
                    "❌ 해외 체결내역 조회 실패 (%s~%s): %s",
                    sub_start,
                    sub_end,
                    e,
                )

            time.sleep(KIS_FILL_CHUNK_DELAY_SEC)

        logger.info("✅ 체결내역 조회 완료: %s건 (%s~%s)", len(records), start, end)
        return records


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
                merged[item.symbol] = merge_balance_pair(merged[item.symbol], item)
            else:
                merged[item.symbol] = item

    result = list(merged.values())
    logger.info("✅ KIS 합산 잔고: %s개 계좌 → %s개 종목", len(configs), len(result))
    return result


def _recent_window_start(today: date | None = None) -> date:
    """KIS 국내 '최근 3개월' API( TTTC0081R )와 과거 API( CTSC9215R ) 경계."""
    today = today or date.today()
    month = today.month - 3
    year = today.year
    while month <= 0:
        month += 12
        year -= 1
    return date(year, month, 1)


DOMESTIC_FILL_TR_IDS = {
    (True, True): ("TTTC0081R", "TTTC8001R"),
    (True, False): ("CTSC9215R", "CTSC9115R"),
    (False, True): ("VTTC0081R", "VTTC8001R"),
    (False, False): ("VTSC9215R", "VTSC9115R"),
}


def _month_last_day(d: date) -> date:
    if d.month == 12:
        return date(d.year, 12, 31)
    return date(d.year, d.month + 1, 1) - timedelta(days=1)


def _split_recent_historical(start: date, end: date, today: date | None = None):
    """국내 체결 API recent/과거 경계에서 구간을 나눈다 (pykis split 버그 회피)."""
    recent_start = _recent_window_start(today)
    if end < recent_start:
        yield start, end
        return
    if start >= recent_start:
        yield start, end
        return
    hist_end = min(end, recent_start - timedelta(days=1))
    if start <= hist_end:
        yield start, hist_end
    if end >= recent_start:
        yield max(start, recent_start), end


def _iter_kis_domestic_ranges(start: date, end: date, today: date | None = None):
    """KIS 국내 체결 API 규칙: 3개월 이전은 월 단위(CTSC9215R), 이내는 일 단위(TTTC0081R)."""
    today = today or date.today()
    recent_start = _recent_window_start(today)
    for part_start, part_end in _split_recent_historical(start, end, today):
        if part_end < recent_start:
            cursor = part_start
            while cursor <= part_end:
                chunk_end = min(part_end, _month_last_day(cursor))
                yield cursor, chunk_end, False
                cursor = chunk_end + timedelta(days=1)
        else:
            cursor = part_start
            while cursor <= part_end:
                chunk_end = min(part_end, cursor + timedelta(days=KIS_FILL_CHUNK_DAYS))
                yield cursor, chunk_end, True
                cursor = chunk_end + timedelta(days=1)


def fetch_trade_history_from_settings(start, end=None) -> list[FillRecord]:
    """설정된 모든 KIS 계좌의 일별 체결내역 조회 (계좌별 API 키 사용)."""
    from config.settings import get_settings

    if end is None:
        end = date.today()

    s = get_settings()
    configs = s.get_kis_accounts()
    if not configs:
        return []

    all_records: list[FillRecord] = []
    seen_ids: set[str] = set()
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
        records = client.get_daily_fills(start, end)
        logger.info(
            "계좌 %s (%s~%s): 체결내역 %s건",
            cfg.account_no,
            start,
            end,
            len(records),
        )
        for rec in records:
            if rec.external_id in seen_ids:
                continue
            seen_ids.add(rec.external_id)
            all_records.append(rec)

    return all_records
