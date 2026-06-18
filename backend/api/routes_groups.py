"""
api/routes_groups.py
관계 묶어보기 2단계 — 사용자 지정 종목 그룹(수동) CRUD
  GET    /api/stock-groups                       — 전체 그룹 목록
  GET    /api/stock-groups/by-symbol/{symbol}     — 특정 종목이 속한 그룹 목록 (차트 패널용)
  POST   /api/stock-groups                        — 그룹 생성
  PATCH  /api/stock-groups/{group_id}             — 그룹 이름 변경
  POST   /api/stock-groups/{group_id}/members     — 멤버 추가
  DELETE /api/stock-groups/{group_id}/members/{symbol} — 멤버 제거
  DELETE /api/stock-groups/{group_id}             — 그룹 삭제
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from config.database import Stock, StockGroup, StockGroupMember, get_db
from core.stock_resolver import resolve_symbol
from core.watchlist_detail import resolve_name_from_symbol

groups_router = APIRouter()


def _serialize_member(db: Session, member: StockGroupMember) -> dict:
    stock = db.query(Stock).filter(Stock.symbol == member.symbol).first()
    return {
        "symbol": member.symbol,
        "name": stock.name if stock else (member.stock_name or member.symbol),
        "current_price": stock.current_price if stock else None,
        "change_rate": round(stock.change_rate, 2) if stock and stock.change_rate else None,
        "is_holding": bool(stock and stock.qty and stock.qty > 0 and stock.is_active),
    }


def _serialize_group(db: Session, group: StockGroup) -> dict:
    return {
        "id": group.id,
        "name": group.name,
        "created_at": group.created_at.isoformat() if group.created_at else None,
        "members": [_serialize_member(db, m) for m in group.members],
    }


class GroupCreate(BaseModel):
    name: str
    symbols: list[str] = []


class GroupUpdate(BaseModel):
    name: Optional[str] = None


class MemberAdd(BaseModel):
    symbol: Optional[str] = None
    stock_name: Optional[str] = None


def _resolve_member_input(db: Session, body: MemberAdd) -> tuple[str, Optional[str]]:
    """입력(symbol 또는 stock_name)으로부터 (symbol, stock_name) 확정."""
    sym = (body.symbol or "").strip() or None
    name = (body.stock_name or "").strip() or None
    if not sym and name:
        sym = resolve_symbol(name, db)
    if not sym:
        raise HTTPException(status_code=400, detail="종목코드 또는 종목명을 확인할 수 없습니다.")
    if not name:
        name = resolve_name_from_symbol(sym)
    return sym, name


@groups_router.get("/stock-groups")
def list_groups(db: Session = Depends(get_db)):
    groups = db.query(StockGroup).order_by(StockGroup.created_at.desc()).all()
    return {"total": len(groups), "groups": [_serialize_group(db, g) for g in groups]}


@groups_router.get("/stock-groups/by-symbol/{symbol}")
def list_groups_for_symbol(symbol: str, db: Session = Depends(get_db)):
    """특정 종목이 속한 그룹들 — 차트 페이지의 '내 그룹' 패널용"""
    groups = (
        db.query(StockGroup)
        .join(StockGroupMember, StockGroupMember.group_id == StockGroup.id)
        .filter(StockGroupMember.symbol == symbol)
        .all()
    )
    return {"symbol": symbol, "groups": [_serialize_group(db, g) for g in groups]}


@groups_router.post("/stock-groups")
def create_group(body: GroupCreate, db: Session = Depends(get_db)):
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="그룹 이름을 입력하세요.")
    group = StockGroup(name=name)
    db.add(group)
    db.flush()

    seen = set()
    for raw in body.symbols:
        sym = (raw or "").strip()
        if not sym or sym in seen:
            continue
        seen.add(sym)
        stock_name = resolve_name_from_symbol(sym)
        db.add(StockGroupMember(group_id=group.id, symbol=sym, stock_name=stock_name))

    db.commit()
    db.refresh(group)
    return _serialize_group(db, group)


@groups_router.patch("/stock-groups/{group_id}")
def update_group(group_id: int, body: GroupUpdate, db: Session = Depends(get_db)):
    group = db.query(StockGroup).filter(StockGroup.id == group_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="그룹 없음")
    if body.name is not None:
        name = body.name.strip()
        if not name:
            raise HTTPException(status_code=400, detail="그룹 이름을 입력하세요.")
        group.name = name
    db.commit()
    db.refresh(group)
    return _serialize_group(db, group)


@groups_router.post("/stock-groups/{group_id}/members")
def add_group_member(group_id: int, body: MemberAdd, db: Session = Depends(get_db)):
    group = db.query(StockGroup).filter(StockGroup.id == group_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="그룹 없음")
    sym, name = _resolve_member_input(db, body)
    existing = (
        db.query(StockGroupMember)
        .filter(StockGroupMember.group_id == group_id, StockGroupMember.symbol == sym)
        .first()
    )
    if not existing:
        db.add(StockGroupMember(group_id=group_id, symbol=sym, stock_name=name))
        db.commit()
        db.refresh(group)
    return _serialize_group(db, group)


@groups_router.delete("/stock-groups/{group_id}/members/{symbol}")
def remove_group_member(group_id: int, symbol: str, db: Session = Depends(get_db)):
    member = (
        db.query(StockGroupMember)
        .filter(StockGroupMember.group_id == group_id, StockGroupMember.symbol == symbol)
        .first()
    )
    if not member:
        raise HTTPException(status_code=404, detail="멤버 없음")
    db.delete(member)
    db.commit()
    group = db.query(StockGroup).filter(StockGroup.id == group_id).first()
    return _serialize_group(db, group) if group else {"ok": True}


@groups_router.delete("/stock-groups/{group_id}")
def delete_group(group_id: int, db: Session = Depends(get_db)):
    group = db.query(StockGroup).filter(StockGroup.id == group_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="그룹 없음")
    db.delete(group)
    db.commit()
    return {"ok": True, "id": group_id}
