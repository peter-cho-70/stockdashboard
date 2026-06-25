"""
core/autotrade_engine.py
전용 계좌(KIS 또는 키움) 자동매매 — 매수적정가/익절 사다리 조건 감시 + (반자동) 승인 후 주문 실행

안전장치:
- 킬스위치(AppConfig) on이면 조건 평가 자체를 하지 않음
- approve_event는 rule.account_no가 rule.broker에 맞는 전용 계좌 설정과 다르면 무조건 거부
  (다른 코드의 버그가 있어도 대시보드 계좌로는 절대 주문이 나가지 않도록 하는 이중 방어)
"""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Any

from sqlalchemy.orm import Session

from config.database import AlertHistory, AppConfig, AutoTradeEvent, AutoTradeRule, Stock
from config.settings import get_settings
from core.kis_client import create_kis_client_from_settings
from core.kiwoom_client import create_kiwoom_client_from_settings
from core.price_targets import compute_sell_ladder, compute_target_buy_price

logger = logging.getLogger(__name__)

KILL_SWITCH_KEY = "autotrade_kill_switch"
SELL_LEG_PCTS = (5, 10, 15, 20)  # + rule별 custom_profit_pct


def is_kill_switch_on(db: Session) -> bool:
    cfg = db.query(AppConfig).filter(AppConfig.key == KILL_SWITCH_KEY).first()
    return bool(cfg and cfg.value == "1")


def set_kill_switch(db: Session, on: bool) -> bool:
    cfg = db.query(AppConfig).filter(AppConfig.key == KILL_SWITCH_KEY).first()
    if cfg:
        cfg.value = "1" if on else "0"
        cfg.updated_at = datetime.utcnow()
    else:
        db.add(AppConfig(key=KILL_SWITCH_KEY, value="1" if on else "0"))
    db.commit()
    return on


def _sell_legs_done(rule: AutoTradeRule) -> set[float]:
    if not rule.sell_leg_done:
        return set()
    return {float(p) for p in rule.sell_leg_done.split(",") if p}


def _mark_leg_done(rule: AutoTradeRule, pct: float) -> None:
    done = _sell_legs_done(rule)
    done.add(pct)
    rule.sell_leg_done = ",".join(str(p) for p in sorted(done))


