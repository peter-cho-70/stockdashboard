"""
core/etf_data.py
네이버 증권 ETF 데이터 — 인기 ETF 랭킹, 구성종목, 종목→ETF 역검색, AI 전망
  - 랭킹: https://finance.naver.com/api/sise/etfItemList.nhn (EUC-KR 인코딩)
  - 구성종목/기본정보: https://m.stock.naver.com/api/etf/{code}/constituent, /basic (UTF-8)
"""
from __future__ import annotations

import json
import logging
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from typing import Any, Optional

import httpx
from sqlalchemy.orm import Session

from config.database import EtfOutlook
from core.gemini_client import GeminiClient
from core.stock_resolver import resolve_symbol

logger = logging.getLogger(__name__)

UA = "Mozilla/5.0 (compatible; StockMind/1.0)"

ETF_CATEGORIES: dict[int, str] = {
    0: "전체",
    1: "국내 시장지수",
    2: "국내 업종/테마",
    3: "국내 파생",
    4: "해외 주식",
    5: "원자재",
    6: "채권",
    7: "기타",
}

SORT_COLUMNS: dict[str, str] = {
    "market_sum": "시가총액",
    "change_rate": "등락률",
    "3month_earn_rate": "3개월수익률",
    "acc_quant": "거래량",
    "now_val": "현재가",
}

_RANKINGS_CACHE: dict[str, tuple[float, list[dict[str, Any]]]] = {}
_HOLDINGS_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}
_REVERSE_INDEX: dict[str, Any] = {"built_at": 0.0, "by_symbol": {}}
_LISTING_DATE_CACHE: dict[str, tuple[float, str | None]] = {}

RANKINGS_TTL_SEC = 5 * 60
HOLDINGS_TTL_SEC = 6 * 60 * 60
REVERSE_INDEX_TTL_SEC = 6 * 60 * 60
LISTING_DATE_TTL_SEC = 24 * 60 * 60


def _fetch_rankings_raw(category: int, sort: str, order: str) -> list[dict[str, Any]]:
    resp = httpx.get(
        "https://finance.naver.com/api/sise/etfItemList.nhn",
        params={"etfType": category, "targetColumn": sort, "sortOrder": order},
        headers={"User-Agent": UA},
        timeout=12,
    )
    resp.raise_for_status()
    data = resp.content.decode("euc-kr", errors="ignore")
    payload = json.loads(data)
    if payload.get("resultCode") != "success":
        raise ValueError(payload.get("result", {}).get("errorMessage", "ETF 목록 조회 실패"))
    items = payload.get("result", {}).get("etfItemList", [])
    return [
        {
            "code": it["itemcode"],
            "name": it["itemname"],
            "category": it.get("etfTabCode"),
            "current_price": it.get("nowVal"),
            "change_value": it.get("changeVal"),
            "change_rate": it.get("changeRate"),
            "nav": it.get("nav"),
            "return_3m": it.get("threeMonthEarnRate"),
            "volume": it.get("quant"),
            "trading_value": it.get("amonut"),  # 백만원
            "market_cap": it.get("marketSum"),  # 억원
            # 상장일 — etfItemList.nhn이 startDate를 내려주면 바로 사용, 아니면 별도 조회
            "listing_date": it.get("startDate") or it.get("listingDate"),
        }
        for it in items
    ]


def _fetch_listing_date_single(code: str) -> str | None:
    """단일 ETF 상장일을 네이버 basic API에서 조회."""
    try:
        basic = httpx.get(
            f"https://m.stock.naver.com/api/etf/{code}/basic",
            headers={"User-Agent": UA},
            timeout=8,
        ).json()
        date_str = (
            basic.get("listingDate")
            or basic.get("startDate")
            or basic.get("listedDate")
            or basic.get("ipoDate")
        )
        return str(date_str) if date_str else None
    except Exception as e:
        logger.debug("ETF 상장일 조회 실패 (%s): %s", code, e)
        return None


