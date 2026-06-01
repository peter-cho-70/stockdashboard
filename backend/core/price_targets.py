"""
증권사·애널리스트 목표가 — Google News RSS 검색 + 기사 근거 추출
"""
from __future__ import annotations

import json
import logging
import re
import xml.etree.ElementTree as ET
from typing import Any, Optional

import httpx
from sqlalchemy.orm import Session

from config.database import Stock, StockPriceTarget
from config.settings import get_settings
from core.gemini_client import GeminiClient

logger = logging.getLogger(__name__)

TARGET_KEYWORDS = ("목표가", "목표주가", "투자의견", "목표주", "컨센서스", "리포트")

TARGET_SYSTEM = """당신은 뉴스 기사에서 목표가·투자의견만 추출하는 도구입니다.
제공된 기사 목록에 없는 수치·증권사·날짜는 절대 만들지 마세요.
기사 제목/설명에 목표가가 명확하지 않으면 해당 항목은 targets에 넣지 마세요.
각 target은 반드시 source_index로 근거 기사를 지정하세요."""

TARGET_EXTRACT_PROMPT = """종목: {name} (코드 {symbol})
현재가(참고): {current_price}

아래는 Google 뉴스 검색 결과입니다. 기사에 실제로 적힌 목표가·투자의견만 추출하세요.

{articles_block}

반환 JSON (이 형식만):
{{
  "targets": [
    {{
      "source_index": 0,
      "source": "증권사명 (기사에서 확인된 이름만)",
      "analyst": "애널리스트명 또는 null",
      "target_price": number,
      "rating": "매수|중립|매도|null",
      "report_date": "YYYY-MM-DD 또는 null",
      "evidence": "기사에서 목표가를 뽑은 짧은 인용(10자 이내)"
    }}
  ],
  "disclaimer": "한 줄 (검색 기사 기반임을 명시)"
}}
"""


def _resolve_stock_name(db: Session, symbol: str) -> tuple[str, Optional[int], float]:
    stock = db.query(Stock).filter(Stock.symbol == symbol).first()
    if stock:
        return stock.name, stock.id, float(stock.current_price or 0)
    return symbol, None, 0.0


def _fetch_target_news(stock_name: str, symbol: str, max_items: int = 20) -> list[dict[str, str]]:
    """목표가 관련 뉴스 RSS 수집."""
    queries = [
        f"{stock_name} 목표가",
        f"{stock_name} 투자의견",
        f"{stock_name} {symbol} 목표주가",
        f"{stock_name} 증권사 리포트",
    ]
    seen: set[str] = set()
    items: list[dict[str, str]] = []

    for q in queries:
        if len(items) >= max_items:
            break
        try:
            resp = httpx.get(
                "https://news.google.com/rss/search",
                params={"q": q, "hl": "ko", "gl": "KR", "ceid": "KR:ko"},
                timeout=12,
                follow_redirects=True,
                headers={"User-Agent": "Mozilla/5.0 (compatible; StockMind/1.0)"},
            )
            resp.raise_for_status()
            root = ET.fromstring(resp.text)
            for item in root.findall(".//item"):
                title_el = item.find("title")
                link_el = item.find("link")
                desc_el = item.find("description")
                if title_el is None or not title_el.text:
                    continue
                title = title_el.text.strip()
                norm = re.sub(r"\s+", "", title.lower())
                if norm in seen:
                    continue
                if not any(kw in title for kw in TARGET_KEYWORDS):
                    desc_text = ""
                    if desc_el is not None and desc_el.text:
                        desc_text = re.sub(r"<[^>]+>", "", desc_el.text)
                    if not any(kw in desc_text for kw in TARGET_KEYWORDS):
                        continue
                seen.add(norm)
                link = link_el.text.strip() if link_el is not None and link_el.text else ""
                pub_el = item.find("pubDate")
                pub = pub_el.text.strip() if pub_el is not None and pub_el.text else ""
                snippet = ""
                if desc_el is not None and desc_el.text:
                    snippet = re.sub(r"<[^>]+>", "", desc_el.text).strip()[:400]
                items.append({
                    "title": title,
                    "url": link,
                    "published": pub,
                    "snippet": snippet,
                })
                if len(items) >= max_items:
                    return items
        except Exception as e:
            logger.warning("목표가 뉴스 RSS 실패 (%s): %s", q, e)
    return items


def _format_articles_block(articles: list[dict[str, str]]) -> str:
    if not articles:
        return "(관련 기사 없음 — targets는 빈 배열로 반환)"
    lines = []
    for i, a in enumerate(articles):
        lines.append(f"[{i}] 제목: {a['title']}")
        if a.get("published"):
            lines.append(f"    발행: {a['published']}")
        if a.get("snippet"):
            lines.append(f"    요약: {a['snippet']}")
        if a.get("url"):
            lines.append(f"    URL: {a['url']}")
    return "\n".join(lines)


def serialize_target(row: StockPriceTarget) -> dict[str, Any]:
    return {
        "id": row.id,
        "symbol": row.symbol,
        "source": row.source,
        "analyst": row.analyst,
        "target_price": row.target_price,
        "rating": row.rating,
        "report_date": row.report_date,
        "currency": row.currency,
        "is_consensus": row.is_consensus,
        "source_url": row.source_url,
        "source_title": row.source_title,
        "notes": row.notes,
        "fetched_at": row.fetched_at.isoformat() if row.fetched_at else None,
    }


