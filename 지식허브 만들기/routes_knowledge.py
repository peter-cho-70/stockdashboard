"""
api/routes_knowledge.py
지식 허브 REST API

등록: main.py에 아래 추가
    from api.routes_knowledge import knowledge_router
    app.include_router(knowledge_router, prefix="/api")
"""
import json
import logging
from datetime import date, datetime
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from config.database import (
    IntelContent,
    KnowledgeDomain,
    KnowledgeNewsItem,
    KnowledgeRemindLog,
    YouTubeChannel,
    get_db,
)
from config.settings import get_settings
from core.knowledge_remind import (
    get_today_remind_cards,
    get_remind_stats,
    record_remind_action,
)
from core.knowledge_news import fetch_domain_news, get_domain_news_stats

logger = logging.getLogger(__name__)
settings = get_settings()

knowledge_router = APIRouter(prefix="/knowledge", tags=["knowledge"])


# ── Pydantic 모델 ─────────────────────────────────────────────────────────────

class DomainCreate(BaseModel):
    name:        str
    slug:        str
    emoji:       Optional[str] = "📁"
    color:       Optional[str] = "#6b7280"
    description: Optional[str] = None
    keywords:    Optional[list[str]] = []
    sort_order:  Optional[int] = 0


class DomainUpdate(BaseModel):
    name:        Optional[str] = None
    emoji:       Optional[str] = None
    color:       Optional[str] = None
    description: Optional[str] = None
    keywords:    Optional[list[str]] = None
    sort_order:  Optional[int] = None
    is_active:   Optional[bool] = None


class RemindAction(BaseModel):
    action: str   # "remembered" | "needs_review"


class KnowledgeAnalyzeBody(BaseModel):
    url:              str
    domain_id:        int
    channel_name:     Optional[str] = ""
    force_reanalyze:  bool = False


class BookmarkBody(BaseModel):
    is_bookmarked: bool


class ReadBody(BaseModel):
    is_read: bool


# ── 헬퍼 ──────────────────────────────────────────────────────────────────────

def _j(v) -> list:
    if not v:
        return []
    try:
        return json.loads(v)
    except Exception:
        return []


def _serialize_domain(d: KnowledgeDomain) -> dict:
    return {
        "id":          d.id,
        "name":        d.name,
        "slug":        d.slug,
        "emoji":       d.emoji,
        "color":       d.color,
        "description": d.description,
        "keywords":    _j(d.keywords),
        "sort_order":  d.sort_order,
        "is_active":   d.is_active,
        "created_at":  d.created_at.isoformat() if d.created_at else None,
    }


def _serialize_content(c: IntelContent, short: bool = False) -> dict:
    base = {
        "id":            c.id,
        "source_type":   c.source_type,
        "source_url":    c.source_url,
        "source_title":  c.source_title,
        "channel_name":  c.channel_name,
        "domain_id":     c.domain_id,
        "summary":       c.summary,
        "keywords":      _j(c.keywords),
        "sentiment":     c.sentiment,
        "is_bookmarked": getattr(c, "is_bookmarked", False),
        "is_read":       getattr(c, "is_read", False),
        "analyzed_at":   c.analyzed_at.isoformat() if c.analyzed_at else None,
        "created_at":    c.created_at.isoformat() if c.created_at else None,
        "published_at":  c.published_at.isoformat() if c.published_at else None,
    }
    if not short:
        base.update({
            "key_points":    _j(c.key_points),
            "concepts":      _j(getattr(c, "concepts", None)),
            "learning_notes": getattr(c, "learning_notes", ""),
            "related_topics": _j(getattr(c, "related_topics", None)),
        })
    return base


def _serialize_news(n: KnowledgeNewsItem) -> dict:
    return {
        "id":           n.id,
        "domain_id":    n.domain_id,
        "title":        n.title,
        "url":          n.url,
        "source_name":  n.source_name,
        "summary":      n.summary,
        "published_at": n.published_at.isoformat() if n.published_at else None,
        "fetched_at":   n.fetched_at.isoformat() if n.fetched_at else None,
    }


# ─────────────────────────────────────────────────────────────────────────────
# 1. 관심 분야 (Domain) CRUD
# ─────────────────────────────────────────────────────────────────────────────

