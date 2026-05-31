"""
core/issue_event_date.py
StockIssue.event_date 결정 — 차트 급등락 연결용
"""
from __future__ import annotations

import re
from datetime import datetime
from typing import Optional

from config.database import IntelContent


def _parse_dates_from_text(text: str, ref_year: Optional[int] = None) -> list[str]:
    if not text:
        return []
    year = ref_year or datetime.utcnow().year
    found: list[str] = []

    for m in re.finditer(r"(20\d{2})[-./](\d{1,2})[-./](\d{1,2})", text):
        found.append(f"{m.group(1)}-{m.group(2).zfill(2)}-{m.group(3).zfill(2)}")

    for m in re.finditer(r"(\d{1,2})월\s*(\d{1,2})일", text):
        found.append(f"{year}-{m.group(1).zfill(2)}-{m.group(2).zfill(2)}")

    return found


def resolve_issue_event_date(
    content: IntelContent,
    issue_summary: str = "",
    source_title: str = "",
) -> tuple[Optional[str], Optional[str]]:
    """
    차트 연결 가능 날짜와 출처 반환.
    (None, None) 이면 차트 자동 연결하지 않음 — 타임라인에만 표시.
    """
    if content.published_at:
        return content.published_at.strftime("%Y-%m-%d"), "published_at"

    ref_year = content.published_at.year if content.published_at else datetime.utcnow().year
    combined = f"{issue_summary or ''} {source_title or ''}"

    for label, text in (
        ("extracted_summary", issue_summary or ""),
        ("extracted_title", source_title or ""),
        ("extracted", combined),
    ):
        dates = _parse_dates_from_text(text, ref_year)
        if dates:
            return dates[0], label if label != "extracted" else "extracted"

    return None, None
