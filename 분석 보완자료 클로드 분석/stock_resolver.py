"""
core/stock_resolver.py
종목명 → 종목코드 강화 매핑

[문제]
AI가 mentioned_stocks / stock_issues 에 종목명만 반환할 때
symbol = None 이 되면 Watchlist 차트 연동·관련 분석 등 모든 코드 기능이 동작 안 함.

[전략]
1. DB 보유 종목 먼저 (가장 빠름)
2. 정적 별칭 사전 (AI가 자주 쓰는 약칭·오표기 대응)
3. pykrx KRX 전종목 검색 (KOSPI → KOSDAQ 순)
4. 부분 일치 폴백 (앞 2글자 이상)

[캐시]
프로세스 수명 동안 in-memory 캐시로 pykrx 중복 호출 방지.
"""
from __future__ import annotations

import logging
from datetime import date
from typing import Optional

from sqlalchemy.orm import Session

from config.database import Stock

logger = logging.getLogger(__name__)

# ── 정적 별칭 사전 ─────────────────────────────────────────────
# AI 가 자주 다르게 표기하는 종목명 → 정식 종목명 매핑
_NAME_ALIASES: dict[str, str] = {
    # 삼성
    "삼성전자우": "삼성전자",
    "삼성sdi": "삼성SDI",
    "삼성바이오": "삼성바이오로직스",
    # SK
    "sk하이": "SK하이닉스",
    "sk이노": "SK이노베이션",
    "sk바이오": "SK바이오사이언스",
    # 현대
    "현대모비": "현대모비스",
    "현대오토에버": "현대오토에버",
    # LG
    "lg에너지": "LG에너지솔루션",
    "lg화학우": "LG화학",
    # 기타
    "카카오페이": "카카오페이",
    "크래프톤": "크래프톤",
    "셀트리온헬스케어": "셀트리온헬스케어",
    "엔씨소프트": "엔씨소프트",
    "엔씨": "엔씨소프트",
    "카뱅": "카카오뱅크",
    "코스맥스": "코스맥스",
    "포스코": "POSCO홀딩스",
    "posco": "POSCO홀딩스",
    "posco홀딩스": "POSCO홀딩스",
}

# ── 정적 코드 사전 ─────────────────────────────────────────────
# 가장 빈번히 AI 분석에 등장하는 대형주 (pykrx 호출 없이 즉시 반환)
_STATIC_MAP: dict[str, str] = {
    "삼성전자":        "005930",
    "sk하이닉스":      "000660",
    "lg에너지솔루션":  "373220",
    "삼성sdi":        "006400",
    "삼성바이오로직스": "207940",
    "셀트리온":        "068270",
    "현대차":          "005380",
    "기아":            "000270",
    "현대모비스":      "012330",
    "posco홀딩스":    "005490",
    "카카오":          "035720",
    "네이버":          "035420",
    "kakao":           "035720",
    "naver":           "035420",
    "카카오뱅크":      "323410",
    "카카오페이":      "377300",
    "lg화학":          "051910",
    "sk이노베이션":    "096770",
    "한화에어로스페이스": "012450",
    "한화솔루션":      "009830",
    "두산에너빌리티":  "034020",
    "크래프톤":        "259960",
    "엔씨소프트":      "036570",
    "넷마블":          "251270",
    "kb금융":          "105560",
    "신한지주":        "055550",
    "하나금융지주":    "086790",
    "우리금융지주":    "316140",
    "삼성생명":        "032830",
    "삼성화재":        "000810",
    "sk텔레콤":        "017670",
    "kt":              "030200",
    "lg유플러스":      "032640",
    "롯데케미칼":      "011170",
    "금호석유":        "011780",
    "고려아연":        "010130",
    "삼성중공업":      "010140",
    "한국조선해양":    "009540",
    "현대중공업":      "329180",
    "대한항공":        "003490",
    "아시아나항공":    "020560",
}

# ── 프로세스 수명 캐시 ─────────────────────────────────────────
_cache: dict[str, Optional[str]] = {}
_krx_ticker_map: dict[str, str] = {}   # 종목명 → 코드 (pykrx 조회 결과)
_krx_loaded = False


def _load_krx_tickers() -> None:
    """pykrx 전종목 한 번만 로드 → _krx_ticker_map 채우기"""
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
                logger.warning(f"⚠️ pykrx {market} 로드 실패: {e}")
        _krx_loaded = True
        logger.info(f"✅ pykrx 전종목 로드: {len(_krx_ticker_map)}개")
    except ImportError:
        logger.error("❌ pykrx 미설치")
        _krx_loaded = True  # 재시도 방지


def resolve_symbol(name: str, db: Optional[Session] = None) -> Optional[str]:
    """
    종목명 → 종목코드 반환.
    DB, 정적 사전, pykrx 순으로 탐색.
    """
    if not name or not name.strip():
        return None

    raw = name.strip()
    lower = raw.lower()

    # 캐시 hit
    if lower in _cache:
        return _cache[lower]

    # 1) 별칭 정규화
    canonical = _NAME_ALIASES.get(lower, raw)

    # 2) 정적 사전 (대소문자 무시)
    for key, sym in _STATIC_MAP.items():
        if key == lower or key == canonical.lower():
            _cache[lower] = sym
            return sym

    # 3) DB 보유 종목
    if db:
        stock = (
            db.query(Stock)
            .filter(Stock.name == canonical)
            .first()
        )
        if not stock:
            # 부분 일치
            stock = (
                db.query(Stock)
                .filter(Stock.name.contains(canonical[:4]))
                .first()
            )
        if stock:
            _cache[lower] = stock.symbol
            return stock.symbol

    # 4) pykrx 전종목
    _load_krx_tickers()
    if canonical in _krx_ticker_map:
        sym = _krx_ticker_map[canonical]
        _cache[lower] = sym
        return sym

    # 5) 부분 일치 폴백 (앞 3글자 이상)
    if len(canonical) >= 3:
        prefix = canonical[:3]
        for k, v in _krx_ticker_map.items():
            if k.startswith(prefix):
                _cache[lower] = v
                logger.info(f"🔍 부분 매칭: '{raw}' → '{k}'({v})")
                return v

    _cache[lower] = None
    logger.debug(f"⚠️ 종목코드 미발견: '{raw}'")
    return None


def enrich_mentioned_stocks(
    names: list[str],
    db: Optional[Session] = None,
) -> list[dict]:
    """
    mentioned_stocks 이름 목록 → {name, symbol} 딕셔너리 목록 변환.
    signal_extractor, ai_analyzer 에서 사용.
    """
    result = []
    for name in names:
        sym = resolve_symbol(name, db)
        result.append({"name": name.strip(), "symbol": sym})
    return result


def clear_cache() -> None:
    """테스트 또는 재시작 시 캐시 초기화"""
    global _krx_loaded
    _cache.clear()
    _krx_ticker_map.clear()
    _krx_loaded = False
