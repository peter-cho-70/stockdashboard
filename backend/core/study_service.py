"""
주식공부하기 — 학습 카드 생성·조회 (유튜브/AI 분석 → 학습용)
"""
from __future__ import annotations

import json
import logging
import re
from datetime import datetime
from typing import Any, Optional

from sqlalchemy.orm import Session

from config.database import IntelContent, StudyCard
from config.settings import get_settings
from core.gemini_client import GeminiClient
from core.study_curriculum import TOPIC_KEYWORDS, all_lesson_ids, get_lesson

logger = logging.getLogger(__name__)

STUDY_FROM_CONTENT_SYSTEM = """당신은 주식 학습 콘텐츠 편집자입니다.
제공된 분석 문서에서 **차트·투자 공부에 도움이 되는 개념**만 추출하세요.
문서에 없는 수치·확률·종목 추천을 만들지 마세요.
SNS에서 유래한 '성공률 80%' 같은 통계는 절대 추가하지 마세요."""

STUDY_FROM_CONTENT_PROMPT = """아래는 유튜브/뉴스 AI 분석 결과입니다. 학습용 카드로 정리하세요.

[원본 제목] {title}
[채널/출처] {channel}
[요약] {summary}

[핵심 포인트]
{key_points_block}

[상세 문서 일부]
{document_excerpt}

[사용자 강조·메모]
{highlights_block}

[커리큘럼 레슨 ID 후보]
{lesson_ids}

다음 JSON만 출력:
{{
  "title": "학습 카드 제목 (한 줄)",
  "summary": "3~5문장 — 개념·교훈 중심, 종목 추천 금지",
  "body_markdown": "마크다운 본문 — ## 소제목 2~4개, bullet, chart.md 용어와 연결",
  "key_points": ["핵심 3~7개"],
  "study_topics": ["lesson_id 목록 — 위 후보 중 1~3개"],
  "quiz": [
    {{"question": "O/X 또는 짧은 질문", "answer": "정답", "explanation": "한 줄"}}
  ],
  "linked_lessons": ["가장 관련 깊은 lesson_id 1~2개"]
}}

study_topics·linked_lessons 값은 반드시 lesson_id 후보 목록에 있는 id만 사용하세요."""


def _parse_json_list(raw: str | None) -> list:
    if not raw:
        return []
    try:
        data = json.loads(raw)
        return data if isinstance(data, list) else []
    except Exception:
        return []


def _normalize_key_points(raw: str | None) -> list[str]:
    items = _parse_json_list(raw)
    out: list[str] = []
    for item in items:
        if isinstance(item, str):
            out.append(item.strip())
        elif isinstance(item, dict):
            text = (item.get("text") or item.get("point") or "").strip()
            if text:
                out.append(text)
    return out


def _highlights_block(content: IntelContent) -> str:
    try:
        data = json.loads(content.user_highlights or "{}")
    except Exception:
        return "(없음)"
    parts: list[str] = []
    for p in data.get("user_key_points") or []:
        if p:
            parts.append(f"- {p}")
    for sn in data.get("snippets") or []:
        text = (sn.get("text") or "").strip()
        if text:
            parts.append(f"- [강조] {text[:300]}")
    return "\n".join(parts) if parts else "(없음)"


def _guess_topics_from_text(text: str) -> list[str]:
    lower = text.lower()
    scores: list[tuple[int, str]] = []
    for lesson_id, keywords in TOPIC_KEYWORDS.items():
        score = sum(1 for kw in keywords if kw.lower() in lower)
        if score:
            scores.append((score, lesson_id))
    scores.sort(reverse=True)
    return [lid for _, lid in scores[:3]]


