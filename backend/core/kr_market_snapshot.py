"""
국내 증시 스냅샷 — 네이버 실시간 지수·시장 통계 + 급등주·테마 섹터
(pykrx 실패 시에도 동작, yfinance는 환율 보조)
"""
from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional

import httpx
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

KST = timezone(timedelta(hours=9))
_NAVER_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)
_CACHE_PATH = Path(__file__).resolve().parent.parent / "data" / "kr_snapshot_cache.json"

KR_MACRO_TICKERS: list[tuple[str, str, str]] = [
    ("원/달러", "KRW=X", "fx"),
]

NAVER_INDEX_MAP: list[tuple[str, str]] = [
    ("KOSPI", "코스피"),
    ("KOSDAQ", "코스닥"),
    ("KPI200", "코스피200"),
    ("FUT", "코스피 선물"),
]


def _kst_now() -> datetime:
    return datetime.now(KST)


def _kst_today() -> str:
    return _kst_now().strftime("%Y-%m-%d")


def _naver_price(raw: int | float) -> float:
    return round(float(raw) / 100.0, 2)


def _quote_from_naver_index(code: str, name: str, row: dict[str, Any]) -> dict[str, Any]:
    close = _naver_price(row.get("nv", 0))
    change = _naver_price(row.get("cv", 0))
    chg_pct = round(float(row.get("cr", 0)), 2)
    return {
        "name": name,
        "ticker": code,
        "category": "kr_index",
        "unit": "index",
        "date": _kst_today(),
        "as_of_label": _kst_now().strftime("%m/%d %H:%M KST"),
        "close": close,
        "change": change,
        "change_pct": chg_pct,
        "open": _naver_price(row["ov"]) if row.get("ov") else None,
        "high": _naver_price(row["hv"]) if row.get("hv") else None,
        "low": _naver_price(row["lv"]) if row.get("lv") else None,
        "volume": int(row["aq"]) if row.get("aq") else None,
        "trading_value_억": round(float(row["aa"]) / 100.0, 1) if row.get("aa") else None,
    }


def _fetch_naver_indices() -> list[dict[str, Any]]:
    indices: list[dict[str, Any]] = []
    try:
        with httpx.Client(timeout=12.0, headers={"User-Agent": _NAVER_UA}) as client:
            for code, name in NAVER_INDEX_MAP:
                try:
                    r = client.get(
                        "https://polling.finance.naver.com/api/realtime",
                        params={"query": f"SERVICE_INDEX:{code}"},
                    )
                    r.raise_for_status()
                    data = r.json()["result"]["areas"][0]["datas"][0]
                    indices.append(_quote_from_naver_index(code, name, data))
                except Exception as e:
                    logger.warning("네이버 지수 %s 조회 실패: %s", code, e)
    except Exception as e:
        logger.warning("네이버 지수 일괄 조회 실패: %s", e)

    if len(indices) < 2:
        from core.us_market_report import _fetch_ticker_group

        fallback = _fetch_ticker_group(
            [
                ("코스피", "^KS11", "index"),
                ("코스닥", "^KQ11", "index"),
                ("코스피200", "^KS200", "index"),
            ],
            "kr_index",
        )
        if fallback:
            indices = fallback
    return indices


def _parse_breadth_block(text: str) -> dict[str, Any]:
    stats: dict[str, Any] = {}
    patterns = {
        "individual_net_억": r"개인\s*([+-]?[\d,]+)\s*억",
        "foreign_net_억": r"외국인\s*([+-]?[\d,]+)\s*억",
        "institution_net_억": r"기관\s*([+-]?[\d,]+)\s*억",
        "limit_up": r"상한종목수\s*(\d+)",
        "advancers": r"상승종목수\s*(\d+)",
        "unchanged": r"보합종목수\s*(\d+)",
        "decliners": r"하락종목수\s*(\d+)",
        "limit_down": r"하한종목수\s*(\d+)",
    }
    for key, pat in patterns.items():
        m = re.search(pat, text)
        if not m:
            continue
        raw = m.group(1).replace(",", "")
        stats[key] = int(raw) if key.endswith("종목수") or key in ("limit_up", "limit_down", "advancers", "unchanged", "decliners") else int(raw)
    return stats


