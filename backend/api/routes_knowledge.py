"""
api/routes_knowledge.py — 지식 허브 API
"""
from __future__ import annotations

import json
import logging
from datetime import date, datetime, timedelta
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from config.database import (
    IntelContent,
    KnowledgeDomain,
    KnowledgeNewsItem,
    SessionLocal,
    YouTubeChannel,
    get_db,
)
from config.settings import get_settings
from core.knowledge_digest import (
    generate_all_weekly_digests,
    generate_weekly_digest,
    get_latest_digest,
    list_domain_digests,
)
from core.knowledge_hub import (
    ensure_uncategorized_domain,
    seed_domain_templates,
    slugify,
)
from core.knowledge_news import fetch_domain_news, get_domain_news_stats
from core.knowledge_remind import get_remind_stats, get_today_remind_cards, record_remind_action

logger = logging.getLogger(__name__)
settings = get_settings()

knowledge_router = APIRouter(prefix="/knowledge", tags=["knowledge"])


class DomainCreate(BaseModel):
    name: str
    slug: Optional[str] = None
    emoji: Optional[str] = "📁"
    color: Optional[str] = "#6b7280"
    description: Optional[str] = None
    keywords: Optional[list[str]] = []
    sort_order: Optional[int] = 0


class DomainUpdate(BaseModel):
    name: Optional[str] = None
    emoji: Optional[str] = None
    color: Optional[str] = None
    description: Optional[str] = None
    keywords: Optional[list[str]] = None
    sort_order: Optional[int] = None
    is_active: Optional[bool] = None


class BookmarkBody(BaseModel):
    is_bookmarked: bool


class ReadBody(BaseModel):
    is_read: bool


class RemindAction(BaseModel):
    action: str  # remembered | needs_review


class DigestGenerateBody(BaseModel):
    period_end: Optional[str] = None
    force: bool = False


def _j(v) -> list:
    if not v:
        return []
    try:
        return json.loads(v)
    except Exception:
        return []


def _serialize_domain(d: KnowledgeDomain) -> dict:
    return {
        "id": d.id,
        "name": d.name,
        "slug": d.slug,
        "emoji": d.emoji or "📁",
        "color": d.color or "#6b7280",
        "description": d.description,
        "keywords": _j(d.keywords),
        "sort_order": d.sort_order or 0,
        "is_active": bool(d.is_active),
        "created_at": d.created_at.isoformat() if d.created_at else None,
    }


def _serialize_content(c: IntelContent, *, short: bool = False) -> dict:
    base = {
        "id": c.id,
        "source_type": c.source_type,
        "source_url": c.source_url,
        "source_title": c.source_title,
        "channel_name": c.channel_name,
        "domain_id": c.domain_id,
        "content_scope": getattr(c, "content_scope", None) or "knowledge",
        "summary": c.summary,
        "keywords": _j(c.keywords),
        "sentiment": c.sentiment,
        "is_bookmarked": bool(getattr(c, "is_bookmarked", False)),
        "is_read": bool(getattr(c, "is_read", False)),
        "analyzed_at": c.analyzed_at.isoformat() if c.analyzed_at else None,
        "created_at": c.created_at.isoformat() if c.created_at else None,
        "published_at": c.published_at.isoformat() if c.published_at else None,
    }
    if not short:
        base.update({
            "key_points": _j(c.key_points),
            "source_document": c.source_document,
            "concepts": [],
            "learning_notes": "",
            "related_topics": [],
        })
    return base


@knowledge_router.get("/domains")
def list_domains(include_inactive: bool = False, db: Session = Depends(get_db)):
    ensure_uncategorized_domain(db)
    q = db.query(KnowledgeDomain)
    if not include_inactive:
        q = q.filter(KnowledgeDomain.is_active == True)
    domains = q.order_by(KnowledgeDomain.sort_order, KnowledgeDomain.name).all()
    return [_serialize_domain(d) for d in domains]


