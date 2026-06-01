"""
주요 경제 일정 — Google News RSS 검색 + Gemini 날짜 추출 → 캘린더
"""
from __future__ import annotations

import json
import logging
import re
import xml.etree.ElementTree as ET
from datetime import date, datetime, timedelta, timezone
from typing import Any, Optional

import httpx
from sqlalchemy.orm import Session

from config.database import AppConfig, EconomicCalendarEvent
from config.settings import get_settings
from core.gemini_client import GeminiClient

logger = logging.getLogger(__name__)

META_KEY = "economic_calendar_sync"

SEARCH_QUERIES = (
    "경제 일정 캘린더",
    "FOMC 연준 금리 결정 일정",
    "미국 CPI PPI 고용지표 발표",
    "한국 GDP 금통위 경제지표",
    "실적발표 일정 실적 시즌",
)

SYSTEM = """당신은 경제 일정 추출 도구입니다.
제공된 뉴스·일정 기사에서만 날짜가 명시된 경제 이벤트를 추출하세요.
날짜가 불명확하거나 추측만 있는 항목은 넣지 마세요.
event_date는 반드시 YYYY-MM-DD이며 요청 기간 안이어야 합니다."""

EXTRACT_PROMPT = """추출 기간: {from_date} ~ {to_date} (이 범위 밖 날짜는 제외)

## 뉴스·일정 검색 결과
{articles_block}

JSON만 반환:
{{
  "events": [
    {{
      "event_date": "YYYY-MM-DD",
      "title": "짧은 제목 (예: FOMC 금리 결정)",
      "region": "US|KR|GLOBAL|EU|CN",
      "category": "FOMC|CPI|고용|GDP|금통위|실적|기타",
      "importance": "high|medium|low",
      "summary": "한 줄 설명",
      "source_index": 0
    }}
  ]
}}
"""


def _parse_iso(s: str) -> date:
    return datetime.strptime(s[:10], "%Y-%m-%d").date()


def _in_range(day: str, from_d: date, to_d: date) -> bool:
    try:
        d = _parse_iso(day)
        return from_d <= d <= to_d
    except ValueError:
        return False


def _month_label(from_date: str) -> str:
    d = _parse_iso(from_date)
    return f"{d.year}년 {d.month}월"


def _fetch_rss(query: str, max_items: int = 5) -> list[dict[str, str]]:
    items: list[dict[str, str]] = []
    try:
        resp = httpx.get(
            "https://news.google.com/rss/search",
            params={"q": query, "hl": "ko", "gl": "KR", "ceid": "KR:ko"},
            timeout=12,
            follow_redirects=True,
            headers={"User-Agent": "Mozilla/5.0 (compatible; StockMind/1.0)"},
        )
        resp.raise_for_status()
        root = ET.fromstring(resp.text)
        for item in root.findall(".//item")[: max_items * 2]:
            title_el = item.find("title")
            link_el = item.find("link")
            desc_el = item.find("description")
            if title_el is None or not title_el.text:
                continue
            title = title_el.text.strip()
            link = link_el.text.strip() if link_el is not None and link_el.text else ""
            snippet = ""
            if desc_el is not None and desc_el.text:
                snippet = re.sub(r"<[^>]+>", "", desc_el.text).strip()[:400]
            items.append({"title": title, "url": link, "snippet": snippet})
            if len(items) >= max_items:
                break
    except Exception as e:
        logger.warning("경제일정 RSS 실패 (%s): %s", query, e)
    return items


def fetch_economic_news(max_total: int = 28) -> list[dict[str, Any]]:
    seen: set[str] = set()
    articles: list[dict[str, Any]] = []
    month_q = _month_label(date.today().strftime("%Y-%m-%d"))
    queries = [f"{month_q} 경제 일정", *SEARCH_QUERIES]

    for query in queries:
        for raw in _fetch_rss(query, max_items=4):
            norm = re.sub(r"\s+", "", raw["title"].lower())
            if norm in seen:
                continue
            seen.add(norm)
            articles.append({
                "index": len(articles),
                "title": raw["title"],
                "url": raw.get("url") or "",
                "snippet": raw.get("snippet") or "",
            })
            if len(articles) >= max_total:
                return articles
    return articles


def _format_articles_block(articles: list[dict[str, Any]]) -> str:
    if not articles:
        return "(검색 결과 없음)"
    lines = []
    for a in articles:
        lines.append(f"[{a['index']}] {a['title']}")
        if a.get("snippet"):
            lines.append(f"    {a['snippet'][:280]}")
        if a.get("url"):
            lines.append(f"    {a['url']}")
    return "\n".join(lines)


def _load_meta(db: Session) -> dict[str, Any]:
    row = db.query(AppConfig).filter(AppConfig.key == META_KEY).first()
    if not row or not row.value:
        return {}
    try:
        return json.loads(row.value)
    except json.JSONDecodeError:
        return {}


def _save_meta(db: Session, meta: dict[str, Any]) -> None:
    payload = json.dumps(meta, ensure_ascii=False)
    row = db.query(AppConfig).filter(AppConfig.key == META_KEY).first()
    if row:
        row.value = payload
    else:
        db.add(AppConfig(key=META_KEY, value=payload))
    db.commit()


