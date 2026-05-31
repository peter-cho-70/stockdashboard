"""
core/signal_related.py
종목·날짜 기준 연관 분석 검색 (키워드·섹터·매크로·날짜 점수)
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy.orm import Session

from config.database import IntelContent, MacroSignal, SectorSignal, Stock, StockSignal
from core.sector_peers import normalize_sector, sectors_match, stock_name_in_mentioned


def _days_between(a: str, b: str) -> int:
    try:
        da = datetime.strptime(a, "%Y-%m-%d")
        db = datetime.strptime(b, "%Y-%m-%d")
        return abs((da - db).days)
    except ValueError:
        return 999


def _parse_keywords(content: IntelContent | None) -> set[str]:
    if not content or not content.keywords:
        return set()
    try:
        kws = json.loads(content.keywords)
        if isinstance(kws, list):
            return {str(k).strip().lower() for k in kws if k}
    except Exception:
        pass
    return set()


def _content_meta(db: Session, content_id: int) -> dict:
    c = db.query(IntelContent).filter(IntelContent.id == content_id).first()
    if not c:
        return {}
    return {
        "source_type": c.source_type,
        "source_url": c.source_url,
        "source_title": c.source_title,
        "channel_name": c.channel_name,
        "keywords": list(_parse_keywords(c)),
    }


def get_shared_signals_for_stock(
    db: Session,
    stock: Stock,
    *,
    days: int = 90,
) -> dict:
    """차트용 — 이 종목에 적용 가능한 섹터·매크로 신호 전체."""
    since = (datetime.utcnow() - timedelta(days=days)).strftime("%Y-%m-%d")
    norm = normalize_sector(stock.sector, stock.symbol)

    sector_rows = (
        db.query(SectorSignal)
        .filter(SectorSignal.event_date >= since)
        .order_by(SectorSignal.event_date.desc())
        .all()
    )
    applicable_sector = [
        s for s in sector_rows
        if sectors_match(stock.sector, s.sector, stock.symbol)
    ]

    macro_rows = (
        db.query(MacroSignal)
        .filter(MacroSignal.event_date >= since)
        .order_by(MacroSignal.event_date.desc())
        .all()
    )

    def _ser_sector(s: SectorSignal) -> dict:
        meta = _content_meta(db, s.content_id)
        mentioned = []
        try:
            mentioned = json.loads(s.mentioned_stocks or "[]")
        except Exception:
            pass
        return {
            "type": "sector",
            "id": s.id,
            "content_id": s.content_id,
            "sector": s.sector,
            "summary": s.summary,
            "sentiment": s.sentiment,
            "outlook": s.outlook,
            "event_date": s.event_date,
            "mentioned_stocks": mentioned,
            "label": s.sector,
            **meta,
        }

    def _ser_macro(m: MacroSignal) -> dict:
        meta = _content_meta(db, m.content_id)
        return {
            "type": "macro",
            "id": m.id,
            "content_id": m.content_id,
            "topic": m.topic,
            "summary": m.summary,
            "sentiment": m.sentiment,
            "impact": m.impact,
            "event_date": m.event_date,
            "label": m.topic,
            **meta,
        }

    return {
        "symbol": stock.symbol,
        "name": stock.name,
        "normalized_sector": norm,
        "sector_signals": [_ser_sector(s) for s in applicable_sector],
        "macro_signals": [_ser_macro(m) for m in macro_rows],
    }


def find_related_analysis(
    db: Session,
    stock: Stock,
    event_date: str,
    *,
    window_days: int = 7,
    limit: int = 10,
) -> list[dict]:
    """특정 날짜 급변 구간과 연관된 분석 목록 (점수순)."""
    since = (
        datetime.strptime(event_date, "%Y-%m-%d") - timedelta(days=window_days)
    ).strftime("%Y-%m-%d")
    until = (
        datetime.strptime(event_date, "%Y-%m-%d") + timedelta(days=window_days)
    ).strftime("%Y-%m-%d")

    norm_sector = normalize_sector(stock.sector, stock.symbol)
    stock_kw = {stock.name.lower(), stock.symbol.lower()}
    if norm_sector:
        stock_kw.add(norm_sector.lower())

    scored: list[dict] = []

    # ── SectorSignal ──
    for s in db.query(SectorSignal).filter(
        SectorSignal.event_date >= since,
        SectorSignal.event_date <= until,
    ).all():
        if not sectors_match(stock.sector, s.sector, stock.symbol):
            continue
        dist = _days_between(s.event_date or event_date, event_date)
        score = max(0, 40 - dist * 8)
        score += 30  # sector match
        mentioned = []
        try:
            mentioned = json.loads(s.mentioned_stocks or "[]")
        except Exception:
            pass
        if stock_name_in_mentioned(stock.name, mentioned):
            score += 25
        meta = _content_meta(db, s.content_id)
        for kw in meta.get("keywords", []):
            if kw in stock_kw:
                score += 5
        scored.append({
            "score": score,
            "type": "sector",
            "id": s.id,
            "label": s.sector,
            "summary": s.summary,
            "sentiment": s.sentiment,
            "outlook": s.outlook,
            "event_date": s.event_date,
            "date_distance": dist,
            "match_reasons": _build_reasons(sector=True, dist=dist, mentioned=stock_name_in_mentioned(stock.name, mentioned)),
            **meta,
        })

    # ── MacroSignal (전 종목 공유) ──
    for m in db.query(MacroSignal).filter(
        MacroSignal.event_date >= since,
        MacroSignal.event_date <= until,
    ).all():
        dist = _days_between(m.event_date or event_date, event_date)
        score = max(0, 25 - dist * 5)
        score += 15  # macro baseline
        meta = _content_meta(db, m.content_id)
        text_blob = f"{m.summary or ''} {m.impact or ''} {m.topic or ''}".lower()
        if norm_sector and norm_sector.lower() in text_blob:
            score += 10
        for kw in meta.get("keywords", []):
            if kw in stock_kw or kw in text_blob:
                score += 5
        scored.append({
            "score": score,
            "type": "macro",
            "id": m.id,
            "label": m.topic,
            "summary": m.summary,
            "sentiment": m.sentiment,
            "impact": m.impact,
            "event_date": m.event_date,
            "date_distance": dist,
            "match_reasons": _build_reasons(macro=True, dist=dist),
            **meta,
        })

    # ── StockSignal (peer / 키워드) ──
    for ss in db.query(StockSignal).filter(
        StockSignal.event_date >= since,
        StockSignal.event_date <= until,
    ).all():
        if ss.symbol == stock.symbol:
            continue
        dist = _days_between(ss.event_date or event_date, event_date)
        score = max(0, 20 - dist * 5)
        peer = False
        if ss.symbol:
            peer_stock = db.query(Stock).filter(Stock.symbol == ss.symbol).first()
            if peer_stock and sectors_match(stock.sector, peer_stock.sector or "", stock.symbol):
                peer = True
                score += 20
        meta = _content_meta(db, ss.content_id)
        text = (ss.summary or "").lower()
        if stock.name.lower() in text or (norm_sector and norm_sector.lower() in text):
            score += 10
        if score < 15:
            continue
        scored.append({
            "score": score,
            "type": "peer_stock",
            "id": ss.id,
            "label": ss.stock_name,
            "summary": ss.summary,
            "sentiment": ss.sentiment,
            "event_date": ss.event_date,
            "date_distance": dist,
            "match_reasons": _build_reasons(peer=peer, dist=dist),
            **meta,
        })

    # ── IntelContent keywords 직접 매칭 ──
    for c in db.query(IntelContent).filter(
        IntelContent.analyzed_at >= since,
    ).all():
        kws = _parse_keywords(c)
        overlap = kws & stock_kw
        if not overlap and norm_sector:
            summary_lower = (c.summary or "").lower()
            if norm_sector.lower() in summary_lower:
                overlap = {norm_sector.lower()}
        if not overlap:
            continue
        cdate = (c.analyzed_at or c.created_at).strftime("%Y-%m-%d")
        dist = _days_between(cdate, event_date)
        if dist > window_days:
            continue
        score = max(0, 15 - dist * 3) + len(overlap) * 8
        scored.append({
            "score": score,
            "type": "keyword",
            "id": c.id,
            "label": ", ".join(sorted(overlap)[:3]),
            "summary": c.summary,
            "sentiment": c.sentiment,
            "event_date": cdate,
            "date_distance": dist,
            "match_reasons": [f"키워드 일치: {', '.join(sorted(overlap)[:3])}"],
            "source_type": c.source_type,
            "source_url": c.source_url,
            "source_title": c.source_title,
            "channel_name": c.channel_name,
            "keywords": list(kws),
        })

    scored.sort(key=lambda x: (-x["score"], x.get("date_distance", 99)))
    return scored[:limit]


def _build_reasons(
    *,
    sector: bool = False,
    macro: bool = False,
    peer: bool = False,
    mentioned: bool = False,
    dist: int = 0,
) -> list[str]:
    reasons = []
    if sector:
        reasons.append("같은 섹터")
    if macro:
        reasons.append("매크로 배경")
    if peer:
        reasons.append("섹터 peer 종목")
    if mentioned:
        reasons.append("언급 종목 포함")
    if dist == 0:
        reasons.append("동일 날짜")
    elif dist <= 3:
        reasons.append(f"±{dist}일")
    return reasons


def pick_best_shared_for_date(
    shared: dict,
    event_date: str,
    window_days: int = 7,
) -> tuple[Optional[dict], Optional[dict]]:
    """섹터·매크로 신호 중 해당 날짜에 가장 적합한 1건씩."""
    best_sector, best_sector_dist = None, window_days + 1
    for s in shared.get("sector_signals", []):
        if not s.get("summary") or not s.get("event_date"):
            continue
        dist = _days_between(s["event_date"], event_date)
        if dist <= window_days and dist < best_sector_dist:
            best_sector_dist = dist
            best_sector = s

    best_macro, best_macro_dist = None, window_days + 1
    for m in shared.get("macro_signals", []):
        if not m.get("summary") or not m.get("event_date"):
            continue
        dist = _days_between(m["event_date"], event_date)
        if dist <= window_days and dist < best_macro_dist:
            best_macro_dist = dist
            best_macro = m

    return best_sector, best_macro


def build_reason_from_sector_signal(sig: dict) -> str:
    parts = [sig.get("summary") or ""]
    if sig.get("outlook"):
        parts.append(f"전망: {sig['outlook']}")
    return " ".join(p for p in parts if p).strip()


def build_reason_from_macro_signal(sig: dict) -> str:
    parts = [sig.get("summary") or ""]
    if sig.get("impact"):
        parts.append(f"→ {sig['impact']}")
    return " ".join(p for p in parts if p).strip()