@knowledge_router.post("/domains", status_code=201)
def create_domain(body: DomainCreate, db: Session = Depends(get_db)):
    slug = (body.slug or slugify(body.name)).strip()
    if db.query(KnowledgeDomain).filter(KnowledgeDomain.slug == slug).first():
        raise HTTPException(status_code=409, detail=f"슬러그 중복: {slug}")
    domain = KnowledgeDomain(
        name=body.name.strip(),
        slug=slug,
        emoji=body.emoji or "📁",
        color=body.color or "#6b7280",
        description=body.description,
        keywords=json.dumps(body.keywords or [], ensure_ascii=False),
        sort_order=body.sort_order or 0,
        is_active=True,
    )
    db.add(domain)
    db.commit()
    db.refresh(domain)
    return _serialize_domain(domain)


@knowledge_router.post("/domains/seed-templates")
def seed_templates(db: Session = Depends(get_db)):
    ensure_uncategorized_domain(db)
    created = seed_domain_templates(db)
    return {"created": len(created), "domains": [_serialize_domain(d) for d in created]}


@knowledge_router.patch("/domains/{domain_id}")
def update_domain(domain_id: int, body: DomainUpdate, db: Session = Depends(get_db)):
    domain = db.get(KnowledgeDomain, domain_id)
    if not domain:
        raise HTTPException(status_code=404, detail="분야 없음")
    if body.name is not None:
        domain.name = body.name.strip()
    if body.emoji is not None:
        domain.emoji = body.emoji
    if body.color is not None:
        domain.color = body.color
    if body.description is not None:
        domain.description = body.description
    if body.sort_order is not None:
        domain.sort_order = body.sort_order
    if body.is_active is not None:
        domain.is_active = body.is_active
    if body.keywords is not None:
        domain.keywords = json.dumps(body.keywords, ensure_ascii=False)
    domain.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(domain)
    return _serialize_domain(domain)


@knowledge_router.delete("/domains/{domain_id}")
def delete_domain(domain_id: int, db: Session = Depends(get_db)):
    domain = db.get(KnowledgeDomain, domain_id)
    if not domain:
        raise HTTPException(status_code=404, detail="분야 없음")
    if domain.slug == "uncategorized":
        raise HTTPException(status_code=400, detail="미분류 분야는 삭제할 수 없습니다")
    domain.is_active = False
    domain.updated_at = datetime.utcnow()
    db.commit()
    return {"ok": True, "id": domain_id}


@knowledge_router.get("/domains/{domain_id}/stats")
def get_domain_stats(domain_id: int, db: Session = Depends(get_db)):
    week_start = date.today() - timedelta(days=7)
    total = (
        db.query(func.count(IntelContent.id))
        .filter(
            IntelContent.content_scope == "knowledge",
            IntelContent.domain_id == domain_id,
        )
        .scalar()
        or 0
    )
    week_count = (
        db.query(func.count(IntelContent.id))
        .filter(
            IntelContent.content_scope == "knowledge",
            IntelContent.domain_id == domain_id,
            func.date(IntelContent.created_at) >= week_start.isoformat(),
        )
        .scalar()
        or 0
    )
    channel_count = (
        db.query(func.count(YouTubeChannel.id))
        .filter(
            YouTubeChannel.domain_id == domain_id,
            YouTubeChannel.is_active == True,
            YouTubeChannel.default_market_impact == False,
        )
        .scalar()
        or 0
    )
    latest = (
        db.query(IntelContent)
        .filter(
            IntelContent.content_scope == "knowledge",
            IntelContent.domain_id == domain_id,
        )
        .order_by(IntelContent.created_at.desc())
        .first()
    )
    news_stats = get_domain_news_stats(db, domain_id)
    return {
        "domain_id": domain_id,
        "total_count": total,
        "week_count": week_count,
        "channel_count": channel_count,
        "news_count": news_stats["total_count"],
        "latest_title": latest.source_title if latest else None,
        "latest_at": latest.created_at.isoformat() if latest and latest.created_at else None,
    }


