"""
core/trade_journal.py
매매습관 일지 — 체결내역에 매수 근거/확신도/감정/목표·손절가(매수 시점),
매도 사유·복기 메모(매도 시점)를 덧붙이고, 손절 준수·익절 타이밍·승패·
감정별 승률 등 습관 지표를 자동 계산한다.

사용자가 엑셀로 관리하던 "매매습관 트래커"의 로직을 그대로 이식:
- 손절 지연: 손실 거래인데 계획 손절가보다 더 내려서 판 경우
- 조기 익절: 이익 거래인데 목표가 도달 전에 판 경우
- 목표가·손절가는 "이 종목의 가장 최근(매도 이전) 매수 기록"에서 가져온다
  — 평단가 방식 회계라 매도 1건이 특정 매수 1건에 귀속되지 않기 때문에,
  매도 시점에 유효했던 최신 계획을 근사치로 사용한다.
"""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy.orm import Session

from config.database import PortfolioTrade, Stock, TradeJournalEntry
from core.portfolio_positions import compute_realized_pnl_by_trade

BUY_REASONS = ["실적/펀더멘털", "차트/기술적", "뉴스/테마", "저평가", "추천/소문", "물타기", "분할매수", "기타"]
ENTRY_EMOTIONS = ["냉정", "기대", "불안", "조급/FOMO"]
SELL_REASONS = ["목표달성", "손절", "불안/급락", "급전필요", "더좋은종목", "시간초과", "기타"]

JOURNAL_OPTIONS = {
    "buy_reasons": BUY_REASONS,
    "entry_emotions": ENTRY_EMOTIONS,
    "sell_reasons": SELL_REASONS,
}


def upsert_journal_entry(db: Session, trade_id: int, fields: dict) -> TradeJournalEntry:
    trade = db.query(PortfolioTrade).filter(PortfolioTrade.id == trade_id).first()
    if not trade:
        raise ValueError(f"체결 내역 없음: trade_id={trade_id}")

    entry = db.query(TradeJournalEntry).filter(TradeJournalEntry.trade_id == trade_id).first()
    if not entry:
        entry = TradeJournalEntry(trade_id=trade_id)
        db.add(entry)

    # 호출자가 exclude_unset된 dict를 넘긴다고 가정 — 명시적으로 보낸 필드만 반영
    # (그래야 부분 수정 시 이전에 저장된 다른 필드가 None으로 덮어써지지 않는다).
    for key, value in fields.items():
        setattr(entry, key, value)
    entry.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(entry)
    return entry


def _days_between(a: str, b: str) -> Optional[int]:
    try:
        return (datetime.strptime(b, "%Y-%m-%d") - datetime.strptime(a, "%Y-%m-%d")).days
    except (ValueError, TypeError):
        return None