def fetch_etf_listing_dates(codes: list[str]) -> dict[str, str | None]:
    """여러 ETF의 상장일을 병렬 조회 (24시간 캐시)."""
    now = time.time()
    result: dict[str, str | None] = {}
    uncached: list[str] = []

    for code in codes:
        cached = _LISTING_DATE_CACHE.get(code)
        if cached and now - cached[0] < LISTING_DATE_TTL_SEC:
            result[code] = cached[1]
        else:
            uncached.append(code)

    if uncached:
        with ThreadPoolExecutor(max_workers=5) as executor:
            future_map = {executor.submit(_fetch_listing_date_single, c): c for c in uncached}
            for future in as_completed(future_map):
                code = future_map[future]
                try:
                    date_str = future.result()
                except Exception:
                    date_str = None
                _LISTING_DATE_CACHE[code] = (now, date_str)
                result[code] = date_str

    return result


def fetch_etf_rankings(
    *, category: int = 0, sort: str = "market_sum", order: str = "desc", limit: int = 30
) -> list[dict[str, Any]]:
    """ETF 랭킹 (카테고리/정렬 기준) — 5분 캐시"""
    cache_key = f"{category}:{sort}:{order}"
    now = time.time()
    cached = _RANKINGS_CACHE.get(cache_key)
    if cached and now - cached[0] < RANKINGS_TTL_SEC:
        return cached[1][:limit]
    try:
        items = _fetch_rankings_raw(category, sort, order)
    except Exception as e:
        logger.warning("ETF 랭킹 조회 실패 (%s): %s", cache_key, e)
        if cached:
            return cached[1][:limit]
        raise
    _RANKINGS_CACHE[cache_key] = (now, items)
    return items[:limit]


def fetch_etf_holdings(code: str) -> dict[str, Any]:
    """ETF 구성종목 + 기본정보 — 6시간 캐시"""
    now = time.time()
    cached = _HOLDINGS_CACHE.get(code)
    if cached and now - cached[0] < HOLDINGS_TTL_SEC:
        return cached[1]

    result: dict[str, Any] = {"code": code, "name": None, "current_price": None, "change_rate": None, "holdings": []}
    try:
        basic = httpx.get(
            f"https://m.stock.naver.com/api/etf/{code}/basic", headers={"User-Agent": UA}, timeout=12
        ).json()
        result["name"] = basic.get("stockName")
        close = (basic.get("closePrice") or "").replace(",", "")
        result["current_price"] = float(close) if close else None
        result["change_rate"] = float(basic.get("fluctuationsRatio") or 0)
        result["rising"] = (basic.get("compareToPreviousPrice") or {}).get("name") == "RISING"
    except Exception as e:
        logger.warning("ETF 기본정보 조회 실패 (%s): %s", code, e)

    try:
        constituent = httpx.get(
            f"https://m.stock.naver.com/api/etf/{code}/constituent", headers={"User-Agent": UA}, timeout=12
        ).json()
        result["total_count"] = constituent.get("totalCount")
        result["total_weight"] = constituent.get("totalWeight")
        result["holdings"] = [
            {
                "symbol": h.get("itemCode"),
                "name": h.get("itemName"),
                "weight": h.get("constituentWeight"),
                "quantity": h.get("cuUnitQuantity"),
            }
            for h in constituent.get("result", [])
        ]
    except Exception as e:
        logger.warning("ETF 구성종목 조회 실패 (%s): %s", code, e)

    _HOLDINGS_CACHE[code] = (now, result)
    return result


