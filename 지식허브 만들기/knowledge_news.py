"""
core/knowledge_news.py
분야별 뉴스 자동 수집 — Google News RSS + AI 요약 + 중복 제거

스케줄러(scheduler/knowledge_jobs.py)에서 호출하거나,
API 엔드포인트에서 수동 트리거로 사용합니다.
"""
import hashlib
import json
import logging
import re
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from typing import Optional
from urllib.parse import quote

import httpx
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

# Google News RSS 기본 URL (한국어, 한국 리전)
GNEWS_RSS = "https://news.google.com/rss/search?q={query}&hl=ko&gl=KR&ceid=KR:ko"
MAX_NEWS_PER_KEYWORD = 5   # 키워드당 최대 수집 건수
MAX_KEYWORDS_PER_RUN = 4   # 1회 실행당 사용할 키워드 수


# ── 메인 수집 함수 ─────────────────────────────────────────────────────────────

async def fetch_domain_news(
    db: Session,
    domain_id: int,
    keywords: list[str],
    gemini_client=None,
) -> int:
    """
    분야 키워드로 Google News RSS 수집 → DB 저장

    Parameters:
        db           : SQLAlchemy 세션
        domain_id    : 저장할 분야 ID
        keywords     : 검색 키워드 목록
        gemini_client: AI 요약용 (없으면 RSS description 사용)

    Returns:
        저장된 뉴스 건수
    """
    from config.database import KnowledgeNewsItem  # 모델은 database.py에 추가됨

    saved = 0
    used_keywords = keywords[:MAX_KEYWORDS_PER_RUN]

    for keyword in used_keywords:
        items = await _fetch_rss(keyword)
        for item in items[:MAX_NEWS_PER_KEYWORD]:
            # 중복 URL 체크
            if _is_duplicate_url(db, item["url"]):
                continue

            # AI 요약 (없으면 RSS description 그대로)
            summary = item.get("description", "")
            if gemini_client and len(summary) > 100:
                summary = await _summarize_news(
                    gemini_client,
                    item["title"],
                    item.get("description", ""),
                )

            news = KnowledgeNewsItem(
                domain_id    = domain_id,
                title        = item["title"][:298],
                url          = item["url"],
                source_name  = item.get("source", ""),
                published_at = item.get("published_at"),
                summary      = summary,
            )
            db.add(news)
            try:
                db.commit()
                saved += 1
            except Exception:
                db.rollback()   # url UNIQUE 제약 충돌 등

    logger.info(
        "✅ 분야 뉴스 수집 완료: domain_id=%d 키워드=%d개 저장=%d건",
        domain_id, len(used_keywords), saved,
    )
    return saved


# ── RSS 파싱 ──────────────────────────────────────────────────────────────────

async def _fetch_rss(keyword: str) -> list[dict]:
    """Google News RSS → 파싱된 뉴스 목록"""
    url = GNEWS_RSS.format(query=quote(keyword))
    try:
        async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
            headers = {"User-Agent": "StockMind-NewsBot/1.0"}
            resp = await client.get(url, headers=headers)
            resp.raise_for_status()
            return _parse_rss_xml(resp.text)
    except Exception as e:
        logger.warning("RSS 수집 실패 (%s): %s", keyword, e)
        return []


def _parse_rss_xml(xml_text: str) -> list[dict]:
    """RSS XML → 뉴스 아이템 목록"""
    items = []
    try:
        root = ET.fromstring(xml_text)
        channel = root.find("channel")
        if channel is None:
            return []

        for item in channel.findall("item"):
            title = _text(item, "title")
            link  = _text(item, "link")
            desc  = _text(item, "description")
            pub   = _text(item, "pubDate")
            source_el = item.find("source")
            source = source_el.text if source_el is not None else ""

            if not title or not link:
                continue

            # Google News 리디렉션 URL 정리
            clean_url = _clean_google_news_url(link)

            published_at = None
            if pub:
                try:
                    published_at = parsedate_to_datetime(pub).replace(tzinfo=None)
                except Exception:
                    pass

            # HTML 태그 제거
            clean_desc = re.sub(r"<[^>]+>", "", desc or "").strip()[:500]

            items.append({
                "title":        title.strip(),
                "url":          clean_url,
                "description":  clean_desc,
                "source":       source,
                "published_at": published_at,
            })
    except ET.ParseError as e:
        logger.warning("RSS XML 파싱 오류: %s", e)

    return items


def _text(el, tag: str) -> str:
    child = el.find(tag)
    return (child.text or "").strip() if child is not None else ""


def _clean_google_news_url(url: str) -> str:
    """Google News 리디렉션 URL에서 원본 URL 추출 시도"""
    # https://news.google.com/rss/articles/... 형태는 그대로
    if "news.google.com/rss/articles" in url:
        return url
    # ?url= 파라미터 추출
    m = re.search(r"[?&]url=([^&]+)", url)
    if m:
        from urllib.parse import unquote
        return unquote(m.group(1))
    return url


# ── 중복 제거 ─────────────────────────────────────────────────────────────────

def _is_duplicate_url(db: Session, url: str) -> bool:
    """URL 중복 여부 확인"""
    from config.database import KnowledgeNewsItem
    exists = db.query(KnowledgeNewsItem.id).filter(
        KnowledgeNewsItem.url == url
    ).first()
    return exists is not None


def _url_fingerprint(url: str) -> str:
    """URL 정규화 후 해시 (파라미터 순서 무관 중복 제거)"""
    # 쿼리스트링 제거 후 소문자
    base = re.sub(r"\?.*", "", url).lower().rstrip("/")
    return hashlib.md5(base.encode()).hexdigest()


# ── AI 요약 ───────────────────────────────────────────────────────────────────

async def _summarize_news(gemini_client, title: str, description: str) -> str:
    """뉴스 제목 + 설명 → 1~2문장 AI 요약"""
    prompt = (
        f"다음 뉴스 기사를 1~2문장으로 핵심만 한국어로 요약하세요.\n"
        f"제목: {title}\n내용: {description[:500]}\n\n요약:"
    )
    try:
        result = await gemini_client.generate(prompt)
        return result.strip()[:400]
    except Exception as e:
        logger.warning("뉴스 AI 요약 실패: %s", e)
        return description[:200]


# ── 통계 헬퍼 ─────────────────────────────────────────────────────────────────

def get_domain_news_stats(db: Session, domain_id: int) -> dict:
    """분야 뉴스 통계 반환"""
    from config.database import KnowledgeNewsItem
    from sqlalchemy import func

    total = db.query(func.count(KnowledgeNewsItem.id)).filter(
        KnowledgeNewsItem.domain_id == domain_id
    ).scalar()

    latest = db.query(KnowledgeNewsItem).filter(
        KnowledgeNewsItem.domain_id == domain_id
    ).order_by(KnowledgeNewsItem.fetched_at.desc()).first()

    return {
        "total_count": total or 0,
        "latest_fetched_at": (
            latest.fetched_at.isoformat() if latest and latest.fetched_at else None
        ),
    }
