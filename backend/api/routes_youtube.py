"""
api/routes_youtube.py
YouTube 채널 구독 · 영상 수집 · AI 분석 API
"""
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, Query
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, timedelta

from config.database import get_db, SessionLocal, YouTubeChannel, IntelContent, VideoCache, StockIssue
from config.settings import get_settings
from core.youtube_fetcher import resolve_channel_id, fetch_latest_videos
from core.ai_analyzer import (
    create_analyzer,
    serialize_intel,
    ensure_analysis_available,
    handle_provider_runtime_error,
    ProviderQuotaError,
    try_cached_intel,
)
from core.analysis_stream import run_youtube_analysis, stream_analysis
from core.content_scope import bulk_convert_channel_contents_to_knowledge, resolve_market_impact
from core.knowledge_hub import register_knowledge_channel, resolve_knowledge_domain_id

CACHE_TTL_HOURS = 1

youtube_router = APIRouter(prefix="/youtube", tags=["youtube"])
settings = get_settings()


class ChannelAddBody(BaseModel):
    handle: str
    custom_name: Optional[str] = None
    default_market_impact: bool = False  # True=주가 반영, False=지식(기본)
    domain_id: Optional[int] = None  # 지식 채널일 때 분야 ID


class ChannelUpdateBody(BaseModel):
    default_market_impact: Optional[bool] = None
    custom_name: Optional[str] = None
    domain_id: Optional[int] = None


class AnalyzeVideoBody(BaseModel):
    url: str
    channel_name: Optional[str] = None
    channel_db_id: Optional[int] = None
    analysis_provider: Optional[str] = None
    force_reanalyze: bool = False
    market_impact: Optional[bool] = None  # None=채널 설정 따름
    detailed_extract: bool = False  # True=약 3배 상세 Gemini 추출
    domain_id: Optional[int] = None  # 지식 분석 시 분야 (없으면 채널 domain)


@youtube_router.get("/channels")
def list_channels(db: Session = Depends(get_db)):
    channels = db.query(YouTubeChannel).filter(YouTubeChannel.is_active == True).all()
    return [_ch_dict(c) for c in channels]


@youtube_router.post("/channels")
def add_channel(body: ChannelAddBody, db: Session = Depends(get_db)):
    if not settings.youtube_api_key:
        raise HTTPException(status_code=400, detail="YouTube API 키가 설정되지 않았습니다.")

    info = resolve_channel_id(body.handle, settings.youtube_api_key)
    if not info:
        raise HTTPException(status_code=404, detail=f"채널을 찾을 수 없습니다: {body.handle}")

    existing = db.query(YouTubeChannel).filter(YouTubeChannel.channel_id == info["channel_id"]).first()
    if existing:
        if not existing.is_active:
            previous_name = existing.channel_name
            existing.is_active = True
            existing.channel_name = body.custom_name or info["channel_name"] or existing.channel_name
            existing.channel_url = info["channel_url"]
            existing.default_market_impact = body.default_market_impact
            hub_registration: dict = {}
            if not body.default_market_impact:
                hub_registration = register_knowledge_channel(
                    db,
                    existing.channel_name,
                    body.domain_id,
                )
                existing.domain_id = hub_registration["domain_id"]
            else:
                existing.domain_id = None
            db.commit()
            db.refresh(existing)

            knowledge_conversion: dict[str, int] = {}
            if not body.default_market_impact:
                knowledge_conversion = bulk_convert_channel_contents_to_knowledge(
                    db,
                    existing,
                    previous_channel_name=previous_name,
                )

            return {
                **_ch_dict(existing),
                "reactivated": True,
                "knowledge_conversion": knowledge_conversion,
                "knowledge_hub": hub_registration,
            }
        raise HTTPException(status_code=409, detail="이미 등록된 채널입니다.")

    hub_registration: dict = {}
    ch_domain_id = None
    if not body.default_market_impact:
        hub_registration = register_knowledge_channel(
            db,
            body.custom_name or info["channel_name"],
            body.domain_id,
        )
        ch_domain_id = hub_registration["domain_id"]

    ch = YouTubeChannel(
        channel_id=info["channel_id"],
        channel_name=body.custom_name or info["channel_name"],
        channel_url=info["channel_url"],
        default_market_impact=body.default_market_impact,
        domain_id=ch_domain_id,
    )
    db.add(ch)
    db.commit()
    db.refresh(ch)
    out = _ch_dict(ch)
    if hub_registration:
        out["knowledge_hub"] = hub_registration
    return out


