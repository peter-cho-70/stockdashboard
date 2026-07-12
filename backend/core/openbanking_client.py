"""
core/openbanking_client.py
금융결제원 오픈뱅킹 API 클라이언트 (OAuth 2.0)

등록: https://openbanking.or.kr
- 서비스 등록 후 client_id, client_secret 발급
- redirect_uri: {backend_url}/api/finance/openbanking/callback
"""
from __future__ import annotations

import json
import logging
import time
import urllib.parse
from datetime import datetime, timedelta
from typing import Any

import httpx
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

def _ob_base() -> str:
    from config.settings import get_settings
    is_test = get_settings().openbanking_is_test
    return "https://testapi.openbanking.or.kr" if is_test else "https://openapi.openbanking.or.kr"


def _ob_url(path: str) -> str:
    return f"{_ob_base()}{path}"

_STORE_KEY = "openbanking_token"
_REQUEST_TIMEOUT = 15.0


def _tran_dtime() -> str:
    """거래일시 포맷: YYYYMMDDHHmmss"""
    return datetime.now().strftime("%Y%m%d%H%M%S")


def _load_ob_state(db: Session) -> dict[str, Any]:
    from config.database import FinanceJsonStore
    row = db.query(FinanceJsonStore).filter(FinanceJsonStore.store_key == _STORE_KEY).first()
    if not row:
        return {}
    try:
        return json.loads(row.data_json) or {}
    except Exception:
        return {}


def _save_ob_state(db: Session, state: dict[str, Any]) -> None:
    from config.database import FinanceJsonStore
    row = db.query(FinanceJsonStore).filter(FinanceJsonStore.store_key == _STORE_KEY).first()
    now = datetime.utcnow()
    encoded = json.dumps(state, ensure_ascii=False)
    if row:
        row.data_json = encoded
        row.updated_at = now
    else:
        db.add(FinanceJsonStore(store_key=_STORE_KEY, data_json=encoded, updated_at=now))
    db.commit()


def get_ob_status(db: Session) -> dict[str, Any]:
    """오픈뱅킹 연동 상태 조회"""
    from config.settings import get_settings
    settings = get_settings()
    state = _load_ob_state(db)
    configured = bool(settings.openbanking_client_id and settings.openbanking_client_secret)
    connected = bool(state.get("access_token"))
    expires_at = state.get("token_expires_at")
    accounts = state.get("accounts") or []
    return {
        "configured": configured,
        "connected": connected,
        "user_seq_no": state.get("user_seq_no"),
        "token_expires_at": expires_at,
        "accounts": accounts,
        "account_count": len(accounts),
    }


def build_auth_url(redirect_uri: str) -> str:
    """금융결제원 OAuth 인가 URL 생성 (scope는 %20 인코딩 사용)"""
    from config.settings import get_settings
    settings = get_settings()
    if not settings.openbanking_client_id:
        raise ValueError("OPENBANKING_CLIENT_ID 환경변수가 설정되지 않았습니다.")
    # scope의 공백은 +가 아닌 %20으로 인코딩 (금결원 요구사항)
    base_params = urllib.parse.urlencode({
        "response_type": "code",
        "client_id": settings.openbanking_client_id,
        "redirect_uri": redirect_uri,
        "auth_type": "0",
        "lang": "kor",
    })
    return f"{_ob_url('/oauth/2.0/authorize')}?{base_params}&scope=login%20inquiry"


