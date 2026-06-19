"""
api/routes_finance.py — 재정허브 API
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from config.database import get_db
from core.demo_mode import demo_write_blocked
from core.finance_service import (
    get_finance_state,
    get_ledger_state,
    get_stock_snapshot,
    reset_finance_state,
    reset_ledger_state,
    save_finance_state,
    save_ledger_state,
)

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


@finance_router.get("/stock-snapshot")
def read_stock_snapshot(db: Session = Depends(get_db)):
    return get_stock_snapshot(db)