def _range_covered(meta: dict[str, Any], from_date: str, to_date: str) -> bool:
    if not meta.get("from") or not meta.get("to"):
        return False
    try:
        mf, mt = _parse_iso(meta["from"]), _parse_iso(meta["to"])
        rf, rt = _parse_iso(from_date), _parse_iso(to_date)
        return mf <= rf and mt >= rt
    except ValueError:
        return False


def _is_stale(meta: dict[str, Any], max_hours: int = 18) -> bool:
    ts = meta.get("synced_at")
    if not ts:
        return True
    try:
        synced = datetime.fromisoformat(ts.replace("Z", "+00:00"))
        if synced.tzinfo is None:
            synced = synced.replace(tzinfo=timezone.utc)
        age = datetime.now(timezone.utc) - synced
        return age > timedelta(hours=max_hours)
    except (ValueError, TypeError):
        return True


def sync_economic_calendar(
    db: Session,
    from_date: str,
    to_date: str,
    *,
    force: bool = False,
) -> dict[str, Any]:
    """기간 내 경제 일정 DB 동기화 (검색 + Gemini)."""
    from_d = _parse_iso(from_date)
    to_d = _parse_iso(to_date)
    meta = _load_meta(db)

    if not force and _range_covered(meta, from_date, to_date) and not _is_stale(meta):
        count = (
            db.query(EconomicCalendarEvent)
            .filter(
                EconomicCalendarEvent.event_date >= from_date,
                EconomicCalendarEvent.event_date <= to_date,
            )
            .count()
        )
        return {"synced": False, "count": count, "message": "최근 동기화됨"}

    settings = get_settings()
    if not settings.gemini_api_key:
        return {"synced": False, "count": 0, "message": "GEMINI_API_KEY 미설정"}

    articles = fetch_economic_news()
    if not articles:
        return {"synced": False, "count": 0, "message": "뉴스 검색 결과 없음"}

    client = GeminiClient(api_key=settings.gemini_api_key, model=settings.gemini_model)
    prompt = EXTRACT_PROMPT.format(
        from_date=from_date,
        to_date=to_date,
        articles_block=_format_articles_block(articles),
    )
    data = client.generate_json(
        prompt,
        purpose="경제 일정 추출",
        system_instruction=SYSTEM,
    )
    raw_events = (data or {}).get("events") or []

    db.query(EconomicCalendarEvent).filter(
        EconomicCalendarEvent.event_date >= from_date,
        EconomicCalendarEvent.event_date <= to_date,
    ).delete(synchronize_session=False)

    inserted = 0
    seen_titles: set[str] = set()
    for ev in raw_events:
        day = (ev.get("event_date") or "")[:10]
        title = (ev.get("title") or "").strip()
        if not day or not title or not _in_range(day, from_d, to_d):
            continue
        key = f"{day}:{title.lower()}"
        if key in seen_titles:
            continue
        seen_titles.add(key)
        idx = ev.get("source_index")
        src = articles[idx] if isinstance(idx, int) and 0 <= idx < len(articles) else None
        db.add(
            EconomicCalendarEvent(
                event_date=day,
                title=title[:400],
                region=(ev.get("region") or "GLOBAL")[:20],
                category=(ev.get("category") or "기타")[:80],
                summary=(ev.get("summary") or "")[:500] or None,
                importance=(ev.get("importance") or "medium")[:10],
                source_url=(src.get("url") if src else None),
                source_title=(src.get("title") if src else None),
            )
        )
        inserted += 1

    db.commit()
    _save_meta(
        db,
        {
            "from": from_date,
            "to": to_date,
            "synced_at": datetime.now(timezone.utc).isoformat(),
            "inserted": inserted,
        },
    )
    logger.info("경제 일정 동기화: %s~%s %s건", from_date, to_date, inserted)
    return {"synced": True, "count": inserted, "message": "ok"}


def ensure_economic_calendar_for_range(db: Session, from_date: str, to_date: str) -> None:
    """캘린더 조회 시 기간이 비어 있거나 오래되면 백그라운드성 동기화."""
    try:
        from_d = _parse_iso(from_date)
        to_d = _parse_iso(to_date)
        pad_from = (from_d - timedelta(days=7)).strftime("%Y-%m-%d")
        pad_to = (to_d + timedelta(days=14)).strftime("%Y-%m-%d")

        count = (
            db.query(EconomicCalendarEvent)
            .filter(
                EconomicCalendarEvent.event_date >= from_date,
                EconomicCalendarEvent.event_date <= to_date,
            )
            .count()
        )
        meta = _load_meta(db)
        need = count == 0 or not _range_covered(meta, pad_from, pad_to) or _is_stale(meta)
        if need:
            sync_economic_calendar(db, pad_from, pad_to, force=count == 0)
    except Exception as e:
        logger.warning("경제 일정 ensure 실패: %s", e)


def list_economic_events(db: Session, from_date: str, to_date: str) -> list[EconomicCalendarEvent]:
    return (
        db.query(EconomicCalendarEvent)
        .filter(
            EconomicCalendarEvent.event_date >= from_date,
            EconomicCalendarEvent.event_date <= to_date,
        )
        .order_by(EconomicCalendarEvent.event_date, EconomicCalendarEvent.id)
        .all()
    )
