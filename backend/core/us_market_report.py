"""
미국 증시 지수·매크로 지표 수집(yfinance) + 아침 리포트 AI 생성
"""
from __future__ import annotations

import json
import logging
import math
import re
import xml.etree.ElementTree as ET
from datetime import date, datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from typing import Any, Literal, Optional

import httpx

from sqlalchemy.orm import Session

from config.database import MacroSignal, UsMarketReport
from config.settings import get_settings
from core.gemini_client import GeminiClient

logger = logging.getLogger(__name__)


def _safe_float(value: Any, *, ndigits: int = 2) -> Optional[float]:
    """NaN/Inf 를 None 으로 — JSON 직렬화 오류 방지."""
    try:
        num = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(num):
        return None
    return round(num, ndigits)


def sanitize_for_json(value: Any) -> Any:
    """응답 직렬화 전 NaN/Inf 제거 (DB에 이미 저장된 데이터 대비)."""
    if isinstance(value, dict):
        return {k: sanitize_for_json(v) for k, v in value.items()}
    if isinstance(value, list):
        return [sanitize_for_json(v) for v in value]
    if isinstance(value, float) and not math.isfinite(value):
        return None
    return value


# (표시명, yfinance 티커, unit: index|fx|yield|price)
US_INDEX_TICKERS: list[tuple[str, str, str]] = [
    ("S&P 500", "^GSPC", "index"),
    ("NASDAQ", "^IXIC", "index"),
    ("DOW", "^DJI", "index"),
    ("러셀 2000", "^RUT", "index"),
    ("필라델피아 반도체", "^SOX", "index"),
    ("VIX", "^VIX", "index"),
]

US_FUTURES_TICKERS: list[tuple[str, str, str]] = [
    ("S&P 500 선물", "ES=F", "futures"),
    ("NASDAQ 선물", "NQ=F", "futures"),
    ("DOW 선물", "YM=F", "futures"),
    ("러셀 2000 선물", "RTY=F", "futures"),
]

KST = timezone(timedelta(hours=9))
NEWS_MAX_AGE_HOURS = 72

COMMODITY_TICKERS: list[tuple[str, str, str]] = [
    ("WTI 유가", "CL=F", "price"),
]

FX_TICKERS: list[tuple[str, str, str]] = [
    ("달러인덱스", "DX-Y.NYB", "index"),
    ("원/달러", "KRW=X", "fx"),
    ("위안/달러", "CNY=X", "fx"),
    ("엔/달러", "JPY=X", "fx"),
]

TREASURY_TICKERS: list[tuple[str, str, str]] = [
    ("국채 10년", "^TNX", "yield"),
    ("국채 2년", "2YY=F", "yield"),
    ("국채 3개월", "^IRX", "yield"),
]

US_STOCK_TICKERS: list[tuple[str, str, str]] = [
    ("애플", "AAPL", "stock"),
    ("마이크로소프트", "MSFT", "stock"),
    ("엔비디아", "NVDA", "stock"),
    ("아마존", "AMZN", "stock"),
    ("알파벳", "GOOGL", "stock"),
    ("메타", "META", "stock"),
    ("테슬라", "TSLA", "stock"),
]

NEWS_SEARCH: list[tuple[str, str]] = [
    ("us_indices", "미국 증시 나스닥 S&P500 마감 시황"),
    ("commodity", "WTI 유가 국제유가 전망"),
    ("fx", "달러인덱스 원달러 환율 엔화 위안"),
    ("treasury", "미국 국채 수익률 10년 금리"),
    ("us_stocks", "미국 빅테크 주가 엔비디아 애플 마감"),
]

INTERPRETATION_TOPICS = ("us_indices", "commodity", "fx", "treasury", "us_stocks")

