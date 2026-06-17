"""
주식공부하기 — URL 미리보기 (YouTube / 웹페이지)
"""
from __future__ import annotations

import logging
import re
from typing import Any
from urllib.parse import urljoin, urlparse

import httpx

from config.settings import get_settings
from core.youtube_fetcher import fetch_video_metadata, is_youtube_url

logger = logging.getLogger(__name__)

_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"


def _normalize_url(url: str) -> str:
    raw = (url or "").strip()
    if not raw:
        raise ValueError("URL을 입력하세요.")
    if not re.match(r"^https?://", raw, re.I):
        raw = f"https://{raw}"
    parsed = urlparse(raw)
    if not parsed.netloc:
        raise ValueError("유효한 URL이 아닙니다.")
    return raw


def _extract_meta(html: str, prop: str) -> str:
    patterns = [
        rf'<meta\s+property="{re.escape(prop)}"\s+content="([^"]*)"',
        rf'<meta\s+content="([^"]*)"\s+property="{re.escape(prop)}"',
        rf'<meta\s+name="{re.escape(prop)}"\s+content="([^"]*)"',
    ]
    for p in patterns:
        m = re.search(p, html, re.I)
        if m:
            return m.group(1).strip()
    return ""


def _extract_title_tag(html: str) -> str:
    m = re.search(r"<title[^>]*>([^<]+)</title>", html, re.I)
    return m.group(1).strip() if m else ""


def fetch_web_page_text(url: str, *, max_chars: int = 12000) -> str:
    resp = httpx.get(url, headers={"User-Agent": _USER_AGENT}, timeout=15, follow_redirects=True)
    resp.raise_for_status()
    try:
        from bs4 import BeautifulSoup

        soup = BeautifulSoup(resp.text, "html.parser")
        for tag in soup(["script", "style", "nav", "header", "footer", "aside", "iframe"]):
            tag.decompose()
        return soup.get_text(separator="\n", strip=True)[:max_chars]
    except ImportError:
        return resp.text[:max_chars]


def preview_link(url: str) -> dict[str, Any]:
    raw = _normalize_url(url)
    settings = get_settings()

    if is_youtube_url(raw):
        meta = fetch_video_metadata(raw, api_key=settings.youtube_api_key or None)
        if not meta:
            raise ValueError("YouTube 영상 정보를 가져올 수 없습니다.")
        return {
            "source_type": "YOUTUBE",
            "url": meta["url"],
            "title": meta["title"],
            "channel_name": meta.get("channel_name") or "",
            "thumbnail": meta.get("thumbnail") or "",
            "video_id": meta.get("video_id"),
        }

    try:
        resp = httpx.get(raw, headers={"User-Agent": _USER_AGENT}, timeout=15, follow_redirects=True)
        resp.raise_for_status()
        html = resp.text
    except Exception as e:
        logger.warning("웹페이지 조회 실패 url=%s err=%s", raw, e)
        raise ValueError("웹페이지를 열 수 없습니다. URL을 확인하세요.") from e

    title = (
        _extract_meta(html, "og:title")
        or _extract_meta(html, "twitter:title")
        or _extract_title_tag(html)
        or raw
    )
    thumb = _extract_meta(html, "og:image") or _extract_meta(html, "twitter:image")
    if thumb and not thumb.startswith("http"):
        thumb = urljoin(raw, thumb)

    return {
        "source_type": "WEB",
        "url": str(resp.url),
        "title": title[:300],
        "channel_name": urlparse(str(resp.url)).netloc,
        "thumbnail": thumb[:500] if thumb else "",
        "video_id": None,
    }
