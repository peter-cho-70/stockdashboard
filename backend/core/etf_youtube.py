"""
core/etf_youtube.py
ETF 전용 유튜브 채널 등록/관리 + 영상 수집 · AI 분석(2단계)
"""
from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Any, Optional

import httpx
from sqlalchemy.orm import Session

from config.database import EtfVideoAnalysis, EtfYoutubeChannel, IntelContent
from core.etf_data import fetch_etf_rankings
from core.gemini_client import GeminiClient
from core.youtube_fetcher import YOUTUBE_API_BASE, extract_video_id, fetch_latest_videos, resolve_channel_id

logger = logging.getLogger(__name__)

MENTION_SYSTEM_PROMPT = """당신은 한국 ETF 시장을 분석하는 애널리스트입니다.
주어진 유튜브 영상 자막에서 실제로 언급된 한국 상장 ETF만 추출하세요.
종목(개별 주식) 언급은 무시하고, ETF(상장지수펀드) 언급만 다루세요.
과장하지 말고 자막에 실제로 등장한 내용만 근거로 작성하세요.
요약은 짧게 뭉뚱그리지 말고, 영상에서 다룬 논점·근거·수치·전망을 빠짐없이 풀어서 길고 꼼꼼하게 작성하세요."""


def channel_to_dict(ch: EtfYoutubeChannel) -> dict[str, Any]:
    return {
        "id": ch.id,
        "channel_id": ch.channel_id,
        "channel_name": ch.channel_name,
        "channel_url": ch.channel_url,
        "is_active": ch.is_active,
        "last_checked_at": ch.last_checked_at.isoformat() if ch.last_checked_at else None,
    }


def list_channels(db: Session) -> list[dict[str, Any]]:
    channels = (
        db.query(EtfYoutubeChannel)
        .filter(EtfYoutubeChannel.is_active == True)  # noqa: E712
        .order_by(EtfYoutubeChannel.created_at.desc())
        .all()
    )
    return [channel_to_dict(c) for c in channels]


def add_channel(db: Session, handle: str, api_key: str, custom_name: str | None = None) -> dict[str, Any]:
    info = resolve_channel_id(handle, api_key)
    if not info:
        raise ValueError(f"채널을 찾을 수 없습니다: {handle}")

    existing = db.query(EtfYoutubeChannel).filter(EtfYoutubeChannel.channel_id == info["channel_id"]).first()
    if existing:
        if existing.is_active:
            raise FileExistsError("이미 등록된 채널입니다.")
        existing.is_active = True
        existing.channel_name = custom_name or info["channel_name"] or existing.channel_name
        existing.channel_url = info["channel_url"]
        db.commit()
        db.refresh(existing)
        return channel_to_dict(existing)

    ch = EtfYoutubeChannel(
        channel_id=info["channel_id"],
        channel_name=custom_name or info["channel_name"],
        channel_url=info["channel_url"],
    )
    db.add(ch)
    db.commit()
    db.refresh(ch)
    return channel_to_dict(ch)


def remove_channel(db: Session, channel_db_id: int) -> None:
    ch = db.query(EtfYoutubeChannel).filter(EtfYoutubeChannel.id == channel_db_id).first()
    if not ch:
        raise LookupError("채널을 찾을 수 없습니다.")
    ch.is_active = False
    db.commit()


def get_channel(db: Session, channel_db_id: int) -> EtfYoutubeChannel:
    ch = db.query(EtfYoutubeChannel).filter(EtfYoutubeChannel.id == channel_db_id).first()
    if not ch:
        raise LookupError("채널을 찾을 수 없습니다.")
    return ch


def _get_transcript(url: str) -> Optional[str]:
    try:
        from youtube_transcript_api import YouTubeTranscriptApi
        import re

        m = re.search(r"(?:v=|youtu\.be/)([a-zA-Z0-9_-]{11})", url)
        if not m:
            return None
        video_id = m.group(1)
        ytt = YouTubeTranscriptApi()
        for langs in (["ko"], ["en"], ["ko", "en"]):
            try:
                fetched = ytt.fetch(video_id, languages=langs)
                text = " ".join(s.text for s in fetched)
                if text.strip():
                    return text
            except Exception:
                continue
        return None
    except Exception as e:
        logger.warning("ETF 영상 자막 추출 실패: %s", e)
        return None