def _build_reverse_index() -> dict[str, list[dict[str, Any]]]:
    """주요 ETF(카테고리별 상위 + 전체 상위)의 구성종목을 모아 종목→ETF 역인덱스를 만든다."""
    universe: dict[str, dict[str, Any]] = {}
    try:
        for cat in (0, 1, 2, 4):
            for item in fetch_etf_rankings(category=cat, sort="market_sum", order="desc", limit=25):
                universe[item["code"]] = item
    except Exception as e:
        logger.warning("ETF 역인덱스용 랭킹 조회 실패: %s", e)
        return {}

    by_symbol: dict[str, list[dict[str, Any]]] = {}
    for code, meta in universe.items():
        try:
            holdings = fetch_etf_holdings(code)
        except Exception as e:
            logger.warning("ETF 구성종목 조회 실패 (역인덱스, %s): %s", code, e)
            continue
        for h in holdings.get("holdings", []):
            symbol = h.get("symbol")
            if not symbol:
                continue
            by_symbol.setdefault(symbol, []).append({
                "etf_code": code,
                "etf_name": meta["name"],
                "category": meta["category"],
                "weight": h.get("weight"),
            })
    return by_symbol


def find_etfs_by_stock(query: str, db: Optional[Session] = None) -> dict[str, Any]:
    """종목명/코드로 그 종목을 담고 있는 주요 ETF들을 찾는다 (상위 ETF 풀 기준 역검색)."""
    query = (query or "").strip()
    symbol = query if query.isdigit() and len(query) == 6 else resolve_symbol(query, db)

    now = time.time()
    if now - _REVERSE_INDEX["built_at"] > REVERSE_INDEX_TTL_SEC or not _REVERSE_INDEX["by_symbol"]:
        _REVERSE_INDEX["by_symbol"] = _build_reverse_index()
        _REVERSE_INDEX["built_at"] = now

    matches = list(_REVERSE_INDEX["by_symbol"].get(symbol, [])) if symbol else []
    matches.sort(key=lambda m: m.get("weight") or 0, reverse=True)
    return {"query": query, "symbol": symbol, "etfs": matches}


OUTLOOK_SYSTEM = """당신은 한국 ETF를 분석하는 애널리스트입니다.
제공된 ETF 정보(이름, 카테고리, 최근 수익률, 상위 구성종목)만 근거로 짧고 객관적인 전망을 작성하세요.
과장된 추천이나 확정적 어투("반드시", "확실히")는 쓰지 말고, 데이터에 기반한 균형 잡힌 톤을 유지하세요."""


def generate_etf_outlook(
    db: Session,
    *,
    code: str,
    name: str,
    category_label: str,
    return_3m: Optional[float],
    holdings: list[dict[str, Any]],
    gemini_api_key: Optional[str],
    gemini_model: Optional[str],
    force: bool = False,
) -> dict[str, Any]:
    today = datetime.utcnow().strftime("%Y-%m-%d")
    if not force:
        cached = (
            db.query(EtfOutlook)
            .filter(EtfOutlook.etf_code == code, EtfOutlook.report_date == today)
            .first()
        )
        if cached:
            return {"outlook": cached.outlook_text, "cached": True, "report_date": today}

    top_holdings = holdings[:10]
    holdings_lines = "\n".join(
        f"- {h['name']} ({h['weight']}%)" for h in top_holdings if h.get("name")
    )
    prompt = f"""{OUTLOOK_SYSTEM}

ETF명: {name} ({code})
카테고리: {category_label}
최근 3개월 수익률: {return_3m if return_3m is not None else "N/A"}%
상위 구성종목:
{holdings_lines or "정보 없음"}

위 정보를 바탕으로 이 ETF에 대한 짧은 전망을 한국어로 3~5문장 작성해주세요.
구성종목 트렌드, 최근 수익률 흐름, 주의할 리스크를 균형 있게 다뤄주세요."""

    client = GeminiClient(api_key=gemini_api_key, model=gemini_model)
    text = client.generate_text(prompt, purpose="ETF 전망")

    if not text:
        return {"outlook": None, "cached": False, "report_date": today, "error": "AI 전망 생성에 실패했습니다."}

    row = (
        db.query(EtfOutlook)
        .filter(EtfOutlook.etf_code == code, EtfOutlook.report_date == today)
        .first()
    )
    if row:
        row.outlook_text = text
    else:
        row = EtfOutlook(etf_code=code, etf_name=name, report_date=today, outlook_text=text)
        db.add(row)
    db.commit()

    return {"outlook": text, "cached": False, "report_date": today}
