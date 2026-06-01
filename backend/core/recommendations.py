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

from config.database import IntelContent, SectorSignal, StockSignal
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
