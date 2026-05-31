"""
core/stock_resolver.py
종목명 → 종목코드 강화 매핑
"""
from __future__ import annotations

import logging
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

    canonical = _NAME_ALIASES.get(lower, raw)

    for key, sym in _STATIC_MAP.items():
        if key == lower or key == canonical.lower():
            _cache[lower] = sym
            return sym

    if db:
        stock = db.query(Stock).filter(Stock.name == canonical).first()
        if not stock and len(canonical) >= 4:
            stock = db.query(Stock).filter(Stock.name.contains(canonical[:4])).first()
        if stock:
            _cache[lower] = stock.symbol
            return stock.symbol

    _load_krx_tickers()
    if canonical in _krx_ticker_map:
        sym = _krx_ticker_map[canonical]
        _cache[lower] = sym
        return sym

    if len(canonical) >= 3:
        prefix = canonical[:3]
        for k, v in _krx_ticker_map.items():
            if k.startswith(prefix):
                _cache[lower] = v
                logger.info("partial match '%s' -> '%s'(%s)", raw, k, v)
                return v

    _cache[lower] = None
    return None
