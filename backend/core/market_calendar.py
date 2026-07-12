"""
core/market_calendar.py
국내 거래일 계산 — 여러 모듈(price_updater, portfolio)이 "오늘"이 아니라
"최근 거래일" 기준으로 시세·스냅샷을 저장해야 해서 공용으로 분리했다.
(순환 import 방지: price_updater가 portfolio를 import하므로 이 로직은 둘 중
어느 쪽에도 속하면 안 된다.)
"""
from datetime import date, timedelta


def get_latest_trading_date(today: date | None = None) -> date:
    """최근 거래일 반환 (주말 제외). 공휴일은 아직 고려하지 않음."""
    d = today or date.today()
    while d.weekday() >= 5:  # 5=토, 6=일
        d -= timedelta(days=1)
    return d


def get_latest_trading_date_str(today: date | None = None) -> str:
    return get_latest_trading_date(today).strftime("%Y%m%d")
