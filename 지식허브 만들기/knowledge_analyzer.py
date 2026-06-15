"""
core/knowledge_analyzer.py
지식 허브 전용 AI 분석 엔진

market 분석(Signal·StockIssue 생성)과 완전히 분리됩니다.
Gemini로 문서 추출 → 지식 전용 프롬프트로 분석 → DB 저장
"""
import json
import logging
import re
from datetime import datetime
from typing import Optional

from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)


# ── 프롬프트 ──────────────────────────────────────────────────────────────────

KNOWLEDGE_ANALYSIS_PROMPT = """당신은 지식 정리 전문가입니다.
아래 문서를 분석하여 학습에 유용한 형태로 JSON만 출력하세요.
(마크다운 코드블록, 설명문 없이 JSON만)

출력 항목:
1. summary       : 전체 5~7문장 요약 (한국어, 핵심 개념 중심)
2. key_points    : 기억해야 할 핵심 포인트 최대 5개 (배열)
3. keywords      : 핵심 키워드 최대 10개 (배열)
4. concepts      : 등장한 핵심 개념 정의 (배열)
                   [{"term": "HBM", "definition": "High Bandwidth Memory…"}]
5. learning_notes: 초보자도 이해할 수 있는 핵심 설명 1~2문장
6. related_topics: 더 공부하면 좋을 관련 주제 최대 3개 (배열)
7. sentiment     : 해당 분야 동향 — "POSITIVE" | "NEUTRAL" | "NEGATIVE"

⚠️ 절대 포함 금지: 주가 예측, 매수·매도 의견, Signal, 투자 권유

응답 예시:
{
  "summary": "…",
  "key_points": ["…"],
  "keywords": ["…"],
  "concepts": [{"term": "…", "definition": "…"}],
  "learning_notes": "…",
  "related_topics": ["…"],
  "sentiment": "NEUTRAL"
}
"""


# ── 헬퍼 ──────────────────────────────────────────────────────────────────────

def _extract_json(text: str) -> Optional[dict]:
    """LLM 응답에서 JSON 추출 (코드블록 제거 포함)"""
    text = text.strip()
    # ```json ... ``` 제거
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        # JSON 블록만 추출 시도
        m = re.search(r"\{.*\}", text, re.DOTALL)
        if m:
            try:
                return json.loads(m.group())
            except json.JSONDecodeError:
                pass
    return None


def _safe_json(value: Optional[list | dict]) -> str:
    return json.dumps(value or [], ensure_ascii=False)


# ── 메인 분석 함수 ─────────────────────────────────────────────────────────────

async def analyze_knowledge_content(
    document: str,
    source_type: str,
    source_url: str,
    source_title: str,
    channel_name: str,
    domain_id: int,
    db: Session,
    gemini_client=None,       # GeminiClient 인스턴스
    published_at: Optional[datetime] = None,
) -> Optional[dict]:
    """
    지식 허브 콘텐츠 분석 및 DB 저장

    Parameters:
        document     : Gemini로 추출된 문서 텍스트
        source_type  : "YOUTUBE" | "NEWS" | "TEXT"
        source_url   : 원본 URL
        source_title : 제목
        channel_name : 채널명 (YouTube일 때)
        domain_id    : 저장할 분야 ID
        db           : SQLAlchemy 세션
        gemini_client: GeminiClient (분석에 재사용)

    Returns:
        저장된 IntelContent 딕셔너리 또는 None
    """
    from config.database import IntelContent

    # ── 1. LLM 분석 ──────────────────────────────────────────────────────────
    analysis = await _run_knowledge_analysis(document, gemini_client)
    if not analysis:
        logger.error("지식 분석 실패: %s", source_url[:80])
        return None

    # ── 2. DB 저장 ───────────────────────────────────────────────────────────
    content = IntelContent(
        source_type      = source_type,
        source_url       = source_url,
        source_title     = source_title or analysis.get("summary", "")[:100],
        channel_name     = channel_name,
        published_at     = published_at,
        source_document  = document,
        # 지식 허브 전용 스코프
        content_scope    = "knowledge",
        domain_id        = domain_id,
        # 공통 분석 결과
        summary          = analysis.get("summary", ""),
        key_points       = _safe_json(analysis.get("key_points")),
        keywords         = _safe_json(analysis.get("keywords")),
        sentiment        = analysis.get("sentiment", "NEUTRAL"),
        # 지식 전용 필드
        concepts         = _safe_json(analysis.get("concepts")),
        learning_notes   = analysis.get("learning_notes", ""),
        related_topics   = _safe_json(analysis.get("related_topics")),
        analyzed_at      = datetime.utcnow(),
    )
    db.add(content)
    db.commit()
    db.refresh(content)

    logger.info(
        "✅ 지식 콘텐츠 저장: id=%d domain=%d '%s'",
        content.id, domain_id, source_title[:40],
    )
    return _serialize_content(content)


