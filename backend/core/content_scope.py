"""
content_scope.py — 지식(knowledge) vs 주가 반영(market) 분류
"""
from __future__ import annotations

from typing import Literal

from sqlalchemy import or_
from sqlalchemy.orm import Session

from config.database import (
    IntelContent,
    MacroSignal,
    SectorSignal,
    Stock,
    StockIssue,
    StockSignal,
    YouTubeChannel,
)

ContentScope = Literal["knowledge", "market"]

SCOPE_KNOWLEDGE = "knowledge"
SCOPE_MARKET = "market"


def is_market_scope(scope: str | None) -> bool:
    return (scope or SCOPE_MARKET) == SCOPE_MARKET


def purge_market_derivatives(db: Session, content_id: int) -> dict[str, int]:
    """Signal·종목 이슈 등 주가 연동 파생 데이터 삭제."""
    counts = {
        "macro_signals": db.query(MacroSignal).filter(MacroSignal.content_id == content_id).delete(),
        "sector_signals": db.query(SectorSignal).filter(SectorSignal.content_id == content_id).delete(),
        "stock_signals": db.query(StockSignal).filter(StockSignal.content_id == content_id).delete(),
        "stock_issues": db.query(StockIssue).filter(StockIssue.content_id == content_id).delete(),
    }
    content = db.get(IntelContent, content_id)
    if content:
        content.macro_analysis = None
        content.sector_analysis = None
        content.mentioned_stocks = "[]"
        content.mentioned_sectors = "[]"
        content.sentiment = "NEUTRAL"
    db.commit()
    return counts


def set_content_scope(db: Session, content_id: int, scope: ContentScope) -> IntelContent:
    content = db.get(IntelContent, content_id)
    if not content:
        raise ValueError("콘텐츠를 찾을 수 없습니다.")

    prev = content.content_scope or SCOPE_MARKET
    content.content_scope = scope

    if scope == SCOPE_KNOWLEDGE and prev != SCOPE_KNOWLEDGE:
        purge_market_derivatives(db, content_id)
    elif scope == SCOPE_MARKET and prev == SCOPE_KNOWLEDGE:
        db.commit()
        if content.macro_analysis:
            from core.signal_extractor import extract_signals

            portfolio_symbols = {
                s.symbol
                for s in db.query(Stock).filter(Stock.is_active == True, Stock.qty > 0).all()
                if s.symbol
            }
            extract_signals(content, db, portfolio_symbols)
            db.commit()
        db.refresh(content)
        return content

    db.commit()
    db.refresh(content)
    return content


def resolve_market_impact(
    db: Session,
    *,
    explicit: bool | None,
    channel_name: str = "",
    channel_db_id: int | None = None,
) -> bool:
    """True = 주가 반영(market), False = 지식(knowledge)."""
    if explicit is not None:
        return explicit
    if channel_db_id:
        ch = db.get(YouTubeChannel, channel_db_id)
        if ch:
            return bool(ch.default_market_impact)
    if channel_name:
        ch = (
            db.query(YouTubeChannel)
            .filter(YouTubeChannel.channel_name == channel_name, YouTubeChannel.is_active == True)
            .first()
        )
        if ch:
            return bool(ch.default_market_impact)
    return False


def bulk_convert_channel_contents_to_knowledge(
    db: Session,
    ch: YouTubeChannel,
    *,
    previous_channel_name: str | None = None,
) -> dict[str, int]:
    """채널 재등록(지식) 시 해당 채널 YouTube 분석을 knowledge로 일괄 전환."""
    from config.database import VideoCache

    urls = {
        row[0]
        for row in db.query(VideoCache.url).filter(VideoCache.channel_id == ch.channel_id).all()
        if row[0]
    }
    names = {n for n in (previous_channel_name, ch.channel_name) if n}

    conditions = []
    if urls:
        conditions.append(IntelContent.source_url.in_(urls))
    if names:
        conditions.append(IntelContent.channel_name.in_(list(names)))
    if not conditions:
        return {"matched": 0, "converted": 0, "already_knowledge": 0}

    contents = (
        db.query(IntelContent)
        .filter(IntelContent.source_type == "YOUTUBE")
        .filter(or_(*conditions))
        .all()
    )
    converted = 0
    already = 0
    for content in contents:
        if (content.content_scope or SCOPE_MARKET) == SCOPE_KNOWLEDGE:
            already += 1
            continue
        set_content_scope(db, content.id, SCOPE_KNOWLEDGE)
        converted += 1

    return {"matched": len(contents), "converted": converted, "already_knowledge": already}
