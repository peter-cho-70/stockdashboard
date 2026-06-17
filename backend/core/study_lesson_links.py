"""
주식공부하기 — 레슨별 참고 유튜브 링크 저장·조회
"""
from __future__ import annotations

import logging
from typing import Any

from sqlalchemy.orm import Session

from config.database import StudyLessonLink
from config.settings import get_settings
from core.study_curriculum import get_lesson
from core.youtube_fetcher import fetch_video_metadata, is_youtube_url

logger = logging.getLogger(__name__)


def serialize_lesson_link(row: StudyLessonLink) -> dict[str, Any]:
    return {
        "id": row.id,
        "lesson_id": row.lesson_id,
        "video_id": row.video_id,
        "url": row.url,
        "title": row.title,
        "channel_name": row.channel_name,
        "thumbnail": row.thumbnail,
        "sort_order": row.sort_order,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


def preview_youtube_url(url: str) -> dict[str, Any]:
    raw = (url or "").strip()
    if not raw:
        raise ValueError("YouTube URL을 입력하세요.")
    if not is_youtube_url(raw):
        raise ValueError("유효한 YouTube URL이 아닙니다.")

    settings = get_settings()
    meta = fetch_video_metadata(raw, api_key=settings.youtube_api_key or None)
    if not meta:
        raise ValueError("영상 정보를 가져올 수 없습니다. URL을 확인하세요.")
    return meta


def list_lesson_links(db: Session, lesson_id: str) -> list[dict[str, Any]]:
    rows = (
        db.query(StudyLessonLink)
        .filter(StudyLessonLink.lesson_id == lesson_id)
        .order_by(StudyLessonLink.sort_order.asc(), StudyLessonLink.created_at.desc())
        .all()
    )
    return [serialize_lesson_link(r) for r in rows]


def get_lesson_link(db: Session, lesson_id: str, link_id: int) -> StudyLessonLink | None:
    return (
        db.query(StudyLessonLink)
        .filter(StudyLessonLink.id == link_id, StudyLessonLink.lesson_id == lesson_id)
        .first()
    )


def add_lesson_link(db: Session, lesson_id: str, url: str) -> dict[str, Any]:
    lesson_id = lesson_id.strip()
    if not get_lesson(lesson_id):
        raise ValueError("레슨을 찾을 수 없습니다.")

    meta = preview_youtube_url(url)
    video_id = meta["video_id"]

    existing = (
        db.query(StudyLessonLink)
        .filter(StudyLessonLink.lesson_id == lesson_id, StudyLessonLink.video_id == video_id)
        .first()
    )
    if existing:
        existing.url = meta["url"]
        existing.title = meta["title"][:300]
        existing.channel_name = (meta.get("channel_name") or "")[:200] or None
        existing.thumbnail = (meta.get("thumbnail") or "")[:500] or None
        db.commit()
        db.refresh(existing)
        logger.info("레슨 유튜브 링크 갱신 lesson=%s id=%s", lesson_id, existing.id)
        return serialize_lesson_link(existing)

    count = db.query(StudyLessonLink).filter(StudyLessonLink.lesson_id == lesson_id).count()
    row = StudyLessonLink(
        lesson_id=lesson_id,
        video_id=video_id,
        url=meta["url"],
        title=meta["title"][:300],
        channel_name=(meta.get("channel_name") or "")[:200] or None,
        thumbnail=(meta.get("thumbnail") or "")[:500] or None,
        sort_order=count,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    logger.info("레슨 유튜브 링크 저장 lesson=%s id=%s", lesson_id, row.id)
    return serialize_lesson_link(row)


def delete_lesson_link(db: Session, lesson_id: str, link_id: int) -> bool:
    row = get_lesson_link(db, lesson_id, link_id)
    if not row:
        return False
    db.delete(row)
    db.commit()
    logger.info("레슨 유튜브 링크 삭제 lesson=%s id=%s", lesson_id, link_id)
    return True
