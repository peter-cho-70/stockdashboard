"""
api/routes_auction.py — 경매허브 API
"""
from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Any, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from config.database import get_db
from core.auction_backup import export_backup, restore_backup
from core.auction_files import (
    delete_source_document,
    extract_pdf_text,
    save_case_thumbnail,
    save_source_document,
    source_document_file_path,
    thumbnail_cover_path,
    thumbnail_list_path,
)
from core.auction_pdf_parser import detect_format_for_auto_parse, parse_auction_pdf_by_kind
from core.auction_pdf_to_case import (
    build_warnings,
    pdf_extract_to_case_fields,
    pdf_extract_to_tenant_fields,
)
from core.auction_pdf_vision import extract_tenants_from_sale_statement, render_pdf_cover_and_thumbnail
from core.auction_service import (
    attach_extracted_text,
    compute_bid_analysis,
    create_case,
    create_comparable,
    create_tenant,
    delete_case,
    delete_comparable,
    delete_tenant,
    get_case_or_none,
    list_cases,
    list_comparables,
    list_tenants,
    replace_tenants,
    serialize_bid_analysis,
    serialize_case_detail,
    serialize_comparable,
    serialize_tenant,
    update_case,
    update_tenant,
)
from core.demo_mode import demo_write_blocked

logger = logging.getLogger(__name__)

auction_router = APIRouter(prefix="/auction", tags=["auction"])


class CaseBody(BaseModel):
    case_number: str = ""
    address: str = ""
    list_title: Optional[str] = None
    property_type: Optional[str] = None
    built_year: Optional[str] = None
    floor: Optional[str] = None
    household_count: Optional[int] = None
    land_area_sqm: Optional[float] = None
    building_area_sqm: Optional[float] = None
    parking_unit_count: Optional[int] = None
    appraisal_price: Optional[float] = None
    min_price: Optional[float] = None
    expected_bid_price: Optional[float] = None
    bid_date: Optional[str] = None
    current_round: Optional[int] = None
    status: Optional[str] = None
    priority_level: Optional[int] = None
    memo: Optional[str] = None
    market_notes: Optional[str] = None


class TenantBody(BaseModel):
    unit: Optional[str] = None
    occupant_name: Optional[str] = None
    deposit: Optional[float] = None
    monthly_rent: Optional[float] = None
    move_in_date: Optional[str] = None
    confirmed_date: Optional[str] = None
    dividend_request_date: Optional[str] = None
    has_opposing_power: Optional[bool] = None
    dividend_amount: Optional[float] = None
    undivided_amount: Optional[float] = None
    dividend_status: Optional[str] = None
    inquiry_notes: Optional[str] = None
    memo: Optional[str] = None


class ComparableBody(BaseModel):
    case_number: Optional[str] = None
    address: Optional[str] = None
    appraisal_price: Optional[float] = None
    winning_bid_price: Optional[float] = None
    sold_round: Optional[int] = None
    bid_date: Optional[str] = None
    memo: Optional[str] = None


def _get_case_or_404(db: Session, case_id: int):
    case = get_case_or_none(db, case_id)
    if not case:
        raise HTTPException(status_code=404, detail="물건을 찾을 수 없습니다.")
    return case


# ── 물건(케이스) ────────────────────────────────────────────

@auction_router.get("/cases")
def get_cases(db: Session = Depends(get_db)):
    return {"items": list_cases(db)}


@auction_router.get("/cases/{case_id}")
def get_case(case_id: int, db: Session = Depends(get_db)):
    return serialize_case_detail(_get_case_or_404(db, case_id))


@auction_router.post("/cases")
def post_case(body: CaseBody, db: Session = Depends(get_db)):
    demo_write_blocked()
    try:
        case = create_case(db, body.model_dump(exclude_unset=True))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return serialize_case_detail(case)


@auction_router.put("/cases/{case_id}")
def put_case(case_id: int, body: CaseBody, db: Session = Depends(get_db)):
    demo_write_blocked()
    try:
        case = update_case(db, case_id, body.model_dump(exclude_unset=True))
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    return serialize_case_detail(case)


