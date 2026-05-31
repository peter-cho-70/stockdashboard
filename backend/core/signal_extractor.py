"""
core/signal_extractor.py
IntelContent → MacroSignal / SectorSignal / StockSignal 파생·저장

[원칙]
- AI 추가 호출 없음 — 저장된 JSON을 파싱
- 원본(IntelContent)은 절대 수정하지 않음
- 기존 signals가 있으면 삭제 후 재생성 (content_id 기준)
"""
import json
import logging
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy.orm import Session

from config.database import (
    IntelContent, Stock,
    MacroSignal, SectorSignal, StockSignal,
)
from core.stock_resolver import resolve_symbol

logger = logging.getLogger(__name__)

# ── 매크로 topic 정규화 키워드 매핑 ────────────────
_MACRO_TOPIC_MAP: list[tuple[list[str], str]] = [
    (["금리", "기준금리", "interest rate", "fed fund", "rate hike", "rate cut"], "금리"),
    (["환율", "달러", "원/달러", "usd", "currency", "forex", "fx"], "환율"),
    (["cpi", "pce", "인플레이션", "물가", "inflation", "소비자물가"], "CPI/물가"),
    (["fomc", "연준", "fed", "파월", "powell", "통화정책"], "FOMC/연준"),
    (["유가", "원유", "wti", "brent", "opec", "oil"], "유가"),
    (["중국", "china", "중국정책", "중국경제", "pmi"], "중국"),
    (["미국", "us economy", "gdp", "고용", "실업", "nonfarm", "미국경제"], "미국경제"),
    (["반도체", "semiconductor", "chip", "tsmc", "메모리"], "반도체"),
    (["ai", "인공지능", "llm", "엔비디아", "nvidia"], "AI"),
    (["국채", "bond", "yield", "채권", "10년물"], "채권/금리"),
]

_KNOWN_SECTORS = {
    "반도체", "AI·빅테크", "2차전지", "바이오·헬스케어",
    "금융", "에너지", "소비재", "자동차", "방산", "부동산·리츠", "기타",
}


def _normalize_topic(raw_topic: str) -> str:
    lower = raw_topic.lower()
    for keywords, canonical in _MACRO_TOPIC_MAP:
        if any(k in lower for k in keywords):
            return canonical
    return raw_topic[:20] if raw_topic else "기타"


def _get_event_date(content: IntelContent) -> Optional[str]:
    """Signal event_date: 영상/기사 게시일 우선, 없으면 분석일"""
    if content.published_at:
        return content.published_at.strftime("%Y-%m-%d")
    if content.analyzed_at:
        return content.analyzed_at.strftime("%Y-%m-%d")
    if content.created_at:
        return content.created_at.strftime("%Y-%m-%d")
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def _parse_json_field(value: Optional[str]) -> object:
    if not value:
        return None
    try:
        return json.loads(value)
    except Exception:
        return None


