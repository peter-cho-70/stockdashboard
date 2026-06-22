"""
core/auction_pdf_to_case.py
경매허브 — auction_pdf_parser가 추출한 AuctionPdfExtract 딕셔너리를
물건(AuctionCase) 등록 필드로 매핑한다. (원본 Auctionhub의 pdf-to-newcase.ts 대응)
"""
from __future__ import annotations

from typing import Any, Optional


def _non_empty_or_none(v: Any) -> Optional[str]:
    if not isinstance(v, str):
        return None
    s = v.strip()
    return s or None


def _list_title(extracted: dict[str, Any]) -> Optional[str]:
    jibun = (extracted.get("address_jibun") or extracted.get("address") or "").strip()
    debtor = (extracted.get("debtor") or "").strip()
    if jibun and debtor:
        return f"{jibun} · {debtor}"
    return jibun or debtor or None


def _build_memo(extracted: dict[str, Any]) -> Optional[str]:
    parts: list[str] = []
    if extracted.get("court"):
        parts.append(f"법원: {extracted['court']}")
    if extracted.get("auction_type"):
        parts.append(f"구분: {extracted['auction_type']}")
    if extracted.get("creditor"):
        parts.append(f"채권자: {extracted['creditor']}")
    if extracted.get("claim_amount"):
        parts.append(f"청구금액: {int(extracted['claim_amount']):,}원")
    if extracted.get("zoning"):
        parts.append(f"용도지역: {extracted['zoning']}")
    if extracted.get("tenant_deposit_total"):
        parts.append(f"임차보증금합계: {int(extracted['tenant_deposit_total']):,}원")
    notes = (extracted.get("notes") or "").strip()
    if notes:
        parts.append(notes)
    memo = "\n".join(parts).strip()
    return memo or None


def pdf_extract_to_case_fields(extracted: dict[str, Any]) -> dict[str, Any]:
    """AuctionCase 생성/수정에 바로 쓸 수 있는 필드 딕셔너리로 변환한다."""
    return {
        "case_number": _non_empty_or_none(extracted.get("case_number")),
        "address": _non_empty_or_none(extracted.get("address")),
        "list_title": _list_title(extracted),
        "property_type": _non_empty_or_none(extracted.get("property_type")),
        "built_year": _non_empty_or_none(extracted.get("built_year")),
        "household_count": extracted.get("household_count_hint"),
        "land_area_sqm": extracted.get("land_area_sqm"),
        "building_area_sqm": extracted.get("building_area_sqm"),
        "parking_unit_count": extracted.get("parking_unit_count"),
        "appraisal_price": extracted.get("appraisal_price"),
        "min_price": extracted.get("min_price"),
        "bid_date": _non_empty_or_none(extracted.get("bid_date")),
        "memo": _build_memo(extracted),
    }


def pdf_extract_to_tenant_fields(tenant_row: dict[str, Any]) -> dict[str, Any]:
    """대장경매 PDF에서 추출된 임차인 행을 AuctionTenantRecord 생성 필드로 변환한다."""
    notes = tenant_row.get("notes")
    return {
        "unit": tenant_row.get("unit"),
        "occupant_name": tenant_row.get("name"),
        "deposit": tenant_row.get("deposit"),
        "monthly_rent": tenant_row.get("monthly_rent"),
        "move_in_date": tenant_row.get("move_in_date"),
        "confirmed_date": tenant_row.get("confirmed_date"),
        "dividend_request_date": tenant_row.get("dividend_request_date"),
        "inquiry_notes": notes,
    }


def build_warnings(extracted: dict[str, Any]) -> list[str]:
    warnings: list[str] = []
    if not extracted.get("case_number"):
        warnings.append("사건번호를 찾지 못했습니다.")
    if not extracted.get("address"):
        warnings.append("주소를 찾지 못했습니다.")
    if not extracted.get("min_price"):
        warnings.append("최저가를 찾지 못했습니다.")
    if not extracted.get("bid_date"):
        warnings.append("매각기일(입찰일)을 찾지 못했습니다.")
    if extracted.get("auction_status") == "ongoing" and extracted.get("format") in (
        "speedauction",
        "daejangauction",
    ):
        warnings.append("진행 중인 경매 PDF입니다. 낙찰가·가율은 없으며 입찰가 분석 비교 사례로는 부적합할 수 있습니다.")
    return warnings
