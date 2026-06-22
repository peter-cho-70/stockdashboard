"""
core/auction_service.py
경매허브 — 물건(사건)/세입자/입찰 비교사례 CRUD 및 입찰가 제안 계산
"""
from __future__ import annotations

import statistics
from datetime import datetime
from typing import Any, Optional

from sqlalchemy.orm import Session

from config.database import (
    AuctionBidAnalysis,
    AuctionCase,
    AuctionCaseThumbnail,
    AuctionSaleComparable,
    AuctionTenantRecord,
)
from core.auction_files import delete_case_files, serialize_source_document

CASE_FIELDS = [
    "case_number", "address", "list_title", "property_type", "built_year",
    "floor", "household_count", "land_area_sqm", "building_area_sqm",
    "parking_unit_count", "appraisal_price", "min_price", "expected_bid_price",
    "bid_date", "current_round", "status", "priority_level", "memo",
    "market_notes",
]

TENANT_FIELDS = [
    "unit", "occupant_name", "deposit", "monthly_rent", "move_in_date",
    "confirmed_date", "dividend_request_date", "has_opposing_power",
    "dividend_amount", "undivided_amount", "dividend_status",
    "inquiry_notes", "memo",
]

COMPARABLE_FIELDS = [
    "case_number", "address", "appraisal_price", "winning_bid_price",
    "sold_round", "bid_date", "memo",
]


def _thumbnail_urls(case_id: int, thumb: Optional[AuctionCaseThumbnail]) -> dict[str, Optional[str]]:
    if not thumb:
        return {"thumbnail_url": None, "cover_url": None}
    return {
        "thumbnail_url": f"/auction/cases/{case_id}/thumbnail" if thumb.list_stored_name else None,
        "cover_url": f"/auction/cases/{case_id}/cover-source" if thumb.cover_stored_name else None,
    }