@auction_router.delete("/cases/{case_id}")
def remove_case(case_id: int, db: Session = Depends(get_db)):
    demo_write_blocked()
    if not delete_case(db, case_id):
        raise HTTPException(status_code=404, detail="물건을 찾을 수 없습니다.")
    return {"ok": True}


# ── PDF 원문 ────────────────────────────────────────────────

@auction_router.post("/pdf-extract")
async def extract_pdf_for_registration(file: UploadFile = File(...)):
    """
    경매정보지 PDF를 업로드하면 텍스트를 추출하고 사건번호·주소·감정가 등
    물건 등록 필드를 자동으로 채워준다 ("PDF로 바로 등록" 기능의 1단계).
    실제 물건 생성은 클라이언트가 이 결과로 기존 케이스/세입자 생성 API를 호출한다.
    """
    data = await file.read()
    try:
        raw_text, page_count = extract_pdf_text(data)
    except Exception as e:  # noqa: BLE001 - PyMuPDF가 손상 파일에서 다양한 예외를 던짐
        raise HTTPException(status_code=400, detail=f"PDF 텍스트 추출에 실패했습니다: {e}") from e

    if not raw_text.strip():
        raise HTTPException(status_code=400, detail="PDF에서 텍스트를 추출할 수 없습니다. 스캔 이미지 PDF는 지원하지 않습니다.")

    detected_format = detect_format_for_auto_parse(raw_text)
    kind = "speedauction-pdf" if detected_format in ("speedauction", "auctionone") else "daejangauction-pdf"
    extracted = parse_auction_pdf_by_kind(raw_text, kind)

    case_fields = pdf_extract_to_case_fields(extracted)
    tenants = [pdf_extract_to_tenant_fields(row) for row in extracted.get("tenant_rows", [])]
    warnings = build_warnings(extracted)

    return {
        "page_count": page_count,
        "extracted_text": raw_text,
        "kind": kind,
        "extracted": extracted,
        "case_fields": case_fields,
        "tenants": tenants,
        "warnings": warnings,
    }


@auction_router.post("/cases/{case_id}/source-documents")
async def upload_source_document(
    case_id: int,
    file: UploadFile = File(...),
    kind: str = Form("pdf"),
    extracted_text: Optional[str] = Form(None),
    structured_json: Optional[str] = Form(None),
    page_count: Optional[int] = Form(None),
    db: Session = Depends(get_db),
):
    demo_write_blocked()
    case = _get_case_or_404(db, case_id)
    try:
        data = await file.read()
        doc = save_source_document(
            db,
            case_id,
            data=data,
            mime_type=file.content_type or "application/pdf",
            original_name=file.filename,
            kind=kind,
            extracted_text=extracted_text,
            structured_json=structured_json,
            page_count=page_count,
        )
        if extracted_text:
            attach_extracted_text(db, case_id, extracted_text)

        is_pdf = (file.content_type or "").lower() == "application/pdf" or (file.filename or "").lower().endswith(".pdf")
        if is_pdf and not (case.thumbnail and case.thumbnail.list_stored_name):
            # 등록 시 첨부한 PDF 첫 페이지로 표지·목록 썸네일을 자동 생성한다 (사용자가 직접 올린 이미지가 없을 때만)
            try:
                cover_bytes, thumb_bytes = render_pdf_cover_and_thumbnail(data)
                save_case_thumbnail(
                    db, case_id,
                    cover_data=cover_bytes, cover_mime="image/jpeg",
                    list_data=thumb_bytes, list_mime="image/jpeg",
                )
            except Exception as e:
                logger.warning("PDF 표지 썸네일 자동 생성 실패 case=%s: %s", case_id, e)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return serialize_case_detail(_get_case_or_404(db, case_id)) | {"new_document_id": doc.id}