@youtube_router.patch("/channels/{channel_db_id}")
def update_channel(channel_db_id: int, body: ChannelUpdateBody, db: Session = Depends(get_db)):
    ch = db.query(YouTubeChannel).filter(YouTubeChannel.id == channel_db_id).first()
    if not ch:
        raise HTTPException(status_code=404, detail="채널 없음")
    if body.custom_name is not None:
        ch.channel_name = body.custom_name.strip() or ch.channel_name
    hub_registration: dict = {}
    if body.default_market_impact is not None:
        ch.default_market_impact = body.default_market_impact
        if body.default_market_impact:
            ch.domain_id = None
        else:
            hub_registration = register_knowledge_channel(
                db,
                ch.channel_name,
                body.domain_id,
            )
            ch.domain_id = hub_registration["domain_id"]
    elif body.domain_id is not None and not ch.default_market_impact:
        ch.domain_id = resolve_knowledge_domain_id(db, body.domain_id)
    db.commit()
    db.refresh(ch)
    out = _ch_dict(ch)
    if hub_registration:
        out["knowledge_hub"] = hub_registration
    return out


@youtube_router.delete("/channels/{channel_db_id}")
def remove_channel(channel_db_id: int, db: Session = Depends(get_db)):
    ch = db.query(YouTubeChannel).filter(YouTubeChannel.id == channel_db_id).first()
    if not ch:
        raise HTTPException(status_code=404, detail="채널 없음")
    ch.is_active = False
    db.commit()
    return {"message": "삭제 완료"}