def serialize_tenant(row: AuctionTenantRecord) -> dict[str, Any]:
    return {
        "id": row.id,
        "case_id": row.case_id,
        "unit": row.unit,
        "occupant_name": row.occupant_name,
        "deposit": row.deposit,
        "monthly_rent": row.monthly_rent,
        "move_in_date": row.move_in_date,
        "confirmed_date": row.confirmed_date,
        "dividend_request_date": row.dividend_request_date,
        "has_opposing_power": row.has_opposing_power,
        "dividend_amount": row.dividend_amount,
        "undivided_amount": row.undivided_amount,
        "dividend_status": row.dividend_status,
        "inquiry_notes": row.inquiry_notes,
        "memo": row.memo,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


def serialize_comparable(row: AuctionSaleComparable) -> dict[str, Any]:
    return {
        "id": row.id,
        "case_id": row.case_id,
        "case_number": row.case_number,
        "address": row.address,
        "appraisal_price": row.appraisal_price,
        "winning_bid_price": row.winning_bid_price,
        "bid_rate_pct": row.bid_rate_pct,
        "sold_round": row.sold_round,
        "bid_date": row.bid_date,
        "memo": row.memo,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


def serialize_bid_analysis(row: Optional[AuctionBidAnalysis]) -> Optional[dict[str, Any]]:
    if not row:
        return None
    return {
        "peer_count": row.peer_count,
        "median_bid_rate_pct": row.median_bid_rate_pct,
        "suggested_bid_won": row.suggested_bid_won,
        "suggested_bid_rate_pct": row.suggested_bid_rate_pct,
        "range_low_won": row.range_low_won,
        "range_high_won": row.range_high_won,
        "narrative": row.narrative,
        "computed_at": row.computed_at.isoformat() if row.computed_at else None,
    }


def serialize_case_summary(row: AuctionCase) -> dict[str, Any]:
    """물건 목록용 — 가벼운 필드만"""
    return {
        "id": row.id,
        "case_number": row.case_number,
        "address": row.address,
        "list_title": row.list_title,
        "property_type": row.property_type,
        "appraisal_price": row.appraisal_price,
        "min_price": row.min_price,
        "expected_bid_price": row.expected_bid_price,
        "bid_date": row.bid_date,
        "current_round": row.current_round,
        "status": row.status,
        "priority_level": row.priority_level,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
        **_thumbnail_urls(row.id, row.thumbnail),
    }


def serialize_case_detail(row: AuctionCase) -> dict[str, Any]:
    base = {f: getattr(row, f) for f in CASE_FIELDS}
    return {
        "id": row.id,
        **base,
        "extracted_text": row.extracted_text,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
        **_thumbnail_urls(row.id, row.thumbnail),
        "source_documents": [serialize_source_document(d) for d in row.source_documents],
        "tenant_records": [serialize_tenant(t) for t in row.tenant_records],
        "sale_comparables": [serialize_comparable(c) for c in row.sale_comparables],
        "bid_analysis": serialize_bid_analysis(row.bid_analysis),
    }


def list_cases(db: Session) -> list[dict[str, Any]]:
    rows = db.query(AuctionCase).order_by(AuctionCase.updated_at.desc()).all()
    return [serialize_case_summary(r) for r in rows]


def get_case_or_none(db: Session, case_id: int) -> Optional[AuctionCase]:
    return db.query(AuctionCase).filter(AuctionCase.id == case_id).first()


def create_case(db: Session, data: dict[str, Any]) -> AuctionCase:
    if not (data.get("case_number") or "").strip():
        raise ValueError("사건번호는 필수입니다.")
    if not (data.get("address") or "").strip():
        raise ValueError("주소는 필수입니다.")
    row = AuctionCase(**{f: data.get(f) for f in CASE_FIELDS if f in data})
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def update_case(db: Session, case_id: int, data: dict[str, Any]) -> AuctionCase:
    row = get_case_or_none(db, case_id)
    if not row:
        raise ValueError("물건을 찾을 수 없습니다.")
    for f in CASE_FIELDS:
        if f in data:
            setattr(row, f, data[f])
    row.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(row)
    return row


def delete_case(db: Session, case_id: int) -> bool:
    row = get_case_or_none(db, case_id)
    if not row:
        return False
    db.delete(row)
    db.commit()
    delete_case_files(case_id)
    return True


def attach_extracted_text(db: Session, case_id: int, text: str) -> None:
    """최초 등록 PDF의 원문 텍스트를 케이스에도 캐시 (검색·참고용)."""
    row = get_case_or_none(db, case_id)
    if row and not row.extracted_text:
        row.extracted_text = text
        db.commit()


# ── 세입자 분석 ─────────────────────────────────────────────

def list_tenants(db: Session, case_id: int) -> list[dict[str, Any]]:
    rows = (
        db.query(AuctionTenantRecord)
        .filter(AuctionTenantRecord.case_id == case_id)
        .order_by(AuctionTenantRecord.unit.asc())
        .all()
    )
    return [serialize_tenant(r) for r in rows]


def create_tenant(db: Session, case_id: int, data: dict[str, Any]) -> AuctionTenantRecord:
    if not get_case_or_none(db, case_id):
        raise ValueError("물건을 찾을 수 없습니다.")
    row = AuctionTenantRecord(
        case_id=case_id, **{f: data.get(f) for f in TENANT_FIELDS if f in data}
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def update_tenant(db: Session, case_id: int, tenant_id: int, data: dict[str, Any]) -> AuctionTenantRecord:
    row = (
        db.query(AuctionTenantRecord)
        .filter(AuctionTenantRecord.id == tenant_id, AuctionTenantRecord.case_id == case_id)
        .first()
    )
    if not row:
        raise ValueError("세입자 기록을 찾을 수 없습니다.")
    for f in TENANT_FIELDS:
        if f in data:
            setattr(row, f, data[f])
    row.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(row)
    return row


def delete_tenant(db: Session, case_id: int, tenant_id: int) -> bool:
    row = (
        db.query(AuctionTenantRecord)
        .filter(AuctionTenantRecord.id == tenant_id, AuctionTenantRecord.case_id == case_id)
        .first()
    )
    if not row:
        return False
    db.delete(row)
    db.commit()
    return True


def replace_tenants(db: Session, case_id: int, tenant_rows: list[dict[str, Any]]) -> list[AuctionTenantRecord]:
    """매각물건명세서 등 권위 있는 문서로 임차인현황을 다시 채울 때 기존 기록을 모두 교체한다."""
    if not get_case_or_none(db, case_id):
        raise ValueError("물건을 찾을 수 없습니다.")
    existing = db.query(AuctionTenantRecord).filter(AuctionTenantRecord.case_id == case_id).all()
    for row in existing:
        db.delete(row)
    db.commit()

    created: list[AuctionTenantRecord] = []
    for data in tenant_rows:
        row = AuctionTenantRecord(
            case_id=case_id, **{f: data.get(f) for f in TENANT_FIELDS if f in data}
        )
        db.add(row)
        created.append(row)
    db.commit()
    for row in created:
        db.refresh(row)
    return created


# ── 입찰가 비교사례 + 제안가 계산 ───────────────────────────

def list_comparables(db: Session, case_id: int) -> list[dict[str, Any]]:
    rows = (
        db.query(AuctionSaleComparable)
        .filter(AuctionSaleComparable.case_id == case_id)
        .order_by(AuctionSaleComparable.created_at.desc())
        .all()
    )
    return [serialize_comparable(r) for r in rows]


def create_comparable(db: Session, case_id: int, data: dict[str, Any]) -> AuctionSaleComparable:
    if not get_case_or_none(db, case_id):
        raise ValueError("물건을 찾을 수 없습니다.")
    appraisal = data.get("appraisal_price")
    winning = data.get("winning_bid_price")
    bid_rate_pct = round(winning / appraisal * 100, 1) if appraisal and winning else None
    row = AuctionSaleComparable(
        case_id=case_id,
        bid_rate_pct=bid_rate_pct,
        **{f: data.get(f) for f in COMPARABLE_FIELDS if f in data},
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def delete_comparable(db: Session, case_id: int, comparable_id: int) -> bool:
    row = (
        db.query(AuctionSaleComparable)
        .filter(AuctionSaleComparable.id == comparable_id, AuctionSaleComparable.case_id == case_id)
        .first()
    )
    if not row:
        return False
    db.delete(row)
    db.commit()
    return True


def compute_bid_analysis(db: Session, case_id: int) -> AuctionBidAnalysis:
    """등록된 비교사례의 낙찰가율로 제안 입찰가를 계산한다."""
    case = get_case_or_none(db, case_id)
    if not case:
        raise ValueError("물건을 찾을 수 없습니다.")

    rates = [
        c.bid_rate_pct
        for c in case.sale_comparables
        if c.bid_rate_pct is not None
    ]

    row = db.query(AuctionBidAnalysis).filter(AuctionBidAnalysis.case_id == case_id).first()
    if not row:
        row = AuctionBidAnalysis(case_id=case_id)
        db.add(row)

    row.peer_count = len(rates)
    if rates and case.appraisal_price:
        median_rate = statistics.median(rates)
        low_rate = min(rates)
        high_rate = max(rates)
        row.median_bid_rate_pct = round(median_rate, 1)
        row.suggested_bid_rate_pct = round(median_rate, 1)
        row.suggested_bid_won = round(case.appraisal_price * median_rate / 100)
        row.range_low_won = round(case.appraisal_price * low_rate / 100)
        row.range_high_won = round(case.appraisal_price * high_rate / 100)
        row.narrative = (
            f"비교사례 {len(rates)}건의 낙찰가율 중간값은 {median_rate:.1f}%입니다. "
            f"감정가 {case.appraisal_price:,.0f}원 기준 제안 입찰가는 "
            f"약 {row.suggested_bid_won:,.0f}원(범위 {row.range_low_won:,.0f}~{row.range_high_won:,.0f}원)입니다."
        )
    else:
        row.median_bid_rate_pct = None
        row.suggested_bid_rate_pct = None
        row.suggested_bid_won = None
        row.range_low_won = None
        row.range_high_won = None
        row.narrative = "비교사례를 등록하고 감정가를 입력하면 제안 입찰가를 계산합니다."

    row.computed_at = datetime.utcnow()
    db.commit()
    db.refresh(row)
    return row