REPORT_SYSTEM = """당신은 한국 투자자를 위한 미국 증시 아침 브리핑 작성자입니다.
제공된 시세 수치와 뉴스 검색 결과만 근거로 해석하세요. 기사에 없는 사실은 만들지 마세요.
각 해석에 사용한 뉴스는 source_indexes로 반드시 표시하세요.
뉴스는 발행 시각이 최근 72시간 이내인 것만 인용하세요. 오래된 기사는 무시하고 source_indexes에 넣지 마세요."""

INTERPRETATION_SYSTEM = """당신은 한국 투자자를 위한 미국 증시 해석 작성자입니다.
제공된 시세와 최신 뉴스만 근거로 각 섹션 해석을 작성하세요.
72시간보다 오래된 기사는 사용하지 마세요. source_indexes에는 최신 기사만 넣으세요."""

REPORT_PROMPT = """오늘(KST) 아침 브리핑 날짜: {report_date}
미국 장 세션일(마감 기준): {session_date}

## 미국 주요 지수 (전일 등락률 %)
{us_indices_json}

## 원자재
{commodity_json}

## 환율·달러
{fx_json}

## 미국 국채 수익률 (단위: %)
{treasury_json}

## 주요 미국 주식 (전일 등락률 %)
{us_stocks_json}

## 뉴스 검색 결과 (인덱스 = source_index, 발행 시각 포함 — 최근 72시간만 사용)
{articles_block}

## 최근 매크로 Signal
{macro_context}

JSON으로 반환 (이 형식만):
{{
  "title": "짧은 제목",
  "interpretations": {{
    "us_indices": {{
      "summary": "2~4문장: S&P·나스닥·SOX·VIX 해석",
      "bullets": ["핵심 포인트"],
      "source_indexes": [0, 1]
    }},
    "commodity": {{ "summary": "WTI 유가 해석", "bullets": [], "source_indexes": [] }},
    "fx": {{ "summary": "달러·원·엔·위안 환율 해석", "bullets": [], "source_indexes": [] }},
    "treasury": {{ "summary": "10Y·2Y·3M 국채 해석", "bullets": [], "source_indexes": [] }},
    "us_stocks": {{ "summary": "빅테크·주요 종목 등락 해석", "bullets": [], "source_indexes": [] }}
  }},
  "body_markdown": "전체 종합 마크다운 (한국 장 시사점·리스크 포함)",
  "highlights": ["한 줄 요약 5~7개"]
}}
"""


def _kst_today() -> str:
    return datetime.now(KST).strftime("%Y-%m-%d")


def _kst_now() -> datetime:
    return datetime.now(KST)


def is_us_daytime_kst(now: Optional[datetime] = None) -> bool:
    """KST 08:30~22:59 — 한국 장중·미국 선물 참고 구간."""
    dt = now or _kst_now()
    total = dt.hour * 60 + dt.minute
    return total >= 8 * 60 + 30 and total < 23 * 60


def _previous_us_session_date(report_date: str) -> str:
    d = datetime.strptime(report_date, "%Y-%m-%d").date()
    return (d - timedelta(days=1)).strftime("%Y-%m-%d")


def _format_as_of_kst(ts: datetime) -> str:
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    local = ts.astimezone(KST)
    return local.strftime("%m/%d %H:%M KST")


def _bar_as_of(bar_index: Any) -> tuple[str, str]:
    """(iso, kst_label) from pandas Timestamp or similar."""
    try:
        if hasattr(bar_index, "to_pydatetime"):
            dt = bar_index.to_pydatetime()
        elif hasattr(bar_index, "strftime"):
            dt = datetime.combine(bar_index, datetime.min.time())  # type: ignore[arg-type]
        else:
            dt = datetime.fromisoformat(str(bar_index)[:19])
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.isoformat(), _format_as_of_kst(dt)
    except Exception:
        fallback = _kst_now().isoformat()
        return fallback, _format_as_of_kst(_kst_now())


def _parse_pub_date(pub: str) -> Optional[datetime]:
    if not pub:
        return None
    try:
        dt = parsedate_to_datetime(pub.strip())
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return None


