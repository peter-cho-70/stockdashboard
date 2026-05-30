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


def _extract_video_id(url: str) -> Optional[str]:
    patterns = [
        r"(?:v=|youtu\.be/)([a-zA-Z0-9_-]{11})",
        r"(?:embed/)([a-zA-Z0-9_-]{11})",
    ]
    for p in patterns:
        m = re.search(p, url)
        if m:
            return m.group(1)
    return None


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


def fetch_latest_videos(channel_id: str, api_key: str, max_results: int = 10) -> list[dict]:
    """
    채널의 최신 영상 목록 반환
    반환: [{"video_id", "title", "description", "published_at", "thumbnail", "url"}]
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
            return []

        uploads_id = items[0]["contentDetails"]["relatedPlaylists"]["uploads"]

        # 업로드 재생목록에서 최신 영상 조회
        pl_resp = httpx.get(
            f"{YOUTUBE_API_BASE}/playlistItems",
            params={
                "key": api_key,
                "part": "snippet",
                "playlistId": uploads_id,
                "maxResults": max_results,
            },
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
        return videos

    except Exception as e:
        logger.error(f"영상 목록 조회 실패: {e}")
        return []
