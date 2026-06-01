"""분야별 뉴스 — Google News RSS + (선택) Gemini 요약."""
from __future__ import annotations

import logging
import re
import xml.etree.ElementTree as ET
from email.utils import parsedate_to_datetime
from urllib.parse import quote, unquote

import httpx
from sqlalchemy import func
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

GNEWS_RSS = "https://news.google.com/rss/search?q={query}&hl=ko&gl=KR&ceid=KR:ko"
MAX_NEWS_PER_KEYWORD = 5
MAX_KEYWORDS_PER_RUN = 4


async def fetch_domain_news(
    db: Session,
    domain_id: int,
    keywords: list[str],
    gemini_client=None,
) -> int:
    from config.database import KnowledgeNewsItem

    saved = 0
    for keyword in keywords[:MAX_KEYWORDS_PER_RUN]:
        items = await _fetch_rss(keyword)
        for item in items[:MAX_NEWS_PER_KEYWORD]:
            if _is_duplicate_url(db, item["url"]):
                continue
            summary = item.get("description", "") or ""
            if gemini_client and len(summary) > 80:
                summary = _summarize_news(gemini_client, item["title"], summary)
            news = KnowledgeNewsItem(
                domain_id=domain_id,
                title=item["title"][:298],
                url=item["url"],
                source_name=item.get("source", ""),
                published_at=item.get("published_at"),
                summary=summary[:2000] if summary else None,
            )
            db.add(news)
            try:
                db.commit()
                saved += 1
            except Exception:
                db.rollback()
    logger.info("분야 뉴스 domain_id=%s 저장 %d건", domain_id, saved)
    return saved


async def _fetch_rss(keyword: str) -> list[dict]:
    url = GNEWS_RSS.format(query=quote(keyword))
    try:
        async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
            resp = await client.get(url, headers={"User-Agent": "StockMind-NewsBot/1.0"})
            resp.raise_for_status()
            return _parse_rss_xml(resp.text)
    except Exception as e:
        logger.warning("RSS 수집 실패 (%s): %s", keyword, e)
        return []


def _parse_rss_xml(xml_text: str) -> list[dict]:
    items = []
    try:
        root = ET.fromstring(xml_text)
        channel = root.find("channel")
        if channel is None:
            return []
        for item in channel.findall("item"):
            title = _text(item, "title")
            link = _text(item, "link")
            desc = _text(item, "description")
            pub = _text(item, "pubDate")
            source_el = item.find("source")
            source = source_el.text if source_el is not None else ""
            if not title or not link:
                continue
            published_at = None
            if pub:
                try:
                    published_at = parsedate_to_datetime(pub).replace(tzinfo=None)
                except Exception:
                    pass
            clean_desc = re.sub(r"<[^>]+>", "", desc or "").strip()[:500]
            items.append({
                "title": title.strip(),
                "url": _clean_google_news_url(link),
                "description": clean_desc,
                "source": source,
                "published_at": published_at,
            })
    except ET.ParseError as e:
        logger.warning("RSS XML 파싱 오류: %s", e)
    return items


def _text(el, tag: str) -> str:
    child = el.find(tag)
    return (child.text or "").strip() if child is not None else ""


def _clean_google_news_url(url: str) -> str:
    if "news.google.com/rss/articles" in url:
        return url
    m = re.search(r"[?&]url=([^&]+)", url)
    if m:
        return unquote(m.group(1))
    return url


def _is_duplicate_url(db: Session, url: str) -> bool:
    from config.database import KnowledgeNewsItem

    return (
        db.query(KnowledgeNewsItem.id).filter(KnowledgeNewsItem.url == url).first() is not None
    )


def _summarize_news(gemini_client, title: str, description: str) -> str:
    data = gemini_client.generate_json(
        f'제목: {title}\n내용: {description[:500]}\n\nJSON: {{"summary": "1~2문장 한국어 요약"}}',
        purpose="뉴스 요약",
    )
    if data and data.get("summary"):
        return str(data["summary"]).strip()[:400]
    return description[:200]


def get_domain_news_stats(db: Session, domain_id: int) -> dict:
    from config.database import KnowledgeNewsItem

    total = (
        db.query(func.count(KnowledgeNewsItem.id))
        .filter(KnowledgeNewsItem.domain_id == domain_id)
        .scalar()
        or 0
    )
    latest = (
        db.query(KnowledgeNewsItem)
        .filter(KnowledgeNewsItem.domain_id == domain_id)
        .order_by(KnowledgeNewsItem.fetched_at.desc())
        .first()
    )
    return {
        "total_count": total,
        "latest_fetched_at": latest.fetched_at.isoformat() if latest and latest.fetched_at else None,
    }
