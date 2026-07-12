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

from config.database import EtfOutlook, Stock
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
_BASIC_STATS_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}

RANKINGS_TTL_SEC = 5 * 60
HOLDINGS_TTL_SEC = 6 * 60 * 60
REVERSE_INDEX_TTL_SEC = 6 * 60 * 60
LISTING_DATE_TTL_SEC = 24 * 60 * 60
BASIC_STATS_TTL_SEC = 5 * 60


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


def _fetch_basic_stats_single(code: str) -> dict[str, Any]:
    """네이버 ETF basic API에서 시가총액·3개월수익률 조회."""
    now = time.time()
    cached = _BASIC_STATS_CACHE.get(code)
    if cached and now - cached[0] < BASIC_STATS_TTL_SEC:
        return cached[1]
    result: dict[str, Any] = {"code": code, "market_cap": None, "return_3m": None}
    try:
        basic = httpx.get(
            f"https://m.stock.naver.com/api/etf/{code}/basic",
            headers={"User-Agent": UA},
            timeout=8,
        ).json()
        # "2,127억" or "4조 4,933억" → 숫자(억 단위)
        mv_raw = (basic.get("marketValue") or "").replace(",", "").strip()
        if "조" in mv_raw:
            parts = mv_raw.replace("억", "").split("조")
            jo = float(parts[0].strip()) if parts[0].strip() else 0
            eok = float(parts[1].strip()) if len(parts) > 1 and parts[1].strip() else 0
            result["market_cap"] = jo * 10000 + eok
        else:
            mv_str = mv_raw.replace("억", "").strip()
            result["market_cap"] = float(mv_str) if mv_str else None
        r3m = basic.get("returnRate3m")
        result["return_3m"] = float(r3m) if r3m is not None else None
    except Exception as e:
        logger.debug("ETF basic stats 조회 실패 (%s): %s", code, e)
    _BASIC_STATS_CACHE[code] = (now, result)
    return result


def fetch_etf_basic_stats(codes: list[str]) -> dict[str, dict[str, Any]]:
    """여러 ETF의 시가총액·3개월수익률을 병렬 조회."""
    with ThreadPoolExecutor(max_workers=6) as executor:
        futures = {executor.submit(_fetch_basic_stats_single, c): c for c in codes}
        result = {}
        for future in as_completed(futures):
            data = future.result()
            result[data["code"]] = data
    return result


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


def build_group_etf_panel(db: Session, symbols: list[str], *, hot_limit: int = 8) -> dict[str, Any]:
    """종목 그룹(테마)의 관련 ETF를 찾아 보유 여부·최근 수익률로 정리.

    관련 ETF = 그룹 멤버 중 하나 이상을 상위 구성종목으로 담고 있는 주요 ETF(상위 풀 기준
    역인덱스, [[find_etfs_by_stock]]과 동일 소스) — 겹치는 멤버 수가 많을수록 관련도가 높다고 본다.
    """
    now = time.time()
    if now - _REVERSE_INDEX["built_at"] > REVERSE_INDEX_TTL_SEC or not _REVERSE_INDEX["by_symbol"]:
        _REVERSE_INDEX["by_symbol"] = _build_reverse_index()
        _REVERSE_INDEX["built_at"] = now
    by_symbol: dict[str, list[dict[str, Any]]] = _REVERSE_INDEX["by_symbol"]

    agg: dict[str, dict[str, Any]] = {}
    for sym in symbols:
        for m in by_symbol.get(sym, []):
            code = m["etf_code"]
            entry = agg.setdefault(
                code,
                {"code": code, "name": m["etf_name"], "category": m["category"],
                 "matched_symbols": [], "weight_sum": 0.0},
            )
            entry["matched_symbols"].append(sym)
            entry["weight_sum"] += m.get("weight") or 0

    if not agg:
        return {"related": [], "held": [], "hot": []}

    # 현재가·등락률·3개월수익률·거래대금 — 역인덱스와 동일한 랭킹 풀에서 조회(캐시 재사용, 추가 스크래핑 없음)
    meta_by_code: dict[str, dict[str, Any]] = {}
    for cat in (0, 1, 2, 4):
        for item in fetch_etf_rankings(category=cat, sort="market_sum", order="desc", limit=25):
            meta_by_code.setdefault(item["code"], item)

    held_rows = {
        s.symbol: s
        for s in db.query(Stock).filter(Stock.symbol.in_(list(agg.keys())), Stock.qty > 0).all()
    }

    related = []
    for code, entry in agg.items():
        meta = meta_by_code.get(code, {})
        held_stock = held_rows.get(code)
        related.append({
            "code": code,
            "name": meta.get("name") or entry["name"],
            "category": entry["category"],
            "category_label": ETF_CATEGORIES.get(entry["category"], "기타"),
            "match_count": len(entry["matched_symbols"]),
            "matched_symbols": entry["matched_symbols"],
            "weight_sum": round(entry["weight_sum"], 2),
            "current_price": meta.get("current_price"),
            "change_rate": meta.get("change_rate"),
            "return_3m": meta.get("return_3m"),
            "trading_value": meta.get("trading_value"),
            "held": held_stock is not None,
            "qty": held_stock.qty if held_stock else None,
            "avg_price": held_stock.avg_price if held_stock else None,
            "profit_rate": held_stock.profit_rate if held_stock else None,
        })

    related.sort(key=lambda r: (r["match_count"], r["weight_sum"]), reverse=True)

    held = [r for r in related if r["held"]]
    hot_candidates = [r for r in related if r.get("return_3m") is not None]
    hot_candidates.sort(key=lambda r: r["return_3m"], reverse=True)
    hot = hot_candidates[:hot_limit]

    return {"related": related, "held": held, "hot": hot}


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