def list_journal_trades(
    db: Session,
    *,
    start: Optional[str] = None,
    end: Optional[str] = None,
    symbol: Optional[str] = None,
    side: Optional[str] = None,
    only_annotated: bool = False,
    limit: int = 500,
    offset: int = 0,
) -> tuple[list[dict], int]:
    realized_map = compute_realized_pnl_by_trade(db)

    # 종목별 "매수 계획(목표가·손절가·매수사유·확신도·감정)이 있는 매수 체결" 시계열 —
    # 매도 시점에 유효했던 가장 최근 계획을 찾기 위해 미리 전 종목分 구성해둔다.
    buy_rows = (
        db.query(PortfolioTrade, TradeJournalEntry, Stock)
        .join(Stock, Stock.id == PortfolioTrade.stock_id)
        .outerjoin(TradeJournalEntry, TradeJournalEntry.trade_id == PortfolioTrade.id)
        .filter(PortfolioTrade.side == "BUY")
        .order_by(Stock.symbol, PortfolioTrade.traded_at, PortfolioTrade.id)
        .all()
    )
    plans_by_symbol: dict[str, list[dict]] = {}
    for trade, entry, stock in buy_rows:
        has_plan = entry is not None and (entry.target_price is not None or entry.stop_price is not None)
        if not has_plan:
            continue
        plans_by_symbol.setdefault(stock.symbol, []).append({
            "trade_id": trade.id,
            "traded_at": trade.traded_at,
            "target_price": entry.target_price,
            "stop_price": entry.stop_price,
            "buy_reason": entry.buy_reason,
            "conviction": entry.conviction,
            "entry_emotion": entry.entry_emotion,
        })

    def active_plan(symbol: str, sell_trade_id: int, sell_traded_at: str) -> Optional[dict]:
        candidates = plans_by_symbol.get(symbol) or []
        best = None
        for plan in candidates:
            if plan["traded_at"] > sell_traded_at:
                continue
            if plan["traded_at"] == sell_traded_at and plan["trade_id"] >= sell_trade_id:
                continue
            if best is None or (plan["traded_at"], plan["trade_id"]) > (best["traded_at"], best["trade_id"]):
                best = plan
        return best

    q = (
        db.query(PortfolioTrade, TradeJournalEntry, Stock)
        .join(Stock, Stock.id == PortfolioTrade.stock_id)
        .outerjoin(TradeJournalEntry, TradeJournalEntry.trade_id == PortfolioTrade.id)
    )
    if side:
        q = q.filter(PortfolioTrade.side == side.upper())
    if symbol:
        q = q.filter(Stock.symbol == symbol)
    if start:
        q = q.filter(PortfolioTrade.traded_at >= start)
    if end:
        q = q.filter(PortfolioTrade.traded_at <= end)

    rows = q.order_by(PortfolioTrade.traded_at.desc(), PortfolioTrade.id.desc()).all()

    items = []
    for trade, entry, stock in rows:
        item = {
            "id": trade.id,
            "symbol": stock.symbol,
            "name": stock.name,
            "side": trade.side,
            "qty": trade.qty,
            "price": trade.price,
            "amount": trade.qty * trade.price,
            "traded_at": trade.traded_at,
            "source": trade.source,
            "buy_reason": entry.buy_reason if entry else None,
            "conviction": entry.conviction if entry else None,
            "entry_emotion": entry.entry_emotion if entry else None,
            "target_price": entry.target_price if entry else None,
            "stop_price": entry.stop_price if entry else None,
            "sell_reason": entry.sell_reason if entry else None,
            "note": entry.note if entry else None,
            "realized_pnl": None,
            "realized_pnl_estimated": False,
            "return_pct": None,
            "plan_target_price": None,
            "plan_stop_price": None,
            "matched_buy_trade_id": None,
            "matched_buy_date": None,
            "holding_days": None,
            "win_loss": None,
            "stop_discipline": None,
            "exit_timing": None,
        }

        if trade.side == "SELL":
            realized = realized_map.get(trade.id) or {}
            realized_pnl = realized.get("realized_pnl")
            avg_price_used = realized.get("avg_price_used")
            item["realized_pnl"] = realized_pnl
            item["realized_pnl_estimated"] = realized.get("estimated", False)
            if realized_pnl is not None and avg_price_used and trade.qty:
                cost_basis = avg_price_used * trade.qty
                item["return_pct"] = (realized_pnl / cost_basis) if cost_basis else None

            plan = active_plan(stock.symbol, trade.id, trade.traded_at)
            if plan:
                item["plan_target_price"] = plan["target_price"]
                item["plan_stop_price"] = plan["stop_price"]
                item["matched_buy_trade_id"] = plan["trade_id"]
                item["matched_buy_date"] = plan["traded_at"]
                item["holding_days"] = _days_between(plan["traded_at"], trade.traded_at)

            if realized_pnl is not None:
                item["win_loss"] = "승" if realized_pnl > 0 else "패"

                stop_price = item["plan_stop_price"]
                if stop_price is None:
                    item["stop_discipline"] = "미설정"
                elif realized_pnl < 0 and trade.price < stop_price:
                    item["stop_discipline"] = "손절지연"
                elif realized_pnl < 0:
                    item["stop_discipline"] = "손절이행"
                else:
                    item["stop_discipline"] = "해당없음"

                target_price = item["plan_target_price"]
                if target_price is None:
                    item["exit_timing"] = "미설정"
                elif trade.price >= target_price:
                    item["exit_timing"] = "목표달성"
                elif realized_pnl > 0:
                    item["exit_timing"] = "조기익절"
                else:
                    item["exit_timing"] = "해당없음"

        items.append(item)

    if only_annotated:
        items = [
            it for it in items
            if it["buy_reason"] or it["conviction"] or it["entry_emotion"]
            or it["target_price"] is not None or it["stop_price"] is not None
            or it["sell_reason"] or it["note"]
        ]

    total = len(items)
    return items[offset:offset + limit], total


