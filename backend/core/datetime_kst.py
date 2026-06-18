"""UTC 저장 · KST 표시 · 미국 거래일 계산."""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

KST = timezone(timedelta(hours=9))


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def kst_now() -> datetime:
    return datetime.now(KST)


def kst_today_str() -> str:
    return kst_now().strftime("%Y-%m-%d")


def ensure_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def format_utc_iso(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    return ensure_utc(dt).strftime("%Y-%m-%dT%H:%M:%S") + "Z"


def format_kst_label(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    return ensure_utc(dt).astimezone(KST).strftime("%Y-%m-%d %H:%M KST")


def _observed_holiday(d: date) -> date:
    if d.weekday() == 5:
        return d - timedelta(days=1)
    if d.weekday() == 6:
        return d + timedelta(days=1)
    return d


def _nth_weekday(year: int, month: int, weekday: int, n: int) -> date:
    """month의 n번째 weekday (0=Mon)."""
    d = date(year, month, 1)
    shift = (weekday - d.weekday()) % 7
    d = d + timedelta(days=shift + 7 * (n - 1))
    return d


def _last_weekday(year: int, month: int, weekday: int) -> date:
    if month == 12:
        d = date(year + 1, 1, 1) - timedelta(days=1)
    else:
        d = date(year, month + 1, 1) - timedelta(days=1)
    shift = (d.weekday() - weekday) % 7
    return d - timedelta(days=shift)


def _easter_sunday(year: int) -> date:
    """Gregorian Easter Sunday (Anonymous algorithm)."""
    a = year % 19
    b = year // 100
    c = year % 100
    d = b // 4
    e = b % 4
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i = c // 4
    k = c % 4
    l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l) // 451
    month = (h + l - 7 * m + 114) // 31
    day = ((h + l - 7 * m + 114) % 31) + 1
    return date(year, month, day)


def nyse_holidays(year: int) -> set[date]:
    """NYSE 전일 휴장일 (주요 고정·가변 휴일)."""
    holidays: set[date] = {
        _observed_holiday(date(year, 1, 1)),
        _nth_weekday(year, 1, 0, 3),
        _nth_weekday(year, 2, 0, 3),
        _easter_sunday(year) - timedelta(days=2),
        _last_weekday(year, 5, 0),
        _observed_holiday(date(year, 7, 4)),
        _nth_weekday(year, 9, 0, 1),
        _nth_weekday(year, 11, 3, 4),
        _observed_holiday(date(year, 12, 25)),
    }
    if year >= 2021:
        holidays.add(_observed_holiday(date(year, 6, 19)))
    return holidays


def is_nyse_trading_day(d: date) -> bool:
    if d.weekday() >= 5:
        return False
    return d not in nyse_holidays(d.year)


def previous_us_session_date(report_date: str) -> str:
    """report_date 직전 미국 거래일 (주말·NYSE 휴일 제외)."""
    d = datetime.strptime(report_date, "%Y-%m-%d").date() - timedelta(days=1)
    for _ in range(366):
        if is_nyse_trading_day(d):
            return d.strftime("%Y-%m-%d")
        d -= timedelta(days=1)
    return d.strftime("%Y-%m-%d")
