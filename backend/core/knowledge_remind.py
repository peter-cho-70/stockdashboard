"""지식 허브 간격 반복 리마인드."""
from __future__ import annotations

import json
from datetime import date, timedelta
from typing import Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

REMIND_INTERVALS = [7, 14, 30]


def get_today_remind_cards(db: Session, limit: int = 3) -> list[dict]:
    from config.database import IntelContent, KnowledgeRemindLog

    today = date.today().isoformat()
    result: list[dict] = []
    already_reminded = {
        row[0]
        for row in db.query(KnowledgeRemindLog.content_id)
        .filter(KnowledgeRemindLog.remind_date == today)
        .all()
    }

    for days_ago in REMIND_INTERVALS:
        if len(result) >= limit:
            break
        target_date = (date.today() - timedelta(days=days_ago)).isoformat()
        candidates = (
            db.query(IntelContent)
            .filter(
                IntelContent.content_scope == "knowledge",
                IntelContent.analyzed_at.isnot(None),
                func.date(IntelContent.analyzed_at) == target_date,
                IntelContent.id.notin_(already_reminded) if already_reminded else True,
            )
            .limit(limit - len(result))
            .all()
        )
        for c in candidates:
            if c.id in already_reminded:
                continue
            result.append(_serialize_remind_card(c, days_ago=days_ago))
            already_reminded.add(c.id)

    if len(result) < limit:
        overdue_ids = {
            row[0]
            for row in db.query(KnowledgeRemindLog.content_id)
            .filter(
                KnowledgeRemindLog.next_remind <= today,
                KnowledgeRemindLog.next_remind.isnot(None),
            )
            .all()
        }
        for cid in overdue_ids:
            if len(result) >= limit:
                break
            if cid in already_reminded:
                continue
            c = db.query(IntelContent).filter(IntelContent.id == cid).first()
            if c:
                result.append(_serialize_remind_card(c, days_ago=None))

    return result[:limit]


def record_remind_action(db: Session, content_id: int, action: str) -> dict:
    from config.database import KnowledgeRemindLog

    today = date.today().isoformat()
    next_remind = _calc_next_remind(action)
    db.add(
        KnowledgeRemindLog(
            content_id=content_id,
            remind_date=today,
            user_action=action,
            next_remind=next_remind,
        )
    )
    db.commit()
    return {"content_id": content_id, "action": action, "next_remind": next_remind}


def _calc_next_remind(action: str) -> str:
    days = 90 if action == "remembered" else 3
    return (date.today() + timedelta(days=days)).isoformat()


def _serialize_remind_card(content, days_ago: Optional[int]) -> dict:
    def _j(v):
        if not v:
            return []
        try:
            return json.loads(v)
        except Exception:
            return []

    return {
        "id": content.id,
        "source_type": content.source_type,
        "source_url": content.source_url,
        "source_title": content.source_title,
        "channel_name": content.channel_name,
        "domain_id": content.domain_id,
        "summary": content.summary,
        "key_points": _j(content.key_points),
        "keywords": _j(content.keywords),
        "sentiment": content.sentiment,
        "days_ago": days_ago,
        "remind_reason": (
            f"{days_ago}일 전 학습한 내용입니다" if days_ago else "복습이 필요한 콘텐츠입니다"
        ),
        "analyzed_at": content.analyzed_at.isoformat() if content.analyzed_at else None,
    }


def get_remind_stats(db: Session) -> dict:
    from config.database import KnowledgeRemindLog

    total = db.query(func.count(KnowledgeRemindLog.id)).scalar() or 0
    remembered = (
        db.query(func.count(KnowledgeRemindLog.id))
        .filter(KnowledgeRemindLog.user_action == "remembered")
        .scalar()
        or 0
    )
    return {
        "total_actions": total,
        "remembered": remembered,
        "needs_review": total - remembered,
        "retention_rate": round(remembered / total * 100, 1) if total > 0 else 0,
    }