def _build_etf_name_index() -> dict[str, str]:
    """ETF 이름 → 코드 매핑 (시가총액 상위권 기준, Gemini가 추출한 이름을 코드로 보강)"""
    name_to_code: dict[str, str] = {}
    try:
        for item in fetch_etf_rankings(category=0, sort="market_sum", order="desc", limit=300):
            name_to_code[item["name"]] = item["code"]
    except Exception as e:
        logger.warning("ETF 이름 인덱스 구성 실패: %s", e)
    return name_to_code


def _resolve_etf_code(name: str, name_to_code: dict[str, str]) -> Optional[str]:
    if name in name_to_code:
        return name_to_code[name]
    for full_name, code in name_to_code.items():
        if name in full_name or full_name in name:
            return code
    return None


def _build_mention_prompt(title: str, transcript: str, known_names: str) -> str:
    return f"""{MENTION_SYSTEM_PROMPT}

영상 제목: {title}

자막:
{transcript[:60000]}

실제 상장된 ETF 정식 명칭 목록 (이 중에서 골라서 답하세요. 목록에 없는 ETF가 언급됐다면 가장 가까운 정식 명칭을 적거나, 특정 ETF가 아니라 일반적인 섹터/종목 언급이면 mentioned_etfs에 포함하지 마세요):
{known_names}

아래 JSON 형식으로만 응답하세요:
{{
  "summary": "영상 전체에 대한 매우 상세한 요약 (최소 15문장 이상, 기존 3~5문장짜리 짧은 요약의 5배 이상 분량). 발언자가 다룬 시장 상황 진단, 구체적 수치·근거, 섹터별 분석, 향후 전망, 투자자에게 주는 시사점을 빠짐없이 문단으로 풀어서 작성하세요. 자막에 없는 내용은 지어내지 마세요.",
  "sentiment": "POSITIVE|NEUTRAL|NEGATIVE",
  "mentioned_etfs": [
    {{"name": "위 목록에 있는 정식 ETF 명칭", "sentiment": "POSITIVE|NEUTRAL|NEGATIVE", "reason": "이 ETF가 왜·어떤 맥락에서 언급됐는지 2~3문장으로 구체적으로 설명 (관련 수치, 발언자의 논리, 비교 대상 등 포함)"}}
  ]
}}
언급된 ETF가 없으면 mentioned_etfs를 빈 배열로 두세요."""