def _fetch_market_breadth() -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    try:
        with httpx.Client(timeout=15.0, headers={"User-Agent": _NAVER_UA}) as client:
            r = client.get("https://finance.naver.com/")
            r.raise_for_status()
            soup = BeautifulSoup(r.text, "html.parser")
            for css, key in [(".kospi_area", "kospi"), (".kosdaq_area", "kosdaq")]:
                el = soup.select_one(css)
                if el:
                    out[key] = _parse_breadth_block(el.get_text(" ", strip=True))
    except Exception as e:
        logger.warning("시장 breadth 파싱 실패: %s", e)
    return out


def _is_common_stock(name: str) -> bool:
    skip = (
        "ETN", "ETF", "인버스", "레버리지", "LEVERAGE", "INVERSE",
        "KODEX", "TIGER", "PLUS ", "RISE ", "HANARO", "KOSEF", "SOL ",
        "선물", "레버리지",
    )
    upper = name.upper()
    return not any(s in name or s in upper for s in skip)


def _parse_mover_rows(html: str, *, min_change: float = 0.0) -> list[dict[str, Any]]:
    soup = BeautifulSoup(html, "html.parser")
    items: list[dict[str, Any]] = []
    for tr in soup.select("table.type_2 tr"):
        a = tr.select_one("a.tltle")
        if not a:
            continue
        tds = tr.select("td")
        if len(tds) < 5:
            continue
        href = a.get("href", "")
        m = re.search(r"code=(\d+)", href)
        if not m:
            continue
        name = a.get_text(strip=True)
        if not _is_common_stock(name):
            continue
        rate_txt = tds[4].get_text(strip=True).replace("%", "").replace("+", "")
        try:
            change_pct = float(rate_txt)
        except ValueError:
            continue
        if abs(change_pct) < min_change:
            continue
        price_txt = tds[1].get_text(strip=True).replace(",", "")
        try:
            close = float(price_txt)
        except ValueError:
            close = None
        vol_txt = tds[5].get_text(strip=True).replace(",", "") if len(tds) > 5 else ""
        try:
            volume = int(vol_txt)
        except ValueError:
            volume = None
        items.append(
            {
                "symbol": m.group(1),
                "name": name,
                "close": close,
                "change_pct": change_pct,
                "volume": volume,
            }
        )
    return items


def _fetch_movers(market: str) -> dict[str, list[dict[str, Any]]]:
    """market: KOSPI | KOSDAQ"""
    sosok = "0" if market == "KOSPI" else "1"
    gainers: list[dict[str, Any]] = []
    losers: list[dict[str, Any]] = []
    try:
        with httpx.Client(timeout=15.0, headers={"User-Agent": _NAVER_UA}) as client:
            rise = client.get(
                f"https://finance.naver.com/sise/sise_rise.naver?sosok={sosok}"
            )
            fall = client.get(
                f"https://finance.naver.com/sise/sise_fall.naver?sosok={sosok}"
            )
            rise.raise_for_status()
            fall.raise_for_status()
            gainers = _parse_mover_rows(rise.text, min_change=3.0)[:12]
            losers = _parse_mover_rows(fall.text, min_change=3.0)[:12]
            for row in gainers:
                row["market"] = market
            for row in losers:
                row["market"] = market
    except Exception as e:
        logger.warning("%s 급등·급락 조회 실패: %s", market, e)
    return {"gainers": gainers, "losers": losers}


def _fetch_theme_sectors(limit: int = 10) -> list[dict[str, Any]]:
    return _fetch_group_table("theme", limit=limit, kind="theme")


def _fetch_industries(limit: int = 10) -> list[dict[str, Any]]:
    return _fetch_group_table("upjong", limit=limit, kind="industry")