@youtube_router.get("/channels/{channel_db_id}/videos")
def get_channel_videos(
    channel_db_id: int,
    max_results: int = 10,
    force_refresh: bool = Query(False),
    page_token: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    ch = db.query(YouTubeChannel).filter(YouTubeChannel.id == channel_db_id).first()
    if not ch:
        raise HTTPException(status_code=404, detail="채널 없음")

    max_results = max(1, min(max_results, 10))
    analyzed_urls = _analyzed_url_set(db)

    if page_token:
        if not settings.youtube_api_key:
            raise HTTPException(status_code=400, detail="YouTube API 키 미설정")
        fresh, next_token = fetch_latest_videos(
            ch.channel_id, settings.youtube_api_key, max_results, page_token=page_token
        )
        for v in fresh:
            v["already_analyzed"] = v["url"] in analyzed_urls
            existing = (
                db.query(VideoCache)
                .filter(VideoCache.channel_id == ch.channel_id, VideoCache.video_id == v["video_id"])
                .first()
            )
            if not existing:
                db.add(VideoCache(
                    channel_id=ch.channel_id,
                    video_id=v["video_id"],
                    title=v["title"],
                    description=v.get("description", ""),
                    published_at=v.get("published_at", ""),
                    thumbnail=v.get("thumbnail", ""),
                    url=v["url"],
                ))
        ch.last_checked_at = datetime.utcnow()
        ch.last_videos_page_token = next_token
        db.commit()
        return {
            "channel": _ch_dict(ch),
            "videos": fresh,
            "from_cache": False,
            "next_page_token": next_token,
            "has_more": bool(next_token),
        }

    cache_valid_after = datetime.utcnow() - timedelta(hours=CACHE_TTL_HOURS)
    cached = (
        db.query(VideoCache)
        .filter(VideoCache.channel_id == ch.channel_id)
        .filter(VideoCache.cached_at >= cache_valid_after)
        .order_by(VideoCache.published_at.desc())
        .limit(max_results)
        .all()
    )

    if cached and not force_refresh:
        videos = [_vc_dict(v, analyzed_urls) for v in cached]
        return {
            "channel": _ch_dict(ch),
            "videos": videos,
            "from_cache": True,
            "next_page_token": ch.last_videos_page_token,
            "has_more": bool(ch.last_videos_page_token),
        }

    if not settings.youtube_api_key:
        raise HTTPException(status_code=400, detail="YouTube API 키 미설정")

    fresh, next_token = fetch_latest_videos(ch.channel_id, settings.youtube_api_key, max_results)

    if force_refresh:
        db.query(VideoCache).filter(VideoCache.channel_id == ch.channel_id).delete()
    for v in fresh:
        existing = (
            db.query(VideoCache)
            .filter(VideoCache.channel_id == ch.channel_id, VideoCache.video_id == v["video_id"])
            .first()
        )
        if existing:
            existing.title = v["title"]
            existing.cached_at = datetime.utcnow()
        else:
            db.add(VideoCache(
                channel_id=ch.channel_id,
                video_id=v["video_id"],
                title=v["title"],
                description=v.get("description", ""),
                published_at=v.get("published_at", ""),
                thumbnail=v.get("thumbnail", ""),
                url=v["url"],
            ))

    ch.last_checked_at = datetime.utcnow()
    ch.last_videos_page_token = next_token
    db.commit()

    for v in fresh:
        v["already_analyzed"] = v["url"] in analyzed_urls

    return {
        "channel": _ch_dict(ch),
        "videos": fresh,
        "from_cache": False,
        "next_page_token": next_token,
        "has_more": bool(next_token),
    }


def _analyzed_url_set(db: Session) -> set:
    return {
        c.source_url
        for c in db.query(IntelContent.source_url)
        .filter(IntelContent.source_type == "YOUTUBE")
        .all()
    }


def _resolve_youtube_domain_id(
    db: Session,
    *,
    market: bool,
    domain_id: Optional[int],
    channel_db_id: Optional[int],
) -> Optional[int]:
    if market:
        return None
    ch = db.get(YouTubeChannel, channel_db_id) if channel_db_id else None
    explicit = domain_id or (ch.domain_id if ch else None)
    return resolve_knowledge_domain_id(db, explicit)


def _vc_dict(v: VideoCache, analyzed_urls: set) -> dict:
    return {
        "video_id": v.video_id,
        "title": v.title,
        "description": v.description or "",
        "published_at": v.published_at or "",
        "thumbnail": v.thumbnail or "",
        "url": v.url,
        "already_analyzed": v.url in analyzed_urls,
    }


@youtube_router.post("/analyze")
def analyze_video(body: AnalyzeVideoBody, db: Session = Depends(get_db)):
    if not settings.gemini_api_key:
        raise HTTPException(status_code=400, detail="YouTube 문서 추출에 GEMINI_API_KEY 필요")
    try:
        ensure_analysis_available(settings, body.analysis_provider)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    cached = try_cached_intel(
        db,
        body.url,
        skip_if_cached=settings.ai_skip_if_cached,
        force_reanalyze=body.force_reanalyze or body.detailed_extract,
    )
    if cached:
        content, logs = cached
        return serialize_intel(content, db, logs)

    market = resolve_market_impact(
        db,
        explicit=body.market_impact,
        channel_name=body.channel_name or "",
        channel_db_id=body.channel_db_id,
    )
    knowledge_domain_id = _resolve_youtube_domain_id(
        db,
        market=market,
        domain_id=body.domain_id,
        channel_db_id=body.channel_db_id,
    )

    analyzer = create_analyzer(db)
    try:
        result = analyzer.analyze_youtube(
            url=body.url,
            channel_name=body.channel_name or "",
            analysis_provider=body.analysis_provider,
            market_impact=market,
            detailed_extract=body.detailed_extract,
            domain_id=knowledge_domain_id,
        )
    except ProviderQuotaError as e:
        handle_provider_runtime_error(e)
    except RuntimeError as e:
        handle_provider_runtime_error(e)

    if not result:
        raise HTTPException(status_code=500, detail={"message": "분석 실패.", "logs": analyzer.logs})

    return serialize_intel(result, db, analyzer.logs)


@youtube_router.post("/analyze/stream")
async def analyze_video_stream(body: AnalyzeVideoBody, db: Session = Depends(get_db)):
    """YouTube 영상 AI 분석 (SSE 실시간 로그)"""
    if not settings.gemini_api_key:
        raise HTTPException(status_code=400, detail="YouTube 문서 추출에 GEMINI_API_KEY 필요")
    try:
        ensure_analysis_available(settings, body.analysis_provider)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    market = resolve_market_impact(
        db,
        explicit=body.market_impact,
        channel_name=body.channel_name or "",
        channel_db_id=body.channel_db_id,
    )
    knowledge_domain_id = _resolve_youtube_domain_id(
        db,
        market=market,
        domain_id=body.domain_id,
        channel_db_id=body.channel_db_id,
    )

    return await stream_analysis(
        lambda on_log: run_youtube_analysis(
            url=body.url,
            channel_name=body.channel_name or "",
            analysis_provider=body.analysis_provider,
            force_reanalyze=body.force_reanalyze,
            skip_if_cached=settings.ai_skip_if_cached,
            market_impact=market,
            detailed_extract=body.detailed_extract,
            domain_id=knowledge_domain_id,
            on_log=on_log,
        )
    )


@youtube_router.post("/channels/{channel_db_id}/analyze-latest")
def analyze_latest(
    channel_db_id: int,
    max_results: int = 5,
    background_tasks: BackgroundTasks = BackgroundTasks(),
    db: Session = Depends(get_db),
):
    if not settings.enable_bulk_youtube_analyze:
        raise HTTPException(
            status_code=403,
            detail="일괄 분석이 비활성화되어 있습니다. ENABLE_BULK_YOUTUBE_ANALYZE=true 또는 영상별 개별 분석을 사용하세요.",
        )
    if not settings.youtube_api_key:
        raise HTTPException(status_code=400, detail="YouTube API 키 미설정")
    if not settings.gemini_api_key:
        raise HTTPException(status_code=400, detail="Gemini API 키 미설정")
    if not settings.openai_api_key:
        raise HTTPException(status_code=400, detail="OpenAI API 키 미설정")

    ch = db.query(YouTubeChannel).filter(YouTubeChannel.id == channel_db_id).first()
    if not ch:
        raise HTTPException(status_code=404, detail="채널 없음")

    videos, _ = fetch_latest_videos(ch.channel_id, settings.youtube_api_key, max_results)

    analyzed_urls = {
        c.source_url
        for c in db.query(IntelContent.source_url)
        .filter(IntelContent.source_type == "YOUTUBE")
        .all()
    }
    new_videos = [v for v in videos if v["url"] not in analyzed_urls]

    if not new_videos:
        return {"message": "새로운 영상 없음 (모두 분석 완료)", "count": 0}

    background_tasks.add_task(
        _bulk_analyze, ch.channel_name, new_videos, bool(ch.default_market_impact)
    )
    return {"message": f"{len(new_videos)}개 영상 분석 시작 (백그라운드)", "count": len(new_videos)}


def _bulk_analyze(channel_name: str, videos: list, market_impact: bool):
    from config.database import SessionLocal
    db = SessionLocal()
    try:
        analyzer = create_analyzer(db)
        for v in videos:
            try:
                analyzer.analyze_youtube(
                    url=v["url"],
                    channel_name=channel_name,
                    market_impact=market_impact,
                )
            except Exception as e:
                import logging
                logging.getLogger(__name__).error(f"영상 분석 실패 {v['url']}: {e}")
    finally:
        db.close()


def _ch_dict(ch: YouTubeChannel) -> dict:
    return {
        "id": ch.id,
        "channel_id": ch.channel_id,
        "channel_name": ch.channel_name,
        "channel_url": ch.channel_url,
        "default_market_impact": bool(ch.default_market_impact),
        "domain_id": ch.domain_id,
        "last_checked_at": ch.last_checked_at.isoformat() if ch.last_checked_at else None,
        "created_at": ch.created_at.isoformat() if ch.created_at else None,
    }