def exchange_code_for_token(
    db: Session,
    code: str,
    redirect_uri: str,
) -> dict[str, Any]:
    """인가코드 → access_token 교환 및 저장"""
    from config.settings import get_settings
    settings = get_settings()
    if not settings.openbanking_client_id or not settings.openbanking_client_secret:
        raise ValueError("오픈뱅킹 API 키가 설정되지 않았습니다.")

    with httpx.Client(timeout=_REQUEST_TIMEOUT) as client:
        resp = client.post(
            _ob_url("/oauth/2.0/token"),
            data={
                "grant_type": "authorization_code",
                "code": code,
                "client_id": settings.openbanking_client_id,
                "client_secret": settings.openbanking_client_secret,
                "redirect_uri": redirect_uri,
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        resp.raise_for_status()
        data = resp.json()

    access_token = data.get("access_token")
    if not access_token:
        raise RuntimeError(f"액세스 토큰 발급 실패: {data}")

    expires_in = int(data.get("expires_in", 7776000))  # 기본 90일
    expires_at = (datetime.utcnow() + timedelta(seconds=expires_in)).isoformat()

    state = _load_ob_state(db)
    state.update({
        "access_token": access_token,
        "refresh_token": data.get("refresh_token"),
        "token_type": data.get("token_type", "Bearer"),
        "token_expires_at": expires_at,
        "user_seq_no": data.get("user_seq_no"),
        "connected_at": datetime.utcnow().isoformat(),
    })
    _save_ob_state(db, state)
    logger.info("✅ 오픈뱅킹 토큰 발급 완료 (user_seq_no=%s)", data.get("user_seq_no"))
    return {"ok": True, "user_seq_no": data.get("user_seq_no"), "expires_at": expires_at}


def _get_valid_token(db: Session) -> str:
    """유효한 access_token 반환 (만료 임박 시 refresh 시도)"""
    state = _load_ob_state(db)
    token = state.get("access_token")
    if not token:
        raise RuntimeError("오픈뱅킹 미연결 상태입니다. OAuth 인증을 먼저 완료하세요.")

    expires_at_str = state.get("token_expires_at")
    if expires_at_str:
        try:
            expires_at = datetime.fromisoformat(expires_at_str)
            if datetime.utcnow() + timedelta(minutes=5) >= expires_at:
                # refresh 시도
                refresh_token = state.get("refresh_token")
                if refresh_token:
                    token = _refresh_token(db, refresh_token, state)
                else:
                    raise RuntimeError("오픈뱅킹 토큰이 만료되었습니다. 재인증이 필요합니다.")
        except ValueError:
            pass

    return token


def _refresh_token(db: Session, refresh_token: str, state: dict) -> str:
    """refresh_token으로 access_token 갱신"""
    from config.settings import get_settings
    settings = get_settings()
    with httpx.Client(timeout=_REQUEST_TIMEOUT) as client:
        resp = client.post(
            _ob_url("/oauth/2.0/token"),
            data={
                "grant_type": "refresh_token",
                "client_id": settings.openbanking_client_id,
                "client_secret": settings.openbanking_client_secret,
                "refresh_token": refresh_token,
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        resp.raise_for_status()
        data = resp.json()

    new_token = data.get("access_token")
    if not new_token:
        raise RuntimeError("토큰 갱신 실패")

    expires_in = int(data.get("expires_in", 7776000))
    expires_at = (datetime.utcnow() + timedelta(seconds=expires_in)).isoformat()
    state.update({
        "access_token": new_token,
        "token_expires_at": expires_at,
    })
    if data.get("refresh_token"):
        state["refresh_token"] = data["refresh_token"]
    # 갱신·회전된 토큰을 즉시 영속화 — 저장하지 않으면 다른 호출이 옛 state를 다시 읽어
    # 이미 무효화된 refresh_token으로 다음 갱신을 시도하게 된다.
    _save_ob_state(db, state)
    logger.info("✅ 오픈뱅킹 토큰 갱신 완료")
    return new_token


def fetch_user_accounts(db: Session) -> list[dict[str, Any]]:
    """사용자 연결 계좌 목록 조회 및 저장"""
    from config.settings import get_settings
    settings = get_settings()
    token = _get_valid_token(db)
    state = _load_ob_state(db)
    user_seq_no = state.get("user_seq_no", "")

    with httpx.Client(timeout=_REQUEST_TIMEOUT) as client:
        resp = client.get(
            _ob_url("/v2.0/user/me"),
            params={
                "user_seq_no": user_seq_no,
            },
            headers={
                "Authorization": f"Bearer {token}",
                "user_seq_no": user_seq_no,
            },
        )
        resp.raise_for_status()
        data = resp.json()

    accounts: list[dict[str, Any]] = []
    raw_accounts = data.get("res_list") or []
    for item in raw_accounts:
        accounts.append({
            "fintech_use_num": item.get("fintech_use_num", ""),
            "bank_code_std": item.get("bank_code_std", ""),
            "bank_name": item.get("bank_name", ""),
            "account_num_masked": item.get("account_num_masked", ""),
            "account_holder_name": item.get("account_holder_name", ""),
            "inquiry_agree_yn": item.get("inquiry_agree_yn", "N"),
        })

    state["accounts"] = accounts
    state["accounts_updated_at"] = datetime.utcnow().isoformat()
    _save_ob_state(db, state)
    logger.info("✅ 오픈뱅킹 계좌 목록 조회 완료: %s개", len(accounts))
    return accounts


def fetch_account_balance(
    db: Session,
    fintech_use_num: str,
) -> dict[str, Any]:
    """개별 계좌 잔액 조회"""
    from config.settings import get_settings
    settings = get_settings()
    token = _get_valid_token(db)

    with httpx.Client(timeout=_REQUEST_TIMEOUT) as client:
        resp = client.get(
            _ob_url("/v2.0/account/balance/fin_num"),
            params={
                "fintech_use_num": fintech_use_num,
                "tran_dtime": _tran_dtime(),
            },
            headers={
                "Authorization": f"Bearer {token}",
            },
        )
        resp.raise_for_status()
        data = resp.json()

    return {
        "fintech_use_num": fintech_use_num,
        "balance_amt": int(data.get("balance_amt", 0) or 0),
        "available_amt": int(data.get("available_amt", 0) or 0),
        "account_num_masked": data.get("account_num_masked", ""),
        "bank_name": data.get("bank_name", ""),
    }


def sync_openbanking_to_finance(db: Session) -> dict[str, Any]:
    """
    오픈뱅킹 계좌 잔액을 조회해 finance cashAssets에 반영.
    syncSource='openbanking' + syncMeta.fintechUseNum 기반으로 기존 항목 업데이트, 없으면 추가.
    """
    import uuid as _uuid
    from core.finance_service import get_finance_state, save_finance_state

    state_ob = _load_ob_state(db)
    accounts = [a for a in (state_ob.get("accounts") or []) if a.get("inquiry_agree_yn") == "Y"]
    if not accounts:
        raise RuntimeError("잔액 조회에 동의한 연결 계좌가 없습니다.")

    finance_state = get_finance_state(db)
    cash_assets: list[dict] = list(finance_state.get("cashAssets") or [])
    now = datetime.utcnow().isoformat()
    updated = 0
    added = 0
    errors = []

    for acct in accounts:
        fin_num = acct.get("fintech_use_num", "")
        bank_name = acct.get("bank_name", "")
        masked = acct.get("account_num_masked", "")
        try:
            bal = fetch_account_balance(db, fin_num)
            amount = bal["balance_amt"]
            time.sleep(0.3)  # API rate limit

            existing = None
            for asset in cash_assets:
                meta = asset.get("syncMeta") or {}
                if asset.get("syncSource") == "openbanking" and meta.get("fintechUseNum") == fin_num:
                    existing = asset
                    break

            if existing:
                existing["amount"] = amount
                existing["updatedAt"] = now
                updated += 1
            else:
                cash_assets.append({
                    "id": str(_uuid.uuid4()),
                    "name": f"{bank_name} ({masked[-4:]})",
                    "institution": bank_name,
                    "accountType": "bank",
                    "amount": amount,
                    "updatedAt": now,
                    "syncSource": "openbanking",
                    "syncMeta": {"fintechUseNum": fin_num},
                })
                added += 1
        except Exception as e:
            logger.warning("오픈뱅킹 잔액 조회 실패 (%s %s): %s", bank_name, masked, e)
            errors.append({"bank": bank_name, "error": str(e)})

    finance_state["cashAssets"] = cash_assets
    save_finance_state(db, finance_state)
    logger.info("✅ 오픈뱅킹 동기화 완료: 업데이트=%s 추가=%s 오류=%s", updated, added, len(errors))
    return {"updated": updated, "added": added, "errors": errors}


def disconnect_openbanking(db: Session) -> dict[str, Any]:
    """오픈뱅킹 연결 해제 (토큰 revoke + 상태 삭제)"""
    from config.settings import get_settings
    settings = get_settings()
    state = _load_ob_state(db)
    token = state.get("access_token")

    if token and settings.openbanking_client_id and settings.openbanking_client_secret:
        try:
            with httpx.Client(timeout=_REQUEST_TIMEOUT) as client:
                client.post(
                    _ob_url("/oauth/2.0/revoke"),
                    data={
                        "token": token,
                        "client_id": settings.openbanking_client_id,
                        "client_secret": settings.openbanking_client_secret,
                    },
                    headers={"Content-Type": "application/x-www-form-urlencoded"},
                )
            logger.info("✅ 오픈뱅킹 토큰 revoke 완료")
        except Exception as e:
            logger.warning("오픈뱅킹 revoke 실패 (로컬 상태는 삭제): %s", e)

    _save_ob_state(db, {})
    return {"ok": True, "message": "오픈뱅킹 연결이 해제되었습니다."}
