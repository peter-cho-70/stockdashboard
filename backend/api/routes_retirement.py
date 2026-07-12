"""
api/routes_retirement.py — 노후생활(은퇴 설계) API
재정 보드 하위 네임스페이스(/finance/retirement)로 노출한다.
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from config.database import get_db
from config.settings import get_settings
from core.ai_analyzer import (
    ProviderQuotaError,
    ensure_analysis_available,
    handle_provider_runtime_error,
)
from core.demo_mode import demo_write_blocked
from core.retirement_service import (
    build_retirement_snapshot,
    generate_retirement_opinion,
    get_retire_profile,
    get_saved_retirement_opinion,
    list_retirement_reviews,
    run_weekly_retirement_review,
    save_retire_profile,
)

retirement_router = APIRouter(prefix="/finance/retirement", tags=["retirement"])


class RetireProfileBody(BaseModel):
    birth_year: int | None = None
    target_retire_age: int | None = None
    target_monthly_expense: int | None = None
    risk_tolerance: str | None = None
    notes: str | None = None


class RetireAiBody(BaseModel):
    analysis_provider: str | None = None


@retirement_router.get("/profile")
def read_retire_profile(db: Session = Depends(get_db)):
    return get_retire_profile(db)


@retirement_router.put("/profile")
def write_retire_profile(body: RetireProfileBody, db: Session = Depends(get_db)):
    demo_write_blocked()
    return save_retire_profile(db, body.model_dump(exclude_unset=True))


@retirement_router.get("/snapshot")
def read_retirement_snapshot(db: Session = Depends(get_db)):
    """AI 호출 없이 계산되는 노후 준비 진단 지표"""
    return build_retirement_snapshot(db)


@retirement_router.get("/opinion")
def read_retirement_opinion(db: Session = Depends(get_db)):
    """저장된 AI 종합 의견 (없으면 null)"""
    saved = get_saved_retirement_opinion(db)
    if not saved:
        return JSONResponse(content=None)
    return saved


@retirement_router.post("/opinion")
def create_retirement_opinion(body: RetireAiBody, db: Session = Depends(get_db)):
    """현재 포트폴리오·재정 데이터 기반 노후 준비 AI 종합 의견 생성"""
    demo_write_blocked()
    settings = get_settings()
    try:
        ensure_analysis_available(settings, body.analysis_provider)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    try:
        return generate_retirement_opinion(db, body.analysis_provider)
    except (ProviderQuotaError, RuntimeError) as e:
        handle_provider_runtime_error(e)


@retirement_router.get("/reviews")
def read_retirement_reviews(db: Session = Depends(get_db)) -> list[dict[str, Any]]:
    """주간 리뷰 히스토리 (최신순)"""
    return list_retirement_reviews(db)


@retirement_router.post("/reviews/run")
def trigger_retirement_review(body: RetireAiBody, db: Session = Depends(get_db)):
    """주간 리뷰 수동 실행 (스케줄러는 매주 일요일 18:00 자동 실행)"""
    demo_write_blocked()
    settings = get_settings()
    try:
        ensure_analysis_available(settings, body.analysis_provider)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    try:
        return run_weekly_retirement_review(db, body.analysis_provider)
    except (ProviderQuotaError, RuntimeError) as e:
        handle_provider_runtime_error(e)