@knowledge_router.get("/domains")
def list_domains(
    include_inactive: bool = False,
    db: Session = Depends(get_db),
):
    """관심 분야 목록 (정렬순)"""
    q = db.query(KnowledgeDomain)
    if not include_inactive:
        q = q.filter(KnowledgeDomain.is_active == True)
    domains = q.order_by(KnowledgeDomain.sort_order, KnowledgeDomain.name).all()
    return [_serialize_domain(d) for d in domains]


@knowledge_router.post("/domains", status_code=201)
def create_domain(body: DomainCreate, db: Session = Depends(get_db)):
    """관심 분야 생성"""
    existing = db.query(KnowledgeDomain).filter(
        KnowledgeDomain.slug == body.slug
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail=f"슬러그 중복: {body.slug}")

    domain = KnowledgeDomain(
        name        = body.name,
        slug        = body.slug,
        emoji       = body.emoji or "📁",
        color       = body.color or "#6b7280",
        description = body.description,
        keywords    = json.dumps(body.keywords or [], ensure_ascii=False),
        sort_order  = body.sort_order or 0,
        is_active   = True,
    )
    db.add(domain)
    db.commit()
    db.refresh(domain)
    return _serialize_domain(domain)


@knowledge_router.patch("/domains/{domain_id}")
def update_domain(
    domain_id: int,
    body: DomainUpdate,
    db: Session = Depends(get_db),
):
    """관심 분야 수정"""
    domain = db.query(KnowledgeDomain).filter(KnowledgeDomain.id == domain_id).first()
    if not domain:
        raise HTTPException(status_code=404, detail="분야 없음")

    if body.name        is not None: domain.name        = body.name
    if body.emoji       is not None: domain.emoji       = body.emoji
    if body.color       is not None: domain.color       = body.color
    if body.description is not None: domain.description = body.description
    if body.sort_order  is not None: domain.sort_order  = body.sort_order
    if body.is_active   is not None: domain.is_active   = body.is_active
    if body.keywords    is not None:
        domain.keywords = json.dumps(body.keywords, ensure_ascii=False)
    domain.updated_at = datetime.utcnow()

    db.commit()
    db.refresh(domain)
    return _serialize_domain(domain)


@knowledge_router.delete("/domains/{domain_id}")
def delete_domain(domain_id: int, db: Session = Depends(get_db)):
    """관심 분야 소프트 삭제 (is_active=False)"""
    domain = db.query(KnowledgeDomain).filter(KnowledgeDomain.id == domain_id).first()
    if not domain:
        raise HTTPException(status_code=404, detail="분야 없음")
    if domain.slug == "uncategorized":
        raise HTTPException(status_code=400, detail="미분류 분야는 삭제할 수 없습니다")

    domain.is_active  = False
    domain.updated_at = datetime.utcnow()
    db.commit()
    return {"ok": True, "id": domain_id}


@knowledge_router.get("/domains/{domain_id}/stats")
def get_domain_stats(domain_id: int, db: Session = Depends(get_db)):
    """분야 통계: 콘텐츠 건수, 채널 수, 최신 콘텐츠"""
    # 전체 콘텐츠 수
    total = db.query(func.count(IntelContent.id)).filter(
        IntelContent.content_scope == "knowledge",
        IntelContent.domain_id == domain_id,
    ).scalar() or 0

    # 이번 주 건수
    week_ago = (date.today().isoformat()[:8] + "01")   # 근사치; 정확히는 7일 전
    from datetime import timedelta
    week_start = (date.today() - timedelta(days=7)).isoformat()
    week_count = db.query(func.count(IntelContent.id)).filter(
        IntelContent.content_scope == "knowledge",
        IntelContent.domain_id == domain_id,
        func.date(IntelContent.created_at) >= week_start,
    ).scalar() or 0

    # 채널 수
    channel_count = db.query(func.count(YouTubeChannel.id)).filter(
        YouTubeChannel.domain_id == domain_id,
        YouTubeChannel.channel_kind == "knowledge",
        YouTubeChannel.is_active == True,
    ).scalar() or 0

    # 최신 콘텐츠
    latest = db.query(IntelContent).filter(
        IntelContent.content_scope == "knowledge",
        IntelContent.domain_id == domain_id,
    ).order_by(IntelContent.created_at.desc()).first()

    news_stats = get_domain_news_stats(db, domain_id)

    return {
        "domain_id":    domain_id,
        "total_count":  total,
        "week_count":   week_count,
        "channel_count": channel_count,
        "news_count":   news_stats["total_count"],
        "latest_title": latest.source_title if latest else None,
        "latest_at":    latest.created_at.isoformat() if latest else None,
    }


