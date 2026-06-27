"""
네이버 금융 — 종목 투자정보·기업개요·재무·수급·뉴스
"""
from __future__ import annotations

import json
import logging
import re
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Optional

import httpx
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

_NAVER_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)
_CACHE_DIR = Path(__file__).resolve().parent.parent / "data" / "stock_basics_cache"
_CACHE_TTL_HOURS = 6
_OVERVIEW_MAX_CHARS = 6000
_NEWS_MAX_ITEMS = 40

INFO_CODE_MAP = {
    "lastClosePrice": "last_close",
    "openPrice": "open_price",
    "highPrice": "high_price",
    "lowPrice": "low_price",
    "accumulatedTradingVolume": "trading_volume",
    "accumulatedTradingValue": "trading_value",
    "marketValue": "market_cap",
    "foreignRate": "foreign_holding_rate",
    "per": "per",
    "eps": "eps",
    "cnsPer": "forward_per",
    "cnsEps": "forward_eps",
    "pbr": "pbr",
    "bps": "bps",
    "dividendYieldRatio": "dividend_yield",
    "dividend": "dividend_amount",
    "highPriceOf52Weeks": "week52_high",
    "lowPriceOf52Weeks": "week52_low",
}

def _is_kr_symbol(symbol: str) -> bool:
    return bool(re.fullmatch(r"\d{6}", (symbol or "").strip()))


def _cache_path(symbol: str) -> Path:
    _CACHE_DIR.mkdir(parents=True, exist_ok=True)
    return _CACHE_DIR / f"{symbol.strip()}.json"


def _load_cache(symbol: str) -> dict[str, Any] | None:
    path = _cache_path(symbol)
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        fetched = datetime.fromisoformat(data.get("fetched_at", ""))
        if datetime.utcnow() - fetched > timedelta(hours=_CACHE_TTL_HOURS):
            return None
        return data
    except Exception:
        return None


def _save_cache(symbol: str, payload: dict[str, Any]) -> None:
    try:
        _cache_path(symbol).write_text(
            json.dumps(payload, ensure_ascii=False, indent=0),
            encoding="utf-8",
        )
    except Exception as e:
        logger.warning("stock_basics 캐시 저장 실패 %s: %s", symbol, e)


