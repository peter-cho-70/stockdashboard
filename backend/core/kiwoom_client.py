"""
core/kiwoom_client.py
키움증권 REST API 클라이언트 (국내주식 전용 — 해외주식/Open API+(OCX)는 범위 밖)

⚠️ 정확도 한계: 키움 개발자포털(openapi.kiwoom.com)은 로그인 기반 SPA라 문서를 직접 조회할 수 없었다.
아래는 공개된 코드 예제·커뮤니티 레퍼런스로 확인한 내용이며, 검증 수준이 다르다:
  - 토큰 발급(/oauth2/token), 주문(/api/dostk/ordr, kt10000/kt10001) — 실제 요청/응답 코드 예제로 확인됨
  - 잔고(kt00018) · 현재가(ka10001) — TR ID만 커뮤니티 레퍼런스로 확인, 정확한 endpoint 경로와
    응답 JSON 필드명은 추정값이다. API 키 발급 후 모의투자 서버로 1회 실호출해서
    _parse_balance_item / _parse_price_item 의 필드명을 실제 응답에 맞춰 반드시 재검증해야 한다.
"""
import logging
import time
from datetime import date
from typing import Any, Optional

import httpx

from core.broker_types import BalanceItem, FillRecord, PriceData, merge_balance_pair

logger = logging.getLogger(__name__)

KIWOOM_BASE_URL_REAL = "https://api.kiwoom.com"
KIWOOM_BASE_URL_MOCK = "https://mockapi.kiwoom.com"

ACCOUNT_FETCH_DELAY_SEC = 1.0
REQUEST_TIMEOUT_SEC = 10.0

TR_BALANCE = "kt00018"   # 계좌평가잔고내역요청 (미검증 — endpoint/필드명 추정)
TR_PRICE = "ka10001"     # 주식기본정보요청 (미검증 — endpoint/필드명 추정)
TR_BUY = "kt10000"       # 매수주문 (검증됨)
TR_SELL = "kt10001"      # 매도주문 (검증됨)


def _get(d: dict, *keys: str, default=None):
    for k in keys:
        if k in d and d[k] not in (None, ""):
            return d[k]
    return default


def _to_float(value, default: float = 0.0) -> float:
    if value is None:
        return default
    try:
        return float(str(value).replace(",", ""))
    except (TypeError, ValueError):
        return default


def _find_list_payload(data: dict) -> list[dict]:
    """응답 최상위 키 중 list[dict] 형태인 첫 값을 찾는다 — 실제 wrapper 키 이름 미확인 대응."""
    for v in data.values():
        if isinstance(v, list) and (not v or isinstance(v[0], dict)):
            return v
    return []


def _parse_balance_item(raw: dict) -> BalanceItem:
    """kt00018 응답 1건 → BalanceItem. 필드명은 추정값 — 실응답으로 검증 필요."""
    symbol = str(_get(raw, "stk_cd", "stock_code", "symbol", default=""))
    qty = _to_float(_get(raw, "rmnd_qty", "hold_qty", "qty", "stk_qty"))
    purchase_amount = _to_float(_get(raw, "pur_amt", "purchase_amount"))
    avg_price = _to_float(_get(raw, "pur_pric", "avg_prc", "avg_price"))
    if not avg_price and qty:
        avg_price = purchase_amount / qty
    current_price = _to_float(_get(raw, "cur_prc", "now_prc", "current_price"))
    eval_amount = _to_float(_get(raw, "evlt_amt", "eval_amt", "evltv_amt"))
    if not eval_amount and qty and current_price:
        eval_amount = qty * current_price
    profit_loss = _to_float(_get(raw, "evltv_prft", "pl_amt", "profit_loss"))
    if not profit_loss and eval_amount:
        profit_loss = eval_amount - purchase_amount
    profit_rate = _to_float(_get(raw, "prft_rt", "profit_rate"))

    return BalanceItem(
        symbol=symbol,
        name=str(_get(raw, "stk_nm", "stock_name", "name", default="") or ""),
        market="KRX",
        currency="KRW",
        qty=qty,
        avg_price=avg_price,
        current_price=current_price,
        purchase_amount=purchase_amount,
        eval_amount=eval_amount,
        profit_loss=profit_loss,
        profit_rate=profit_rate,
    )


