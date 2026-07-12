"""
core/sector_peers.py
섹터 정규화 및 peer 그룹 매칭

stock.sector (KIS/수동) ↔ AI SectorSignal.sector ("자동차" 등) 간 브릿지
"""
from __future__ import annotations

# canonical → aliases (소문자 비교)
SECTOR_ALIASES: dict[str, list[str]] = {
    "자동차": ["자동차", "운송장비", "운송장비·부품", "자동차부품", "완성차", "auto", "automotive"],
    "반도체": ["반도체", "semiconductor", "chip", "메모리", "시스템반도체"],
    "2차전지": ["2차전지", "배터리", "이차전지", "전지", "ev배터리"],
    "AI·빅테크": ["ai", "빅테크", "인공지능", "big tech", "플랫폼"],
    "바이오·헬스케어": ["바이오", "헬스케어", "제약", "biotech", "healthcare"],
    "금융": ["금융", "은행", "증권", "보험", "finance"],
    "에너지": ["에너지", "정유", "가스", "energy", "oil"],
    "소비재": ["소비재", "유통", "식품", "consumer"],
    "방산": ["방산", "국방", "defense"],
    "부동산·리츠": ["부동산", "리츠", "reit", "건설"],
    "기타": ["기타", "etc", "other", "기타업종"],
}

# 종목코드 → canonical (stock.sector 비어 있을 때 fallback)
SYMBOL_SECTOR_HINT: dict[str, str] = {
    "005380": "자동차",   # 현대차
    "000270": "자동차",   # 기아
    "012330": "자동차",   # 현대모비스
    "005930": "반도체",   # 삼성전자
    "000660": "반도체",   # SK하이닉스
    "373220": "2차전지",  # LG에너지솔루션
    "006400": "2차전지",  # 삼성SDI
}


def normalize_sector(raw: str | None, symbol: str | None = None) -> str | None:
    """임의 섹터 문자열 → canonical 섹터명."""
    if raw:
        lower = raw.strip().lower()
        for canonical, aliases in SECTOR_ALIASES.items():
            for alias in aliases:
                al = alias.lower()
                if al in lower or lower in al:
                    return canonical
        return raw.strip()

    if symbol and symbol in SYMBOL_SECTOR_HINT:
        return SYMBOL_SECTOR_HINT[symbol]
    return None


def sectors_match(
    stock_sector: str | None,
    signal_sector: str,
    symbol: str | None = None,
) -> bool:
    """종목 섹터와 SectorSignal.sector 가 같은 peer 그룹인지."""
    ns = normalize_sector(stock_sector, symbol)
    nss = normalize_sector(signal_sector)
    if ns and nss:
        return ns == nss
    if not stock_sector:
        return False
    ss = stock_sector.strip().lower()
    sg = signal_sector.strip().lower()
    return ss in sg or sg in ss


def stock_name_in_mentioned(stock_name: str, mentioned: list | None) -> bool:
    if not mentioned or not stock_name:
        return False
    name = stock_name.strip()
    for m in mentioned:
        mstr = str(m).strip()
        if name in mstr or mstr in name:
            return True
    return False


def is_krx_stock(stock) -> bool:
    """국내(KRX) 종목 판정 — volatility_forecast 등과 공유하는 단일 기준."""
    m = (stock.market or "").upper()
    return m in ("KRX", "KOSPI", "KOSDAQ", "") or (stock.currency or "KRW").upper() == "KRW"


# 하위 호환 별칭 (기존 내부 사용처)
_is_krx_stock = is_krx_stock


def find_active_stocks_in_sector(db, sector: str) -> list:
    """활성 KRX 종목 중 해당 섹터에 매칭되는 것들. 없으면 보유 종목 전체로 폴백.
    core/signal_tracker.py의 섹터 Signal 사후검증, core/pattern_library.py의 패턴 추출이 공유해서 쓴다."""
    from config.database import Stock

    stocks = db.query(Stock).filter(Stock.is_active == True).all()
    matched = [s for s in stocks if _is_krx_stock(s) and sectors_match(s.sector, sector, s.symbol)]
    if matched:
        return matched
    return [s for s in stocks if _is_krx_stock(s) and (s.qty or 0) > 0]


def find_sector_peers(db, stock, limit: int = 12) -> dict:
    """같은 섹터의 다른 보유·관심 종목 (관계 묶어보기 1단계: 섹터 기반 자동 매칭).

    내가 보유했거나 관심 등록한 종목 중에서만 찾는다 — 전체 시장 종목 중
    섹터만 같은 무관한 종목까지 끌어오면 노이즈가 커지기 때문.
    """
    from config.database import Stock, WatchlistItem

    sector = normalize_sector(stock.sector, stock.symbol)
    if not sector:
        return {"sector": None, "peers": []}

    watched_symbols = {
        w.symbol
        for w in db.query(WatchlistItem).filter(WatchlistItem.symbol.isnot(None)).all()
    }

    candidates = db.query(Stock).filter(Stock.symbol != stock.symbol).all()
    peers = []
    for c in candidates:
        is_holding = bool(c.qty and c.qty > 0 and c.is_active)
        is_watched = c.symbol in watched_symbols
        if not (is_holding or is_watched):
            continue
        if normalize_sector(c.sector, c.symbol) != sector:
            continue
        peers.append({
            "symbol": c.symbol,
            "name": c.name,
            "market": c.market,
            "current_price": c.current_price,
            "change_rate": round(c.change_rate, 2) if c.change_rate else 0,
            "is_holding": is_holding,
            "is_watched": is_watched,
        })

    peers.sort(key=lambda p: (not p["is_holding"], not p["is_watched"], -abs(p["change_rate"])))
    return {"sector": sector, "peers": peers[:limit]}