def _fetch_group_table(
    group_type: str, *, limit: int = 10, kind: str
) -> list[dict[str, Any]]:
    sectors: list[dict[str, Any]] = []
    try:
        with httpx.Client(timeout=15.0, headers={"User-Agent": _NAVER_UA}) as client:
            r = client.get(
                f"https://finance.naver.com/sise/sise_group.naver?type={group_type}"
            )
            r.raise_for_status()
            soup = BeautifulSoup(r.text, "html.parser")
            table = soup.select_one("table.type_1")
            if not table:
                return sectors
            for tr in table.select("tr")[2:]:
                tds = tr.select("td")
                if len(tds) < 2:
                    continue
                a = tr.select_one("a")
                if not a:
                    continue
                name = a.get_text(strip=True)
                chg_txt = tds[1].get_text(strip=True).replace("%", "").replace("+", "")
                try:
                    change_pct = float(chg_txt)
                except ValueError:
                    continue
                href = a.get("href", "")
                m = re.search(r"no=(\d+)", href)
                item: dict[str, Any] = {
                    "name": name,
                    "change_pct": change_pct,
                    "kind": kind,
                    "group_no": m.group(1) if m else None,
                }
                if kind == "theme":
                    item["theme_no"] = item["group_no"]
                sectors.append(item)
            sectors.sort(key=lambda x: x["change_pct"], reverse=True)
            return sectors[:limit]
    except Exception as e:
        logger.warning("%s 그룹 조회 실패: %s", group_type, e)
    return sectors


def _symbol_from_href(href: str) -> str:
    m = re.search(r"code=(\d+)", href or "")
    return m.group(1) if m else ""


def _parse_quant_rows(html: str, *, limit: int = 10) -> list[dict[str, Any]]:
    soup = BeautifulSoup(html, "html.parser")
    items: list[dict[str, Any]] = []
    for tr in soup.select("table.type_2 tr"):
        a = tr.select_one("a")
        if not a:
            continue
        tds = tr.select("td")
        if len(tds) < 6:
            continue
        name = a.get_text(strip=True)
        if not _is_common_stock(name):
            continue
        try:
            change_pct = float(
                tds[4].get_text(strip=True).replace("%", "").replace("+", "")
            )
            volume = int(tds[5].get_text(strip=True).replace(",", ""))
            close_txt = tds[2].get_text(strip=True).replace(",", "")
            close = int(close_txt) if close_txt.isdigit() else None
        except ValueError:
            continue
        items.append(
            {
                "symbol": _symbol_from_href(a.get("href", "")),
                "name": name,
                "close": close,
                "change_pct": change_pct,
                "volume": volume,
            }
        )
        if len(items) >= limit:
            break
    return items


def _fetch_volume_rank(market: str, *, limit: int = 10) -> list[dict[str, Any]]:
    sosok = "0" if market == "KOSPI" else "1"
    try:
        with httpx.Client(timeout=15.0, headers={"User-Agent": _NAVER_UA}) as client:
            r = client.get(
                f"https://finance.naver.com/sise/sise_quant.naver?sosok={sosok}"
            )
            r.raise_for_status()
            rows = _parse_quant_rows(r.text, limit=limit)
            for row in rows:
                row["market"] = market
            return rows
    except Exception as e:
        logger.warning("%s 거래량 순위 조회 실패: %s", market, e)
    return []


def _parse_upper_rows(table: Any, *, market: str, limit: int = 10) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for tr in table.select("tr"):
        tds = tr.select("td")
        if len(tds) < 8:
            continue
        a = tr.select_one("a")
        if not a:
            continue
        name = a.get_text(strip=True)
        if not _is_common_stock(name):
            continue
        try:
            close = int(tds[4].get_text(strip=True).replace(",", ""))
            change_pct = float(
                tds[6].get_text(strip=True).replace("%", "").replace("+", "")
            )
            volume = int(tds[7].get_text(strip=True).replace(",", ""))
        except ValueError:
            continue
        items.append(
            {
                "symbol": _symbol_from_href(a.get("href", "")),
                "name": name,
                "close": close,
                "change_pct": change_pct,
                "volume": volume,
                "market": market,
            }
        )
        if len(items) >= limit:
            break
    return items


