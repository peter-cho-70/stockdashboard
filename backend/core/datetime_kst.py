"""UTC 저장 · KST 표시 공통 유틸."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

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


def previous_us_session_date(report_date: str) -> str:
    """report_date 직전 미국 거래일 (주말 제외)."""
    d = datetime.strptime(report_date, "%Y-%m-%d").date() - timedelta(days=1)
    while d.weekday() >= 5:
        d -= timedelta(days=1)
    return d.strftime("%Y-%m-%d")