def check_conditions(db: Session) -> dict[str, Any]:
    """모든 활성 규칙의 매수/매도 조건을 평가하고, 충족 시 PENDING_APPROVAL 이벤트를 생성한다.
    실제 주문은 여기서 내지 않는다 — Phase1(반자동)은 approve_event를 통해서만 주문이 나간다."""
    if is_kill_switch_on(db):
        return {"skipped": "kill_switch_on", "events_created": []}

    created: list[dict[str, Any]] = []
    rules = db.query(AutoTradeRule).filter(AutoTradeRule.enabled.is_(True)).all()
    for rule in rules:
        stock = db.query(Stock).filter(Stock.symbol == rule.symbol).first()
        if not stock or not stock.current_price:
            continue
        current_price = stock.current_price

        pending_events = (
            db.query(AutoTradeEvent)
            .filter(AutoTradeEvent.rule_id == rule.id, AutoTradeEvent.status == "PENDING_APPROVAL")
            .all()
        )
        pending_buy = any(e.event_type == "BUY" for e in pending_events)
        pending_sell_legs = {e.leg_pct for e in pending_events if e.event_type == "SELL"}

        if rule.executed_buy_price is None:
            # 아직 한 번도 매수 체결된 적 없음 — 매수 조건만 평가 (승인 대기 중이면 중복 생성하지 않음)
            if pending_buy:
                continue
            info = compute_target_buy_price(db, rule.symbol)
            if not info:
                continue
            if current_price <= info["buy_price"]:
                event = AutoTradeEvent(
                    rule_id=rule.id,
                    event_type="BUY",
                    trigger_price=current_price,
                    qty=rule.buy_qty,
                )
                db.add(event)
                rule.buy_triggered = True
                db.add(AlertHistory(
                    stock_symbol=rule.symbol,
                    alert_type="AUTOTRADE_CONDITION_MET",
                    message=f"🤖 자동매매 매수 조건 충족 [{stock.name}({rule.symbol})] "
                            f"현재가 {current_price:,.0f}원 ≤ 매수적정가 {info['buy_price']:,.0f}원 — 승인 대기",
                    change_rate=stock.change_rate,
                ))
                db.commit()
                created.append({"rule_id": rule.id, "type": "BUY", "price": current_price})
            continue

        if rule.position_qty > 0:
            setting_custom_pct = compute_target_buy_price(db, rule.symbol)
            custom_pct = setting_custom_pct["custom_profit_pct"] if setting_custom_pct else 10
            ladder = compute_sell_ladder(rule.executed_buy_price, custom_pct)
            done = _sell_legs_done(rule)
            leg_qty = max(rule.buy_qty // 5, 1)
            for leg in ladder:
                pct = leg["pct"]
                if pct in done or pct in pending_sell_legs:
                    continue
                if current_price >= leg["price"]:
                    sell_qty = min(leg_qty, rule.position_qty)
                    if sell_qty <= 0:
                        continue
                    event = AutoTradeEvent(
                        rule_id=rule.id,
                        event_type="SELL",
                        leg_pct=pct,
                        trigger_price=current_price,
                        qty=sell_qty,
                    )
                    db.add(event)
                    db.add(AlertHistory(
                        stock_symbol=rule.symbol,
                        alert_type="AUTOTRADE_CONDITION_MET",
                        message=f"🤖 자동매매 익절 조건 충족 [{stock.name}({rule.symbol})] "
                                f"+{pct}% 구간 도달 (현재가 {current_price:,.0f}원) — {sell_qty}주 매도 승인 대기",
                        change_rate=stock.change_rate,
                    ))
                    db.commit()
                    created.append({"rule_id": rule.id, "type": "SELL", "leg_pct": pct, "price": current_price})

    return {"events_created": created}


def approve_event(db: Session, event_id: int) -> dict[str, Any]:
    """반자동 승인 — 실제 주문을 전용 자동매매 계좌로 실행한다."""
    event = db.query(AutoTradeEvent).filter(AutoTradeEvent.id == event_id).first()
    if not event:
        raise ValueError("이벤트를 찾을 수 없습니다.")
    if event.status != "PENDING_APPROVAL":
        raise ValueError(f"이미 처리된 이벤트입니다 (status={event.status})")

    rule = db.query(AutoTradeRule).filter(AutoTradeRule.id == event.rule_id).first()
    if not rule:
        raise ValueError("규칙을 찾을 수 없습니다.")

    settings = get_settings()
    broker = rule.broker or "kis"
    if broker == "kiwoom":
        autotrade_account = (settings.autotrade_kiwoom_account_no or "").strip()
        env_name = "AUTOTRADE_KIWOOM_ACCOUNT_NO"
    else:
        autotrade_account = (settings.autotrade_account_no or "").strip()
        env_name = "AUTOTRADE_ACCOUNT_NO"

    if not autotrade_account or rule.account_no != autotrade_account:
        # 다른 코드 경로에 버그가 있어도 대시보드(메인) 계좌로는 절대 주문이 나가지 않도록 하는 안전장치
        event.status = "FAILED"
        event.error_message = f"전용 자동매매 계좌({env_name})와 일치하지 않아 주문을 거부했습니다."
        event.resolved_at = datetime.utcnow()
        db.commit()
        raise ValueError(event.error_message)

    side = "buy" if event.event_type == "BUY" else "sell"
    try:
        client = (
            create_kiwoom_client_from_settings(rule.account_no)
            if broker == "kiwoom"
            else create_kis_client_from_settings(rule.account_no)
        )
        result = client.place_order(rule.symbol, side, event.qty)
        event.status = "EXECUTED"
        event.order_id = result.get("order_id")
        event.resolved_at = datetime.utcnow()

        if event.event_type == "BUY":
            rule.position_qty = event.qty
            rule.executed_buy_price = event.trigger_price
        else:
            rule.position_qty = max(rule.position_qty - event.qty, 0)
            if event.leg_pct is not None:
                _mark_leg_done(rule, event.leg_pct)

        db.commit()
        return {"status": "EXECUTED", "order_id": event.order_id}
    except Exception as e:
        logger.error("자동매매 주문 실패 (event=%s): %s", event_id, e)
        event.status = "FAILED"
        event.error_message = str(e)
        event.resolved_at = datetime.utcnow()
        db.commit()
        raise


def reject_event(db: Session, event_id: int) -> dict[str, Any]:
    event = db.query(AutoTradeEvent).filter(AutoTradeEvent.id == event_id).first()
    if not event:
        raise ValueError("이벤트를 찾을 수 없습니다.")
    if event.status != "PENDING_APPROVAL":
        raise ValueError(f"이미 처리된 이벤트입니다 (status={event.status})")
    event.status = "REJECTED"
    event.resolved_at = datetime.utcnow()
    db.commit()
    return {"status": "REJECTED"}
