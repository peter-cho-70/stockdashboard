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
from core.study_categories import ensure_default_category, get_category
from core.study_curriculum import TOPIC_KEYWORDS, all_lesson_ids, get_lesson
from core.study_link_preview import fetch_web_page_text, preview_link

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

SIMPLE_ANALYSIS_SYSTEM = """당신은 주식·차트 학습 도우미입니다.
제공된 내용에서 학습에 도움이 되는 개념만 짧게 정리하세요.
종목 추천, 매수·매도 신호, 수익률 예측은 절대 하지 마세요."""

SIMPLE_ANALYSIS_PROMPT = """아래 {label} 내용을 **학습용**으로 간단히 정리하세요.

[제목] {title}
[출처] {source}

[본문]
{body}

다음 JSON만 출력:
{{
  "summary": "3~5문장 — 개념·교훈 중심",
  "key_points": ["핵심 3~5개"]
}}"""


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


def _parse_json_obj(raw: str | None) -> dict | None:
    if not raw:
        return None
    try:
        data = json.loads(raw)
        return data if isinstance(data, dict) else None
    except Exception:
        return None


def serialize_study_card(row: StudyCard) -> dict[str, Any]:
    simple = _parse_json_obj(row.simple_analysis)
    return {
        "id": row.id,
        "content_id": row.content_id,
        "category_id": row.category_id,
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
        "thumbnail": row.thumbnail,
        "origin": row.origin or "ai",
        "sort_order": row.sort_order or 0,
        "user_note": row.user_note,
        "analysis_status": row.analysis_status or "none",
        "simple_analysis": simple,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


def list_study_cards(
    db: Session,
    *,
    lesson_id: str | None = None,
    category_id: int | None = None,
    limit: int = 50,
) -> list[dict[str, Any]]:
    q = db.query(StudyCard)
    if lesson_id:
        q = q.filter(
            (StudyCard.lesson_id == lesson_id)
            | StudyCard.study_topics.like(f'%"{lesson_id}"%')
        )
    if category_id is not None:
        default = ensure_default_category(db)
        if category_id == default.id:
            q = q.filter(
                (StudyCard.category_id == category_id) | (StudyCard.category_id.is_(None))
            )
        else:
            q = q.filter(StudyCard.category_id == category_id)
    rows = (
        q.order_by(StudyCard.sort_order.asc(), StudyCard.created_at.desc())
        .limit(limit)
        .all()
    )
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
        origin="ai",
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    logger.info("학습 카드 생성 content=%s card=%s lesson=%s", content_id, row.id, primary_lesson)
    return serialize_study_card(row)


def _resolve_category_id(db: Session, category_id: int | None) -> int:
    default = ensure_default_category(db)
    if category_id is None:
        return default.id
    if not get_category(db, category_id):
        raise ValueError("카테고리를 찾을 수 없습니다.")
    return category_id


def _next_sort_order(db: Session, category_id: int) -> int:
    count = db.query(StudyCard).filter(StudyCard.category_id == category_id).count()
    return count


def create_manual_study_card(
    db: Session,
    *,
    url: str,
    category_id: int | None = None,
    title: str | None = None,
    user_note: str | None = None,
) -> dict[str, Any]:
    meta = preview_link(url)
    cat_id = _resolve_category_id(db, category_id)

    existing = (
        db.query(StudyCard)
        .filter(StudyCard.source_url == meta["url"], StudyCard.origin == "manual")
        .first()
    )
    card_title = (title or meta["title"] or "학습 링크")[:300]

    if existing:
        existing.title = card_title
        existing.source_title = meta["title"][:300]
        existing.source_type = meta["source_type"]
        existing.thumbnail = (meta.get("thumbnail") or "")[:500] or None
        existing.category_id = cat_id
        if user_note is not None:
            existing.user_note = user_note[:2000] or None
        db.commit()
        db.refresh(existing)
        return serialize_study_card(existing)

    row = StudyCard(
        category_id=cat_id,
        title=card_title,
        source_title=meta["title"][:300],
        source_url=meta["url"],
        source_type=meta["source_type"],
        thumbnail=(meta.get("thumbnail") or "")[:500] or None,
        origin="manual",
        sort_order=_next_sort_order(db, cat_id),
        user_note=(user_note or "")[:2000] or None,
        analysis_status="none",
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    logger.info("수동 학습 카드 생성 id=%s url=%s", row.id, meta["url"])
    return serialize_study_card(row)


def update_study_card(
    db: Session,
    card_id: int,
    *,
    title: str | None = None,
    category_id: int | None = None,
    user_note: str | None = None,
) -> dict[str, Any]:
    row = db.query(StudyCard).filter(StudyCard.id == card_id).first()
    if not row:
        raise ValueError("학습 카드를 찾을 수 없습니다.")

    if title is not None:
        t = title.strip()
        if not t:
            raise ValueError("제목을 입력하세요.")
        row.title = t[:300]

    if category_id is not None:
        row.category_id = _resolve_category_id(db, category_id)

    if user_note is not None:
        row.user_note = user_note.strip()[:2000] or None

    db.commit()
    db.refresh(row)
    return serialize_study_card(row)


def move_study_card(
    db: Session,
    card_id: int,
    *,
    category_id: int,
    sort_order: int | None = None,
) -> dict[str, Any]:
    row = db.query(StudyCard).filter(StudyCard.id == card_id).first()
    if not row:
        raise ValueError("학습 카드를 찾을 수 없습니다.")
    cat_id = _resolve_category_id(db, category_id)
    row.category_id = cat_id
    if sort_order is not None:
        row.sort_order = sort_order
    else:
        row.sort_order = _next_sort_order(db, cat_id)
    db.commit()
    db.refresh(row)
    return serialize_study_card(row)


def reorder_study_cards(db: Session, category_id: int, card_ids: list[int]) -> list[dict[str, Any]]:
    _resolve_category_id(db, category_id)
    rows = (
        db.query(StudyCard)
        .filter(StudyCard.category_id == category_id, StudyCard.id.in_(card_ids))
        .all()
    )
    by_id = {r.id: r for r in rows}
    for idx, cid in enumerate(card_ids):
        row = by_id.get(cid)
        if row:
            row.sort_order = idx
    db.commit()
    return list_study_cards(db, category_id=category_id, limit=200)


def _get_youtube_transcript(url: str) -> str | None:
    try:
        from youtube_transcript_api import YouTubeTranscriptApi
        from core.youtube_fetcher import extract_video_id

        video_id = extract_video_id(url)
        if not video_id:
            return None
        transcript = YouTubeTranscriptApi.get_transcript(video_id, languages=["ko", "en"])
        return " ".join(item["text"] for item in transcript)
    except Exception:
        return None


def run_simple_analysis(db: Session, card_id: int, *, force: bool = False) -> dict[str, Any]:
    settings = get_settings()
    if not settings.gemini_api_key:
        raise ValueError("GEMINI_API_KEY가 설정되지 않았습니다.")

    row = db.query(StudyCard).filter(StudyCard.id == card_id).first()
    if not row:
        raise ValueError("학습 카드를 찾을 수 없습니다.")
    if not row.source_url:
        raise ValueError("원본 URL이 없는 카드입니다.")

    if row.simple_analysis and row.analysis_status == "done" and not force:
        return serialize_study_card(row)

    row.analysis_status = "pending"
    db.commit()

    try:
        if row.content_id:
            content = db.query(IntelContent).filter(IntelContent.id == row.content_id).first()
            if content:
                body = (content.source_document or content.summary or "")[:8000]
                title = content.source_title or row.title
                label = content.source_type or "문서"
            else:
                title, label, body = _gather_source_body_simple(db, row)
        else:
            title, label, body = _gather_source_body_simple(db, row)

        if not body.strip():
            raise ValueError("본문을 가져올 수 없습니다.")

        client = GeminiClient(api_key=settings.gemini_api_key, model=settings.gemini_model)
        prompt = SIMPLE_ANALYSIS_PROMPT.format(
            label=label,
            title=title,
            source=row.source_url,
            body=body[:8000],
        )
        data = client.generate_json(
            prompt,
            purpose="학습 간단분석",
            system_instruction=SIMPLE_ANALYSIS_SYSTEM,
        )
        if not data:
            raise ValueError("간단 분석 생성에 실패했습니다.")

        result = {
            "summary": data.get("summary") or "",
            "key_points": data.get("key_points") or [],
            "analyzed_at": datetime.utcnow().isoformat(),
            "source_type": row.source_type,
        }
        row.simple_analysis = json.dumps(result, ensure_ascii=False)
        row.analysis_status = "done"
        if not row.summary and result["summary"]:
            row.summary = result["summary"]
        if result["key_points"] and not row.key_points:
            row.key_points = json.dumps(result["key_points"], ensure_ascii=False)
        db.commit()
        db.refresh(row)
        logger.info("간단 분석 완료 card=%s", card_id)
        return serialize_study_card(row)
    except Exception:
        row.analysis_status = "failed"
        db.commit()
        raise


def _gather_source_body_simple(db: Session, row: StudyCard) -> tuple[str, str, str]:
    url = row.source_url or ""
    title = row.source_title or row.title or ""

    if row.source_type == "YOUTUBE" and url:
        transcript = _get_youtube_transcript(url)
        if transcript:
            return title, "YouTube", transcript[:8000]
        return title, "YouTube", f"[YouTube URL]\n{url}"

    if url:
        text = fetch_web_page_text(url, max_chars=8000)
        return title, "웹페이지", text

    raise ValueError("분석할 원본 내용이 없습니다.")
