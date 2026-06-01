"""
목표가·미국 증시 리포트 API
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from config.database import get_db
from core.price_targets import (
    add_manual_target,
    delete_price_target,
    fetch_price_targets_with_ai,
    list_price_targets,
)
from core.us_market_report import (
    generate_us_morning_report,
    get_report,
    list_reports,
)

market_router = APIRouter(tags=["market"])


class ManualTargetBody(BaseModel):
    source: str = Field(..., min_length=1, max_length=100)
    target_price: float = Field(..., gt=0)
    analyst: Optional[str] = None
    rating: Optional[str] = None
    report_date: Optional[str] = None
    is_consensus: bool = False


# ── 목표가 ────────────────────────────────────────────────────────

@market_router.get("/stocks/{symbol}/price-targets")
def api_list_price_targets(symbol: str, db: Session = Depends(get_db)):
    return {"symbol": symbol, "targets": list_price_targets(db, symbol)}


@market_router.post("/stocks/{symbol}/price-targets/fetch")
def api_fetch_price_targets(symbol: str, db: Session = Depends(get_db)):
    try:
        return fetch_price_targets_with_ai(db, symbol.strip())
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@market_router.post("/stocks/{symbol}/price-targets")
def api_add_price_target(symbol: str, body: ManualTargetBody, db: Session = Depends(get_db)):
    row = add_manual_target(
        db,
        symbol.strip(),
        source=body.source,
        target_price=body.target_price,
        analyst=body.analyst,
        rating=body.rating,
        report_date=body.report_date,
        is_consensus=body.is_consensus,
    )
    return row


@market_router.delete("/stocks/{symbol}/price-targets/{target_id}")
def api_delete_price_target(symbol: str, target_id: int, db: Session = Depends(get_db)):
    if not delete_price_target(db, symbol.strip(), target_id):
        raise HTTPException(status_code=404, detail="목표가 없음")
    return {"ok": True}


# ── 미국 증시 리포트 ──────────────────────────────────────────────

@market_router.get("/reports/us/daily")
def api_us_daily_reports(
    days: int = Query(7, ge=1, le=30),
    date: Optional[str] = Query(None, description="YYYY-MM-DD, 단일 조회"),
    db: Session = Depends(get_db),
):
    if date:
        one = get_report(db, date)
        return {"report": one}
    return {"reports": list_reports(db, days=days)}


@market_router.post("/reports/us/daily/generate")
def api_generate_us_report(
    date: Optional[str] = Query(None, description="YYYY-MM-DD"),
    force: bool = Query(False),
    db: Session = Depends(get_db),
):
    try:
        report = generate_us_morning_report(db, report_date=date, force=force)
        return {"report": report}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
