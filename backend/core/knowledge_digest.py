"""분야별 주간 다이제스트 (지식 콘텐츠 + 뉴스 요약)."""
from __future__ import annotations

import json
import logging
from datetime import date, datetime, timedelta, timezone
from typing import Any, Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from config.database import IntelContent, KnowledgeDigest, KnowledgeDomain, KnowledgeNewsItem
from config.settings import get_settings
from core.gemini_client import GeminiClient

logger = logging.getLogger(__name__)

DIGEST_SYSTEM = "당신은 학습 콘텐츠 큐레이터입니다. 제공된 목록만으로 주간 다이제스트를 한국어 마크다운으로 작성하세요."


def _week_period(end: Optional[date] = None) -> tuple[str, str]:
    end = end or date.today()
    start = end - timedelta(days=6)
    return start.isoformat(), end.isoformat()


def serialize_digest(row: KnowledgeDigest) -> dict[str, Any]:
    highlights = []
    try:
        if row.highlights_json:
            highlights = json.loads(row.highlights_json)
    except json.JSONDecodeError:
        pass
    return {
        "id": row.id,
        "domain_id": row.domain_id,
        "period_start": row.period_start,
        "period_end": row.period_end,
        "title": row.title,
        "body_markdown": row.body_markdown,
        "highlights": highlights,
        "status": row.status,
        "model": row.model,
        "generated_at": row.generated_at.isoformat() if row.generated_at else None,
    }


def get_latest_digest(db: Session, domain_id: int) -> Optional[dict[str, Any]]:
    row = (
        db.query(KnowledgeDigest)
        .filter(KnowledgeDigest.domain_id == domain_id, KnowledgeDigest.status == "ready")
        .order_by(KnowledgeDigest.period_end.desc())
        .first()
    )
    return serialize_digest(row) if row else None


def list_domain_digests(db: Session, domain_id: int, limit: int = 8) -> list[dict[str, Any]]:
    rows = (
        db.query(KnowledgeDigest)
        .filter(KnowledgeDigest.domain_id == domain_id)
        .order_by(KnowledgeDigest.period_end.desc())
        .limit(limit)
        .all()
    )
    return [serialize_digest(r) for r in rows]


def generate_weekly_digest(
    db: Session,
    domain_id: int,
    *,
    period_end: Optional[str] = None,
    force: bool = False,
) -> dict[str, Any]:
    domain = db.get(KnowledgeDomain, domain_id)
    if not domain:
        raise ValueError("분야 없음")

    if period_end:
        end_d = datetime.strptime(period_end, "%Y-%m-%d").date()
    else:
        end_d = date.today()
    period_start, period_end_str = _week_period(end_d)

    existing = (
        db.query(KnowledgeDigest)
        .filter(
            KnowledgeDigest.domain_id == domain_id,
            KnowledgeDigest.period_start == period_start,
            KnowledgeDigest.period_end == period_end_str,
        )
        .first()
    )
    if existing and existing.status == "ready" and not force:
        return serialize_digest(existing)

    contents = (
        db.query(IntelContent)
        .filter(
            IntelContent.content_scope == "knowledge",
            IntelContent.domain_id == domain_id,
            func.date(IntelContent.created_at) >= period_start,
            func.date(IntelContent.created_at) <= period_end_str,
        )
        .order_by(IntelContent.created_at.desc())
        .limit(30)
        .all()
    )
    news_items = (
        db.query(KnowledgeNewsItem)
        .filter(
            KnowledgeNewsItem.domain_id == domain_id,
            func.date(KnowledgeNewsItem.fetched_at) >= period_start,
        )
        .order_by(KnowledgeNewsItem.fetched_at.desc())
        .limit(15)
        .all()
    )

    content_lines = [
        f"- [{c.source_type}] {c.source_title or '(제목 없음)'}: {(c.summary or '')[:120]}"
        for c in contents
    ]
    news_lines = [f"- {n.title}: {(n.summary or '')[:80]}" for n in news_items]

    settings = get_settings()
    if not settings.gemini_api_key:
        raise ValueError("GEMINI_API_KEY 미설정")

    client = GeminiClient(api_key=settings.gemini_api_key, model=settings.gemini_model)
    prompt = f"""분야: {domain.name} ({domain.emoji})
기간: {period_start} ~ {period_end_str}

## 이번 주 학습 콘텐츠 ({len(contents)}건)
{chr(10).join(content_lines) or "(없음)"}

## 이번 주 뉴스 ({len(news_items)}건)
{chr(10).join(news_lines) or "(없음)"}

JSON 반환:
{{
  "title": "주간 다이제스트 제목",
  "body_markdown": "마크다운 본문 (핵심 테마, 3~5 bullet, 다음 주 학습 제안)",
  "highlights": ["한 줄 요약 3~5개"]
}}
"""
    data = client.generate_json(prompt, purpose="주간 다이제스트", system_instruction=DIGEST_SYSTEM)
    if not data or not data.get("body_markdown"):
        raise ValueError("다이제스트 생성 실패")

    row = existing or KnowledgeDigest(
        domain_id=domain_id,
        period_start=period_start,
        period_end=period_end_str,
    )
    row.title = data.get("title") or f"{domain.name} 주간 정리"
    row.body_markdown = data.get("body_markdown")
    row.highlights_json = json.dumps(data.get("highlights") or [], ensure_ascii=False)
    row.status = "ready"
    row.model = settings.gemini_model
    row.generated_at = datetime.now(timezone.utc)
    if not existing:
        db.add(row)
    db.commit()
    db.refresh(row)
    return serialize_digest(row)


def generate_all_weekly_digests(db: Session) -> int:
    domains = (
        db.query(KnowledgeDomain)
        .filter(KnowledgeDomain.is_active == True, KnowledgeDomain.slug != "uncategorized")
        .all()
    )
    count = 0
    for d in domains:
        try:
            generate_weekly_digest(db, d.id, force=False)
            count += 1
        except Exception as e:
            logger.warning("다이제스트 실패 domain=%s: %s", d.name, e)
    return count
