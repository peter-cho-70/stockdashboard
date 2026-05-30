"""
api/routes_gains.py
연도별 실현 수익 (매도 수익 + 배당 수익) API
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func
from pydantic import BaseModel
from typing import Optional
from datetime import datetime

from config.database import get_db, RealizedGain, AppConfig

gains_router = APIRouter(prefix="/gains", tags=["gains"])


class GainCreate(BaseModel):
    year: int
    gain_type: str          # "CAPITAL" or "DIVIDEND"
    symbol: Optional[str] = None
    stock_name: Optional[str] = None
    amount: float
    tax_amount: float = 0
    trade_date: Optional[str] = None
    note: Optional[str] = None


class GainUpdate(BaseModel):
    amount: Optional[float] = None
    tax_amount: Optional[float] = None
    stock_name: Optional[str] = None
    symbol: Optional[str] = None
    trade_date: Optional[str] = None
    note: Optional[str] = None


def _to_dict(g: RealizedGain) -> dict:
    return {
        "id": g.id,
        "year": g.year,
        "gain_type": g.gain_type,
        "symbol": g.symbol,
        "stock_name": g.stock_name,
        "amount": g.amount,
        "tax_amount": g.tax_amount,
        "net_amount": g.amount - g.tax_amount,
        "trade_date": g.trade_date,
        "note": g.note,
        "created_at": g.created_at.isoformat(),
    }


# ── 전체 내역 조회 ────────────────────────────
@gains_router.get("")
def get_gains(year: Optional[int] = None, gain_type: Optional[str] = None, db: Session = Depends(get_db)):
    """실현 수익 내역 조회 (연도/종류 필터 가능)"""
    q = db.query(RealizedGain)
    if year:
        q = q.filter(RealizedGain.year == year)
    if gain_type:
        q = q.filter(RealizedGain.gain_type == gain_type)
    items = q.order_by(RealizedGain.year.desc(), RealizedGain.trade_date.desc()).all()
    return [_to_dict(g) for g in items]


# ── 연도별 요약 ───────────────────────────────
@gains_router.get("/summary")
def get_gains_summary(db: Session = Depends(get_db)):
    """연도별 매도/배당 합계 요약"""
    rows = (
        db.query(
            RealizedGain.year,
            RealizedGain.gain_type,
            func.sum(RealizedGain.amount).label("total_amount"),
            func.sum(RealizedGain.tax_amount).label("total_tax"),
            func.count(RealizedGain.id).label("count"),
        )
        .group_by(RealizedGain.year, RealizedGain.gain_type)
        .order_by(RealizedGain.year)
        .all()
    )

    # 연도별로 묶기
    by_year: dict[int, dict] = {}
    for row in rows:
        y = row.year
        if y not in by_year:
            by_year[y] = {
                "year": y,
                "capital_amount": 0,
                "capital_tax": 0,
                "capital_count": 0,
                "dividend_amount": 0,
                "dividend_tax": 0,
                "dividend_count": 0,
            }
        if row.gain_type == "CAPITAL":
            by_year[y]["capital_amount"] = round(row.total_amount or 0)
            by_year[y]["capital_tax"] = round(row.total_tax or 0)
            by_year[y]["capital_count"] = row.count
        elif row.gain_type == "DIVIDEND":
            by_year[y]["dividend_amount"] = round(row.total_amount or 0)
            by_year[y]["dividend_tax"] = round(row.total_tax or 0)
            by_year[y]["dividend_count"] = row.count

    result = []
    for y, d in sorted(by_year.items()):
        total = d["capital_amount"] + d["dividend_amount"]
        total_tax = d["capital_tax"] + d["dividend_tax"]
        result.append({
            **d,
            "total_amount": total,
            "total_tax": total_tax,
            "total_net": total - total_tax,
        })

    # 누적 합계
    cum_capital = cum_dividend = cum_total = cum_tax = 0
    for r in result:
        cum_capital += r["capital_amount"]
        cum_dividend += r["dividend_amount"]
        cum_total += r["total_amount"]
        cum_tax += r["total_tax"]
        r["cum_capital"] = cum_capital
        r["cum_dividend"] = cum_dividend
        r["cum_total"] = cum_total

    return {
        "yearly": result,
        "all_time": {
            "capital": cum_capital,
            "dividend": cum_dividend,
            "total": cum_total,
            "tax": cum_tax,
            "net": cum_total - cum_tax,
        },
    }


# ── 단건 추가 ─────────────────────────────────
@gains_router.post("")
def add_gain(body: GainCreate, db: Session = Depends(get_db)):
    """실현 수익 내역 추가"""
    if body.gain_type not in ("CAPITAL", "DIVIDEND"):
        raise HTTPException(status_code=400, detail="gain_type은 CAPITAL 또는 DIVIDEND 여야 합니다.")
    g = RealizedGain(**body.model_dump())
    db.add(g)
    db.commit()
    db.refresh(g)
    return _to_dict(g)


# ── 수정 ──────────────────────────────────────
@gains_router.patch("/{gain_id}")
def update_gain(gain_id: int, body: GainUpdate, db: Session = Depends(get_db)):
    """실현 수익 수정"""
    g = db.query(RealizedGain).filter(RealizedGain.id == gain_id).first()
    if not g:
        raise HTTPException(status_code=404, detail="내역 없음")
    for field, val in body.model_dump(exclude_none=True).items():
        setattr(g, field, val)
    g.updated_at = datetime.utcnow()
    db.commit()
    return _to_dict(g)


# ── 삭제 ──────────────────────────────────────
@gains_router.delete("/{gain_id}")
def delete_gain(gain_id: int, db: Session = Depends(get_db)):
    """실현 수익 삭제"""
    g = db.query(RealizedGain).filter(RealizedGain.id == gain_id).first()
    if not g:
        raise HTTPException(status_code=404, detail="내역 없음")
    db.delete(g)
    db.commit()
    return {"message": "삭제 완료", "id": gain_id}


# ── 예수금 조회/저장 ────────────────────────────
class CashBody(BaseModel):
    amount: float


@gains_router.get("/cash")
def get_cash(db: Session = Depends(get_db)):
    """예수금 조회"""
    cfg = db.query(AppConfig).filter(AppConfig.key == "cash_balance").first()
    return {"cash_balance": float(cfg.value) if cfg else 0.0}


@gains_router.post("/cash")
def set_cash(body: CashBody, db: Session = Depends(get_db)):
    """예수금 저장"""
    cfg = db.query(AppConfig).filter(AppConfig.key == "cash_balance").first()
    if cfg:
        cfg.value = str(body.amount)
        cfg.updated_at = datetime.utcnow()
    else:
        db.add(AppConfig(key="cash_balance", value=str(body.amount)))
    db.commit()
    return {"cash_balance": body.amount}
