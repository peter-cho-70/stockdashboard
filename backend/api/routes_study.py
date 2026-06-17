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
from core.study_lesson_links import (
    add_lesson_link,
    delete_lesson_link,
    list_lesson_links,
    preview_youtube_url,
)
from core.study_categories import (
    create_category,
    delete_category,
    list_categories,
    reorder_categories,
    update_category,
)
from core.study_link_preview import preview_link
from core.study_service import (
    create_manual_study_card,
    create_study_card_from_content,
    delete_study_card,
    find_related_content_ids,
    get_study_card,
    list_study_cards,
    move_study_card,
    reorder_study_cards,
    run_simple_analysis,
    update_study_card,
)

logger = logging.getLogger(__name__)

study_router = APIRouter(prefix="/study", tags=["study"])


class StudyCardFromContentBody(BaseModel):
    lesson_id: Optional[str] = None
    force: bool = False


class YoutubePreviewBody(BaseModel):
    url: str


class LessonLinkBody(BaseModel):
    url: str


class LinkPreviewBody(BaseModel):
    url: str


class CategoryCreateBody(BaseModel):
    name: str
    description: Optional[str] = None


class CategoryUpdateBody(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None


class ManualCardBody(BaseModel):
    url: str
    category_id: Optional[int] = None
    title: Optional[str] = None
    user_note: Optional[str] = None


class CardUpdateBody(BaseModel):
    title: Optional[str] = None
    category_id: Optional[int] = None
    user_note: Optional[str] = None


class CardMoveBody(BaseModel):
    category_id: int
    sort_order: Optional[int] = None


class CardReorderBody(BaseModel):
    category_id: int
    card_ids: list[int]


class CategoryReorderBody(BaseModel):
    category_ids: list[int]


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
    category_id: Optional[int] = None,
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
):
    return {"items": list_study_cards(db, lesson_id=lesson_id, category_id=category_id, limit=limit)}


@study_router.get("/categories")
def get_categories(db: Session = Depends(get_db)):
    return {"items": list_categories(db)}


@study_router.post("/categories")
def post_category(body: CategoryCreateBody, db: Session = Depends(get_db)):
    try:
        return create_category(db, name=body.name, description=body.description)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@study_router.patch("/categories/{category_id}")
def patch_category(category_id: int, body: CategoryUpdateBody, db: Session = Depends(get_db)):
    try:
        return update_category(db, category_id, name=body.name, description=body.description)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@study_router.delete("/categories/{category_id}")
def remove_category(
    category_id: int,
    move_to: Optional[int] = Query(None),
    db: Session = Depends(get_db),
):
    try:
        if not delete_category(db, category_id, move_to_id=move_to):
            raise HTTPException(status_code=404, detail="카테고리를 찾을 수 없습니다.")
        return {"ok": True}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@study_router.patch("/categories/reorder")
def patch_category_reorder(body: CategoryReorderBody, db: Session = Depends(get_db)):
    return {"items": reorder_categories(db, body.category_ids)}


@study_router.post("/link-preview")
def post_link_preview(body: LinkPreviewBody):
    try:
        return preview_link(body.url)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        logger.exception("링크 미리보기 실패")
        raise HTTPException(status_code=500, detail="링크 정보 조회에 실패했습니다.") from e


@study_router.post("/cards/manual")
def post_manual_study_card(body: ManualCardBody, db: Session = Depends(get_db)):
    try:
        return create_manual_study_card(
            db,
            url=body.url,
            category_id=body.category_id,
            title=body.title,
            user_note=body.user_note,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        logger.exception("수동 학습 카드 생성 실패")
        raise HTTPException(status_code=500, detail="학습 카드 저장에 실패했습니다.") from e


@study_router.patch("/cards/reorder")
def patch_card_reorder(body: CardReorderBody, db: Session = Depends(get_db)):
    try:
        return {"items": reorder_study_cards(db, body.category_id, body.card_ids)}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


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


@study_router.patch("/cards/{card_id}")
def patch_study_card(card_id: int, body: CardUpdateBody, db: Session = Depends(get_db)):
    try:
        return update_study_card(
            db,
            card_id,
            title=body.title,
            category_id=body.category_id,
            user_note=body.user_note,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@study_router.patch("/cards/{card_id}/move")
def patch_study_card_move(card_id: int, body: CardMoveBody, db: Session = Depends(get_db)):
    try:
        return move_study_card(
            db,
            card_id,
            category_id=body.category_id,
            sort_order=body.sort_order,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@study_router.post("/cards/{card_id}/analyze")
def post_study_card_analyze(
    card_id: int,
    force: bool = Query(False),
    db: Session = Depends(get_db),
):
    try:
        return run_simple_analysis(db, card_id, force=force)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        logger.exception("간단 분석 실패 card=%s", card_id)
        raise HTTPException(status_code=500, detail="간단 분석 중 오류가 발생했습니다.") from e


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


@study_router.post("/youtube/preview")
def post_youtube_preview(body: YoutubePreviewBody):
    try:
        return preview_youtube_url(body.url)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        logger.exception("YouTube 미리보기 실패")
        raise HTTPException(status_code=500, detail="YouTube 정보 조회에 실패했습니다.") from e


@study_router.get("/lessons/{lesson_id}/links")
def get_lesson_links(lesson_id: str, db: Session = Depends(get_db)):
    if not get_lesson(lesson_id):
        raise HTTPException(status_code=404, detail="레슨을 찾을 수 없습니다.")
    return {"lesson_id": lesson_id, "items": list_lesson_links(db, lesson_id)}


@study_router.post("/lessons/{lesson_id}/links")
def post_lesson_link(lesson_id: str, body: LessonLinkBody, db: Session = Depends(get_db)):
    try:
        item = add_lesson_link(db, lesson_id, body.url)
        return item
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        logger.exception("레슨 유튜브 링크 저장 실패 lesson=%s", lesson_id)
        raise HTTPException(status_code=500, detail="유튜브 링크 저장에 실패했습니다.") from e


@study_router.delete("/lessons/{lesson_id}/links/{link_id}")
def remove_lesson_link(lesson_id: str, link_id: int, db: Session = Depends(get_db)):
    if not delete_lesson_link(db, lesson_id, link_id):
        raise HTTPException(status_code=404, detail="링크를 찾을 수 없습니다.")
    return {"ok": True}