def _news_cutoff(session_date: Optional[str] = None) -> datetime:
    now_utc = datetime.now(timezone.utc)
    by_age = now_utc - timedelta(hours=NEWS_MAX_AGE_HOURS)
    if not session_date:
        return by_age
    try:
        session_start = datetime.strptime(session_date, "%Y-%m-%d").replace(
            tzinfo=timezone.utc
        ) - timedelta(days=1)
        return max(by_age, session_start)
    except ValueError:
        return by_age


def _fetch_ticker_group(
    items: list[tuple[str, str, str]],
    category: str,
    *,
    intraday: bool = False,
) -> list[dict[str, Any]]:
    try:
        import yfinance as yf
    except ImportError:
        logger.error("yfinance 미설치")
        return []

    results: list[dict[str, Any]] = []
    for label, ticker, unit in items:
        try:
            t = yf.Ticker(ticker)
            if intraday:
                hist = t.history(period="1d", interval="5m")
                if hist is None or hist.empty:
                    hist = t.history(period="5d")
            else:
                hist = t.history(period="5d")
            if hist is None or hist.empty:
                results.append({
                    "name": label,
                    "ticker": ticker,
                    "category": category,
                    "unit": unit,
                    "error": "no_data",
                })
                continue
            last = hist.iloc[-1]
            prev = hist.iloc[-2] if len(hist) > 1 else last
            ndigits = 4 if unit in ("fx", "yield") else 2
            close = _safe_float(last["Close"], ndigits=ndigits)
            prev_close = _safe_float(prev["Close"], ndigits=ndigits)
            if close is None or prev_close is None:
                results.append({
                    "name": label,
                    "ticker": ticker,
                    "category": category,
                    "unit": unit,
                    "error": "invalid_price",
                })
                continue
            chg_pct = ((close - prev_close) / prev_close * 100) if prev_close else 0.0
            idx_date = (
                last.name.strftime("%Y-%m-%d")
                if hasattr(last.name, "strftime")
                else str(last.name)[:10]
            )
            as_of_iso, as_of_label = _bar_as_of(last.name)
            results.append(
                {
                    "name": label,
                    "ticker": ticker,
                    "category": category,
                    "unit": unit,
                    "date": idx_date,
                    "as_of": as_of_iso,
                    "as_of_label": as_of_label,
                    "close": close,
                    "change_pct": _safe_float(chg_pct, ndigits=2) or 0.0,
                    "change": _safe_float(close - prev_close, ndigits=ndigits) or 0.0,
                }
            )
        except Exception as e:
            logger.warning("시세 조회 실패 %s (%s): %s", label, ticker, e)
            results.append({
                "name": label,
                "ticker": ticker,
                "category": category,
                "unit": unit,
                "error": str(e)[:120],
            })
    return results


def _fetch_rss_query(
    query: str,
    max_per_query: int = 4,
    *,
    min_published: Optional[datetime] = None,
) -> list[dict[str, str]]:
    items: list[dict[str, str]] = []
    rss_q = f"{query} when:3d"
    try:
        resp = httpx.get(
            "https://news.google.com/rss/search",
            params={"q": rss_q, "hl": "ko", "gl": "KR", "ceid": "KR:ko"},
            timeout=12,
            follow_redirects=True,
            headers={"User-Agent": "Mozilla/5.0 (compatible; StockMind/1.0)"},
        )
        resp.raise_for_status()
        root = ET.fromstring(resp.text)
        raw_items: list[dict[str, Any]] = []
        for item in root.findall(".//item")[: max_per_query * 4]:
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
            pub_el = item.find("pubDate")
            pub = pub_el.text.strip() if pub_el is not None and pub_el.text else ""
            pub_dt = _parse_pub_date(pub)
            if min_published and pub_dt and pub_dt < min_published:
                continue
            raw_items.append({
                "title": title,
                "url": link,
                "published": pub,
                "published_at": pub_dt.isoformat() if pub_dt else None,
                "snippet": snippet,
                "_sort": pub_dt or datetime.min.replace(tzinfo=timezone.utc),
            })
        raw_items.sort(key=lambda x: x["_sort"], reverse=True)
        for raw in raw_items[:max_per_query]:
            items.append({
                "title": raw["title"],
                "url": raw["url"],
                "published": raw["published"],
                "published_at": raw.get("published_at"),
                "snippet": raw["snippet"],
            })
    except Exception as e:
        logger.warning("RSS 검색 실패 (%s): %s", query, e)
    return items


