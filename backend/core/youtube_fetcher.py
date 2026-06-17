"""
core/youtube_fetcher.py
YouTube Data API v3 기반 채널/영상 수집
"""
import logging
import re
from typing import Optional
import httpx

logger = logging.getLogger(__name__)

YOUTUBE_API_BASE = "https://www.googleapis.com/youtube/v3"


def extract_video_id(url: str) -> Optional[str]:
    patterns = [
        r"(?:v=|youtu\.be/)([a-zA-Z0-9_-]{11})",
        r"(?:embed/)([a-zA-Z0-9_-]{11})",
        r"(?:shorts/)([a-zA-Z0-9_-]{11})",
    ]
    for p in patterns:
        m = re.search(p, url)
        if m:
            return m.group(1)
    return None


_extract_video_id = extract_video_id


def is_youtube_url(url: str) -> bool:
    u = (url or "").strip().lower()
    return "youtube.com" in u or "youtu.be" in u


def fetch_video_metadata(url: str, api_key: str | None = None) -> Optional[dict]:
    """
    YouTube URL에서 제목·채널·썸네일 등 메타데이터 조회.
    oEmbed 우선 (API 키 불필요), 키가 있으면 Data API로 published_at 보강.
    """
    video_id = extract_video_id(url)
    if not video_id:
        return None

    canonical_url = f"https://www.youtube.com/watch?v={video_id}"
    meta: dict = {
        "video_id": video_id,
        "url": canonical_url,
        "title": "",
        "channel_name": "",
        "thumbnail": f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg",
        "published_at": "",
    }

    try:
        resp = httpx.get(
            "https://www.youtube.com/oembed",
            params={"url": canonical_url, "format": "json"},
            timeout=8,
        )
        if resp.status_code == 200:
            data = resp.json()
            meta["title"] = (data.get("title") or "").strip()
            meta["channel_name"] = (data.get("author_name") or "").strip()
            thumb = data.get("thumbnail_url")
            if thumb:
                meta["thumbnail"] = thumb
    except Exception as e:
        logger.warning("YouTube oEmbed 조회 실패: %s", e)

    if api_key:
        try:
            resp = httpx.get(
                f"{YOUTUBE_API_BASE}/videos",
                params={
                    "key": api_key,
                    "part": "snippet",
                    "id": video_id,
                },
                timeout=8,
            )
            items = resp.json().get("items", [])
            if items:
                snippet = items[0].get("snippet", {})
                meta["title"] = (snippet.get("title") or meta["title"] or "").strip()
                meta["channel_name"] = (snippet.get("channelTitle") or meta["channel_name"] or "").strip()
                thumbs = snippet.get("thumbnails", {})
                for key in ("medium", "high", "default"):
                    if thumbs.get(key, {}).get("url"):
                        meta["thumbnail"] = thumbs[key]["url"]
                        break
                meta["published_at"] = snippet.get("publishedAt") or ""
        except Exception as e:
            logger.warning("YouTube Data API 조회 실패: %s", e)

    if not meta["title"]:
        return None
    return meta


def resolve_channel_id(handle_or_id: str, api_key: str) -> Optional[dict]:
    """
    채널 핸들(@3protv), URL, 채널ID 등을 받아서
    실제 channel_id, channel_name, channel_url 반환
    """
    # 이미 UC로 시작하는 채널ID면 바로 조회
    raw = handle_or_id.strip().lstrip("@")

    # forHandle 검색 (핸들 방식 @3protv)
    try:
        resp = httpx.get(
            f"{YOUTUBE_API_BASE}/channels",
            params={
                "key": api_key,
                "part": "id,snippet",
                "forHandle": raw,
            },
            timeout=10,
        )
        data = resp.json()
        items = data.get("items", [])
        if items:
            item = items[0]
            return {
                "channel_id": item["id"],
                "channel_name": item["snippet"]["title"],
                "channel_url": f"https://www.youtube.com/@{raw}",
            }
    except Exception as e:
        logger.warning(f"forHandle 조회 실패: {e}")

    # forUsername 검색 (구형 채널)
    try:
        resp = httpx.get(
            f"{YOUTUBE_API_BASE}/channels",
            params={
                "key": api_key,
                "part": "id,snippet",
                "forUsername": raw,
            },
            timeout=10,
        )
        data = resp.json()
        items = data.get("items", [])
        if items:
            item = items[0]
            return {
                "channel_id": item["id"],
                "channel_name": item["snippet"]["title"],
                "channel_url": f"https://www.youtube.com/user/{raw}",
            }
    except Exception as e:
        logger.warning(f"forUsername 조회 실패: {e}")

    # 직접 채널 ID로 조회
    try:
        resp = httpx.get(
            f"{YOUTUBE_API_BASE}/channels",
            params={
                "key": api_key,
                "part": "id,snippet",
                "id": raw,
            },
            timeout=10,
        )
        data = resp.json()
        items = data.get("items", [])
        if items:
            item = items[0]
            return {
                "channel_id": item["id"],
                "channel_name": item["snippet"]["title"],
                "channel_url": f"https://www.youtube.com/channel/{item['id']}",
            }
    except Exception as e:
        logger.warning(f"채널ID 직접 조회 실패: {e}")

    return None


def fetch_latest_videos(
    channel_id: str,
    api_key: str,
    max_results: int = 10,
    page_token: Optional[str] = None,
) -> tuple[list[dict], Optional[str]]:
    """
    채널의 최신 영상 목록 반환
    반환: (videos, next_page_token)
    """
    try:
        # 채널의 uploads 재생목록 ID 조회
        ch_resp = httpx.get(
            f"{YOUTUBE_API_BASE}/channels",
            params={
                "key": api_key,
                "part": "contentDetails",
                "id": channel_id,
            },
            timeout=10,
        )
        ch_data = ch_resp.json()
        items = ch_data.get("items", [])
        if not items:
            logger.error(f"채널 정보 없음: {channel_id}")
            return [], None

        uploads_id = items[0]["contentDetails"]["relatedPlaylists"]["uploads"]

        params: dict = {
            "key": api_key,
            "part": "snippet",
            "playlistId": uploads_id,
            "maxResults": max(1, min(max_results, 50)),
        }
        if page_token:
            params["pageToken"] = page_token

        pl_resp = httpx.get(
            f"{YOUTUBE_API_BASE}/playlistItems",
            params=params,
            timeout=10,
        )
        pl_data = pl_resp.json()

        videos = []
        for item in pl_data.get("items", []):
            snippet = item["snippet"]
            vid_id = snippet["resourceId"]["videoId"]
            videos.append({
                "video_id": vid_id,
                "title": snippet.get("title", ""),
                "description": snippet.get("description", "")[:500],
                "published_at": snippet.get("publishedAt", ""),
                "thumbnail": snippet.get("thumbnails", {}).get("medium", {}).get("url", ""),
                "url": f"https://www.youtube.com/watch?v={vid_id}",
            })
        return videos, pl_data.get("nextPageToken")

    except Exception as e:
        logger.error(f"영상 목록 조회 실패: {e}")
        return [], None