# ─────────────────────────────────────────────────────────────────────────────
# 2. 콘텐츠 피드
# ─────────────────────────────────────────────────────────────────────────────

@knowledge_router.get("/feed")
def get_feed(
    domain_id:   Optional[int]  = None,
    source_type: Optional[str]  = None,   # YOUTUBE | NEWS | TEXT
    sentiment:   Optional[str]  = None,   # POSITIVE | NEUTRAL | NEGATIVE
    search:      Optional[str]  = None,
    bookmarked:  bool            = False,
    limit:       int             = Query(20, le=100),
    cursor:      Optional[int]   = None,   # 마지막 id (커서 페이지네이션)
    db:          Session         = Depends(get_db),
):
    """지식 콘텐츠 피드 (최신순, 커서 페이지네이션)"""
    q = db.query(IntelContent).filter(
        IntelContent.content_scope == "knowledge"
    )

    if domain_id:
        q = q.filter(IntelContent.domain_id == domain_id)
    if source_type:
        q = q.filter(IntelContent.source_type == source_type)
    if sentiment:
        q = q.filter(IntelContent.sentiment == sentiment)
    if bookmarked:
        q = q.filter(IntelContent.is_bookmarked == True)
    if search:
        like = f"%{search}%"
        q = q.filter(
            IntelContent.source_title.ilike(like)
            | IntelContent.summary.ilike(like)
            | IntelContent.keywords.ilike(like)
            | IntelContent.channel_name.ilike(like)
        )
    if cursor:
        q = q.filter(IntelContent.id < cursor)

    contents = q.order_by(IntelContent.id.desc()).limit(limit).all()
    next_cursor = contents[-1].id if len(contents) == limit else None

    return {
        "items":       [_serialize_content(c, short=True) for c in contents],
        "next_cursor": next_cursor,
        "count":       len(contents),
    }


@knowledge_router.get("/feed/{content_id}")
def get_content_detail(content_id: int, db: Session = Depends(get_db)):
    """콘텐츠 상세 (핵심 포인트, 개념, 학습 메모 포함)"""
    c = db.query(IntelContent).filter(
        IntelContent.id == content_id,
        IntelContent.content_scope == "knowledge",
    ).first()
    if not c:
        raise HTTPException(status_code=404, detail="콘텐츠 없음")

    # 읽음 처리 (자동)
    if not getattr(c, "is_read", False):
        c.is_read = True
        db.commit()

    return _serialize_content(c, short=False)


@knowledge_router.patch("/feed/{content_id}/bookmark")
def toggle_bookmark(
    content_id: int,
    body: BookmarkBody,
    db: Session = Depends(get_db),
):
    """북마크 토글"""
    c = db.query(IntelContent).filter(IntelContent.id == content_id).first()
    if not c:
        raise HTTPException(status_code=404, detail="콘텐츠 없음")
    c.is_bookmarked = body.is_bookmarked
    db.commit()
    return {"ok": True, "is_bookmarked": body.is_bookmarked}


@knowledge_router.patch("/feed/{content_id}/read")
def mark_read(
    content_id: int,
    body: ReadBody,
    db: Session = Depends(get_db),
):
    """읽음 표시"""
    c = db.query(IntelContent).filter(IntelContent.id == content_id).first()
    if not c:
        raise HTTPException(status_code=404, detail="콘텐츠 없음")
    c.is_read = body.is_read
    db.commit()
    return {"ok": True, "is_read": body.is_read}


@knowledge_router.patch("/feed/{content_id}/domain")
def change_content_domain(
    content_id: int,
    domain_id: int,
    db: Session = Depends(get_db),
):
    """콘텐츠 분야 변경"""
    c = db.query(IntelContent).filter(IntelContent.id == content_id).first()
    if not c:
        raise HTTPException(status_code=404, detail="콘텐츠 없음")
    domain = db.query(KnowledgeDomain).filter(KnowledgeDomain.id == domain_id).first()
    if not domain:
        raise HTTPException(status_code=404, detail="분야 없음")
    c.domain_id = domain_id
    db.commit()
    return {"ok": True, "domain_id": domain_id}