def fetch_us_market_news(
    max_total: int = 24,
    *,
    session_date: Optional[str] = None,
) -> list[dict[str, Any]]:
    """카테고리별 뉴스 검색 — topic 태그 + 전역 index, 최신순·기간 필터."""
    cutoff = _news_cutoff(session_date)
    seen: set[str] = set()
    articles: list[dict[str, Any]] = []
    for topic, query in NEWS_SEARCH:
        for raw in _fetch_rss_query(query, max_per_query=4, min_published=cutoff):
            norm = re.sub(r"\s+", "", raw["title"].lower())
            if norm in seen:
                continue
            seen.add(norm)
            articles.append({
                "index": len(articles),
                "topic": topic,
                "title": raw["title"],
                "url": raw["url"],
                "published": raw.get("published"),
                "published_at": raw.get("published_at"),
                "snippet": raw.get("snippet"),
            })
            if len(articles) >= max_total:
                return articles
    articles.sort(
        key=lambda a: a.get("published_at") or "",
        reverse=True,
    )
    for i, a in enumerate(articles):
        a["index"] = i
    return articles


def _format_articles_block(articles: list[dict[str, Any]]) -> str:
    if not articles:
        return "(뉴스 검색 결과 없음)"
    lines = []
    for a in articles:
        lines.append(f"[{a['index']}] topic={a['topic']}")
        lines.append(f"    제목: {a['title']}")
        if a.get("published") or a.get("published_at"):
            lines.append(f"    발행: {a.get('published') or a.get('published_at')}")
        if a.get("snippet"):
            lines.append(f"    요약: {a['snippet'][:300]}")
        if a.get("url"):
            lines.append(f"    URL: {a['url']}")
    return "\n".join(lines)


def fetch_us_market_snapshot() -> dict[str, Any]:
    return {
        "us_indices": _fetch_ticker_group(US_INDEX_TICKERS, "us_index"),
        "commodity": _fetch_ticker_group(COMMODITY_TICKERS, "commodity", intraday=True),
        "fx": _fetch_ticker_group(FX_TICKERS, "fx", intraday=True),
        "treasury": _fetch_ticker_group(TREASURY_TICKERS, "treasury"),
        "us_stocks": _fetch_ticker_group(US_STOCK_TICKERS, "us_stock"),
        "us_futures": [],
    }


QuoteMode = Literal["auto", "cash", "futures"]


def fetch_live_snapshot(mode: QuoteMode = "auto") -> dict[str, Any]:
    """실시간 시세 스냅샷 — KST 낮에는 미국 선물 포함."""
    use_futures = mode == "futures" or (mode == "auto" and is_us_daytime_kst())
    now_kst = _kst_now()
    snap: dict[str, Any] = {
        "us_indices": _fetch_ticker_group(US_INDEX_TICKERS, "us_index"),
        "us_futures": (
            _fetch_ticker_group(US_FUTURES_TICKERS, "us_futures", intraday=True)
            if use_futures
            else []
        ),
        "commodity": _fetch_ticker_group(COMMODITY_TICKERS, "commodity", intraday=True),
        "fx": _fetch_ticker_group(FX_TICKERS, "fx", intraday=True),
        "treasury": _fetch_ticker_group(TREASURY_TICKERS, "treasury"),
        "us_stocks": _fetch_ticker_group(US_STOCK_TICKERS, "us_stock"),
        "quote_mode": "futures_daytime" if use_futures else "cash_close",
        "fetched_at": now_kst.isoformat(),
        "fetched_at_label": now_kst.strftime("%Y-%m-%d %H:%M KST"),
    }
    report_date = _kst_today()
    session_date = _previous_us_session_date(report_date)
    snap["articles"] = fetch_us_market_news(session_date=session_date)
    return snap