def compute_analysis(db: Session, *, start: Optional[str] = None, end: Optional[str] = None) -> dict:
    items, _ = list_journal_trades(db, start=start, end=end, side="SELL", limit=100000)
    completed = [it for it in items if it["realized_pnl"] is not None]

    win = [it for it in completed if it["win_loss"] == "승"]
    loss = [it for it in completed if it["win_loss"] == "패"]

    def avg(vals: list[float]) -> Optional[float]:
        vals = [v for v in vals if v is not None]
        return sum(vals) / len(vals) if vals else None

    avg_return_all = avg([it["return_pct"] for it in completed])
    avg_return_win = avg([it["return_pct"] for it in win])
    avg_return_loss = avg([it["return_pct"] for it in loss])
    profit_loss_ratio = (
        (avg_return_win / abs(avg_return_loss))
        if avg_return_win is not None and avg_return_loss not in (None, 0)
        else None
    )

    stop_set = [it for it in completed if it["plan_stop_price"] is not None]
    delayed = [it for it in loss if it["stop_discipline"] == "손절지연"]
    delayed_rate = (len(delayed) / len(loss)) if loss else None

    target_hit = [it for it in completed if it["exit_timing"] == "목표달성"]
    early_exit = [it for it in win if it["exit_timing"] == "조기익절"]
    early_exit_rate = (len(early_exit) / len(win)) if win else None

    avg_days_win = avg([it["holding_days"] for it in win])
    avg_days_loss = avg([it["holding_days"] for it in loss])

    # matched_buy_trade_id -> 계획 상세(감정/사유/확신도) 재조회
    matched_ids = {it["matched_buy_trade_id"] for it in completed if it["matched_buy_trade_id"]}
    plans_lookup: dict[int, dict] = {}
    if matched_ids:
        rows = (
            db.query(PortfolioTrade, TradeJournalEntry)
            .join(TradeJournalEntry, TradeJournalEntry.trade_id == PortfolioTrade.id)
            .filter(PortfolioTrade.id.in_(matched_ids))
            .all()
        )
        for trade, entry in rows:
            plans_lookup[trade.id] = {
                "entry_emotion": entry.entry_emotion,
                "buy_reason": entry.buy_reason,
                "conviction": entry.conviction,
            }

    def group_by(key_fn, keys: list) -> list[dict]:
        result = []
        for key in keys:
            group = [it for it in completed if key_fn(it) == key]
            if not group:
                result.append({"key": key, "count": 0, "win_rate": None, "avg_return": None})
                continue
            group_win = [it for it in group if it["win_loss"] == "승"]
            result.append({
                "key": key,
                "count": len(group),
                "win_rate": (len(group_win) / len(group)) if group else None,
                "avg_return": avg([it["return_pct"] for it in group]),
            })
        return result

    def plan_field(it: dict, field: str):
        return (plans_lookup.get(it["matched_buy_trade_id"]) or {}).get(field)

    by_emotion = group_by(lambda it: plan_field(it, "entry_emotion"), ENTRY_EMOTIONS)
    by_buy_reason = group_by(lambda it: plan_field(it, "buy_reason"), BUY_REASONS)
    by_conviction = group_by(lambda it: plan_field(it, "conviction"), [1, 2, 3, 4, 5])

    return {
        "total_count": len(completed),
        "win_count": len(win),
        "loss_count": len(loss),
        "win_rate": (len(win) / len(completed)) if completed else None,
        "avg_return_all": avg_return_all,
        "avg_return_win": avg_return_win,
        "avg_return_loss": avg_return_loss,
        "profit_loss_ratio": profit_loss_ratio,
        "stop": {
            "set_count": len(stop_set),
            "delayed_count": len(delayed),
            "delayed_rate": delayed_rate,
        },
        "holding": {
            "avg_days_win": avg_days_win,
            "avg_days_loss": avg_days_loss,
        },
        "exit": {
            "target_hit_count": len(target_hit),
            "early_exit_count": len(early_exit),
            "early_exit_rate": early_exit_rate,
        },
        "by_emotion": by_emotion,
        "by_buy_reason": by_buy_reason,
        "by_conviction": by_conviction,
    }