# ─────────────────────────────────────────────────────────────────────────────
# 3. 지식 분석 (YouTube / URL / 텍스트)
# ─────────────────────────────────────────────────────────────────────────────

@knowledge_router.post("/analyze")
async def analyze_knowledge(
    body: KnowledgeAnalyzeBody,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """
    YouTube URL 또는 뉴스 URL을 지식 허브용으로 분석

    기존 /api/youtube/analyze 와 별개로, domain_id를 받아
    지식 scope로만 저장합니다 (Signal 생성 없음).
    """
    # 이미 분석된 URL 체크
    if not body.force_reanalyze:
        existing = db.query(IntelContent).filter(
            IntelContent.source_url == body.url,
            IntelContent.content_scope == "knowledge",
        ).first()
        if existing:
            return {
                "status":  "cached",
                "content": _serialize_content(existing, short=True),
            }

    # 분야 존재 확인
    domain = db.query(KnowledgeDomain).filter(
        KnowledgeDomain.id == body.domain_id
    ).first()
    if not domain:
        raise HTTPException(status_code=404, detail="분야를 찾을 수 없습니다")

    # 백그라운드 분석 실행
    background_tasks.add_task(
        _run_knowledge_analysis_task,
        url=body.url,
        domain_id=body.domain_id,
        channel_name=body.channel_name or "",
    )

    return {
        "status":    "queued",
        "url":       body.url,
        "domain_id": body.domain_id,
        "message":   "분석이 시작됐습니다. 잠시 후 피드에서 확인하세요.",
    }


async def _run_knowledge_analysis_task(
    url: str,
    domain_id: int,
    channel_name: str,
):
    """백그라운드 분석 작업"""
    from config.database import SessionLocal
    from core.knowledge_analyzer import analyze_youtube_as_knowledge, analyze_knowledge_content
    from core.gemini_client import GeminiClient

    db = SessionLocal()
    try:
        gemini = GeminiClient(settings.gemini_api_key, settings.gemini_extract_model)

        is_youtube = "youtube.com" in url or "youtu.be" in url
        if is_youtube:
            await analyze_youtube_as_knowledge(
                youtube_url  = url,
                domain_id    = domain_id,
                channel_name = channel_name,
                db           = db,
                gemini_client= gemini,
            )
        else:
            # 뉴스/텍스트 URL
            import httpx
            from bs4 import BeautifulSoup
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.get(url, follow_redirects=True)
                soup = BeautifulSoup(resp.text, "html.parser")
                for tag in soup(["script", "style", "nav", "footer"]):
                    tag.decompose()
                document = soup.get_text(separator="\n", strip=True)[:10000]
                title = soup.title.string if soup.title else ""

            await analyze_knowledge_content(
                document     = document,
                source_type  = "NEWS",
                source_url   = url,
                source_title = title,
                channel_name = "",
                domain_id    = domain_id,
                db           = db,
                gemini_client= gemini,
            )
    except Exception as e:
        logger.error("지식 분석 백그라운드 실패: %s", e)
    finally:
        db.close()


# ─────────────────────────────────────────────────────────────────────────────
# 4. 리마인드
# ─────────────────────────────────────────────────────────────────────────────

@knowledge_router.get("/remind")
def get_remind_cards(
    limit: int = Query(3, le=10),
    db: Session = Depends(get_db),
):
    """오늘의 리마인드 카드"""
    cards = get_today_remind_cards(db, limit=limit)
    return {"cards": cards, "count": len(cards)}


@knowledge_router.post("/remind/{content_id}")
def record_remind(
    content_id: int,
    body: RemindAction,
    db: Session = Depends(get_db),
):
    """리마인드 액션 기록 (remembered | needs_review)"""
    if body.action not in ("remembered", "needs_review"):
        raise HTTPException(status_code=400, detail="action은 'remembered' 또는 'needs_review'")

    c = db.query(IntelContent).filter(IntelContent.id == content_id).first()
    if not c:
        raise HTTPException(status_code=404, detail="콘텐츠 없음")

    return record_remind_action(db, content_id, body.action)


@knowledge_router.get("/remind/stats")
def get_remind_statistics(db: Session = Depends(get_db)):
    """리마인드 통계 (기억률 등)"""
    return get_remind_stats(db)


# ─────────────────────────────────────────────────────────────────────────────
# 5. 분야 뉴스
# ─────────────────────────────────────────────────────────────────────────────

@knowledge_router.get("/news")
def get_domain_news(
    domain_id: int,
    limit: int = Query(10, le=50),
    db: Session = Depends(get_db),
):
    """분야 뉴스 목록 (최신순)"""
    news = db.query(KnowledgeNewsItem).filter(
        KnowledgeNewsItem.domain_id == domain_id
    ).order_by(KnowledgeNewsItem.published_at.desc().nullslast()).limit(limit).all()

    return [_serialize_news(n) for n in news]


@knowledge_router.post("/news/fetch")
async def trigger_news_fetch(
    domain_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """분야 뉴스 수동 수집 트리거"""
    domain = db.query(KnowledgeDomain).filter(KnowledgeDomain.id == domain_id).first()
    if not domain:
        raise HTTPException(status_code=404, detail="분야 없음")

    keywords = _j(domain.keywords)
    if not keywords:
        raise HTTPException(status_code=400, detail="분야에 키워드가 없습니다")

    background_tasks.add_task(
        _fetch_news_background,
        domain_id=domain_id,
        keywords=keywords,
    )
    return {"status": "queued", "domain_id": domain_id, "keywords": keywords}


async def _fetch_news_background(domain_id: int, keywords: list[str]):
    from config.database import SessionLocal
    from core.gemini_client import GeminiClient

    db = SessionLocal()
    try:
        gemini = GeminiClient(settings.gemini_api_key, settings.gemini_model)
        count = await fetch_domain_news(db, domain_id, keywords, gemini_client=gemini)
        logger.info("뉴스 수집 완료: domain_id=%d count=%d", domain_id, count)
    except Exception as e:
        logger.error("뉴스 수집 실패: %s", e)
    finally:
        db.close()


@knowledge_router.post("/news/{news_id}/save-as-content")
async def save_news_as_content(
    news_id: int,
    domain_id: Optional[int] = None,
    background_tasks: BackgroundTasks = BackgroundTasks(),
    db: Session = Depends(get_db),
):
    """뉴스 → 지식 콘텐츠로 저장 (URL 분석 파이프라인)"""
    news = db.query(KnowledgeNewsItem).filter(KnowledgeNewsItem.id == news_id).first()
    if not news:
        raise HTTPException(status_code=404, detail="뉴스 없음")

    target_domain = domain_id or news.domain_id
    background_tasks.add_task(
        _run_knowledge_analysis_task,
        url=news.url,
        domain_id=target_domain,
        channel_name=news.source_name or "",
    )
    return {"status": "queued", "url": news.url, "domain_id": target_domain}


# ─────────────────────────────────────────────────────────────────────────────
# 6. 채널 (지식 채널 전용 뷰)
# ─────────────────────────────────────────────────────────────────────────────

@knowledge_router.get("/channels")
def list_knowledge_channels(
    domain_id: Optional[int] = None,
    db: Session = Depends(get_db),
):
    """지식 채널 목록"""
    q = db.query(YouTubeChannel).filter(
        YouTubeChannel.channel_kind == "knowledge",
        YouTubeChannel.is_active == True,
    )
    if domain_id:
        q = q.filter(YouTubeChannel.domain_id == domain_id)
    channels = q.all()

    return [
        {
            "id":           c.id,
            "channel_id":   c.channel_id,
            "channel_name": c.channel_name,
            "channel_url":  c.channel_url,
            "domain_id":    c.domain_id,
            "channel_kind": c.channel_kind,
        }
        for c in channels
    ]


@knowledge_router.patch("/channels/{channel_id}/domain")
def change_channel_domain(
    channel_id: int,
    domain_id: int,
    db: Session = Depends(get_db),
):
    """채널 분야 변경"""
    ch = db.query(YouTubeChannel).filter(YouTubeChannel.id == channel_id).first()
    if not ch:
        raise HTTPException(status_code=404, detail="채널 없음")
    domain = db.query(KnowledgeDomain).filter(KnowledgeDomain.id == domain_id).first()
    if not domain:
        raise HTTPException(status_code=404, detail="분야 없음")

    ch.domain_id    = domain_id
    ch.channel_kind = "knowledge"
    db.commit()
    return {"ok": True}