def fetch_us_indices() -> list[dict[str, Any]]:
    """하위 호환 — 전체 플랫 리스트."""
    snap = fetch_us_market_snapshot()
    return (
        snap["us_indices"]
        + snap["commodity"]
        + snap["fx"]
        + snap["treasury"]
        + snap.get("us_stocks", [])
    )


def _empty_snapshot() -> dict[str, Any]:
    return {
        "us_indices": [],
        "us_futures": [],
        "commodity": [],
        "fx": [],
        "treasury": [],
        "us_stocks": [],
        "interpretations": {},
        "articles": [],
    }


def _normalize_snapshot(raw: Any) -> dict[str, Any]:
    base = _empty_snapshot()
    if not raw:
        return base
    if isinstance(raw, dict):
        for key in ("us_indices", "us_futures", "commodity", "fx", "treasury", "us_stocks"):
            if raw.get(key):
                base[key] = raw[key]
        base["interpretations"] = raw.get("interpretations") or {}
        base["articles"] = raw.get("articles") or []
        return base
    if isinstance(raw, list):
        for item in raw:
            if not isinstance(item, dict):
                continue
            cat = item.get("category") or "us_index"
            key = {
                "us_index": "us_indices",
                "us_futures": "us_futures",
                "commodity": "commodity",
                "fx": "fx",
                "treasury": "treasury",
                "us_stock": "us_stocks",
            }.get(cat, "us_indices")
            base[key].append(item)
        return base
    return base


def _macro_context(db: Session, since: str) -> str:
    topics = ["FOMC/연준", "미국경제", "금리", "AI", "미국정책", "환율", "유가"]
    rows = (
        db.query(MacroSignal)
        .filter(MacroSignal.event_date >= since, MacroSignal.topic.in_(topics))
        .order_by(MacroSignal.event_date.desc())
        .limit(12)
        .all()
    )
    if not rows:
        return "(최근 미국 관련 매크로 Signal 없음)"
    lines = []
    for m in rows:
        lines.append(f"- [{m.event_date}] {m.topic} ({m.sentiment}): {(m.summary or '')[:200]}")
    return "\n".join(lines)


def serialize_report(row: UsMarketReport) -> dict[str, Any]:
    highlights = []
    snapshot = _normalize_snapshot(None)
    try:
        if row.indices_json:
            snapshot = _normalize_snapshot(json.loads(row.indices_json))
    except json.JSONDecodeError:
        pass
    try:
        if row.highlights_json:
            highlights = json.loads(row.highlights_json)
    except json.JSONDecodeError:
        pass

    all_items = (
        snapshot["us_indices"]
        + snapshot.get("us_futures", [])
        + snapshot["commodity"]
        + snapshot["fx"]
        + snapshot["treasury"]
        + snapshot.get("us_stocks", [])
    )
    return sanitize_for_json({
        "id": row.id,
        "report_date": row.report_date,
        "session_date": row.session_date,
        "snapshot": snapshot,
        "indices": all_items,
        "interpretations": snapshot.get("interpretations") or {},
        "articles": snapshot.get("articles") or [],
        "highlights": highlights,
        "body_markdown": row.body_markdown,
        "status": row.status,
        "error_message": row.error_message,
        "model": row.model,
        "generated_at": row.generated_at.isoformat() if row.generated_at else None,
    })


def get_report(db: Session, report_date: str) -> Optional[dict[str, Any]]:
    row = db.query(UsMarketReport).filter(UsMarketReport.report_date == report_date).first()
    return serialize_report(row) if row else None


def list_reports(db: Session, days: int = 7) -> list[dict[str, Any]]:
    since = (date.today() - timedelta(days=days)).strftime("%Y-%m-%d")
    rows = (
        db.query(UsMarketReport)
        .filter(UsMarketReport.report_date >= since)
        .order_by(UsMarketReport.report_date.desc())
        .all()
    )
    return [serialize_report(r) for r in rows]