def _fetch_upper_limits(*, limit: int = 10) -> dict[str, list[dict[str, Any]]]:
    out: dict[str, list[dict[str, Any]]] = {"kospi": [], "kosdaq": []}
    try:
        with httpx.Client(timeout=15.0, headers={"User-Agent": _NAVER_UA}) as client:
            r = client.get("https://finance.naver.com/sise/sise_upper.naver")
            r.raise_for_status()
            soup = BeautifulSoup(r.text, "html.parser")
            for h in soup.select("h4"):
                title = h.get_text(strip=True)
                if title == "코스피":
                    table = h.find_next("table", class_="type_5")
                    if table:
                        out["kospi"] = _parse_upper_rows(
                            table, market="KOSPI", limit=limit
                        )
                elif title == "코스닥":
                    table = h.find_next("table", class_="type_5")
                    if table:
                        out["kosdaq"] = _parse_upper_rows(
                            table, market="KOSDAQ", limit=limit
                        )
    except Exception as e:
        logger.warning("상한가 조회 실패: %s", e)
    return out


def _parse_deal_rank_tables(html: str, *, market: str) -> dict[str, list[dict[str, Any]]]:
    """외국인·기관 순매수/순매도 상위 — 네이버 type_r1 (금액: 천원)."""
    soup = BeautifulSoup(html, "html.parser")
    tables = soup.select("table.type_r1")
    buy: list[dict[str, Any]] = []
    sell: list[dict[str, Any]] = []
    for idx, table in enumerate(tables[:2]):
        rows: list[dict[str, Any]] = []
        for tr in table.select("tr"):
            a = tr.select_one("a")
            if not a:
                continue
            name = a.get_text(strip=True)
            if not _is_common_stock(name):
                continue
            tds = tr.select("td")
            if len(tds) < 3:
                continue
            raw = tds[2].get_text(strip=True).replace(",", "")
            net_amount_억: Optional[float] = None
            if raw.lstrip("-").isdigit():
                # 네이버: 천원 단위 → 억원 (1억 = 100,000천원)
                net_amount_억 = round(int(raw) / 100_000, 1)
            rows.append(
                {
                    "symbol": _symbol_from_href(a.get("href", "")),
                    "name": name,
                    "net_amount_억": net_amount_억,
                    "market": market,
                }
            )
        if idx == 0:
            buy = rows[:10]
        else:
            sell = rows[:10]
    return {"buy": buy, "sell": sell}


def _fetch_investor_rank(investor_gubun: str, label: str) -> dict[str, Any]:
    try:
        with httpx.Client(timeout=15.0, headers={"User-Agent": _NAVER_UA}) as client:
            r = client.get(
                "https://finance.naver.com/sise/sise_deal_rank.naver",
                params={"investor_gubun": investor_gubun},
            )
            r.raise_for_status()
            tables = _parse_deal_rank_tables(r.text, market="MIXED")
            return {"label": label, **tables}
    except Exception as e:
        logger.warning("%s 매매 상위 조회 실패: %s", label, e)
    return {"label": label, "buy": [], "sell": []}