def serialize_study_card(row: StudyCard) -> dict[str, Any]:
    return {
        "id": row.id,
        "content_id": row.content_id,
        "lesson_id": row.lesson_id,
        "title": row.title,
        "summary": row.summary,
        "body_markdown": row.body_markdown,
        "key_points": _parse_json_list(row.key_points),
        "study_topics": _parse_json_list(row.study_topics),
        "quiz": _parse_json_list(row.quiz_items),
        "source_title": row.source_title,
        "source_url": row.source_url,
        "source_type": row.source_type,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


def list_study_cards(
    db: Session,
    *,
    lesson_id: str | None = None,
    limit: int = 50,
) -> list[dict[str, Any]]:
    q = db.query(StudyCard).order_by(StudyCard.created_at.desc())
    if lesson_id:
        q = q.filter(
            (StudyCard.lesson_id == lesson_id)
            | StudyCard.study_topics.like(f'%"{lesson_id}"%')
        )
    rows = q.limit(limit).all()
    return [serialize_study_card(r) for r in rows]


def get_study_card(db: Session, card_id: int) -> dict[str, Any] | None:
    row = db.query(StudyCard).filter(StudyCard.id == card_id).first()
    return serialize_study_card(row) if row else None


def delete_study_card(db: Session, card_id: int) -> bool:
    row = db.query(StudyCard).filter(StudyCard.id == card_id).first()
    if not row:
        return False
    db.delete(row)
    db.commit()
    return True


def find_related_content_ids(db: Session, lesson_id: str, *, limit: int = 8) -> list[int]:
    keywords = TOPIC_KEYWORDS.get(lesson_id, [])
    if not keywords:
        return []
    rows = (
        db.query(IntelContent)
        .filter(IntelContent.summary.isnot(None))
        .order_by(IntelContent.analyzed_at.desc())
        .limit(200)
        .all()
    )
    scored: list[tuple[int, int]] = []
    for row in rows:
        blob = " ".join(
            filter(
                None,
                [
                    row.source_title or "",
                    row.summary or "",
                    row.source_document[:2000] if row.source_document else "",
                ],
            )
        ).lower()
        score = sum(1 for kw in keywords if kw.lower() in blob)
        if score:
            scored.append((score, row.id))
    scored.sort(key=lambda x: (-x[0], -x[1]))
    return [rid for _, rid in scored[:limit]]


def create_study_card_from_content(
    db: Session,
    content_id: int,
    *,
    lesson_id: str | None = None,
    force: bool = False,
) -> dict[str, Any]:
    settings = get_settings()
    if not settings.gemini_api_key:
        raise ValueError("GEMINI_API_KEY가 설정되지 않았습니다.")

    content = db.query(IntelContent).filter(IntelContent.id == content_id).first()
    if not content:
        raise ValueError(f"콘텐츠 없음: {content_id}")

    if not force:
        existing = (
            db.query(StudyCard)
            .filter(StudyCard.content_id == content_id)
            .order_by(StudyCard.created_at.desc())
            .first()
        )
        if existing:
            return serialize_study_card(existing)

    key_points = _normalize_key_points(content.key_points)
    key_points_block = "\n".join(f"- {p}" for p in key_points[:12]) or "(없음)"
    doc = (content.source_document or content.summary or "")[:8000]
    summary = (content.summary or "")[:1500]

    client = GeminiClient(api_key=settings.gemini_api_key, model=settings.gemini_model)
    prompt = STUDY_FROM_CONTENT_PROMPT.format(
        title=content.source_title or "제목 없음",
        channel=content.channel_name or content.source_type,
        summary=summary or "(없음)",
        key_points_block=key_points_block,
        document_excerpt=doc or summary,
        highlights_block=_highlights_block(content),
        lesson_ids=", ".join(all_lesson_ids()),
    )
    data = client.generate_json(
        prompt,
        purpose="유튜브→학습카드",
        system_instruction=STUDY_FROM_CONTENT_SYSTEM,
    )
    if not data:
        raise ValueError("학습 카드 생성에 실패했습니다.")

    topics = data.get("study_topics") or data.get("linked_lessons") or []
    if not isinstance(topics, list):
        topics = []
    topics = [t for t in topics if isinstance(t, str) and t in all_lesson_ids()]
    if lesson_id and lesson_id in all_lesson_ids() and lesson_id not in topics:
        topics.insert(0, lesson_id)
    if not topics:
        topics = _guess_topics_from_text(f"{summary}\n{doc}")

    primary_lesson = lesson_id if lesson_id in all_lesson_ids() else (topics[0] if topics else None)

    row = StudyCard(
        content_id=content_id,
        lesson_id=primary_lesson,
        title=(data.get("title") or content.source_title or "학습 카드")[:300],
        summary=data.get("summary"),
        body_markdown=data.get("body_markdown"),
        key_points=json.dumps(data.get("key_points") or key_points[:7], ensure_ascii=False),
        study_topics=json.dumps(topics, ensure_ascii=False),
        quiz_items=json.dumps(data.get("quiz") or [], ensure_ascii=False),
        source_title=content.source_title,
        source_url=content.source_url,
        source_type=content.source_type,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    logger.info("학습 카드 생성 content=%s card=%s lesson=%s", content_id, row.id, primary_lesson)
    return serialize_study_card(row)