@auction_router.get("/cases/{case_id}/source-documents/{doc_id}/file")
def get_source_document_file(case_id: int, doc_id: int, db: Session = Depends(get_db)):
    case = _get_case_or_404(db, case_id)
    doc = next((d for d in case.source_documents if d.id == doc_id), None)
    if not doc:
        raise HTTPException(status_code=404, detail="문서를 찾을 수 없습니다.")
    path = source_document_file_path(doc)
    if not path.is_file():
        raise HTTPException(status_code=404, detail="파일이 없습니다.")
    return FileResponse(path, media_type=doc.mime_type or "application/pdf")


@auction_router.delete("/cases/{case_id}/source-documents/{doc_id}")
def remove_source_document(case_id: int, doc_id: int, db: Session = Depends(get_db)):
    demo_write_blocked()
    if not delete_source_document(db, case_id, doc_id):
        raise HTTPException(status_code=404, detail="문서를 찾을 수 없습니다.")
    return {"ok": True}


# ── 표지 썸네일 ──────────────────────────────────────────────

@auction_router.post("/cases/{case_id}/thumbnail")
async def upload_case_thumbnail(
    case_id: int,
    cover: Optional[UploadFile] = File(None),
    list_image: Optional[UploadFile] = File(None),
    db: Session = Depends(get_db),
):
    demo_write_blocked()
    _get_case_or_404(db, case_id)
    try:
        cover_data = await cover.read() if cover else None
        list_data = await list_image.read() if list_image else None
        save_case_thumbnail(
            db,
            case_id,
            cover_data=cover_data,
            cover_mime=cover.content_type if cover else "image/jpeg",
            list_data=list_data,
            list_mime=list_image.content_type if list_image else "image/jpeg",
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return serialize_case_detail(_get_case_or_404(db, case_id))


@auction_router.get("/cases/{case_id}/thumbnail")
def get_case_thumbnail(case_id: int, db: Session = Depends(get_db)):
    case = _get_case_or_404(db, case_id)
    if not case.thumbnail:
        raise HTTPException(status_code=404, detail="썸네일이 없습니다.")
    path = thumbnail_list_path(case.thumbnail)
    if not path or not path.is_file():
        raise HTTPException(status_code=404, detail="썸네일 파일이 없습니다.")
    return FileResponse(path, media_type=case.thumbnail.mime_type or "image/jpeg")


@auction_router.get("/cases/{case_id}/cover-source")
def get_case_cover_source(case_id: int, db: Session = Depends(get_db)):
    case = _get_case_or_404(db, case_id)
    if not case.thumbnail:
        raise HTTPException(status_code=404, detail="표지 원본이 없습니다.")
    path = thumbnail_cover_path(case.thumbnail)
    if not path or not path.is_file():
        raise HTTPException(status_code=404, detail="표지 원본 파일이 없습니다.")
    return FileResponse(path, media_type=case.thumbnail.mime_type or "image/jpeg")


# ── 세입자 분석 ──────────────────────────────────────────────

@auction_router.get("/cases/{case_id}/tenants")
def get_tenants(case_id: int, db: Session = Depends(get_db)):
    _get_case_or_404(db, case_id)
    return {"items": list_tenants(db, case_id)}


@auction_router.post("/cases/{case_id}/tenants")
def post_tenant(case_id: int, body: TenantBody, db: Session = Depends(get_db)):
    demo_write_blocked()
    try:
        row = create_tenant(db, case_id, body.model_dump(exclude_unset=True))
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    return serialize_tenant(row)


@auction_router.put("/cases/{case_id}/tenants/{tenant_id}")
def put_tenant(case_id: int, tenant_id: int, body: TenantBody, db: Session = Depends(get_db)):
    demo_write_blocked()
    try:
        row = update_tenant(db, case_id, tenant_id, body.model_dump(exclude_unset=True))
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    return serialize_tenant(row)


@auction_router.delete("/cases/{case_id}/tenants/{tenant_id}")
def remove_tenant(case_id: int, tenant_id: int, db: Session = Depends(get_db)):
    demo_write_blocked()
    if not delete_tenant(db, case_id, tenant_id):
        raise HTTPException(status_code=404, detail="세입자 기록을 찾을 수 없습니다.")
    return {"ok": True}


@auction_router.post("/cases/{case_id}/tenants/from-sale-statement")
async def refresh_tenants_from_sale_statement(
    case_id: int,
    file: UploadFile = File(...),
    analysis_provider: Optional[str] = Form(None),
    db: Session = Depends(get_db),
):
    """
    매각물건명세서 PDF(스캔 이미지)를 업로드하면 비전 AI로 임차인현황(점유관계) 표를 읽어
    기존 세입자 기록을 모두 교체한다. 매각물건명세서는 법원이 발급하는 권위 있는 문서이므로
    기존에 다른 자료로 등록해둔 추정치보다 우선한다.
    """
    demo_write_blocked()
    _get_case_or_404(db, case_id)
    from core.ai_analyzer import create_analyzer, ensure_analysis_available, handle_provider_runtime_error
    from config.settings import get_settings

    try:
        ensure_analysis_available(get_settings(), analysis_provider)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    data = await file.read()
    analyzer = create_analyzer(db)
    try:
        extraction = extract_tenants_from_sale_statement(analyzer, data, analysis_provider)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e)) from e
    except Exception as e:  # noqa: BLE001 - provider 런타임 오류(quota/auth)를 HTTP로 변환
        handle_provider_runtime_error(e)
        raise

    rows = replace_tenants(db, case_id, extraction["tenants"])
    save_source_document(
        db,
        case_id,
        data=data,
        mime_type=file.content_type or "application/pdf",
        original_name=file.filename,
        kind="sale_statement_pdf",
        structured_json=json.dumps(extraction, ensure_ascii=False),
    )
    return {
        "tenants": [serialize_tenant(r) for r in rows],
        "case_number": extraction.get("case_number"),
        "address": extraction.get("address"),
    }