def _fetch_popular_search(*, limit: int = 10) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    try:
        with httpx.Client(timeout=15.0, headers={"User-Agent": _NAVER_UA}) as client:
            r = client.get("https://finance.naver.com/sise/lastsearch2.naver")
            r.raise_for_status()
            soup = BeautifulSoup(r.text, "html.parser")
            rank = 0
            for tr in soup.select("table tr"):
                a = tr.select_one("a")
                if not a:
                    continue
                href = a.get("href", "")
                symbol = _symbol_from_href(href)
                if not symbol:
                    continue
                name = a.get_text(strip=True)
                if not name or name in {x["name"] for x in items}:
                    continue
                rank += 1
                tds = tr.select("td")
                # 컬럼 구조: [0]순위 [1]종목명 [2]검색비율% [3]현재가 [4]전일비(하락/상승+금액) [5]등락률% ...
                price: int | None = None
                change_pct: float | None = None
                if len(tds) > 3:
                    try:
                        price = int(tds[3].get_text(strip=True).replace(",", ""))
                    except ValueError:
                        pass
                if len(tds) > 5:
                    try:
                        change_pct = float(tds[5].get_text(strip=True).replace("%", "").replace(",", "").strip())
                    except ValueError:
                        pass
                items.append(
                    {
                        "rank": rank,
                        "symbol": symbol,
                        "name": name,
                        "close": price,
                        "change_pct": change_pct,
                    }
                )
                if len(items) >= limit:
                    break
    except Exception as e:
        logger.warning("인기 검색 종목 조회 실패: %s", e)
    return items


def _fetch_index_chart(code: str = "KOSPI") -> list[dict[str, Any]]:
    points: list[dict[str, Any]] = []
    try:
        with httpx.Client(timeout=12.0, headers={"User-Agent": _NAVER_UA}) as client:
            r = client.get(
                "https://api.stock.naver.com/chart/domestic/index/"
                f"{code}/minute",
                params={"period": "1", "withPrevClose": "true"},
                headers={"Accept": "application/json"},
            )
            r.raise_for_status()
            for row in r.json():
                dt = str(row.get("localDateTime", ""))
                if len(dt) < 12:
                    continue
                hhmm = f"{dt[8:10]}:{dt[10:12]}"
                points.append(
                    {
                        "time": hhmm,
                        "price": round(float(row.get("currentPrice", 0)), 2),
                        "volume": int(row.get("accumulatedTradingVolume", 0) or 0),
                    }
                )
    except Exception as e:
        logger.warning("%s 분봉 차트 조회 실패: %s", code, e)
    return points


def _fetch_macro() -> list[dict[str, Any]]:
    from core.us_market_report import _fetch_ticker_group

    return _fetch_ticker_group(KR_MACRO_TICKERS, "fx")


def _load_disk_cache() -> Optional[dict[str, Any]]:
    if not _CACHE_PATH.is_file():
        return None
    try:
        data = json.loads(_CACHE_PATH.read_text(encoding="utf-8"))
        if data.get("session_date") == _kst_today():
            return data
    except (json.JSONDecodeError, OSError):
        pass
    return None


def _save_disk_cache(payload: dict[str, Any]) -> None:
    _CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    _CACHE_PATH.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def fetch_kr_market_snapshot(*, force: bool = False) -> dict[str, Any]:
    """국내 증시 종합 스냅샷 — 당일 디스크 캐시 우선."""
    if not force:
        cached = _load_disk_cache()
        if cached:
            return cached

    indices = _fetch_naver_indices()
    macro = _fetch_macro()
    breadth = _fetch_market_breadth()
    kospi_movers = _fetch_movers("KOSPI")
    kosdaq_movers = _fetch_movers("KOSDAQ")
    sectors = _fetch_theme_sectors(10)
    industries = _fetch_industries(10)
    upper_limits = _fetch_upper_limits(limit=8)
    volume_rank = {
        "kospi": _fetch_volume_rank("KOSPI", limit=10),
        "kosdaq": _fetch_volume_rank("KOSDAQ", limit=10),
    }
    investor_flow = {
        "foreign": _fetch_investor_rank("9000", "외국인"),
        "institution": _fetch_investor_rank("1000", "기관"),
    }
    popular_search = _fetch_popular_search(limit=10)
    index_chart = {
        "kospi": _fetch_index_chart("KOSPI"),
        "kosdaq": _fetch_index_chart("KOSDAQ"),
    }

    hot_gainers = sorted(
        kospi_movers["gainers"] + kosdaq_movers["gainers"],
        key=lambda x: x.get("change_pct", 0),
        reverse=True,
    )[:15]

    now = _kst_now()
    payload: dict[str, Any] = {
        "session_date": _kst_today(),
        "indices": indices,
        "macro": macro,
        "market_stats": breadth,
        "movers": {
            "kospi": kospi_movers,
            "kosdaq": kosdaq_movers,
            "hot_gainers": hot_gainers,
        },
        "sectors": sectors,
        "industries": industries,
        "rankings": {
            "upper_limit": upper_limits,
            "volume": volume_rank,
        },
        "investor_flow": investor_flow,
        "popular_search": popular_search,
        "index_chart": index_chart,
        "fetched_at": now.isoformat(),
        "fetched_at_label": now.strftime("%Y-%m-%d %H:%M KST"),
        "source": "naver+yfinance",
    }
    try:
        _save_disk_cache(payload)
    except OSError as e:
        logger.warning("KR 스냅샷 캐시 저장 실패: %s", e)
    return payload