def _clean_label(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").replace("\n", " ").replace("\t", " ")).strip()


def _parse_table_row(label: str, value: str) -> tuple[str, str]:
    label = _clean_label(label.split(" l ")[0].split(" | ")[0])
    value = _clean_label(value)
    return label, value


def _naver_get(path: str) -> dict[str, Any]:
    url = f"https://m.stock.naver.com/api/stock/{path}"
    with httpx.Client(timeout=15.0, headers={"User-Agent": _NAVER_UA}) as client:
        resp = client.get(url)
        resp.raise_for_status()
        return resp.json()


def _fetch_naver_integration(symbol: str) -> dict[str, Any]:
    return _naver_get(f"{symbol}/integration")


def _fetch_naver_basic(symbol: str) -> dict[str, Any]:
    try:
        return _naver_get(f"{symbol}/basic")
    except Exception as e:
        logger.warning("네이버 basic API 실패 %s: %s", symbol, e)
        return {}


def _fetch_finance_table(symbol: str, period: str) -> dict[str, Any]:
    try:
        return _naver_get(f"{symbol}/finance/{period}")
    except Exception as e:
        logger.warning("네이버 finance/%s 실패 %s: %s", period, symbol, e)
        return {}


def _fetch_investment_table(symbol: str) -> dict[str, str]:
    """PC 종목 메인 — #tab_con1 투자정보 표."""
    url = f"https://finance.naver.com/item/main.naver?code={symbol}"
    with httpx.Client(timeout=15.0, headers={"User-Agent": _NAVER_UA}) as client:
        resp = client.get(url)
        resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")
    tab = soup.select_one("#tab_con1")
    if not tab:
        return {}

    rows: dict[str, str] = {}
    for tr in tab.select("tr"):
        th = tr.find("th")
        td = tr.find("td")
        if not th or not td:
            continue
        label, value = _parse_table_row(th.get_text(" ", strip=True), td.get_text(" ", strip=True))
        if label and value:
            rows[label] = value
    return rows


def _fetch_quote_tables(symbol: str) -> dict[str, str]:
    """PC 종목 메인 — 주요 시세 표(table.no_info)."""
    url = f"https://finance.naver.com/item/main.naver?code={symbol}"
    with httpx.Client(timeout=15.0, headers={"User-Agent": _NAVER_UA}) as client:
        resp = client.get(url)
        resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")
    rows: dict[str, str] = {}
    for table in soup.select("table.no_info"):
        for tr in table.select("tr"):
            th = tr.find("th")
            td = tr.find("td")
            if not th or not td:
                continue
            label, value = _parse_table_row(th.get_text(" ", strip=True), td.get_text(" ", strip=True))
            if label and value and label not in rows:
                rows[label] = value
    return rows


def _table_to_list(table: dict[str, str]) -> list[dict[str, str]]:
    return [{"label": k, "value": v} for k, v in table.items()]


_COMMENT_LABELS = {
    "comment1": "사업 개요",
    "comment2": "주력 제품 및 서비스",
    "comment3": "수익 구조",
    "comment4": "주요 리스크",
    "comment5": "전망 및 기타",
}

def _build_corporation_overview(finance_annual: dict[str, Any], coinfo_text: str) -> tuple[str, dict[str, str]]:
    summary = finance_annual.get("corporationSummary") or {}
    parts: list[str] = []
    comments: dict[str, str] = {}
    if isinstance(summary, dict):
        for key, label in _COMMENT_LABELS.items():
            text = (summary.get(key) or "").strip()
            if text:
                comments[key] = text
                parts.append(f"▶ {label}\n{text}")
    combined = "\n\n".join(parts).strip()
    if not combined:
        combined = coinfo_text
    elif coinfo_text and coinfo_text not in combined:
        combined = f"{combined}\n\n{coinfo_text}"
    return combined[:_OVERVIEW_MAX_CHARS], comments


def _fetch_company_overview(symbol: str) -> str:
    """네이버 기업정보 페이지에서 기업개요·주력상품·수익구조를 수집."""
    url = f"https://finance.naver.com/item/coinfo.naver?code={symbol}"
    try:
        with httpx.Client(timeout=15.0, headers={"User-Agent": _NAVER_UA}) as client:
            resp = client.get(url)
            resp.raise_for_status()
    except Exception:
        return ""
    soup = BeautifulSoup(resp.text, "html.parser")

    sections: list[str] = []

    # ① 기업개요 (.wrap_company)
    wrap = soup.select_one(".wrap_company")
    if wrap:
        raw = wrap.get_text(" ", strip=True)
        for marker in ("기업개요", "사업내용", "회사소개"):
            if marker in raw:
                idx = raw.find(marker)
                snippet = raw[idx + len(marker): idx + len(marker) + 2000]
                snippet = re.sub(r"출처\s*:.*$", "", snippet, flags=re.MULTILINE).strip()
                if snippet:
                    sections.append(f"[기업개요]\n{snippet}")
                break
        if not sections:
            sections.append(f"[기업개요]\n{raw[:2000]}")

    # ② 제품·서비스 정보 (tab_con1, coinfo_tb_lay)
    for sel in (".tb_type2", "#coinfo_tb_lay", ".wrap_coinfo"):
        tbl = soup.select_one(sel)
        if tbl:
            rows_text = []
            for tr in tbl.find_all("tr"):
                th = tr.find("th")
                tds = tr.find_all("td")
                if th and tds:
                    key = th.get_text(strip=True)
                    val = " ".join(td.get_text(" ", strip=True) for td in tds)
                    if val and key:
                        rows_text.append(f"{key}: {val[:300]}")
            if rows_text:
                sections.append("[사업 현황]\n" + "\n".join(rows_text[:10]))
            break

    # ③ 주요 제품/서비스 키워드 블록
    for sel in (".product_area", ".goods_area", ".biz_sum"):
        blk = soup.select_one(sel)
        if blk:
            txt = blk.get_text(" ", strip=True)
            if txt:
                sections.append(f"[주력 제품·서비스]\n{txt[:800]}")
            break

    return "\n\n".join(sections)


def _fetch_stock_news(stock_name: str, symbol: str, max_items: int = _NEWS_MAX_ITEMS) -> list[dict[str, str]]:
    queries = [
        f"{stock_name} {symbol}",
        f"{stock_name} 주가",
        f"{stock_name} 실적",
        f"{stock_name} 목표주가",
        f"{stock_name} 컨센서스",
        f"{stock_name} 실적 발표",
        f"{stock_name} 배당",
        f"{stock_name} 수급",
        f"{stock_name} 증권사",
        f"{stock_name} 전망",
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
                pub_el = item.find("pubDate")
                if title_el is None or not title_el.text:
                    continue
                title = title_el.text.strip()
                norm = re.sub(r"\s+", "", title.lower())
                if norm in seen:
                    continue
                seen.add(norm)
                items.append({
                    "title": title,
                    "url": link_el.text.strip() if link_el is not None and link_el.text else "",
                    "published": pub_el.text.strip() if pub_el is not None and pub_el.text else "",
                })
                if len(items) >= max_items:
                    return items
        except Exception as e:
            logger.warning("종목 뉴스 RSS 실패 (%s): %s", q, e)
    return items


def _serialize_finance(finance_payload: dict[str, Any]) -> dict[str, Any]:
    info = finance_payload.get("financeInfo") or {}
    periods = [
        {"key": p.get("key"), "title": p.get("title"), "is_consensus": p.get("isConsensus") == "Y"}
        for p in info.get("trTitleList") or []
    ]
    rows: list[dict[str, Any]] = []
    for row in info.get("rowList") or []:
        columns = {
            key: (val or {}).get("value")
            for key, val in (row.get("columns") or {}).items()
        }
        rows.append({"title": row.get("title"), "columns": columns})
    return {
        "period_type": finance_payload.get("financePeriodType"),
        "periods": periods,
        "rows": rows,
    }


def _serialize_investor_trends(integration: dict[str, Any], *, limit: int = 10) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for item in (integration.get("dealTrendInfos") or [])[:limit]:
        bizdate = str(item.get("bizdate") or "")
        if len(bizdate) == 8:
            bizdate = f"{bizdate[:4]}-{bizdate[4:6]}-{bizdate[6:8]}"
        prev = item.get("compareToPreviousPrice") or {}
        out.append({
            "date": bizdate,
            "close_price": item.get("closePrice"),
            "change": item.get("compareToPreviousClosePrice"),
            "change_direction": prev.get("text") if isinstance(prev, dict) else None,
            "volume": item.get("accumulatedTradingVolume"),
            "foreign_net_buy": item.get("foreignerPureBuyQuant"),
            "foreign_holding_rate": item.get("foreignerHoldRatio"),
            "institution_net_buy": item.get("organPureBuyQuant"),
            "individual_net_buy": item.get("individualPureBuyQuant"),
        })
    return out


def _serialize_industry_peers(integration: dict[str, Any], *, limit: int = 8) -> list[dict[str, Any]]:
    peers: list[dict[str, Any]] = []
    for item in (integration.get("industryCompareInfo") or [])[:limit]:
        prev = item.get("compareToPreviousPrice") or {}
        peers.append({
            "symbol": item.get("itemCode"),
            "name": item.get("stockName"),
            "close_price": item.get("closePrice"),
            "change_pct": item.get("fluctuationsRatio"),
            "change_direction": prev.get("text") if isinstance(prev, dict) else None,
            "market_cap": item.get("marketValue"),
        })
    return peers


def _serialize_research_reports(integration: dict[str, Any], *, limit: int = 8) -> list[dict[str, Any]]:
    reports: list[dict[str, Any]] = []
    for item in (integration.get("researches") or [])[:limit]:
        wdt = str(item.get("wdt") or "")
        if len(wdt) == 8:
            wdt = f"{wdt[:4]}-{wdt[4:6]}-{wdt[6:8]}"
        rid = item.get("id")
        reports.append({
            "broker": item.get("bnm"),
            "title": item.get("tit"),
            "date": wdt,
            "target_price": item.get("rcnt"),
            "report_id": rid,
            "url": f"https://finance.naver.com/research/company_read.naver?nid={rid}" if rid else None,
        })
    return reports


def _build_quote_snapshot(basic: dict[str, Any]) -> dict[str, Any]:
    """당일 시세 헤더 — basic API만 사용 (투자정보는 investment_table 기준)."""
    prev = basic.get("compareToPreviousPrice") or {}
    return {
        "close_price": basic.get("closePrice"),
        "change": basic.get("compareToPreviousClosePrice"),
        "change_pct": basic.get("fluctuationsRatio"),
        "change_direction": prev.get("text") if isinstance(prev, dict) else None,
        "market_status": (basic.get("marketStatus") or {}).get("text") if isinstance(basic.get("marketStatus"), dict) else basic.get("marketStatus"),
        "traded_at": basic.get("localTradedAt"),
        "exchange": basic.get("stockExchangeName"),
    }


def _build_investment_info(
    table: dict[str, str],
    integration: dict[str, Any],
) -> dict[str, Any]:
    info: dict[str, Any] = {"source": "naver_finance"}

    for row_label, row_value in table.items():
        key = (
            row_label.replace(" ", "")
            .replace("(", "_")
            .replace(")", "")
            .replace("/", "_")
            .replace(".", "")
            .lower()
        )
        info[key] = row_value

    info["market_cap"] = table.get("시가총액") or info.get("market_cap")
    info["market_cap_rank"] = table.get("시가총액순위")
    info["listed_shares"] = table.get("상장주식수")
    info["face_value_trading_unit"] = table.get("액면가 l 매매단위") or table.get("액면가 l매매단위")
    info["foreign_limit_shares"] = table.get("외국인한도주식수(A)")
    info["foreign_held_shares"] = table.get("외국인보유주식수(B)")
    info["foreign_exhaustion_rate"] = table.get("외국인소진율(B/A)") or table.get("외국인소진율(B/A)외국인소진율(B/A)상세설명")
    if info.get("foreign_exhaustion_rate") and "외국인" in str(info["foreign_exhaustion_rate"]):
        m = re.search(r"([\d.]+%)", str(info["foreign_exhaustion_rate"]))
        if m:
            info["foreign_exhaustion_rate"] = m.group(1)

    opinion_raw = table.get("투자의견 l 목표주가") or table.get("투자의견l목표주가")
    if opinion_raw:
        parts = re.split(r"\s+l\s+", opinion_raw)
        if len(parts) >= 2:
            info["consensus_rating"] = parts[0].strip()
            info["consensus_target_price"] = parts[1].replace(",", "").strip()
        else:
            info["consensus_opinion_line"] = opinion_raw

    info["week52_range"] = table.get("52주최고 l 최저") or table.get("52week최고l최저") or table.get("52주최고l최저")
    info["per_eps"] = table.get("PER l EPS (2026.03)") or next(
        (v for k, v in table.items() if k.startswith("PER l EPS")), None
    )
    info["forward_per_eps"] = table.get("추정PER l EPS") or next(
        (v for k, v in table.items() if k.startswith("추정PER")), None
    )
    info["pbr_bps"] = table.get("PBR l BPS (2026.03)") or next(
        (v for k, v in table.items() if k.startswith("PBR l BPS")), None
    )
    info["dividend_yield"] = table.get("배당수익률 l 2025.12") or next(
        (v for k, v in table.items() if "배당수익률" in k), None
    )
    info["industry_per"] = table.get("동일업종 PER")
    info["industry_change_pct"] = table.get("동일업종 등락률")

    totals = {item.get("code"): item.get("value") for item in integration.get("totalInfos") or []}
    for code, field in INFO_CODE_MAP.items():
        if totals.get(code):
            info[field] = totals.get(code)

    consensus = integration.get("consensusInfo") or {}
    if consensus:
        info["consensus_rating_score"] = consensus.get("recommMean")
        info["consensus_target_price_numeric"] = consensus.get("priceTargetMean")
        info["consensus_date"] = consensus.get("createDate")

    if integration.get("stockName"):
        info["name"] = integration["stockName"]

    info["table_rows"] = _table_to_list(table)
    return info


def _generate_business_profile(
    name: str, symbol: str, overview: str, corp_summary: dict[str, str]
) -> dict[str, str] | None:
    """Gemini AI로 기업의 주력상품·캐시카우·수익구조를 생성."""
    try:
        from core.ai_analyzer import create_analyzer
        from sqlalchemy.orm import Session
        # DB 없이도 동작하도록 간단한 analyzer 생성
        analyzer = create_analyzer(None)
    except Exception:
        return None

    # 기존 요약 조합
    existing = "\n".join(v for v in corp_summary.values() if v).strip() or overview[:600]

    prompt = f"""당신은 한국 주식시장 전문 기업 분석가입니다.
아래 기업에 대해 투자자에게 유용한 구조적 정보를 JSON으로 작성하세요.

종목명: {name} ({symbol})
기존 개요: {existing}

다음 항목을 한국어로 작성하세요 (각 항목 2~4문장, 구체적 수치·제품명 포함):

1. core_business: 이 기업이 무슨 사업을 하는지 핵심 설명
2. main_products: 주력 제품/서비스 목록 (배열, 각 항목에 제품명과 특징 포함)
3. cash_cow: 가장 안정적이고 높은 이익을 내는 캐시카우 사업/제품 설명
4. revenue_model: 돈 버는 구조 — 어떤 방식으로 매출이 발생하는지 (B2B/B2C, 구독/일회성, 계약/스팟 등)
5. competitive_edge: 이 기업만의 핵심 경쟁력 또는 해자(moat)

반드시 아래 JSON 형식으로만 응답하세요:
{{
  "core_business": "...",
  "main_products": ["제품1: 설명", "제품2: 설명", "제품3: 설명"],
  "cash_cow": "...",
  "revenue_model": "...",
  "competitive_edge": "..."
}}"""

    try:
        result = analyzer.analyze_json_prompt(prompt, log_label=f"기업프로파일:{name}")
        if isinstance(result, dict) and "core_business" in result:
            return result
    except Exception as e:
        logger.debug("기업 프로파일 생성 실패 %s: %s", name, e)
    return None


def fetch_stock_basics(symbol: str, *, use_cache: bool = True) -> dict[str, Any]:
    symbol = symbol.strip()
    if not _is_kr_symbol(symbol):
        raise ValueError("국내 6자리 종목코드만 지원합니다.")

    if use_cache:
        cached = _load_cache(symbol)
        if cached:
            return cached

    integration = _fetch_naver_integration(symbol)
    basic = _fetch_naver_basic(symbol)
    table = _fetch_investment_table(symbol)
    quote_table = _fetch_quote_tables(symbol)
    finance_annual = _fetch_finance_table(symbol, "annual")
    finance_quarter = _fetch_finance_table(symbol, "quarter")
    coinfo_text = _fetch_company_overview(symbol)
    overview, corporation_comments = _build_corporation_overview(finance_annual, coinfo_text)
    name = integration.get("stockName") or basic.get("stockName") or symbol
    news = _fetch_stock_news(name, symbol)

    business_profile = _generate_business_profile(name, symbol, overview, corporation_comments)

    payload = {
        "symbol": symbol,
        "name": name,
        "source": "naver_finance",
        "fetched_at": datetime.utcnow().isoformat(),
        "quote": _build_quote_snapshot(basic),
        "investment_info": _build_investment_info(table, integration),
        "investment_table": _table_to_list(table),
        "quote_table": _table_to_list(quote_table),
        "investor_trends": _serialize_investor_trends(integration),
        "financials": {
            "annual": _serialize_finance(finance_annual),
            "quarterly": _serialize_finance(finance_quarter),
        },
        "industry_peers": _serialize_industry_peers(integration),
        "research_reports": _serialize_research_reports(integration),
        "corporation_summary": corporation_comments,
        "overview": overview,
        "business_profile": business_profile,
        "news": news,
    }
    _save_cache(symbol, payload)
    return payload
