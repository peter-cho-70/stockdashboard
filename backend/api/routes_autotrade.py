"""
api/routes_autotrade.py
전용 KIS 계좌 자동매매 — 규칙 관리, 조건 충족 이벤트 승인/거부, 킬스위치
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from config.database import AutoTradeEvent, AutoTradeRule, Stock, get_db
from config.settings import get_settings
from core.autotrade_engine import approve_event, is_kill_switch_on, reject_event, set_kill_switch
from core.demo_mode import demo_write_blocked, is_demo_mode
from core.price_targets import compute_sell_ladder, compute_target_buy_price

autotrade_router = APIRouter(prefix="/autotrade", tags=["autotrade"])


class RuleCreate(BaseModel):
    symbol: str = Field(..., min_length=1)
    name: Optional[str] = None
    buy_qty: int = Field(..., gt=0)
    broker: str = Field("kis", pattern="^(kis|kiwoom)$")


def _serialize_rule(db: Session, rule: AutoTradeRule) -> dict:
    stock = db.query(Stock).filter(Stock.symbol == rule.symbol).first()
    info = compute_target_buy_price(db, rule.symbol)
    ladder = None
    if rule.executed_buy_price:
        ladder = compute_sell_ladder(rule.executed_buy_price, info["custom_profit_pct"] if info else 10)
    done = {p for p in (rule.sell_leg_done or "").split(",") if p}
    return {
        "id": rule.id,
        "symbol": rule.symbol,
        "name": rule.name or (stock.name if stock else rule.symbol),
        "account_no": rule.account_no,
        "broker": rule.broker or "kis",
        "execution_mode": rule.execution_mode,
        "enabled": rule.enabled,
        "buy_qty": rule.buy_qty,
        "current_price": stock.current_price if stock else None,
        "computed_buy_price": info["buy_price"] if info else None,
        "avg_target": info["avg_target"] if info else None,
        "weight_pct": info["weight_pct"] if info else None,
        "executed_buy_price": rule.executed_buy_price,
        "position_qty": rule.position_qty,
        "sell_ladder": ladder,
        "sell_leg_done": sorted(done),
        "status": (
            "매도 진행중" if rule.position_qty > 0
            else "매수완료" if rule.executed_buy_price
            else "대기"
        ),
    }


@autotrade_router.get("/rules")
def list_rules(db: Session = Depends(get_db)):
    if is_demo_mode():
        return []
    rules = db.query(AutoTradeRule).order_by(AutoTradeRule.created_at.desc()).all()
    return [_serialize_rule(db, r) for r in rules]


@autotrade_router.post("/rules")
def create_rule(body: RuleCreate, db: Session = Depends(get_db)):
    demo_write_blocked()
    settings = get_settings()
    if body.broker == "kiwoom":
        account_no = (settings.autotrade_kiwoom_account_no or "").strip()
        env_name = "AUTOTRADE_KIWOOM_ACCOUNT_NO"
    else:
        account_no = (settings.autotrade_account_no or "").strip()
        env_name = "AUTOTRADE_ACCOUNT_NO"
    if not account_no:
        raise HTTPException(
            status_code=400,
            detail=f"{env_name}가 설정되지 않았습니다. .env에 자동매매 전용 계좌를 먼저 등록하세요.",
        )
    rule = AutoTradeRule(
        symbol=body.symbol.strip(),
        name=body.name,
        account_no=account_no,
        broker=body.broker,
        execution_mode="semi",
        buy_qty=body.buy_qty,
    )
    db.add(rule)
    db.commit()
    db.refresh(rule)
    return _serialize_rule(db, rule)


@autotrade_router.patch("/rules/{rule_id}")
def update_rule(rule_id: int, enabled: Optional[bool] = None, db: Session = Depends(get_db)):
    demo_write_blocked()
    rule = db.query(AutoTradeRule).filter(AutoTradeRule.id == rule_id).first()
    if not rule:
        raise HTTPException(status_code=404, detail="규칙을 찾을 수 없습니다.")
    if enabled is not None:
        rule.enabled = enabled
    db.commit()
    return _serialize_rule(db, rule)


@autotrade_router.delete("/rules/{rule_id}")
def delete_rule(rule_id: int, db: Session = Depends(get_db)):
    demo_write_blocked()
    rule = db.query(AutoTradeRule).filter(AutoTradeRule.id == rule_id).first()
    if not rule:
        raise HTTPException(status_code=404, detail="규칙을 찾을 수 없습니다.")
    db.delete(rule)
    db.commit()
    return {"ok": True}


@autotrade_router.get("/events")
def list_events(status: Optional[str] = None, db: Session = Depends(get_db)):
    if is_demo_mode():
        return []
    q = db.query(AutoTradeEvent)
    if status:
        q = q.filter(AutoTradeEvent.status == status)
    rows = q.order_by(AutoTradeEvent.created_at.desc()).limit(200).all()
    out = []
    for e in rows:
        rule = db.query(AutoTradeRule).filter(AutoTradeRule.id == e.rule_id).first()
        out.append({
            "id": e.id,
            "rule_id": e.rule_id,
            "symbol": rule.symbol if rule else None,
            "name": rule.name if rule else None,
            "event_type": e.event_type,
            "leg_pct": e.leg_pct,
            "status": e.status,
            "trigger_price": e.trigger_price,
            "qty": e.qty,
            "order_id": e.order_id,
            "error_message": e.error_message,
            "created_at": e.created_at.isoformat(),
            "resolved_at": e.resolved_at.isoformat() if e.resolved_at else None,
        })
    return out


@autotrade_router.post("/events/{event_id}/approve")
def approve(event_id: int, db: Session = Depends(get_db)):
    demo_write_blocked()
    try:
        return approve_event(db, event_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@autotrade_router.post("/events/{event_id}/reject")
def reject(event_id: int, db: Session = Depends(get_db)):
    demo_write_blocked()
    try:
        return reject_event(db, event_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@autotrade_router.get("/kill-switch")
def get_kill_switch(db: Session = Depends(get_db)):
    return {"on": is_kill_switch_on(db)}


@autotrade_router.post("/kill-switch")
def post_kill_switch(on: bool, db: Session = Depends(get_db)):
    demo_write_blocked()
    return {"on": set_kill_switch(db, on)}