async def _run_knowledge_analysis(
    document: str,
    gemini_client=None,
) -> Optional[dict]:
    """Gemini로 지식 분석 실행 (fallback: 직접 REST 호출)"""
    prompt = KNOWLEDGE_ANALYSIS_PROMPT + f"\n\n[문서]\n{document[:15000]}"

    # ① GeminiClient 사용 (기존 코드 재활용)
    if gemini_client:
        try:
            result = await gemini_client.generate(prompt)
            return _extract_json(result)
        except Exception as e:
            logger.warning("GeminiClient 분석 실패: %s", e)

    # ② 직접 REST 호출 (fallback)
    try:
        import httpx
        from config.settings import get_settings
        s = get_settings()
        if not s.gemini_api_key:
            return None

        url = (
            f"https://generativelanguage.googleapis.com/v1beta/models/"
            f"{s.gemini_model}:generateContent?key={s.gemini_api_key}"
        )
        body = {"contents": [{"parts": [{"text": prompt}]}]}
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(url, json=body)
            resp.raise_for_status()
            data = resp.json()
            text = (
                data.get("candidates", [{}])[0]
                .get("content", {})
                .get("parts", [{}])[0]
                .get("text", "")
            )
            return _extract_json(text)
    except Exception as e:
        logger.error("Gemini REST 분석 실패: %s", e)
        return None


# ── 직렬화 ────────────────────────────────────────────────────────────────────

def _serialize_content(content) -> dict:
    def _j(v):
        if not v:
            return []
        try:
            return json.loads(v)
        except Exception:
            return []

    return {
        "id":             content.id,
        "source_type":    content.source_type,
        "source_url":     content.source_url,
        "source_title":   content.source_title,
        "channel_name":   content.channel_name,
        "content_scope":  content.content_scope,
        "domain_id":      content.domain_id,
        "summary":        content.summary,
        "key_points":     _j(content.key_points),
        "keywords":       _j(content.keywords),
        "concepts":       _j(getattr(content, "concepts", None)),
        "learning_notes": getattr(content, "learning_notes", ""),
        "related_topics": _j(getattr(content, "related_topics", None)),
        "sentiment":      content.sentiment,
        "is_bookmarked":  getattr(content, "is_bookmarked", False),
        "is_read":        getattr(content, "is_read", False),
        "analyzed_at":    content.analyzed_at.isoformat() if content.analyzed_at else None,
        "created_at":     content.created_at.isoformat() if content.created_at else None,
        "published_at":   content.published_at.isoformat() if content.published_at else None,
    }


# ── YouTube URL → 지식 분석 원스톱 함수 ─────────────────────────────────────

async def analyze_youtube_as_knowledge(
    youtube_url: str,
    domain_id: int,
    channel_name: str,
    db: Session,
    gemini_client=None,
) -> Optional[dict]:
    """
    YouTube URL을 받아 Gemini로 문서 추출 → 지식 분석 → 저장

    기존 routes_youtube.py의 분석 흐름을 knowledge 전용으로 래핑.
    """
    # Gemini로 문서 추출 (기존 gemini_client 재활용)
    document = ""
    title = ""
    published_at = None

    if gemini_client:
        try:
            extracted = await gemini_client.extract_youtube(youtube_url)
            document = extracted.get("document", "")
            title = extracted.get("title", "")
        except Exception as e:
            logger.error("YouTube 문서 추출 실패: %s", e)
            return None
    else:
        logger.error("GeminiClient 없음 — YouTube 추출 불가")
        return None

    if not document:
        logger.error("추출된 문서 없음: %s", youtube_url)
        return None

    return await analyze_knowledge_content(
        document     = document,
        source_type  = "YOUTUBE",
        source_url   = youtube_url,
        source_title = title,
        channel_name = channel_name,
        domain_id    = domain_id,
        db           = db,
        gemini_client= gemini_client,
        published_at = published_at,
    )