INTERPRETATION_PROMPT = """오늘(KST) 브리핑 날짜: {report_date}
미국 장 세션일(마감 기준): {session_date}

## 미국 주요 지수
{us_indices_json}

## 원자재
{commodity_json}

## 환율·달러
{fx_json}

## 미국 국채 수익률
{treasury_json}

## 주요 미국 주식
{us_stocks_json}

## 최신 뉴스 (72시간 이내만 사용, 발행 시각 참고)
{articles_block}

JSON만 반환:
{{
  "interpretations": {{
    "us_indices": {{ "summary": "2~4문장", "bullets": [], "source_indexes": [] }},
    "commodity": {{ "summary": "", "bullets": [], "source_indexes": [] }},
    "fx": {{ "summary": "", "bullets": [], "source_indexes": [] }},
    "treasury": {{ "summary": "", "bullets": [], "source_indexes": [] }},
    "us_stocks": {{ "summary": "", "bullets": [], "source_indexes": [] }}
  }}
}}
"""


def _run_interpretations(
    client: GeminiClient,
    snapshot: dict[str, Any],
    articles: list[dict[str, Any]],
    report_date: str,
    session_date: str,
) -> dict[str, Any]:
    prompt = INTERPRETATION_PROMPT.format(
        report_date=report_date,
        session_date=session_date,
        us_indices_json=json.dumps(snapshot.get("us_indices") or [], ensure_ascii=False, indent=2),
        commodity_json=json.dumps(snapshot.get("commodity") or [], ensure_ascii=False, indent=2),
        fx_json=json.dumps(snapshot.get("fx") or [], ensure_ascii=False, indent=2),
        treasury_json=json.dumps(snapshot.get("treasury") or [], ensure_ascii=False, indent=2),
        us_stocks_json=json.dumps(snapshot.get("us_stocks") or [], ensure_ascii=False, indent=2),
        articles_block=_format_articles_block(articles),
    )
    data = client.generate_json(
        prompt,
        purpose="미국 장 해석 갱신",
        system_instruction=INTERPRETATION_SYSTEM,
    )
    return (data or {}).get("interpretations") or {}


def refresh_us_report_news(
    db: Session,
    report_date: Optional[str] = None,
    *,
    refresh_quotes: bool = False,
) -> dict[str, Any]:
    """최신 기사 검색 + 해석 갱신 (전체 리포트 재생성 없이)."""
    report_date = report_date or _kst_today()
    row = db.query(UsMarketReport).filter(UsMarketReport.report_date == report_date).first()
    if not row or row.status != "ready":
        raise ValueError("갱신할 준비된 리포트가 없습니다")

    session_date = row.session_date or _previous_us_session_date(report_date)
    snapshot = _normalize_snapshot(json.loads(row.indices_json) if row.indices_json else None)

    if refresh_quotes:
        live = fetch_live_snapshot(mode="auto")
        for key in ("us_indices", "us_futures", "commodity", "fx", "treasury", "us_stocks"):
            if live.get(key):
                snapshot[key] = live[key]

    articles = fetch_us_market_news(session_date=session_date)
    snapshot["articles"] = articles

    settings = get_settings()
    if not settings.gemini_api_key:
        snapshot["interpretations"] = snapshot.get("interpretations") or {}
        row.indices_json = json.dumps(snapshot, ensure_ascii=False)
        db.commit()
        db.refresh(row)
        return serialize_report(row)

    client = GeminiClient(api_key=settings.gemini_api_key, model=settings.gemini_model)
    interpretations = _run_interpretations(
        client, snapshot, articles, report_date, session_date
    )
    snapshot["interpretations"] = interpretations
    row.indices_json = json.dumps(snapshot, ensure_ascii=False)
    row.generated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(row)
    logger.info("미국 리포트 기사·해석 갱신: %s (%d건)", report_date, len(articles))
    return serialize_report(row)


