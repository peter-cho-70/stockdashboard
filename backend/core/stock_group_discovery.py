"""
core/stock_group_discovery.py
관계 묶어보기 — 종목 그룹에 추가할 "관련 종목" 후보 검색
  1) co_mention: 기존 AI 분석(영상·뉴스)에서 같은 콘텐츠에 함께 언급된 종목 (비용 없음, recommendations.py 재사용)
  2) news_search: 구글 뉴스 RSS + Gemini로 "OO 관련주"를 새로 검색·추출 (co_mention이 부족할 때 보강)
"""
from __future__ import annotations

import html
import logging
import re
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta
from typing import Any, Optional

import httpx
from sqlalchemy import or_
from sqlalchemy.orm import Session

from config.database import IntelContent, Stock, StockGroup, StockSignal
from config.settings import get_settings
from core.gemini_client import GeminiClient
from core.recommendations import get_co_mentioned_stocks
from core.stock_resolver import resolve_symbol

logger = logging.getLogger(__name__)

NEWS_SEARCH_QUERIES = ["{name} 관련주", "{name} 동반 강세 테마"]
NEWS_MAX_PER_QUERY = 5
DISCOVERY_MAX_CANDIDATES = 10

DISCOVERY_SYSTEM = """당신은 한국 증시 테마주·관련주를 찾는 애널리스트입니다.
제공된 뉴스 제목·요약만 근거로 판단하고, 뉴스에 없는 사실은 만들지 마세요.
실제 한국거래소(KRX)에 상장된 종목명만 사용하세요. 확신이 없으면 포함하지 마세요.
기준 종목 자신은 결과에 포함하지 마세요."""

DISCOVERY_PROMPT = """기준 종목: {name}

뉴스 목록:
{articles_block}

위 뉴스에서 "{name}"와 함께 묶여 언급되는(공급망·경쟁사·동반 등락 등) 한국 상장 종목을 최대 {max_n}개 찾아 JSON으로 반환하세요.
명확한 관련 종목이 없으면 빈 배열을 반환하세요.

JSON 형식:
{{
  "related_stocks": [
    {{"name": "삼성전기", "reason": "10단어 이내 이유"}}
  ]
}}
"""


def _fetch_rss_query(query: str, max_per_query: int = NEWS_MAX_PER_QUERY) -> list[dict[str, str]]:
    items: list[dict[str, str]] = []
    try:
        resp = httpx.get(
            "https://news.google.com/rss/search",
            params={"q": f"{query} when:14d", "hl": "ko", "gl": "KR", "ceid": "KR:ko"},
            timeout=12,
            follow_redirects=True,
            headers={"User-Agent": "Mozilla/5.0 (compatible; StockMind/1.0)"},
        )
        resp.raise_for_status()
        root = ET.fromstring(resp.text)
        for item in root.findall(".//item")[:max_per_query]:
            title_el = item.find("title")
            if title_el is None or not title_el.text:
                continue
            link_el = item.find("link")
            pub_el = item.find("pubDate")
            desc_el = item.find("description")
            snippet = ""
            if desc_el is not None and desc_el.text:
                snippet = html.unescape(re.sub(r"<[^>]+>", "", desc_el.text)).strip()[:300]
            items.append({
                "title": html.unescape(title_el.text).strip(),
                "snippet": snippet,
                "url": link_el.text.strip() if link_el is not None and link_el.text else "",
                "published": pub_el.text.strip() if pub_el is not None and pub_el.text else "",
            })
    except Exception as e:
        logger.warning("관련주 뉴스 검색 실패 (%s): %s", query, e)
    return items


def _format_articles_block(articles: list[dict[str, str]]) -> str:
    if not articles:
        return "(검색 결과 없음)"
    lines = []
    for i, a in enumerate(articles):
        lines.append(f"[{i}] {a['title']}")
        if a.get("snippet"):
            lines.append(f"    {a['snippet']}")
    return "\n".join(lines)


