"""
api/routes_youtube.py
YouTube 채널 구독 · 영상 수집 · AI 분석 API
"""
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, Query
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, timedelta

from config.database import get_db, YouTubeChannel, IntelContent, VideoCache, StockIssue
from config.settings import get_settings
from core.youtube_fetcher import resolve_channel_id, fetch_latest_videos
from core.ai_analyzer import create_analyzer, serialize_intel

CACHE_TTL_HOURS = 1

youtube_router = APIRouter(prefix="/youtube", tags=["youtube"])
settings = get_settings()


class ChannelAddBody(BaseModel):
    handle: str
    custom_name: Optional[str] = None


class AnalyzeVideoBody(BaseModel):
    url: str
    channel_name: Optional[str] = None


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
            existing.is_active = True
            db.commit()
            return _ch_dict(existing)
        raise HTTPException(status_code=409, detail="이미 등록된 채널입니다.")

    ch = YouTubeChannel(
        channel_id=info["channel_id"],
        channel_name=body.custom_name or info["channel_name"],
        channel_url=info["channel_url"],
    )
    db.add(ch)
    db.commit()
    db.refresh(ch)
    return _ch_dict(ch)


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
    db: Session = Depends(get_db),
):
    ch = db.query(YouTubeChannel).filter(YouTubeChannel.id == channel_db_id).first()
    if not ch:
        raise HTTPException(status_code=404, detail="채널 없음")

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
        analyzed_urls = _analyzed_url_set(db)
        videos = [_vc_dict(v, analyzed_urls) for v in cached]
        return {"channel": _ch_dict(ch), "videos": videos, "from_cache": True}

    if not settings.youtube_api_key:
        raise HTTPException(status_code=400, detail="YouTube API 키 미설정")

    fresh = fetch_latest_videos(ch.channel_id, settings.youtube_api_key, max_results)

    db.query(VideoCache).filter(VideoCache.channel_id == ch.channel_id).delete()
    for v in fresh:
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
    db.commit()

    analyzed_urls = _analyzed_url_set(db)
    for v in fresh:
        v["already_analyzed"] = v["url"] in analyzed_urls

    return {"channel": _ch_dict(ch), "videos": fresh, "from_cache": False}


def _analyzed_url_set(db: Session) -> set:
    return {
        c.source_url
        for c in db.query(IntelContent.source_url)
        .filter(IntelContent.source_type == "YOUTUBE")
        .all()
    }


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
    if not settings.openai_api_key:
        raise HTTPException(status_code=400, detail="구조화 분석에 OPENAI_API_KEY 필요")

    analyzer = create_analyzer(db)
    try:
        result = analyzer.analyze_youtube(url=body.url, channel_name=body.channel_name or "")
    except RuntimeError as e:
        err = str(e)
        if err.startswith("GEMINI_QUOTA_EXCEEDED:"):
            secs = err.split(":")[1]
            raise HTTPException(status_code=429, detail=f"Gemini API 한도 초과. {secs}초 후 재시도.")
        if err.startswith("OPENAI_QUOTA_EXCEEDED:"):
            secs = err.split(":")[1]
            raise HTTPException(status_code=429, detail=f"OpenAI API 한도 초과. {secs}초 후 재시도.")
        raise HTTPException(status_code=500, detail=err)

    if not result:
        raise HTTPException(status_code=500, detail={"message": "분석 실패.", "logs": analyzer.logs})

    return serialize_intel(result, db, analyzer.logs)


@youtube_router.post("/channels/{channel_db_id}/analyze-latest")
def analyze_latest(
    channel_db_id: int,
    max_results: int = 5,
    background_tasks: BackgroundTasks = BackgroundTasks(),
    db: Session = Depends(get_db),
):
    if not settings.youtube_api_key:
        raise HTTPException(status_code=400, detail="YouTube API 키 미설정")
    if not settings.gemini_api_key:
        raise HTTPException(status_code=400, detail="Gemini API 키 미설정")
    if not settings.openai_api_key:
        raise HTTPException(status_code=400, detail="OpenAI API 키 미설정")

    ch = db.query(YouTubeChannel).filter(YouTubeChannel.id == channel_db_id).first()
    if not ch:
        raise HTTPException(status_code=404, detail="채널 없음")

    videos = fetch_latest_videos(ch.channel_id, settings.youtube_api_key, max_results)

    analyzed_urls = {
        c.source_url
        for c in db.query(IntelContent.source_url)
        .filter(IntelContent.source_type == "YOUTUBE")
        .all()
    }
    new_videos = [v for v in videos if v["url"] not in analyzed_urls]

    if not new_videos:
        return {"message": "새로운 영상 없음 (모두 분석 완료)", "count": 0}

    background_tasks.add_task(_bulk_analyze, ch.channel_name, new_videos)
    return {"message": f"{len(new_videos)}개 영상 분석 시작 (백그라운드)", "count": len(new_videos)}


def _bulk_analyze(channel_name: str, videos: list):
    from config.database import SessionLocal
    db = SessionLocal()
    try:
        analyzer = create_analyzer(db)
        for v in videos:
            try:
                analyzer.analyze_youtube(url=v["url"], channel_name=channel_name)
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
        "last_checked_at": ch.last_checked_at.isoformat() if ch.last_checked_at else None,
        "created_at": ch.created_at.isoformat() if ch.created_at else None,
    }
