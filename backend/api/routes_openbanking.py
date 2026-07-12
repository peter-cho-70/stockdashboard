"""
api/routes_openbanking.py
금융결제원 오픈뱅킹 OAuth2 연동 라우터

GET  /finance/openbanking/status    — 연동 상태 조회
GET  /finance/openbanking/auth      — OAuth 인가 URL 반환
GET  /finance/openbanking/callback  — OAuth 콜백 (code 교환)
GET  /finance/openbanking/accounts  — 연결 계좌 목록 조회 및 저장
POST /finance/openbanking/sync      — 잔액 조회 후 cashAssets 갱신
DELETE /finance/openbanking         — 연결 해제
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import RedirectResponse, JSONResponse
from sqlalchemy.orm import Session

from config.database import get_db
from config.settings import get_settings

openbanking_router = APIRouter(prefix="/finance/openbanking", tags=["openbanking"])

_FRONTEND_CALLBACK_URL = "/finance/settings?tab=openbanking"


def _get_redirect_uri() -> str:
    """포털에 등록한 Redirect URI 반환 (OPENBANKING_REDIRECT_URI 우선)"""
    return get_settings().get_openbanking_redirect_uri()


@openbanking_router.get("/status")
def ob_status(db: Session = Depends(get_db)):
    """오픈뱅킹 연동 상태 반환"""
    from core.openbanking_client import get_ob_status
    return get_ob_status(db)


@openbanking_router.get("/auth")
def ob_auth_url():
    """금융결제원 OAuth 인가 URL 반환 (프론트에서 리다이렉트용)"""
    from core.openbanking_client import build_auth_url
    settings = get_settings()
    if not settings.openbanking_is_configured():
        raise HTTPException(
            status_code=400,
            detail="OPENBANKING_CLIENT_ID / OPENBANKING_CLIENT_SECRET 환경변수가 설정되지 않았습니다.",
        )
    redirect_uri = _get_redirect_uri()
    try:
        url = build_auth_url(redirect_uri)
        return {"url": url, "redirect_uri": redirect_uri}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@openbanking_router.get("/callback")
def ob_callback(
    code: str = Query(..., description="인가 코드"),
    db: Session = Depends(get_db),
):
    """OAuth 콜백 — code를 access_token으로 교환 후 계좌 목록 자동 조회, 프론트 설정 페이지로 리다이렉트"""
    from core.openbanking_client import exchange_code_for_token, fetch_user_accounts
    redirect_uri = _get_redirect_uri()
    import os
    frontend_origin = os.environ.get("FRONTEND_URL") or f"http://localhost:{os.environ.get('FRONTEND_PORT', '3000')}"
    try:
        exchange_code_for_token(db, code, redirect_uri)
        fetch_user_accounts(db)
        return RedirectResponse(
            url=f"{frontend_origin}{_FRONTEND_CALLBACK_URL}&ob_success=1",
            status_code=302,
        )
    except Exception as e:
        return RedirectResponse(
            url=f"{frontend_origin}{_FRONTEND_CALLBACK_URL}&ob_error={str(e)[:80]}",
            status_code=302,
        )


@openbanking_router.get("/accounts")
def ob_accounts(db: Session = Depends(get_db)):
    """연결 계좌 목록 조회 (금융결제원 /v2.0/user/me)"""
    from core.openbanking_client import fetch_user_accounts
    try:
        accounts = fetch_user_accounts(db)
        return {"accounts": accounts, "count": len(accounts)}
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"계좌 조회 실패: {e}") from e


@openbanking_router.post("/sync")
def ob_sync(db: Session = Depends(get_db)):
    """오픈뱅킹 계좌 잔액 조회 → finance cashAssets 동기화"""
    from core.openbanking_client import sync_openbanking_to_finance
    try:
        result = sync_openbanking_to_finance(db)
        return result
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"잔액 동기화 실패: {e}") from e


@openbanking_router.delete("")
def ob_disconnect(db: Session = Depends(get_db)):
    """오픈뱅킹 연결 해제 (토큰 revoke + DB 삭제)"""
    from core.openbanking_client import disconnect_openbanking
    return disconnect_openbanking(db)