def _discover_from_news(db: Session, name: str, exclude_symbols: set[str]) -> list[dict[str, Any]]:
    settings = get_settings()
    if not settings.gemini_api_key:
        return []

    articles: list[dict[str, str]] = []
    seen_titles: set[str] = set()
    for q_template in NEWS_SEARCH_QUERIES:
        for a in _fetch_rss_query(q_template.format(name=name)):
            norm = re.sub(r"\s+", "", a["title"].lower())
            if norm in seen_titles:
                continue
            seen_titles.add(norm)
            articles.append(a)
    if not articles:
        return []

    client = GeminiClient(api_key=settings.gemini_api_key, model=settings.gemini_model)
    prompt = DISCOVERY_PROMPT.format(
        name=name,
        articles_block=_format_articles_block(articles),
        max_n=DISCOVERY_MAX_CANDIDATES,
    )
    try:
        data = client.generate_json(prompt, purpose="관련 종목 검색", system_instruction=DISCOVERY_SYSTEM)
    except Exception as e:
        logger.warning("관련 종목 AI 추출 실패: %s", e)
        return []

    result: list[dict[str, Any]] = []
    seen_syms: set[str] = set()
    for item in (data or {}).get("related_stocks") or []:
        if not isinstance(item, dict):
            continue
        cand_name = str(item.get("name") or "").strip()
        if not cand_name:
            continue
        sym = resolve_symbol(cand_name, db)
        if not sym or sym in exclude_symbols or sym in seen_syms:
            continue
        seen_syms.add(sym)
        stock = db.query(Stock).filter(Stock.symbol == sym).first()
        result.append({
            "symbol": sym,
            "name": stock.name if stock else cand_name,
            "current_price": stock.current_price if stock else None,
            "change_rate": round(stock.change_rate, 2) if stock and stock.change_rate else None,
            "is_holding": bool(stock and stock.qty and stock.qty > 0 and stock.is_active),
            "source": "news_search",
            "reason": str(item.get("reason") or "").strip()[:80] or None,
        })
        if len(result) >= DISCOVERY_MAX_CANDIDATES:
            break
    return result


def discover_related_stocks(
    db: Session, query: str, *, days: int = 180, limit: int = 10
) -> dict[str, Any]:
    """종목명/코드를 입력받아 그룹에 추가할 관련 종목 후보를 찾는다.
    1) co_mention(무료, 기존 AI 분석 재사용) → 부족하면 2) news_search(Gemini)로 보강."""
    query = (query or "").strip()
    if not query:
        return {"query": query, "base_symbol": None, "base_name": None, "candidates": []}

    symbol = query if re.fullmatch(r"\d{6}", query) else resolve_symbol(query, db)
    base_stock = db.query(Stock).filter(Stock.symbol == symbol).first() if symbol else None
    base_name = base_stock.name if base_stock else query
    exclude = {symbol} if symbol else set()

    candidates: list[dict[str, Any]] = []
    if base_stock:
        peers = get_co_mentioned_stocks(db, base_stock, days=days, limit=limit)
        for p in peers:
            p["source"] = "co_mention"
            p["reason"] = f"최근 {days}일 내 {p['mention_count']}건 함께 언급됨"
        candidates.extend(peers)
        exclude |= {c["symbol"] for c in candidates if c.get("symbol")}

    if len(candidates) < limit:
        candidates.extend(_discover_from_news(db, base_name, exclude)[: limit - len(candidates)])

    return {
        "query": query,
        "base_symbol": symbol,
        "base_name": base_name,
        "candidates": candidates[:limit],
    }


def get_group_related_content(
    db: Session, group: StockGroup, *, days: int = 180, limit: int = 30
) -> list[dict[str, Any]]:
    """그룹 멤버 중 하나라도 언급된 AI 분석 콘텐츠(유튜브·뉴스) 목록 — StockSignal 기준(보유 여부 무관)."""
    member_symbols = {m.symbol for m in group.members if m.symbol}
    member_names = {m.stock_name for m in group.members if m.stock_name}
    if not member_symbols and not member_names:
        return []

    since = (datetime.utcnow() - timedelta(days=days)).strftime("%Y-%m-%d")
    conditions = []
    if member_symbols:
        conditions.append(StockSignal.symbol.in_(member_symbols))
    if member_names:
        conditions.append(StockSignal.stock_name.in_(member_names))

    rows = (
        db.query(StockSignal)
        .filter(StockSignal.event_date >= since)
        .filter(or_(*conditions))
        .all()
    )
    if not rows:
        return []

    content_matches: dict[int, set[str]] = {}
    for r in rows:
        content_matches.setdefault(r.content_id, set()).add(r.stock_name)

    contents = (
        db.query(IntelContent)
        .filter(IntelContent.id.in_(content_matches.keys()))
        .order_by(IntelContent.analyzed_at.desc())
        .limit(limit)
        .all()
    )

    return [
        {
            "id": c.id,
            "source_type": c.source_type,
            "source_url": c.source_url,
            "source_title": c.source_title,
            "channel_name": c.channel_name,
            "published_at": c.published_at.isoformat() if c.published_at else None,
            "analyzed_at": c.analyzed_at.isoformat() if c.analyzed_at else None,
            "summary": (c.summary or "")[:240],
            "sentiment": c.sentiment,
            "matched_members": sorted(content_matches.get(c.id, [])),
        }
        for c in contents
    ]


def get_group_live_news(group: StockGroup, *, limit: int = 6) -> list[dict[str, Any]]:
    """그룹 대표 종목명으로 실시간 뉴스 검색 (AI 분석 콘텐츠가 부족할 때 보강)."""
    if not group.members:
        return []
    primary = group.members[0].stock_name or group.members[0].symbol
    if not primary:
        return []
    return _fetch_rss_query(f"{primary} 관련주", max_per_query=limit)