def _parse_price_item(raw: dict, symbol: str) -> PriceData:
    """ka10001 응답 → PriceData. 필드명은 추정값 — 실응답으로 검증 필요."""
    current_price = _to_float(_get(raw, "cur_prc", "now_prc"))
    change_rate = _to_float(_get(raw, "flu_rt", "chg_rate", "change_rate"))
    prev_price = _to_float(_get(raw, "pred_pre", "prev_price"))
    if not prev_price and current_price and change_rate:
        prev_price = current_price / (1 + change_rate / 100.0)
    return PriceData(
        symbol=symbol,
        current_price=current_price,
        prev_price=prev_price,
        change_rate=change_rate,
        volume=_to_float(_get(raw, "now_trde_qty", "trde_qty", "volume")),
        high_price=_to_float(_get(raw, "high_prc", "high_price")),
        low_price=_to_float(_get(raw, "low_prc", "low_price")),
        open_price=_to_float(_get(raw, "open_prc", "open_price")),
    )


class KiwoomClient:
    """키움증권 REST API 클라이언트 (국내주식)"""

    def __init__(
        self,
        app_key: str,
        app_secret: str,
        account_no: str,
        is_mock: bool = True,
    ):
        self.app_key = app_key
        self.app_secret = app_secret
        self.account_no = account_no
        self.is_mock = is_mock
        self.base_url = KIWOOM_BASE_URL_MOCK if is_mock else KIWOOM_BASE_URL_REAL
        self._access_token: Optional[str] = None
        self._connected = False

    def connect(self) -> bool:
        """OAuth2 접근토큰 발급 (POST /oauth2/token, client_credentials)."""
        try:
            with httpx.Client(timeout=REQUEST_TIMEOUT_SEC) as client:
                resp = client.post(
                    f"{self.base_url}/oauth2/token",
                    json={
                        "grant_type": "client_credentials",
                        "appkey": self.app_key,
                        "secretkey": self.app_secret,
                    },
                )
                resp.raise_for_status()
                data = resp.json()
            token = _get(data, "token", "access_token")
            if not token:
                logger.error("❌ 키움 토큰 발급 실패 — 응답에 token 없음: %s", data)
                return False
            self._access_token = str(token)
            self._connected = True
            mode = "모의투자" if self.is_mock else "실전투자"
            logger.info("✅ 키움 API 연결 성공 (%s, 계좌 %s)", mode, self.account_no)
            return True
        except Exception as e:
            logger.error("❌ 키움 API 연결 실패: %s", e)
            self._access_token = None
            self._connected = False
            return False

    def _headers(self, api_id: str) -> dict:
        return {
            "Content-Type": "application/json;charset=UTF-8",
            "Authorization": f"Bearer {self._access_token}",
            "appkey": self.app_key,
            "appsecret": self.app_secret,
            "api-id": api_id,
        }

    def _post(self, path: str, api_id: str, body: dict) -> dict[str, Any]:
        if not self._connected or not self._access_token:
            raise RuntimeError("키움 API 미연결. connect() 먼저 호출 필요")
        with httpx.Client(timeout=REQUEST_TIMEOUT_SEC) as client:
            resp = client.post(
                f"{self.base_url}{path}",
                headers=self._headers(api_id),
                json=body,
            )
            resp.raise_for_status()
            return resp.json()

    def get_domestic_balance(self) -> list[BalanceItem]:
        """국내주식 잔고 조회 (kt00018 — endpoint/필드명 미검증)."""
        try:
            data = self._post(
                "/api/dostk/acnt",
                TR_BALANCE,
                {"qry_tp": "1", "dmst_stex_tp": "KRX"},
            )
        except Exception as e:
            logger.warning("키움 잔고 조회 실패: %s", e)
            return []
        items = [_parse_balance_item(raw) for raw in _find_list_payload(data)]
        logger.info("✅ 키움 국내주식 잔고 조회 완료: %s개 종목", len(items))
        return items

    def get_all_balance(self) -> list[BalanceItem]:
        """국내주식 잔고만 지원 (해외주식은 범위 밖)."""
        return self.get_domestic_balance()

    def get_domestic_price(self, symbol: str) -> Optional[PriceData]:
        """국내주식 현재가 조회 (ka10001 — endpoint/필드명 미검증)."""
        try:
            data = self._post("/api/dostk/stkinfo", TR_PRICE, {"stk_cd": symbol})
            return _parse_price_item(data, symbol)
        except Exception as e:
            logger.error("❌ 키움 현재가 조회 실패 (%s): %s", symbol, e)
            return None

    def place_order(self, symbol: str, side: str, qty: int, price: Optional[float] = None) -> dict:
        """국내주식 매수·매도 주문 실행 (검증된 endpoint — /api/dostk/ordr, kt10000/kt10001).

        반드시 connect()로 연결된 계좌(self.account_no)에만 주문이 들어간다 — 자동매매 엔진은
        호출 전 account_no가 전용 자동매매 계좌인지 별도로 검증해야 한다.
        """
        if side not in ("buy", "sell"):
            raise ValueError(f"side는 'buy' 또는 'sell'이어야 합니다: {side}")
        api_id = TR_BUY if side == "buy" else TR_SELL
        body = {
            "dmst_stex_tp": "KRX",
            "stk_cd": symbol,
            "ord_qty": str(qty),
            "ord_uv": str(int(price)) if price else "",
            "trde_tp": "0" if price else "3",  # 0=지정가, 3=시장가
        }
        data = self._post("/api/dostk/ordr", api_id, body)
        order_id = str(_get(data, "ord_no", default=""))
        logger.info(
            "✅ 키움 주문 실행: %s %s %s주 @ %s (계좌 %s, 주문번호 %s)",
            "매수" if side == "buy" else "매도", symbol, qty, price or "시장가", self.account_no, order_id,
        )
        return {"order_id": order_id, "raw": data}

    def get_daily_fills(self, start: date, end: date | None = None) -> list[FillRecord]:
        raise NotImplementedError(
            "키움 일별 체결내역 조회 TR을 확인하지 못했습니다 — API 키 발급 후 후속 작업 필요"
        )