@knowledge_router.get("/feed")
def get_feed(
    domain_id: Optional[int] = None,
    source_type: Optional[str] = None,
    search: Optional[str] = None,
    bookmarked: bool = False,
    limit: int = Query(20, le=100),
    cursor: Optional[int] = None,
    db: Session = Depends(get_db),
):
    q = db.query(IntelContent).filter(IntelContent.content_scope == "knowledge")
    if domain_id:
        q = q.filter(IntelContent.domain_id == domain_id)
    if source_type:
        q = q.filter(IntelContent.source_type == source_type)
    if bookmarked:
        q = q.filter(IntelContent.is_bookmarked == True)
    if search:
        like = f"%{search}%"
        q = q.filter(
            or_(
                IntelContent.source_title.like(like),
                IntelContent.summary.like(like),
                IntelContent.keywords.like(like),
                IntelContent.channel_name.like(like),
            )
        )
    if cursor:
        q = q.filter(IntelContent.id < cursor)
    contents = q.order_by(IntelContent.id.desc()).limit(limit).all()
    next_cursor = contents[-1].id if len(contents) == limit else None
    return {
        "items": [_serialize_content(c, short=True) for c in contents],
        "next_cursor": next_cursor,
        "count": len(contents),
    }


@knowledge_router.get("/feed/{content_id}")
def get_content_detail(content_id: int, db: Session = Depends(get_db)):
    c = (
        db.query(IntelContent)
        .filter(
            IntelContent.id == content_id,
            IntelContent.content_scope == "knowledge",
        )
        .first()
    )
    if not c:
        raise HTTPException(status_code=404, detail="콘텐츠 없음")
    if not c.is_read:
        c.is_read = True
        db.commit()
    return _serialize_content(c, short=False)


@knowledge_router.patch("/feed/{content_id}/bookmark")
def toggle_bookmark(content_id: int, body: BookmarkBody, db: Session = Depends(get_db)):
    c = db.get(IntelContent, content_id)
    if not c:
        raise HTTPException(status_code=404, detail="콘텐츠 없음")
    c.is_bookmarked = body.is_bookmarked
    db.commit()
    return {"ok": True, "is_bookmarked": body.is_bookmarked}


@knowledge_router.patch("/feed/{content_id}/read")
def mark_read(content_id: int, body: ReadBody, db: Session = Depends(get_db)):
    c = db.get(IntelContent, content_id)
    if not c:
        raise HTTPException(status_code=404, detail="콘텐츠 없음")
    c.is_read = body.is_read
    db.commit()
    return {"ok": True, "is_read": body.is_read}


@knowledge_router.patch("/feed/{content_id}/domain")
def change_content_domain(
    content_id: int,
    domain_id: int = Query(...),
    db: Session = Depends(get_db),
):
    c = db.get(IntelContent, content_id)
    if not c:
        raise HTTPException(status_code=404, detail="콘텐츠 없음")
    if not db.get(KnowledgeDomain, domain_id):
        raise HTTPException(status_code=404, detail="분야 없음")
    c.domain_id = domain_id
    db.commit()
    return {"ok": True, "domain_id": domain_id}


def _serialize_news(n: KnowledgeNewsItem) -> dict:
    return {
        "id": n.id,
        "domain_id": n.domain_id,
        "title": n.title,
        "url": n.url,
        "source_name": n.source_name,
        "published_at": n.published_at.isoformat() if n.published_at else None,
        "summary": n.summary,
        "fetched_at": n.fetched_at.isoformat() if n.fetched_at else None,
    }


@knowledge_router.get("/remind")
def get_remind_cards(limit: int = Query(3, le=10), db: Session = Depends(get_db)):
    cards = get_today_remind_cards(db, limit=limit)
    return {"cards": cards, "count": len(cards)}


