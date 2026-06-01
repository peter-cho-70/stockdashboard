"""
api/routes_digest.py — 일일 AI digest API
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from config.database import get_db
from core.intel_digest import (
    backfill_digests,
    generate_daily_digest,
    get_digest,
    list_digests,
    serialize_digest,
)

digest_router = APIRouter()


class DigestGenerateBody(BaseModel):
    date: str
    force: bool = False
    analysis_provider: Optional[str] = None


class DigestBackfillBody(BaseModel):
    from_date: str
    to_date: str
    force: bool = False
    analysis_provider: Optional[str] = None


@digest_router.get("/intel/digest")
def list_intel_digests(
    from_date: str = Query(..., alias="from"),
    to_date: str = Query(..., alias="to"),
    db: Session = Depends(get_db),
):
    """기간별 digest 목록."""
    return {
        "from": from_date,
        "to": to_date,
        "digests": list_digests(db, from_date, to_date),
    }


@digest_router.get("/intel/digest/{date}")
def get_intel_digest(date: str, db: Session = Depends(get_db)):
    """해당일 digest 본문 + stats."""
    row = get_digest(db, date)
    if not row:
        raise HTTPException(status_code=404, detail=f"digest 없음: {date}")
    return serialize_digest(row)


@digest_router.post("/intel/digest/generate")
def post_generate_digest(body: DigestGenerateBody, db: Session = Depends(get_db)):
    """단일일 digest 생성/재생성."""
    try:
        row = generate_daily_digest(
            db,
            body.date,
            force=body.force,
            analysis_provider=body.analysis_provider,
        )
    except ValueError as e:
        raise HTTPException(status_code=403, detail=str(e)) from e
    return {"ok": True, "digest": serialize_digest(row)}


@digest_router.post("/intel/digest/backfill")
def post_backfill_digest(body: DigestBackfillBody, db: Session = Depends(get_db)):
    """기간 백필 (일별 AI 호출 — 비용 주의)."""
    try:
        result = backfill_digests(
            db,
            body.from_date,
            body.to_date,
            force=body.force,
            analysis_provider=body.analysis_provider,
        )
    except ValueError as e:
        raise HTTPException(status_code=403, detail=str(e)) from e
    return {"ok": True, **result}