def _resolve_kiwoom_mock(cfg, settings) -> bool:
    if cfg.is_mock is not None:
        return cfg.is_mock
    return settings.kiwoom_is_mock


def create_kiwoom_client_from_settings(account_no: str | None = None) -> KiwoomClient:
    """설정에서 키움 클라이언트 생성 (account_no 생략 시 첫 번째 계좌)."""
    from config.settings import get_settings

    s = get_settings()
    accounts = s.get_kiwoom_accounts()
    if not accounts:
        raise ValueError("키움 API가 설정되지 않았습니다 (.env — KIWOOM_ACCOUNTS 또는 KIWOOM_APP_KEY)")

    if account_no:
        cfg = s.kiwoom_account_for(account_no)
        if not cfg:
            raise ValueError(f"키움 계좌 설정 없음: {account_no}")
    else:
        cfg = accounts[0]

    client = KiwoomClient(
        app_key=cfg.app_key,
        app_secret=cfg.app_secret,
        account_no=cfg.account_no,
        is_mock=_resolve_kiwoom_mock(cfg, s),
    )
    client.connect()
    return client


def fetch_merged_kiwoom_balance_from_settings() -> list[BalanceItem]:
    """설정된 모든 키움 계좌 잔고를 조회·종목별 합산 (계좌별 API 키 사용)."""
    from config.settings import get_settings

    s = get_settings()
    configs = s.get_kiwoom_accounts()
    if not configs:
        return []

    merged: dict[str, BalanceItem] = {}
    for i, cfg in enumerate(configs):
        if i > 0:
            time.sleep(ACCOUNT_FETCH_DELAY_SEC)
        client = KiwoomClient(
            app_key=cfg.app_key,
            app_secret=cfg.app_secret,
            account_no=cfg.account_no,
            is_mock=_resolve_kiwoom_mock(cfg, s),
        )
        if not client.connect():
            logger.warning("키움 연결 실패 — 계좌 %s", cfg.account_no)
            continue
        items = client.get_domestic_balance()
        logger.info("키움 계좌 %s: %s개 종목", cfg.account_no, len(items))
        for item in items:
            if item.symbol in merged:
                merged[item.symbol] = merge_balance_pair(merged[item.symbol], item)
            else:
                merged[item.symbol] = item

    result = list(merged.values())
    logger.info("✅ 키움 합산 잔고: %s개 계좌 → %s개 종목", len(configs), len(result))
    return result
