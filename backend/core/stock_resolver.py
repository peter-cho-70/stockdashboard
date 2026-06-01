"""
core/stock_resolver.py
종목명 → 종목코드 강화 매핑
"""
from __future__ import annotations

import logging
import re
from datetime import date
from typing import Optional

from sqlalchemy.orm import Session

from config.database import Stock

logger = logging.getLogger(__name__)

_NAME_ALIASES: dict[str, str] = {
    "삼성전자우": "삼성전자",
    "삼성sdi": "삼성SDI",
    "삼성바이오": "삼성바이오로직스",
    "sk하이": "SK하이닉스",
    "sk이노": "SK이노베이션",
    "sk바이오": "SK바이오사이언스",
    "현대모비": "현대모비스",
    "lg에너지": "LG에너지솔루션",
    "lg화학우": "LG화학",
    "엔씨": "엔씨소프트",
    "카뱅": "카카오뱅크",
    "posco": "POSCO홀딩스",
    "posco홀딩스": "POSCO홀딩스",
    "삼전": "삼성전자",
    "하이닉": "SK하이닉스",
    "하이닉스": "SK하이닉스",
}

_STATIC_MAP: dict[str, str] = {
    "삼성전자": "005930",
    "sk하이닉스": "000660",
    "lg에너지솔루션": "373220",
    "삼성sdi": "006400",
    "삼성바이오로직스": "207940",
    "셀트리온": "068270",
    "현대차": "005380",
    "기아": "000270",
    "현대모비스": "012330",
    "posco홀딩스": "005490",
    "카카오": "035720",
    "네이버": "035420",
    "kakao": "035720",
    "naver": "035420",
    "카카오뱅크": "323410",
    "카카오페이": "377300",
    "lg화학": "051910",
    "sk이노베이션": "096770",
    "한화에어로스페이스": "012450",
    "크래프톤": "259960",
    "엔씨소프트": "036570",
    "kb금융": "105560",
    "신한지주": "055550",
}

_cache: dict[str, Optional[str]] = {}
_krx_ticker_map: dict[str, str] = {}
_krx_loaded = False


def _normalize_stock_name(name: str) -> str:
    """괄호·(주) 등 제거 후 비교용 이름."""
    s = (name or "").strip()
    s = re.sub(r"\([^)]*\)", "", s)
    s = re.sub(r"（[^）]*）", "", s)
    s = re.sub(r"㈜|주식회사|\(주\)|\(유\)", "", s, flags=re.IGNORECASE)
    s = re.sub(r"\s+", "", s)
    return s.strip()


def _krx_fuzzy_match(query: str) -> Optional[str]:
    """KRX 전체 목록에서 부분 일치 (정확·포함·단일 후보)."""
    q = _normalize_stock_name(query)
    if len(q) < 2:
        return None
    _load_krx_tickers()
    ql = q.lower()

    for k, v in _krx_ticker_map.items():
        if k.lower() == ql:
            return v

    contains = [(k, v) for k, v in _krx_ticker_map.items() if ql in k.lower()]
    if len(contains) == 1:
        return contains[0][1]
    if contains:
        contains.sort(key=lambda x: len(x[0]))
        return contains[0][1]

    reverse = [(k, v) for k, v in _krx_ticker_map.items() if k.lower().startswith(ql)]
    if len(reverse) == 1:
        return reverse[0][1]
    if reverse:
        reverse.sort(key=lambda x: len(x[0]))
        return reverse[0][1]

    return None


def _load_krx_tickers() -> None:
    global _krx_loaded
    if _krx_loaded:
        return
    try:
        from pykrx import stock as krx
        today = date.today().strftime("%Y%m%d")
        for market in ("KOSPI", "KOSDAQ"):
            try:
                tickers = krx.get_market_ticker_list(today, market=market)
                for t in tickers:
                    try:
                        name = krx.get_market_ticker_name(t)
                        if name:
                            _krx_ticker_map[name.strip()] = t
                    except Exception:
                        continue
            except Exception as e:
                logger.warning("pykrx %s load failed: %s", market, e)
        _krx_loaded = True
        logger.info("pykrx tickers loaded: %d", len(_krx_ticker_map))
    except ImportError:
        logger.error("pykrx not installed")
        _krx_loaded = True


def resolve_symbol(name: str, db: Optional[Session] = None) -> Optional[str]:
    if not name or not name.strip():
        return None

    raw = name.strip()
    lower = raw.lower()

    if lower in _cache:
        return _cache[lower]

    variants: list[str] = []
    for v in (raw, _normalize_stock_name(raw)):
        if v and v not in variants:
            variants.append(v)
        canon = _NAME_ALIASES.get(v.lower(), v)
        if canon not in variants:
            variants.append(canon)
        norm = _normalize_stock_name(canon)
        if norm and norm not in variants:
            variants.append(norm)

    for candidate in variants:
        cl = candidate.lower()
        for key, sym in _STATIC_MAP.items():
            if key == cl:
                _cache[lower] = sym
                return sym

        if db:
            stock = db.query(Stock).filter(Stock.name == candidate).first()
            if not stock and len(candidate) >= 4:
                stock = db.query(Stock).filter(Stock.name.contains(candidate[:4])).first()
            if stock and stock.symbol:
                _cache[lower] = stock.symbol
                return stock.symbol

        _load_krx_tickers()
        if candidate in _krx_ticker_map:
            sym = _krx_ticker_map[candidate]
            _cache[lower] = sym
            return sym

        sym = _krx_fuzzy_match(candidate)
        if sym:
            _cache[lower] = sym
            logger.info("fuzzy match '%s' -> %s", raw, sym)
            return sym

    _cache[lower] = None
    return None
