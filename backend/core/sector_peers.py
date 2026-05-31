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
