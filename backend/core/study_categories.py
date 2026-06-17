"""
주식공부하기 — 사용자 카테고리 CRUD
"""
from __future__ import annotations

import logging
from typing import Any

from sqlalchemy.orm import Session

from config.database import StudyCard, StudyCategory

logger = logging.getLogger(__name__)

DEFAULT_CATEGORY_NAME = "미분류"


def serialize_category(row: StudyCategory) -> dict[str, Any]:
    return {
        "id": row.id,
        "name": row.name,
        "description": row.description,
        "sort_order": row.sort_order,
        "is_default": bool(row.is_default),
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


def ensure_default_category(db: Session) -> StudyCategory:
    row = db.query(StudyCategory).filter(StudyCategory.is_default == True).first()  # noqa: E712
    if row:
        return row
    row = StudyCategory(name=DEFAULT_CATEGORY_NAME, is_default=True, sort_order=0)
    db.add(row)
    db.commit()
    db.refresh(row)
    logger.info("기본 학습 카테고리 생성 id=%s", row.id)
    return row


def list_categories(db: Session) -> list[dict[str, Any]]:
    ensure_default_category(db)
    rows = (
        db.query(StudyCategory)
        .order_by(StudyCategory.sort_order.asc(), StudyCategory.id.asc())
        .all()
    )
    return [serialize_category(r) for r in rows]


def get_category(db: Session, category_id: int) -> StudyCategory | None:
    return db.query(StudyCategory).filter(StudyCategory.id == category_id).first()


def create_category(db: Session, *, name: str, description: str | None = None) -> dict[str, Any]:
    name = (name or "").strip()
    if not name:
        raise ValueError("카테고리 이름을 입력하세요.")
    if name == DEFAULT_CATEGORY_NAME:
        raise ValueError(f"「{DEFAULT_CATEGORY_NAME}」는 시스템 카테고리입니다.")

    existing = db.query(StudyCategory).filter(StudyCategory.name == name).first()
    if existing:
        raise ValueError("같은 이름의 카테고리가 있습니다.")

    count = db.query(StudyCategory).count()
    row = StudyCategory(
        name=name[:100],
        description=(description or "")[:500] or None,
        sort_order=count,
        is_default=False,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return serialize_category(row)


def update_category(
    db: Session,
    category_id: int,
    *,
    name: str | None = None,
    description: str | None = None,
) -> dict[str, Any]:
    row = get_category(db, category_id)
    if not row:
        raise ValueError("카테고리를 찾을 수 없습니다.")
    if row.is_default and name and name.strip() != row.name:
        raise ValueError(f"「{DEFAULT_CATEGORY_NAME}」 이름은 변경할 수 없습니다.")

    if name is not None:
        new_name = name.strip()
        if not new_name:
            raise ValueError("카테고리 이름을 입력하세요.")
        dup = (
            db.query(StudyCategory)
            .filter(StudyCategory.name == new_name, StudyCategory.id != category_id)
            .first()
        )
        if dup:
            raise ValueError("같은 이름의 카테고리가 있습니다.")
        row.name = new_name[:100]

    if description is not None:
        row.description = description.strip()[:500] or None

    db.commit()
    db.refresh(row)
    return serialize_category(row)


def delete_category(db: Session, category_id: int, *, move_to_id: int | None = None) -> bool:
    row = get_category(db, category_id)
    if not row:
        return False
    if row.is_default:
        raise ValueError(f"「{DEFAULT_CATEGORY_NAME}」 카테고리는 삭제할 수 없습니다.")

    default = ensure_default_category(db)
    target_id = move_to_id or default.id
    target = get_category(db, target_id)
    if not target:
        raise ValueError("이동 대상 카테고리를 찾을 수 없습니다.")

    cards = db.query(StudyCard).filter(StudyCard.category_id == category_id).all()
    for card in cards:
        card.category_id = target_id

    db.delete(row)
    db.commit()
    logger.info("카테고리 삭제 id=%s cards_moved=%s", category_id, len(cards))
    return True


def reorder_categories(db: Session, category_ids: list[int]) -> list[dict[str, Any]]:
    if not category_ids:
        return list_categories(db)
    rows = db.query(StudyCategory).filter(StudyCategory.id.in_(category_ids)).all()
    by_id = {r.id: r for r in rows}
    for idx, cid in enumerate(category_ids):
        row = by_id.get(cid)
        if row:
            row.sort_order = idx
    db.commit()
    return list_categories(db)
