"""
api/routes_finance.py — 재정허브 API
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
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
from core.finance_service import (
    export_backup,
    generate_cashflow_opinion,
    get_saved_cashflow_opinion,
    get_finance_state,
    get_ledger_state,
    get_stock_snapshot,
    list_asset_snapshots,
    record_asset_snapshot,
    reset_finance_state,
    reset_ledger_state,
    restore_backup,
    save_finance_state,
    save_ledger_state,
)
from core.leverage_analysis import analyze_leverage_investment

finance_router = APIRouter(prefix="/finance", tags=["finance"])


class FinanceStateBody(BaseModel):
    cashAssets: list[Any] = []
    illiquidAssets: list[Any] = []
    realEstateAssets: list[Any] = []
    liabilities: list[Any] = []
    fixedExpenses: list[Any] = []
    incomes: list[Any] = []
    fundingNeeds: list[Any] = []


class LedgerStateBody(BaseModel):
    transactions: list[Any] = []
    budgets: list[Any] = []
    settings: dict[str, Any] | None = None


@finance_router.get("/state")
def read_finance_state(db: Session = Depends(get_db)):
    return get_finance_state(db)


@finance_router.put("/state")
def write_finance_state(body: FinanceStateBody, db: Session = Depends(get_db)):
    demo_write_blocked()
    return save_finance_state(db, body.model_dump())


@finance_router.delete("/state")
def clear_finance_state(db: Session = Depends(get_db)):
    demo_write_blocked()
    return reset_finance_state(db)


@finance_router.get("/ledger")
def read_ledger_state(db: Session = Depends(get_db)):
    return get_ledger_state(db)


@finance_router.put("/ledger")
def write_ledger_state(body: LedgerStateBody, db: Session = Depends(get_db)):
    demo_write_blocked()
    return save_ledger_state(db, body.model_dump(exclude_unset=True))


@finance_router.delete("/ledger")
def clear_ledger_state(db: Session = Depends(get_db)):
    demo_write_blocked()
    return reset_ledger_state(db)


class CashflowOpinionBody(BaseModel):
    year: int
    month: int
    analysis_provider: str | None = None


@finance_router.get("/ledger/cashflow-opinion")
def get_cashflow_opinion(
    year: int = Query(...), month: int = Query(...), db: Session = Depends(get_db)
):
    """저장된 월별 AI 현금흐름 의견 조회"""
    saved = get_saved_cashflow_opinion(db, year, month)
    if not saved:
        return JSONResponse(content=None)
    return saved


@finance_router.post("/ledger/cashflow-opinion")
def cashflow_opinion(body: CashflowOpinionBody, db: Session = Depends(get_db)):
    """이번 달 수입 대비 지출에 대한 AI 의견 생성"""
    settings = get_settings()
    try:
        ensure_analysis_available(settings, body.analysis_provider)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    try:
        return generate_cashflow_opinion(db, body.year, body.month, body.analysis_provider)
    except ProviderQuotaError as e:
        handle_provider_runtime_error(e)
    except RuntimeError as e:
        handle_provider_runtime_error(e)


@finance_router.get("/stock-snapshot")
def read_stock_snapshot(db: Session = Depends(get_db)):
    return get_stock_snapshot(db)


@finance_router.get("/leverage-analysis")
def read_leverage_analysis(
    start_date: str = Query(..., description="대출 실행일 YYYY-MM-DD"),
    principal: float = Query(..., gt=0),
    annual_rate: float = Query(..., ge=0),
    db: Session = Depends(get_db),
):
    """대출 실행일 이후 매수한 종목들의 투자 성과 vs 대출 이자비용"""
    return analyze_leverage_investment(
        db, start_date=start_date, principal=principal, annual_rate=annual_rate
    )


class AssetSnapshotBody(BaseModel):
    date: str | None = None
    total_assets: float = 0
    liquid_assets: float = 0
    illiquid_assets: float = 0
    real_estate_assets: float = 0
    total_liabilities: float = 0
    liquid_net_worth: float = 0


@finance_router.post("/asset-snapshot")
def write_asset_snapshot(body: AssetSnapshotBody, db: Session = Depends(get_db)):
    """대시보드를 열 때마다 그날의 총자산·유동성자산 값을 upsert (날짜별 추이 차트용)"""
    return record_asset_snapshot(db, body.model_dump())


@finance_router.get("/asset-snapshot")
def read_asset_snapshots(days: int = 180, db: Session = Depends(get_db)):
    return {"items": list_asset_snapshots(db, days)}


@finance_router.get("/broker-deposits")
def read_broker_deposits():
    """KIS + 키움 예수금 현재 잔액 조회 (DB 저장 없음)"""
    from core.broker_deposit_sync import get_all_broker_deposits
    try:
        deposits = get_all_broker_deposits()
        return {"deposits": deposits, "count": len(deposits)}
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"브로커 예수금 조회 실패: {e}") from e


@finance_router.post("/sync-broker-deposits")
def sync_broker_deposits(db: Session = Depends(get_db)):
    """KIS + 키움 예수금을 조회해 cashAssets에 자동 반영"""
    demo_write_blocked()
    from core.broker_deposit_sync import sync_broker_deposits_to_finance
    try:
        result = sync_broker_deposits_to_finance(db)
        return result
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"예수금 동기화 실패: {e}") from e


@finance_router.get("/backup")
def read_backup(db: Session = Depends(get_db)):
    """FinanceHub 호환 JSON 백업 다운로드"""
    return export_backup(db)


class FinanceBackupRestoreBody(BaseModel):
    model_config = {"extra": "allow"}

    version: int | None = None
    app: str | None = None
    exportedAt: str | None = None
    finance: dict[str, Any] | None = None
    ledger: dict[str, Any] | None = None


@finance_router.post("/backup/restore")
def restore_from_backup(body: FinanceBackupRestoreBody, db: Session = Depends(get_db)):
    """JSON 백업 파일로 재정·가계부 데이터 복구"""
    demo_write_blocked()
    try:
        return restore_backup(db, body.model_dump(exclude_none=False))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
