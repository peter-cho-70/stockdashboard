"""
core/demo_mode.py
데모 모드 — demo_portfolio.json 기반 샘플 포트폴리오 (실보유 미노출)
"""
from __future__ import annotations

import json
import logging
from datetime import date, timedelta
from pathlib import Path
from typing import Any, Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from config.database import Stock
from config.settings import get_settings

logger = logging.getLogger(__name__)

_DEMO_JSON = Path(__file__).resolve().parent.parent / "data" / "demo_portfolio.json"
_cache: Optional[dict] = None


def is_demo_mode() -> bool:
    return get_settings().demo_mode


def demo_write_blocked() -> None:
    if is_demo_mode():
        raise HTTPException(
            status_code=403,
            detail="데모 모드에서는 포트폴리오·실현손익을 변경할 수 없습니다.",
        )


def load_demo_config(force_reload: bool = False) -> dict:
    global _cache
    if _cache is not None and not force_reload:
        return _cache
    if not _DEMO_JSON.is_file():
        raise FileNotFoundError(f"데모 설정 파일 없음: {_DEMO_JSON}")
    with open(_DEMO_JSON, encoding="utf-8") as f:
        _cache = json.load(f)
    return _cache


def demo_symbol_set() -> set[str]:
    cfg = load_demo_config()
    return {str(h["symbol"]).strip() for h in cfg.get("holdings", []) if h.get("symbol")}


def _resolve_live_price(db: Session, symbol: str, fallback: float) -> tuple[float, float]:
    """(current_price, change_rate) — DB 시세 우선."""
    stock = db.query(Stock).filter(Stock.symbol == symbol).first()
    if stock and stock.current_price and stock.current_price > 0:
        return float(stock.current_price), float(stock.change_rate or 0)
    if fallback > 0:
        return fallback, 0.0
    try:
        from pykrx import stock as krx

        today = date.today().strftime("%Y%m%d")
        df = krx.get_market_ohlcv_by_date(today, today, symbol)
        if df is not None and not df.empty:
            row = df.iloc[-1]
            close = float(row["종가"])
            return close, 0.0
    except Exception as e:
        logger.debug("demo price %s: %s", symbol, e)
    return fallback if fallback > 0 else 0.0, 0.0


def _holding_to_stock_dict(db: Session, h: dict) -> dict:
    sym = str(h["symbol"]).strip()
    qty = float(h.get("qty") or 0)
    avg = float(h.get("avg_price") or 0)
    seed_price = float(h.get("current_price") or 0)
    current, change_rate = _resolve_live_price(db, sym, seed_price or avg)
    if current <= 0:
        current = avg
    purchase = qty * avg
    value = qty * current
    profit = value - purchase
    profit_rate = (profit / purchase * 100) if purchase > 0 else 0.0

    return {
        "id": 0,
        "symbol": sym,
        "name": h.get("name") or sym,
        "market": h.get("market") or "KRX",
        "sector": h.get("sector"),
        "currency": h.get("currency") or "KRW",
        "qty": qty,
        "avg_price": round(avg, 2),
        "current_price": round(current, 2),
        "change_rate": round(change_rate, 2),
        "profit_rate": round(profit_rate, 2),
        "profit_loss": round(profit, 0),
        "current_value": round(value, 0),
        "memo": None,
        "position_source": "demo",
        "last_synced_at": None,
    }


def build_demo_stocks(db: Session) -> list[dict]:
    cfg = load_demo_config()
    holdings = cfg.get("holdings") or []
    return [_holding_to_stock_dict(db, h) for h in holdings if h.get("symbol")]


def build_demo_summary(db: Session) -> dict:
    stocks = build_demo_stocks(db)
    if not stocks:
        return {
            "total_value": 0,
            "total_purchase": 0,
            "total_profit": 0,
            "total_profit_rate": 0,
            "stock_count": 0,
            "stocks": [],
            "demo_mode": True,
        }
    total_value = sum(s["current_value"] for s in stocks)
    total_purchase = sum(s["qty"] * s["avg_price"] for s in stocks)
    total_profit = total_value - total_purchase
    total_profit_rate = (total_profit / total_purchase * 100) if total_purchase > 0 else 0

    summary_stocks = [
        {
            "symbol": s["symbol"],
            "name": s["name"],
            "market": s["market"],
            "qty": s["qty"],
            "avg_price": s["avg_price"],
            "current_price": s["current_price"],
            "change_rate": s["change_rate"],
            "profit_rate": s["profit_rate"],
            "profit_loss": s["profit_loss"],
            "current_value": s["current_value"],
            "currency": s["currency"],
        }
        for s in sorted(stocks, key=lambda x: abs(x["change_rate"]), reverse=True)
    ]

    return {
        "total_value": round(total_value, 0),
        "total_purchase": round(total_purchase, 0),
        "total_profit": round(total_profit, 0),
        "total_profit_rate": round(total_profit_rate, 2),
        "stock_count": len(stocks),
        "stocks": summary_stocks,
        "demo_mode": True,
    }


def build_demo_history(days: int, summary: dict) -> list[dict]:
    """데모용 평탄 이력 (현재 평가 기준)."""
    days = max(1, min(days, 400))
    out = []
    for i in range(days):
        d = (date.today() - timedelta(days=days - 1 - i)).isoformat()
        out.append(
            {
                "date": d,
                "total_value": summary.get("total_value", 0),
                "total_profit": summary.get("total_profit", 0),
                "total_profit_rate": summary.get("total_profit_rate", 0),
            }
        )
    return out


def ensure_demo_anchor_stocks(db: Session) -> None:
    """차트·buy-score API용 Stock 행 확보 (qty는 덮어쓰지 않음)."""
    if not is_demo_mode():
        return
    cfg = load_demo_config()
    for h in cfg.get("holdings") or []:
        sym = str(h.get("symbol", "")).strip()
        if len(sym) != 6:
            continue
        existing = db.query(Stock).filter(Stock.symbol == sym).first()
        if existing:
            if h.get("name") and not existing.name:
                existing.name = h["name"]
            if h.get("sector") and not existing.sector:
                existing.sector = h["sector"]
            existing.is_active = True
            continue
        db.add(
            Stock(
                symbol=sym,
                name=h.get("name") or sym,
                market=h.get("market") or "KRX",
                sector=h.get("sector"),
                currency=h.get("currency") or "KRW",
                qty=0,
                avg_price=0,
                purchase_amount=0,
                current_price=float(h.get("current_price") or 0),
                position_source="demo_anchor",
                is_active=True,
            )
        )
    db.commit()


def demo_info() -> dict[str, Any]:
    cfg = load_demo_config()
    return {
        "demo_mode": True,
        "title": cfg.get("title", "데모 포트폴리오"),
        "description": cfg.get("description", ""),
        "holding_count": len(cfg.get("holdings") or []),
        "symbols": sorted(demo_symbol_set()),
        "config_path": str(_DEMO_JSON.name),
    }