@knowledge_router.post("/remind/{content_id}")
def post_remind_action(content_id: int, body: RemindAction, db: Session = Depends(get_db)):
    if body.action not in ("remembered", "needs_review"):
        raise HTTPException(status_code=400, detail="action은 remembered 또는 needs_review")
    c = db.get(IntelContent, content_id)
    if not c:
        raise HTTPException(status_code=404, detail="콘텐츠 없음")
    return record_remind_action(db, content_id, body.action)


@knowledge_router.get("/remind/stats")
def remind_statistics(db: Session = Depends(get_db)):
    return get_remind_stats(db)


@knowledge_router.get("/news")
def get_domain_news_list(
    domain_id: int = Query(...),
    limit: int = Query(10, le=50),
    db: Session = Depends(get_db),
):
    rows = (
        db.query(KnowledgeNewsItem)
        .filter(KnowledgeNewsItem.domain_id == domain_id)
        .order_by(KnowledgeNewsItem.fetched_at.desc())
        .limit(limit)
        .all()
    )
    return [_serialize_news(n) for n in rows]


@knowledge_router.post("/news/fetch")
async def post_fetch_domain_news(
    background_tasks: BackgroundTasks,
    domain_id: int = Query(...),
    db: Session = Depends(get_db),
):
    domain = db.get(KnowledgeDomain, domain_id)
    if not domain:
        raise HTTPException(status_code=404, detail="분야 없음")
    keywords = _j(domain.keywords)
    if not keywords:
        raise HTTPException(status_code=400, detail="분야에 뉴스 키워드가 없습니다. 분야 설정에서 keywords를 추가하세요.")

    if background_tasks is not None:
        background_tasks.add_task(_fetch_news_background, domain_id, keywords)
        return {"status": "queued", "domain_id": domain_id, "message": "백그라운드에서 수집 중"}

    count = await _fetch_news_sync(db, domain_id, keywords)
    return {"status": "done", "domain_id": domain_id, "fetched": count}


async def _fetch_news_sync(db: Session, domain_id: int, keywords: list[str]) -> int:
    gemini = None
    if settings.gemini_api_key:
        from core.gemini_client import GeminiClient

        gemini = GeminiClient(settings.gemini_api_key, settings.gemini_model)
    return await fetch_domain_news(db, domain_id, keywords, gemini_client=gemini)


def _fetch_news_background(domain_id: int, keywords: list[str]):
    db = SessionLocal()
    try:
        import asyncio

        asyncio.run(_fetch_news_sync(db, domain_id, keywords))
    except Exception as e:
        logger.error("뉴스 백그라운드 수집 실패: %s", e)
    finally:
        db.close()


@knowledge_router.get("/digest/{domain_id}")
def get_domain_digest(
    domain_id: int,
    latest: bool = Query(True),
    db: Session = Depends(get_db),
):
    if latest:
        digest = get_latest_digest(db, domain_id)
        return {"digest": digest}
    return {"digests": list_domain_digests(db, domain_id)}


@knowledge_router.post("/digest/{domain_id}/generate")
def post_generate_digest(
    domain_id: int,
    body: DigestGenerateBody = DigestGenerateBody(),
    db: Session = Depends(get_db),
):
    try:
        digest = generate_weekly_digest(
            db,
            domain_id,
            period_end=body.period_end,
            force=body.force,
        )
        return {"digest": digest}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@knowledge_router.post("/digest/generate-all")
def post_generate_all_digests(db: Session = Depends(get_db)):
    count = generate_all_weekly_digests(db)
    return {"ok": True, "generated": count}


@knowledge_router.get("/channels")
def list_knowledge_channels(
    domain_id: Optional[int] = None,
    db: Session = Depends(get_db),
):
    q = db.query(YouTubeChannel).filter(
        YouTubeChannel.is_active == True,
        YouTubeChannel.default_market_impact == False,
    )
    if domain_id:
        q = q.filter(YouTubeChannel.domain_id == domain_id)
    return [
        {
            "id": c.id,
            "channel_id": c.channel_id,
            "channel_name": c.channel_name,
            "channel_url": c.channel_url,
            "domain_id": c.domain_id,
        }
        for c in q.all()
    ]