def list_price_targets(db: Session, symbol: str) -> list[dict[str, Any]]:
    rows = (
        db.query(StockPriceTarget)
        .filter(StockPriceTarget.symbol == symbol)
        .order_by(StockPriceTarget.is_consensus.desc(), StockPriceTarget.target_price.desc())
        .all()
    )
    return [serialize_target(r) for r in rows]


def add_manual_target(
    db: Session,
    symbol: str,
    *,
    source: str,
    target_price: float,
    analyst: Optional[str] = None,
    rating: Optional[str] = None,
    report_date: Optional[str] = None,
    is_consensus: bool = False,
    source_url: Optional[str] = None,
    source_title: Optional[str] = None,
) -> dict[str, Any]:
    name, stock_id, _ = _resolve_stock_name(db, symbol)
    row = StockPriceTarget(
        symbol=symbol,
        stock_id=stock_id,
        source=source.strip() or "직접입력",
        analyst=analyst,
        target_price=target_price,
        rating=rating,
        report_date=report_date,
        is_consensus=is_consensus,
        source_url=source_url,
        source_title=source_title,
        notes=f"수동 입력 ({name})",
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return serialize_target(row)


def delete_price_target(db: Session, symbol: str, target_id: int) -> bool:
    row = (
        db.query(StockPriceTarget)
        .filter(StockPriceTarget.symbol == symbol, StockPriceTarget.id == target_id)
        .first()
    )
    if not row:
        return False
    db.delete(row)
    db.commit()
    return True


def fetch_price_targets_with_ai(db: Session, symbol: str) -> dict[str, Any]:
    settings = get_settings()
    if not settings.gemini_api_key:
        raise ValueError("GEMINI_API_KEY가 설정되지 않았습니다.")

    name, stock_id, current_price = _resolve_stock_name(db, symbol)
    articles = _fetch_target_news(name, symbol)

    if not articles:
        raise ValueError(
            f"「{name}」 목표가 관련 뉴스를 찾지 못했습니다. "
            "잠시 후 다시 시도하거나 수동으로 목표가를 입력하세요."
        )

    client = GeminiClient(api_key=settings.gemini_api_key, model=settings.gemini_model)
    prompt = TARGET_EXTRACT_PROMPT.format(
        name=name,
        symbol=symbol,
        current_price=f"{current_price:,.0f}원" if current_price else "미확인",
        articles_block=_format_articles_block(articles),
    )
    data = client.generate_json(
        prompt,
        purpose="목표가 기사 추출",
        system_instruction=TARGET_SYSTEM,
    )
    if not data:
        raise ValueError("목표가 추출에 실패했습니다. 잠시 후 다시 시도하세요.")

    db.query(StockPriceTarget).filter(
        StockPriceTarget.symbol == symbol,
        StockPriceTarget.notes.like("%뉴스 검색%"),
    ).delete(synchronize_session=False)

    saved: list[StockPriceTarget] = []
    disclaimer = data.get("disclaimer") or "Google 뉴스 검색 기사에서 추출 — 출처 링크로 원문 확인"

    for item in data.get("targets") or []:
        try:
            price = float(item.get("target_price") or 0)
        except (TypeError, ValueError):
            continue
        if price <= 0:
            continue

        idx = item.get("source_index")
        article: dict[str, str] | None = None
        if isinstance(idx, int) and 0 <= idx < len(articles):
            article = articles[idx]
        elif isinstance(idx, str) and idx.isdigit():
            i = int(idx)
            if 0 <= i < len(articles):
                article = articles[i]

        if not article or not article.get("url"):
            continue

        evidence = (item.get("evidence") or "").strip()
        source = (item.get("source") or article.get("title", "미상")[:80]).strip()[:100]
        note_parts = [f"뉴스 검색 — {disclaimer}"]
        if evidence:
            note_parts.append(f"근거: {evidence}")

        row = StockPriceTarget(
            symbol=symbol,
            stock_id=stock_id,
            source=source,
            analyst=item.get("analyst"),
            target_price=price,
            rating=item.get("rating"),
            report_date=item.get("report_date"),
            is_consensus=False,
            source_url=article["url"],
            source_title=article["title"][:298],
            notes=" | ".join(note_parts),
        )
        db.add(row)
        saved.append(row)

    db.commit()
    for row in saved:
        db.refresh(row)

    logger.info("목표가 저장 %s: %d건 / 기사 %d건", name, len(saved), len(articles))

    search_articles = [
        {
            "title": a["title"],
            "url": a["url"],
            "published": a.get("published"),
            "snippet": a.get("snippet"),
            "used_in_target": any(
                r.source_url == a["url"] for r in saved
            ),
        }
        for a in articles
    ]

    if not saved:
        return {
            "symbol": symbol,
            "name": name,
            "fetched_count": 0,
            "disclaimer": disclaimer,
            "message": "기사는 찾았으나 목표가 수치를 확실히 추출하지 못했습니다. 아래 기사를 직접 확인하세요.",
            "search_articles": search_articles,
            "targets": list_price_targets(db, symbol),
        }

    return {
        "symbol": symbol,
        "name": name,
        "fetched_count": len(saved),
        "disclaimer": disclaimer,
        "search_articles": search_articles,
        "targets": list_price_targets(db, symbol),
    }