def _parse_group_detail_table(
    table: Any, *, group_type: str, limit: int = 10
) -> list[dict[str, Any]]:
    """테마/업종 상세 페이지 type_5 테이블 → 종목 목록 (등락률 내림차순)."""
    close_idx = 2 if group_type == "theme" else 1
    pct_idx = 4 if group_type == "theme" else 3
    items: list[dict[str, Any]] = []
    for tr in table.select("tr"):
        a = tr.select_one("a")
        if not a:
            continue
        sym = _symbol_from_href(a.get("href", ""))
        if not sym:
            continue
        name = a.get_text(strip=True)
        if not _is_common_stock(name):
            continue
        tds = tr.select("td")
        if len(tds) <= pct_idx:
            continue
        try:
            close_txt = tds[close_idx].get_text(strip=True).replace(",", "")
            close = int(close_txt) if close_txt.isdigit() else None
            change_pct = float(
                tds[pct_idx].get_text(strip=True).replace("%", "").replace("+", "")
            )
        except (ValueError, IndexError):
            continue
        items.append(
            {
                "symbol": sym,
                "name": name,
                "close": close,
                "change_pct": change_pct,
                "market": "KRX",
            }
        )
    items.sort(key=lambda x: x.get("change_pct", 0), reverse=True)
    return items[:limit]


def fetch_kr_group_stocks(
    group_type: str,
    group_no: str,
    *,
    limit: int = 10,
) -> dict[str, Any]:
    """
    네이버 테마(type=theme) / 업종(type=upjong) 구성 종목 상위 N개.
    group_no: sise_group 테이블의 no 파라미터
    """
    gt = (group_type or "").strip().lower()
    if gt not in ("theme", "upjong", "industry"):
        raise ValueError("group_type은 theme 또는 upjong(upjong/industry) 이어야 합니다")
    naver_type = "theme" if gt == "theme" else "upjong"
    no = (group_no or "").strip()
    if not no.isdigit():
        raise ValueError("group_no가 올바르지 않습니다")

    limit = max(1, min(limit, 30))
    try:
        with httpx.Client(timeout=15.0, headers={"User-Agent": _NAVER_UA}) as client:
            r = client.get(
                "https://finance.naver.com/sise/sise_group_detail.naver",
                params={"type": naver_type, "no": no},
            )
            r.raise_for_status()
            soup = BeautifulSoup(r.text, "html.parser")
            table = soup.select_one("table.type_5")
            if not table:
                return {
                    "group_type": naver_type,
                    "group_no": no,
                    "name": None,
                    "stocks": [],
                }
            title_el = soup.select_one("h4") or soup.select_one(".sub_tit")
            group_name = title_el.get_text(strip=True) if title_el else None
            stocks = _parse_group_detail_table(
                table, group_type=naver_type, limit=limit
            )
            return {
                "group_type": naver_type,
                "group_no": no,
                "name": group_name,
                "stocks": stocks,
            }
    except ValueError:
        raise
    except Exception as e:
        logger.warning("그룹 종목 조회 실패 %s/%s: %s", naver_type, no, e)
        raise ValueError(f"그룹 종목을 불러오지 못했습니다: {e}") from e
