"""
core/knowledge_remind.py
간격 반복(Spaced Repetition) 기반 리마인드 카드 로직

7일·30일 전 학습 콘텐츠를 오늘 다시 보여주어 장기 기억으로 전환합니다.
"""
import json
import logging
from datetime import date, timedelta
from typing import Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

# 리마인드 주기 (일)
REMIND_INTERVALS = [7, 14, 30, 60, 90]


# ── 오늘의 리마인드 카드 ──────────────────────────────────────────────────────

def get_today_remind_cards(db: Session, limit: int = 3) -> list[dict]:
    """
    오늘의 리마인드 카드 반환

    기준:
    1. 정확히 7일·14일·30일 전 분석된 knowledge 콘텐츠
    2. 오늘 이미 리마인드 액션을 취한 것 제외
    3. 최대 limit 건
    """
    from config.database import IntelContent, KnowledgeRemindLog

    today = date.today().isoformat()
    result = []

    for days_ago in REMIND_INTERVALS:
        if len(result) >= limit:
            break

        target_date = (date.today() - timedelta(days=days_ago)).isoformat()

        # 오늘 이미 리마인드한 content_id 목록
        already_reminded = {
            row[0]
            for row in db.query(KnowledgeRemindLog.content_id)
            .filter(KnowledgeRemindLog.remind_date == today)
            .all()
        }

        # next_remind 지정된 것 중 오늘 이전인 것도 포함
        next_remind_due = {
            row[0]
            for row in db.query(KnowledgeRemindLog.content_id)
            .filter(
                KnowledgeRemindLog.next_remind <= today,
                KnowledgeRemindLog.next_remind != None,
            )
            .all()
        }

        candidates = (
            db.query(IntelContent)
            .filter(
                IntelContent.content_scope == "knowledge",
                IntelContent.analyzed_at.isnot(None),
                func.date(IntelContent.analyzed_at) == target_date,
                IntelContent.id.notin_(already_reminded),
            )
            .limit(limit - len(result))
            .all()
        )

        for c in candidates:
            result.append(_serialize_remind_card(c, days_ago=days_ago))

    # next_remind 도달한 항목 추가
    if len(result) < limit:
        today_str = date.today().isoformat()
        overdue_ids = {
            row[0]
            for row in db.query(KnowledgeRemindLog.content_id)
            .filter(
                KnowledgeRemindLog.next_remind <= today_str,
                KnowledgeRemindLog.next_remind.isnot(None),
            )
            .all()
        }
        already_in = {c["id"] for c in result}
        for cid in overdue_ids - already_in:
            if len(result) >= limit:
                break
            c = db.query(IntelContent).filter(IntelContent.id == cid).first()
            if c:
                result.append(_serialize_remind_card(c, days_ago=None))

    return result[:limit]


# ── 리마인드 액션 기록 ────────────────────────────────────────────────────────

def record_remind_action(
    db: Session,
    content_id: int,
    action: str,  # "remembered" | "needs_review"
) -> dict:
    """
    리마인드 액션 저장 및 다음 리마인드 날짜 계산

    remembered   → 90일 후 다시 리마인드
    needs_review → 3일 후 다시 리마인드
    """
    from config.database import KnowledgeRemindLog

    today = date.today().isoformat()
    next_remind = _calc_next_remind(action)

    log = KnowledgeRemindLog(
        content_id  = content_id,
        remind_date = today,
        user_action = action,
        next_remind = next_remind,
    )
    db.add(log)
    db.commit()

    logger.info(
        "리마인드 기록: content_id=%d action=%s next=%s",
        content_id, action, next_remind,
    )
    return {
        "content_id":  content_id,
        "action":      action,
        "next_remind": next_remind,
    }


def _calc_next_remind(action: str) -> str:
    """액션에 따른 다음 리마인드 날짜 계산"""
    days = 90 if action == "remembered" else 3
    return (date.today() + timedelta(days=days)).isoformat()


# ── 직렬화 ────────────────────────────────────────────────────────────────────

def _serialize_remind_card(content, days_ago: Optional[int]) -> dict:
    def _j(v):
        if not v:
            return []
        try:
            return json.loads(v)
        except Exception:
            return []

    return {
        "id":            content.id,
        "source_type":   content.source_type,
        "source_url":    content.source_url,
        "source_title":  content.source_title,
        "channel_name":  content.channel_name,
        "domain_id":     content.domain_id,
        "summary":       content.summary,
        "key_points":    _j(content.key_points),
        "keywords":      _j(content.keywords),
        "sentiment":     content.sentiment,
        "days_ago":      days_ago,           # "7일 전 학습" 표시용
        "remind_reason": (
            f"{days_ago}일 전 학습한 내용입니다" if days_ago
            else "복습이 필요한 콘텐츠입니다"
        ),
        "analyzed_at":   (
            content.analyzed_at.isoformat() if content.analyzed_at else None
        ),
    }


# ── 통계 ──────────────────────────────────────────────────────────────────────

def get_remind_stats(db: Session) -> dict:
    """리마인드 통계 반환"""
    from config.database import KnowledgeRemindLog

    total = db.query(func.count(KnowledgeRemindLog.id)).scalar() or 0
    remembered = (
        db.query(func.count(KnowledgeRemindLog.id))
        .filter(KnowledgeRemindLog.user_action == "remembered")
        .scalar() or 0
    )
    needs_review = total - remembered
    retention_rate = round(remembered / total * 100, 1) if total > 0 else 0

    return {
        "total_actions":   total,
        "remembered":      remembered,
        "needs_review":    needs_review,
        "retention_rate":  retention_rate,
    }