def extract_signals(content: IntelContent, db: Session, portfolio_symbols: set[str]) -> dict:
    """
    content 에서 MacroSignal / SectorSignal / StockSignal 을 추출하여 DB에 저장.
    기존 signals는 삭제 후 재생성.
    Returns: {"macro": int, "sector": int, "stock": int}
    """
    db.query(MacroSignal).filter(MacroSignal.content_id == content.id).delete()
    db.query(SectorSignal).filter(SectorSignal.content_id == content.id).delete()
    db.query(StockSignal).filter(StockSignal.content_id == content.id).delete()

    event_date = _get_event_date(content)
    counts = {"macro": 0, "sector": 0, "stock": 0}

    # ── Macro Signals ─────────────────────────────
    macro = _parse_json_field(content.macro_analysis)
    if isinstance(macro, dict):
        topics = macro.get("topics", [])
        if isinstance(topics, list):
            for t in topics:
                if not isinstance(t, dict):
                    continue
                raw_topic = t.get("topic", "기타")
                db.add(MacroSignal(
                    content_id=content.id,
                    topic=_normalize_topic(raw_topic),
                    summary=t.get("summary", ""),
                    sentiment=t.get("sentiment", "NEUTRAL"),
                    impact=t.get("impact", ""),
                    event_date=event_date,
                ))
                counts["macro"] += 1

    # ── Sector Signals ────────────────────────────
    sectors = _parse_json_field(content.sector_analysis)
    if isinstance(sectors, list):
        for s in sectors:
            if not isinstance(s, dict):
                continue
            sector_name = s.get("sector", "기타")
            if sector_name not in _KNOWN_SECTORS:
                sector_name = "기타"
            db.add(SectorSignal(
                content_id=content.id,
                sector=sector_name,
                summary=s.get("summary", ""),
                sentiment=s.get("sentiment", "NEUTRAL"),
                outlook=s.get("outlook", ""),
                mentioned_stocks=json.dumps(s.get("mentioned_stocks", []), ensure_ascii=False),
                event_date=event_date,
            ))
            counts["sector"] += 1

    # ── Stock Signals ─────────────────────────────
    # 1) AI가 stock_issues(보유 종목 매핑)에서 추출한 것
    portfolio_stocks_db = {
        s.symbol: s for s in db.query(Stock).filter(Stock.is_active == True).all()
    }
    portfolio_name_map = {s.name: s.symbol for s in portfolio_stocks_db.values()}

    saved_names: set[str] = set()

    # StockIssue 테이블 (보유 종목 매핑)을 stock_signals에 반영
    for issue in content.issues:
        if not issue.stock:
            continue
        db.add(StockSignal(
            content_id=content.id,
            symbol=issue.stock.symbol,
            stock_name=issue.stock.name,
            is_portfolio=True,
            summary=issue.issue_summary or "",
            sentiment=issue.sentiment or "NEUTRAL",
            event_date=event_date,
        ))
        saved_names.add(issue.stock.name)
        counts["stock"] += 1

    # 2) mentioned_stocks 전체 (보유 여부 무관)
    mentioned = _parse_json_field(content.mentioned_stocks)
    if isinstance(mentioned, list):
        for m in mentioned:
            name = str(m).strip()
            if not name or name in saved_names:
                continue
            symbol = portfolio_name_map.get(name)
            if not symbol:
                symbol = resolve_symbol(name, db)
            is_portfolio = symbol in portfolio_symbols if symbol else False
            db.add(StockSignal(
                content_id=content.id,
                symbol=symbol,
                stock_name=name,
                is_portfolio=is_portfolio,
                summary=content.summary[:200] if content.summary else "",
                sentiment=content.sentiment or "NEUTRAL",
                event_date=event_date,
            ))
            saved_names.add(name)
            counts["stock"] += 1

    db.commit()
    logger.info(
        "✅ 신호 파생 완료 (content_id=%d) — 매크로 %d, 섹터 %d, 종목 %d",
        content.id, counts["macro"], counts["sector"], counts["stock"],
    )
    return counts


def backfill_all_signals(db: Session) -> dict:
    """
    기존 IntelContent 전체를 순회해 signals 테이블 채우기 (1회성 마이그레이션)
    """
    portfolio_symbols = {
        s.symbol for s in db.query(Stock).filter(Stock.is_active == True).all()
    }
    contents = db.query(IntelContent).all()
    total = {"macro": 0, "sector": 0, "stock": 0, "contents": 0}
    for c in contents:
        if not (c.macro_analysis or c.sector_analysis):
            continue
        counts = extract_signals(c, db, portfolio_symbols)
        for k in ("macro", "sector", "stock"):
            total[k] += counts[k]
        total["contents"] += 1
    logger.info("🔄 백필 완료 — %d건 처리, 매크로 %d, 섹터 %d, 종목 %d",
                total["contents"], total["macro"], total["sector"], total["stock"])
    return total