# ── 입찰가 비교사례 + 제안가 ─────────────────────────────────

@auction_router.get("/cases/{case_id}/comparables")
def get_comparables(case_id: int, db: Session = Depends(get_db)):
    _get_case_or_404(db, case_id)
    return {"items": list_comparables(db, case_id)}


@auction_router.post("/cases/{case_id}/comparables")
def post_comparable(case_id: int, body: ComparableBody, db: Session = Depends(get_db)):
    demo_write_blocked()
    try:
        row = create_comparable(db, case_id, body.model_dump(exclude_unset=True))
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    return serialize_comparable(row)


@auction_router.delete("/cases/{case_id}/comparables/{comparable_id}")
def remove_comparable(case_id: int, comparable_id: int, db: Session = Depends(get_db)):
    demo_write_blocked()
    if not delete_comparable(db, case_id, comparable_id):
        raise HTTPException(status_code=404, detail="비교사례를 찾을 수 없습니다.")
    return {"ok": True}


@auction_router.post("/cases/{case_id}/bid-analysis/compute")
def post_bid_analysis(case_id: int, db: Session = Depends(get_db)):
    demo_write_blocked()
    try:
        row = compute_bid_analysis(db, case_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    return serialize_bid_analysis(row)


@auction_router.get("/cases/{case_id}/bid-analysis")
def get_bid_analysis(case_id: int, db: Session = Depends(get_db)):
    case = _get_case_or_404(db, case_id)
    return serialize_bid_analysis(case.bid_analysis)


# ── 백업/복구 ────────────────────────────────────────────────

@auction_router.get("/backup")
def download_backup(db: Session = Depends(get_db)):
    """전체 경매허브 데이터(물건·세입자·비교사례·PDF·썸네일)를 ZIP으로 다운로드"""
    data = export_backup(db)
    filename = f"auctionhub-backup-{datetime.utcnow().strftime('%Y%m%d-%H%M%S')}.zip"
    return Response(
        content=data,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@auction_router.post("/backup/restore")
async def upload_backup_restore(file: UploadFile = File(...), db: Session = Depends(get_db)):
    """ZIP 백업으로 전체 데이터를 교체 복구 (기존 물건은 모두 삭제됨)"""
    demo_write_blocked()
    try:
        data = await file.read()
        return restore_backup(db, data)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