def _analyze_and_save_video(
    db: Session,
    video: dict[str, Any],
    *,
    channel_id: str,
    channel_name: str,
    gemini: GeminiClient,
    name_to_code: dict[str, str],
) -> Optional[dict[str, Any]]:
    transcript = _get_transcript(video["url"])
    if not transcript:
        return None

    known_names = "\n".join(sorted(name_to_code.keys()))
    prompt = _build_mention_prompt(video["title"], transcript, known_names)
    parsed = gemini.generate_json(prompt, purpose="ETF 영상 분석")
    if not parsed:
        return None

    mentioned = []
    for m in parsed.get("mentioned_etfs", []):
        name = (m.get("name") or "").strip()
        if not name:
            continue
        mentioned.append({
            "name": name,
            "code": _resolve_etf_code(name, name_to_code),
            "sentiment": m.get("sentiment"),
            "reason": m.get("reason"),
        })

    row = EtfVideoAnalysis(
        channel_id=channel_id,
        channel_name=channel_name,
        video_id=video["video_id"],
        title=video["title"],
        url=video["url"],
        published_at=video.get("published_at"),
        summary=parsed.get("summary"),
        sentiment=parsed.get("sentiment"),
        mentioned_etfs=json.dumps(mentioned, ensure_ascii=False),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return video_to_dict(row)


def analyze_latest_videos(
    db: Session,
    channel: EtfYoutubeChannel,
    *,
    youtube_api_key: str,
    gemini_api_key: str,
    gemini_model: str,
    max_results: int = 5,
) -> list[dict[str, Any]]:
    videos, _ = fetch_latest_videos(channel.channel_id, youtube_api_key, max_results=max_results)
    if not videos:
        return []

    existing_ids = {
        v.video_id
        for v in db.query(EtfVideoAnalysis.video_id)
        .filter(EtfVideoAnalysis.video_id.in_([v["video_id"] for v in videos]))
        .all()
    }
    new_videos = [v for v in videos if v["video_id"] not in existing_ids]
    if not new_videos:
        channel.last_checked_at = datetime.utcnow()
        db.commit()
        return []

    gemini = GeminiClient(api_key=gemini_api_key, model=gemini_model)
    name_to_code = _build_etf_name_index()
    results: list[dict[str, Any]] = []

    for video in new_videos:
        analyzed = _analyze_and_save_video(
            db, video, channel_id=channel.channel_id, channel_name=channel.channel_name,
            gemini=gemini, name_to_code=name_to_code,
        )
        if analyzed:
            results.append(analyzed)

    channel.last_checked_at = datetime.utcnow()
    db.commit()
    return results


def _fetch_video_owner_channel(video_id: str, api_key: str) -> Optional[dict[str, Any]]:
    """영상 ID로 제목·게시일·소속 채널 정보를 조회 (채널 미등록 단건 링크 분석용)"""
    try:
        resp = httpx.get(
            f"{YOUTUBE_API_BASE}/videos",
            params={"key": api_key, "part": "snippet", "id": video_id},
            timeout=10,
        )
        items = resp.json().get("items", [])
        if not items:
            return None
        snippet = items[0]["snippet"]
        return {
            "title": snippet.get("title", ""),
            "channel_id": snippet.get("channelId"),
            "channel_name": snippet.get("channelTitle", ""),
            "published_at": snippet.get("publishedAt"),
        }
    except Exception as e:
        logger.warning("영상 소속 채널 조회 실패: %s", e)
        return None


def analyze_video_url(
    db: Session,
    url: str,
    *,
    youtube_api_key: str,
    gemini_api_key: str,
    gemini_model: str,
    force: bool = False,
) -> dict[str, Any]:
    """채널 등록 없이 단건 YouTube 링크를 바로 분석"""
    video_id = extract_video_id(url)
    if not video_id:
        raise ValueError("올바른 YouTube 링크가 아닙니다.")

    existing = db.query(EtfVideoAnalysis).filter(EtfVideoAnalysis.video_id == video_id).first()
    if existing:
        if not force:
            return {**video_to_dict(existing), "already_analyzed": True}
        db.delete(existing)
        db.commit()

    owner = _fetch_video_owner_channel(video_id, youtube_api_key)
    if not owner or not owner.get("title"):
        raise ValueError("영상 정보를 가져올 수 없습니다.")

    video = {
        "video_id": video_id,
        "title": owner["title"],
        "url": f"https://www.youtube.com/watch?v={video_id}",
        "published_at": owner.get("published_at"),
    }

    gemini = GeminiClient(api_key=gemini_api_key, model=gemini_model)
    name_to_code = _build_etf_name_index()
    analyzed = _analyze_and_save_video(
        db, video,
        channel_id=owner.get("channel_id") or video_id,
        channel_name=owner.get("channel_name") or "알 수 없음",
        gemini=gemini, name_to_code=name_to_code,
    )
    if not analyzed:
        raise ValueError("자막을 추출할 수 없어 분석할 수 없습니다 (자막이 없는 영상일 수 있어요).")
    return analyzed


def video_to_dict(row: EtfVideoAnalysis) -> dict[str, Any]:
    return {
        "id": row.id,
        "channel_id": row.channel_id,
        "channel_name": row.channel_name,
        "video_id": row.video_id,
        "title": row.title,
        "url": row.url,
        "published_at": row.published_at,
        "summary": row.summary,
        "sentiment": row.sentiment,
        "mentioned_etfs": json.loads(row.mentioned_etfs) if row.mentioned_etfs else [],
        "analyzed_at": row.analyzed_at.isoformat() if row.analyzed_at else None,
    }


def list_link_analyzed_videos(db: Session, limit: int = 30) -> list[dict[str, Any]]:
    """채널 등록 없이 링크로 직접 분석한 영상 목록.
    현재 활성 등록 채널에 속하지 않는 EtfVideoAnalysis 행을 반환한다."""
    active_ids = {
        r.channel_id
        for r in db.query(EtfYoutubeChannel.channel_id)
        .filter(EtfYoutubeChannel.is_active == True)  # noqa: E712
        .all()
    }
    query = db.query(EtfVideoAnalysis)
    if active_ids:
        query = query.filter(EtfVideoAnalysis.channel_id.notin_(active_ids))
    rows = query.order_by(EtfVideoAnalysis.analyzed_at.desc()).limit(limit).all()
    return [video_to_dict(r) for r in rows]


def list_channel_videos(db: Session, channel_id: str, limit: int = 20) -> list[dict[str, Any]]:
    rows = (
        db.query(EtfVideoAnalysis)
        .filter(EtfVideoAnalysis.channel_id == channel_id)
        .order_by(EtfVideoAnalysis.analyzed_at.desc())
        .limit(limit)
        .all()
    )
    return [video_to_dict(r) for r in rows]


def _etf_channel_insights(db: Session, code: str, name: Optional[str], limit: int) -> list[dict[str, Any]]:
    rows = (
        db.query(EtfVideoAnalysis)
        .order_by(EtfVideoAnalysis.analyzed_at.desc())
        .limit(200)
        .all()
    )
    matches = []
    for row in rows:
        mentioned = json.loads(row.mentioned_etfs) if row.mentioned_etfs else []
        hit = next(
            (m for m in mentioned if m.get("code") == code or (name and m.get("name") == name)),
            None,
        )
        if hit:
            d = video_to_dict(row)
            d["source"] = "etf_channel"
            d["matched_reason"] = hit.get("reason")
            d["matched_sentiment"] = hit.get("sentiment")
            matches.append(d)
            if len(matches) >= limit:
                break
    return matches


def get_general_intel_mentions_for_etf(
    db: Session, code: str, name: Optional[str], limit: int = 10
) -> list[dict[str, Any]]:
    """기존 'AI 분석'(인텔리전스) 일반 채널들이 이미 분석해 둔 영상 중 이 ETF를 언급한 것을 찾는다.
    별도 ETF 프롬프트로 재분석하지 않고, 이미 저장된 요약·원문 텍스트에서 ETF 정식 명칭을 검색한다."""
    if not name:
        return []
    rows = (
        db.query(IntelContent)
        .filter(IntelContent.source_type == "YOUTUBE")
        .order_by(IntelContent.analyzed_at.desc())
        .limit(300)
        .all()
    )
    matches = []
    for row in rows:
        haystack = " ".join(filter(None, [row.summary, row.source_document, row.key_points]))
        if name not in haystack:
            continue
        matches.append({
            "id": f"intel-{row.id}",
            "channel_id": "",
            "channel_name": row.channel_name or "AI 분석",
            "video_id": "",
            "title": row.source_title or "",
            "url": row.source_url or "",
            "published_at": row.published_at.isoformat() if row.published_at else None,
            "summary": (row.summary or "")[:240],
            "sentiment": row.sentiment,
            "mentioned_etfs": [],
            "analyzed_at": row.analyzed_at.isoformat() if row.analyzed_at else None,
            "source": "general_ai",
            "matched_reason": None,
            "matched_sentiment": row.sentiment,
        })
        if len(matches) >= limit:
            break
    return matches


def get_youtube_insights_for_etf(db: Session, code: str, name: Optional[str] = None, limit: int = 20) -> list[dict[str, Any]]:
    """주어진 ETF(code/name)를 언급한 분석 영상들(ETF 전용 채널 + 일반 AI 분석)을 최신순으로 반환"""
    etf_channel = _etf_channel_insights(db, code, name, limit)
    general = get_general_intel_mentions_for_etf(db, code, name, limit)
    combined = etf_channel + general
    combined.sort(key=lambda d: d.get("analyzed_at") or "", reverse=True)
    return combined[:limit]
