"""
api/routes_study.py — 주식공부하기 API
"""
from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from config.database import IntelContent, get_db
from core.study_curriculum import get_lesson, load_curriculum
from core.study_lesson_images import (
    delete_lesson_image,
    get_lesson_image,
    image_file_path,
    list_lesson_images,
    save_lesson_image,
)
from core.study_service import (
    create_study_card_from_content,
    delete_study_card,
    find_related_content_ids,
    get_study_card,
    list_study_cards,
)

logger = logging.getLogger(__name__)

study_router = APIRouter(prefix="/study", tags=["study"])


class StudyCardFromContentBody(BaseModel):
    lesson_id: Optional[str] = None
    force: bool = False


@study_router.get("/curriculum")
def get_curriculum():
    data = load_curriculum()
    lessons = [
        {
            "id": l["id"],
            "order": l["order"],
            "title": l["title"],
            "subtitle": l["subtitle"],
            "chart_link": l.get("chart_link"),
            "topic_keywords": l.get("topic_keywords", []),
        }
        for l in data["lessons"]
    ]
    return {
        "title": data["title"],
        "source": data["source"],
        "intro_markdown": data["intro_markdown"],
        "disclaimer": data["disclaimer"],
        "lessons": lessons,
    }


@study_router.get("/lessons/{lesson_id}")
def get_lesson_detail(lesson_id: str):
    lesson = get_lesson(lesson_id)
    if not lesson:
        raise HTTPException(status_code=404, detail="레슨을 찾을 수 없습니다.")
    return {
        "id": lesson["id"],
        "order": lesson["order"],
        "title": lesson["title"],
        "subtitle": lesson["subtitle"],
        "section_title": lesson.get("section_title"),
        "body_markdown": lesson.get("body_markdown", ""),
        "chart_link": lesson.get("chart_link"),
        "topic_keywords": lesson.get("topic_keywords", []),
    }


@study_router.get("/lessons/{lesson_id}/related-content")
def get_lesson_related_content(
    lesson_id: str,
    limit: int = Query(8, ge=1, le=20),
    db: Session = Depends(get_db),
):
    if not get_lesson(lesson_id):
        raise HTTPException(status_code=404, detail="레슨을 찾을 수 없습니다.")
    ids = find_related_content_ids(db, lesson_id, limit=limit)
    rows = db.query(IntelContent).filter(IntelContent.id.in_(ids)).all() if ids else []
    by_id = {r.id: r for r in rows}
    items = []
    for cid in ids:
        row = by_id.get(cid)
        if not row:
            continue
        items.append(
            {
                "id": row.id,
                "source_type": row.source_type,
                "source_title": row.source_title,
                "source_url": row.source_url,
                "channel_name": row.channel_name,
                "summary": (row.summary or "")[:300],
                "analyzed_at": row.analyzed_at.isoformat() if row.analyzed_at else None,
            }
        )
    return {"lesson_id": lesson_id, "items": items}


@study_router.get("/cards")
def get_study_cards(
    lesson_id: Optional[str] = None,
    limit: int = Query(50, ge=1, le=100),
    db: Session = Depends(get_db),
):
    return {"items": list_study_cards(db, lesson_id=lesson_id, limit=limit)}


@study_router.get("/cards/{card_id}")
def get_study_card_detail(card_id: int, db: Session = Depends(get_db)):
    card = get_study_card(db, card_id)
    if not card:
        raise HTTPException(status_code=404, detail="학습 카드를 찾을 수 없습니다.")
    return card


@study_router.post("/cards/from-content/{content_id}")
def post_study_card_from_content(
    content_id: int,
    body: StudyCardFromContentBody | None = None,
    db: Session = Depends(get_db),
):
    body = body or StudyCardFromContentBody()
    try:
        card = create_study_card_from_content(
            db,
            content_id,
            lesson_id=body.lesson_id,
            force=body.force,
        )
        return card
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        logger.exception("학습 카드 생성 실패 content=%s", content_id)
        raise HTTPException(status_code=500, detail="학습 카드 생성 중 오류가 발생했습니다.") from e


@study_router.delete("/cards/{card_id}")
def remove_study_card(card_id: int, db: Session = Depends(get_db)):
    if not delete_study_card(db, card_id):
        raise HTTPException(status_code=404, detail="학습 카드를 찾을 수 없습니다.")
    return {"ok": True}


@study_router.get("/lessons/{lesson_id}/images")
def get_lesson_images(lesson_id: str, db: Session = Depends(get_db)):
    if not get_lesson(lesson_id):
        raise HTTPException(status_code=404, detail="레슨을 찾을 수 없습니다.")
    return {"lesson_id": lesson_id, "items": list_lesson_images(db, lesson_id)}


@study_router.post("/lessons/{lesson_id}/images")
async def upload_lesson_image(
    lesson_id: str,
    file: UploadFile = File(...),
    caption: Optional[str] = Form(None),
    db: Session = Depends(get_db),
):
    try:
        data = await file.read()
        item = save_lesson_image(
            db,
            lesson_id,
            data=data,
            mime_type=file.content_type or "image/png",
            original_name=file.filename,
            caption=caption,
        )
        return item
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        logger.exception("레슨 이미지 업로드 실패 lesson=%s", lesson_id)
        raise HTTPException(status_code=500, detail="이미지 업로드에 실패했습니다.") from e


@study_router.get("/lessons/{lesson_id}/images/{image_id}/file")
def get_lesson_image_file(lesson_id: str, image_id: int, db: Session = Depends(get_db)):
    row = get_lesson_image(db, lesson_id, image_id)
    if not row:
        raise HTTPException(status_code=404, detail="이미지를 찾을 수 없습니다.")
    path = image_file_path(row)
    if not path.is_file():
        raise HTTPException(status_code=404, detail="이미지 파일이 없습니다.")
    return FileResponse(path, media_type=row.mime_type or "image/png")


@study_router.delete("/lessons/{lesson_id}/images/{image_id}")
def remove_lesson_image(lesson_id: str, image_id: int, db: Session = Depends(get_db)):
    if not delete_lesson_image(db, lesson_id, image_id):
        raise HTTPException(status_code=404, detail="이미지를 찾을 수 없습니다.")
    return {"ok": True}
