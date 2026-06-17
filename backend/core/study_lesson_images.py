"""
주식공부하기 — 레슨 참고 이미지 저장·조회
"""
from __future__ import annotations

import logging
import re
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

from sqlalchemy.orm import Session

from config.database import StudyLessonImage
from core.study_curriculum import get_lesson

logger = logging.getLogger(__name__)

_IMAGES_ROOT = Path(__file__).resolve().parent.parent / "data" / "study_images"
_MAX_BYTES = 5 * 1024 * 1024
_ALLOWED_MIME = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
}


def _lesson_dir(lesson_id: str) -> Path:
    safe = re.sub(r"[^\w-]", "", lesson_id)
    path = _IMAGES_ROOT / safe
    path.mkdir(parents=True, exist_ok=True)
    return path


def _image_url(lesson_id: str, image_id: int) -> str:
    return f"/api/study/lessons/{lesson_id}/images/{image_id}/file"


def serialize_lesson_image(row: StudyLessonImage) -> dict[str, Any]:
    return {
        "id": row.id,
        "lesson_id": row.lesson_id,
        "url": _image_url(row.lesson_id, row.id),
        "original_name": row.original_name,
        "mime_type": row.mime_type,
        "caption": row.caption,
        "sort_order": row.sort_order,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


def list_lesson_images(db: Session, lesson_id: str) -> list[dict[str, Any]]:
    rows = (
        db.query(StudyLessonImage)
        .filter(StudyLessonImage.lesson_id == lesson_id)
        .order_by(StudyLessonImage.sort_order.asc(), StudyLessonImage.created_at.desc())
        .all()
    )
    return [serialize_lesson_image(r) for r in rows]


def get_lesson_image(db: Session, lesson_id: str, image_id: int) -> StudyLessonImage | None:
    return (
        db.query(StudyLessonImage)
        .filter(StudyLessonImage.id == image_id, StudyLessonImage.lesson_id == lesson_id)
        .first()
    )


def image_file_path(row: StudyLessonImage) -> Path:
    return _lesson_dir(row.lesson_id) / row.stored_name


def save_lesson_image(
    db: Session,
    lesson_id: str,
    *,
    data: bytes,
    mime_type: str,
    original_name: str | None = None,
    caption: str | None = None,
) -> dict[str, Any]:
    lesson_id = lesson_id.strip()
    if not get_lesson(lesson_id):
        raise ValueError("레슨을 찾을 수 없습니다.")

    mime = (mime_type or "image/png").split(";")[0].strip().lower()
    if mime not in _ALLOWED_MIME:
        raise ValueError("PNG, JPEG, WebP, GIF 이미지만 업로드할 수 있습니다.")
    if len(data) > _MAX_BYTES:
        raise ValueError("이미지 크기는 5MB 이하여야 합니다.")
    if len(data) == 0:
        raise ValueError("빈 이미지입니다.")

    ext = _ALLOWED_MIME[mime]
    stored_name = f"{uuid.uuid4().hex}{ext}"
    dest = _lesson_dir(lesson_id) / stored_name
    dest.write_bytes(data)

    count = db.query(StudyLessonImage).filter(StudyLessonImage.lesson_id == lesson_id).count()
    row = StudyLessonImage(
        lesson_id=lesson_id,
        stored_name=stored_name,
        original_name=(original_name or "")[:255] or None,
        mime_type=mime,
        caption=(caption or "")[:300] or None,
        sort_order=count,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    logger.info("레슨 이미지 저장 lesson=%s id=%s", lesson_id, row.id)
    return serialize_lesson_image(row)


def delete_lesson_image(db: Session, lesson_id: str, image_id: int) -> bool:
    row = get_lesson_image(db, lesson_id, image_id)
    if not row:
        return False
    path = image_file_path(row)
    db.delete(row)
    db.commit()
    if path.is_file():
        path.unlink(missing_ok=True)
    logger.info("레슨 이미지 삭제 lesson=%s id=%s", lesson_id, image_id)
    return True