def generate_us_morning_report(
    db: Session,
    report_date: Optional[str] = None,
    *,
    force: bool = False,
) -> dict[str, Any]:
    report_date = report_date or _kst_today()
    session_date = _previous_us_session_date(report_date)

    existing = db.query(UsMarketReport).filter(UsMarketReport.report_date == report_date).first()
    if existing and existing.status == "ready" and not force:
        return serialize_report(existing)

    if not existing:
        existing = UsMarketReport(report_date=report_date, session_date=session_date, status="pending")
        db.add(existing)
        db.commit()
        db.refresh(existing)
    else:
        existing.status = "pending"
        existing.session_date = session_date
        existing.error_message = None
        db.commit()

    settings = get_settings()
    snapshot = fetch_us_market_snapshot()
    articles = fetch_us_market_news(session_date=session_date)
    snapshot["articles"] = articles
    snapshot["interpretations"] = {}

    existing.indices_json = json.dumps(snapshot, ensure_ascii=False)
    db.commit()

    if not settings.gemini_api_key:
        existing.status = "failed"
        existing.error_message = "GEMINI_API_KEY 미설정"
        db.commit()
        raise ValueError(existing.error_message)

    since = (date.today() - timedelta(days=5)).strftime("%Y-%m-%d")
    macro_ctx = _macro_context(db, since)

    client = GeminiClient(api_key=settings.gemini_api_key, model=settings.gemini_model)
    prompt = REPORT_PROMPT.format(
        report_date=report_date,
        session_date=session_date,
        us_indices_json=json.dumps(snapshot["us_indices"], ensure_ascii=False, indent=2),
        commodity_json=json.dumps(snapshot["commodity"], ensure_ascii=False, indent=2),
        fx_json=json.dumps(snapshot["fx"], ensure_ascii=False, indent=2),
        treasury_json=json.dumps(snapshot["treasury"], ensure_ascii=False, indent=2),
        us_stocks_json=json.dumps(snapshot["us_stocks"], ensure_ascii=False, indent=2),
        articles_block=_format_articles_block(articles),
        macro_context=macro_ctx,
    )

    try:
        data = client.generate_json(
            prompt,
            purpose="미국 장 아침 리포트",
            system_instruction=REPORT_SYSTEM,
        )
        if not data:
            raise ValueError("리포트 생성 결과가 비어 있습니다")

        interpretations = data.get("interpretations") or {}
        snapshot["interpretations"] = interpretations
        existing.indices_json = json.dumps(snapshot, ensure_ascii=False)

        body = data.get("body_markdown") or ""
        if not body:
            parts = []
            for topic in INTERPRETATION_TOPICS:
                block = interpretations.get(topic) or {}
                if block.get("summary"):
                    labels = {
                        "us_indices": "미국 지수",
                        "commodity": "유가",
                        "fx": "환율",
                        "treasury": "국채",
                        "us_stocks": "주요 미국주",
                    }
                    parts.append(f"### {labels.get(topic, topic)}\n{block['summary']}")
            body = "\n\n".join(parts) if parts else "해석 생성 실패"

        existing.body_markdown = body
        existing.highlights_json = json.dumps(data.get("highlights") or [], ensure_ascii=False)
        if data.get("title") and not existing.body_markdown.startswith("#"):
            existing.body_markdown = f"# {data['title']}\n\n{existing.body_markdown}"
        existing.status = "ready"
        existing.model = settings.gemini_model
        existing.generated_at = datetime.now(timezone.utc)
        existing.error_message = None
        db.commit()
        db.refresh(existing)
        logger.info("미국 아침 리포트 생성 완료: %s", report_date)
        return serialize_report(existing)
    except Exception as e:
        existing.indices_json = json.dumps(snapshot, ensure_ascii=False)
        existing.status = "failed"
        existing.error_message = str(e)[:500]
        db.commit()
        logger.error("미국 리포트 생성 실패: %s", e)
        raise
