"""
core/recommendations.py
섹터·매크로 AI 분석에서 추출된 추천(언급) 종목 집계
"""
from __future__ import annotations

import json
from collections import defaultdict
from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy.orm import Session

from config.database import IntelContent, SectorSignal, Stock, StockSignal
from core.stock_resolver import resolve_symbol


def _parse_json_list(val: Optional[str]) -> list:
    if not val:
        return []
    try:
        data = json.loads(val)
        return data if isinstance(data, list) else []
    except Exception:
        return []


def get_stock_recommendations(
    db: Session,
    *,
    sector: Optional[str] = None,
    days: int = 30,
    limit: int = 50,
) -> list[dict]:
    """섹터·StockSignal 기반 추천 종목 (언급 횟수·최신 감성 집계)."""
    since = (datetime.utcnow() - timedelta(days=days)).strftime("%Y-%m-%d")

    agg: dict[str, dict] = {}

    def _touch(name: str, *, sector_name: str, sentiment: str, summary: str,
               event_date: str, source_type: str, source_id: int, symbol: Optional[str] = None):
        name = name.strip()
        if not name:
            return
        key = name
        if key not in agg:
            agg[key] = {
                "stock_name": name,
                "symbol": symbol,
                "sector": sector_name,
                "mention_count": 0,
                "latest_date": event_date,
                "latest_sentiment": sentiment,
                "latest_summary": summary,
                "sources": [],
            }
        entry = agg[key]
        entry["mention_count"] += 1
        if symbol and not entry.get("symbol"):
            entry["symbol"] = symbol
        if event_date >= (entry.get("latest_date") or ""):
            entry["latest_date"] = event_date
            entry["latest_sentiment"] = sentiment
            entry["latest_summary"] = summary
        entry["sources"].append({
            "type": source_type,
            "id": source_id,
            "date": event_date,
            "sentiment": sentiment,
        })
        if sector_name and not entry.get("sector"):
            entry["sector"] = sector_name

    # SectorSignal.mentioned_stocks
    q = db.query(SectorSignal).filter(SectorSignal.event_date >= since)
    if sector:
        q = q.filter(SectorSignal.sector == sector)
    for sig in q.all():
        for name in _parse_json_list(sig.mentioned_stocks):
            nm = str(name).strip()
            sym = resolve_symbol(nm, db)
            _touch(
                nm,
                sector_name=sig.sector,
                sentiment=sig.sentiment or "NEUTRAL",
                summary=(sig.summary or "")[:200],
                event_date=sig.event_date or since,
                source_type="sector",
                source_id=sig.id,
                symbol=sym,
            )

    # StockSignal (비보유 포함)
    sq = db.query(StockSignal).filter(StockSignal.event_date >= since)
    for sig in sq.all():
        if sector:
            # sector filter: only if matching sector signal exists for same content
            sec = db.query(SectorSignal).filter(
                SectorSignal.content_id == sig.content_id,
                SectorSignal.sector == sector,
            ).first()
            if not sec:
                continue
        sym = sig.symbol or resolve_symbol(sig.stock_name, db)
        _touch(
            sig.stock_name,
            sector_name=sector or "",
            sentiment=sig.sentiment or "NEUTRAL",
            summary=(sig.summary or "")[:200],
            event_date=sig.event_date or since,
            source_type="stock",
            source_id=sig.id,
            symbol=sym,
        )

    results = sorted(
        agg.values(),
        key=lambda x: (x.get("latest_date") or "", x["mention_count"]),
        reverse=True,
    )
    out = results[:limit]
    for row in out:
        if not row.get("symbol"):
            row["symbol"] = resolve_symbol(row["stock_name"], db)
    return out


def get_co_mentioned_stocks(
    db: Session,
    stock: Stock,
    *,
    days: int = 90,
    limit: int = 10,
) -> list[dict]:
    """관계 묶어보기 3단계: AI 분석에서 같은 콘텐츠(영상·뉴스)에 함께 언급된 종목 집계.

    같은 StockSignal.content_id 를 공유하는 다른 종목들을 모아 언급 빈도순으로 반환.
    """
    since = (datetime.utcnow() - timedelta(days=days)).strftime("%Y-%m-%d")

    own_content_ids = {
        cid
        for (cid,) in db.query(StockSignal.content_id)
        .filter(StockSignal.event_date >= since)
        .filter((StockSignal.symbol == stock.symbol) | (StockSignal.stock_name == stock.name))
        .distinct()
        .all()
    }
    if not own_content_ids:
        return []

    rows = (
        db.query(StockSignal)
        .filter(StockSignal.content_id.in_(own_content_ids))
        .filter(StockSignal.event_date >= since)
        .all()
    )

    agg: dict[str, dict] = {}
    for r in rows:
        # symbol이 비어있는 행도 종목명으로 미리 심볼을 풀어서 키로 써야,
        # 같은 종목이 symbol 유무에 따라 두 개 버킷으로 쪼개지지 않는다.
        resolved_sym = r.symbol or resolve_symbol(r.stock_name, db)
        if resolved_sym == stock.symbol or r.stock_name == stock.name:
            continue
        key = resolved_sym or r.stock_name
        entry = agg.setdefault(key, {
            "stock_name": r.stock_name,
            "symbol": resolved_sym,
            "mention_count": 0,
            "latest_date": "",
            "latest_sentiment": "NEUTRAL",
        })
        entry["mention_count"] += 1
        if not entry["symbol"] and resolved_sym:
            entry["symbol"] = resolved_sym
        if (r.event_date or "") >= entry["latest_date"]:
            entry["latest_date"] = r.event_date or entry["latest_date"]
            entry["latest_sentiment"] = r.sentiment or "NEUTRAL"

    ranked = sorted(agg.values(), key=lambda x: (x["mention_count"], x["latest_date"]), reverse=True)[:limit]

    out = []
    for r in ranked:
        sym = r["symbol"]
        st = db.query(Stock).filter(Stock.symbol == sym).first() if sym else None
        out.append({
            "symbol": sym,
            "name": st.name if st else r["stock_name"],
            "current_price": st.current_price if st else None,
            "change_rate": round(st.change_rate, 2) if st and st.change_rate else None,
            "mention_count": r["mention_count"],
            "latest_date": r["latest_date"],
            "sentiment": r["latest_sentiment"],
            "is_holding": bool(st and st.qty and st.qty > 0 and st.is_active),
        })
    return out
