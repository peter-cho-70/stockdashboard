"""
core/auction_files.py
경매허브 — PDF 원문·표지 썸네일 파일 저장/조회 (디스크 + SQLite 메타데이터)
"""
from __future__ import annotations

import logging
import re
import uuid
from pathlib import Path
from typing import Any, Optional

from sqlalchemy.orm import Session

from config.database import AuctionCaseThumbnail, AuctionSourceDocument

logger = logging.getLogger(__name__)

_FILES_ROOT = Path(__file__).resolve().parent.parent / "data" / "auction_files"
_MAX_PDF_BYTES = 30 * 1024 * 1024
_MAX_IMAGE_BYTES = 5 * 1024 * 1024
_ALLOWED_IMAGE_MIME = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
}


def _case_dir(case_id: int) -> Path:
    safe = re.sub(r"[^\w-]", "", str(case_id))
    path = _FILES_ROOT / safe
    path.mkdir(parents=True, exist_ok=True)
    return path


def _doc_url(case_id: int, doc_id: int) -> str:
    return f"/auction/cases/{case_id}/source-documents/{doc_id}/file"


def serialize_source_document(row: AuctionSourceDocument) -> dict[str, Any]:
    return {
        "id": row.id,
        "case_id": row.case_id,
        "kind": row.kind,
        "url": _doc_url(row.case_id, row.id),
        "original_name": row.original_name,
        "mime_type": row.mime_type,
        "file_size": row.file_size,
        "page_count": row.page_count,
        "extracted_text": row.extracted_text,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


def save_source_document(
    db: Session,
    case_id: int,
    *,
    data: bytes,
    mime_type: str,
    original_name: Optional[str] = None,
    kind: str = "pdf",
    extracted_text: Optional[str] = None,
    structured_json: Optional[str] = None,
    page_count: Optional[int] = None,
) -> AuctionSourceDocument:
    if not data:
        raise ValueError("빈 파일입니다.")
    if len(data) > _MAX_PDF_BYTES:
        raise ValueError("파일 크기는 30MB 이하여야 합니다.")

    stored_name = f"{uuid.uuid4().hex}.pdf"
    dest = _case_dir(case_id) / stored_name
    dest.write_bytes(data)

    row = AuctionSourceDocument(
        case_id=case_id,
        kind=kind,
        stored_name=stored_name,
        original_name=(original_name or "")[:255] or None,
        mime_type=mime_type or "application/pdf",
        file_size=len(data),
        page_count=page_count,
        extracted_text=extracted_text,
        structured_json=structured_json,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    logger.info("경매 PDF 저장 case=%s doc=%s", case_id, row.id)
    return row


def source_document_file_path(row: AuctionSourceDocument) -> Path:
    return _case_dir(row.case_id) / row.stored_name


def delete_source_document(db: Session, case_id: int, doc_id: int) -> bool:
    row = (
        db.query(AuctionSourceDocument)
        .filter(AuctionSourceDocument.id == doc_id, AuctionSourceDocument.case_id == case_id)
        .first()
    )
    if not row:
        return False
    path = source_document_file_path(row)
    db.delete(row)
    db.commit()
    if path.is_file():
        path.unlink(missing_ok=True)
    return True


def _validate_image(data: bytes, mime_type: str) -> str:
    mime = (mime_type or "image/jpeg").split(";")[0].strip().lower()
    if mime not in _ALLOWED_IMAGE_MIME:
        raise ValueError("JPEG, PNG, WebP 이미지만 업로드할 수 있습니다.")
    if not data:
        raise ValueError("빈 이미지입니다.")
    if len(data) > _MAX_IMAGE_BYTES:
        raise ValueError("이미지 크기는 5MB 이하여야 합니다.")
    return mime


def save_case_thumbnail(
    db: Session,
    case_id: int,
    *,
    cover_data: Optional[bytes] = None,
    cover_mime: str = "image/jpeg",
    list_data: Optional[bytes] = None,
    list_mime: str = "image/jpeg",
) -> AuctionCaseThumbnail:
    """표지 원본(cover)과 목록용 썸네일(list)을 함께 또는 개별로 저장한다."""
    if cover_data is None and list_data is None:
        raise ValueError("저장할 이미지가 없습니다.")

    row = (
        db.query(AuctionCaseThumbnail)
        .filter(AuctionCaseThumbnail.case_id == case_id)
        .first()
    )
    case_dir = _case_dir(case_id)
    mime_type = "image/jpeg"

    cover_stored_name = row.cover_stored_name if row else None
    list_stored_name = row.list_stored_name if row else None

    if cover_data is not None:
        mime_type = _validate_image(cover_data, cover_mime)
        ext = _ALLOWED_IMAGE_MIME[mime_type]
        cover_stored_name = f"cover-{uuid.uuid4().hex}{ext}"
        (case_dir / cover_stored_name).write_bytes(cover_data)
        if row and row.cover_stored_name:
            (case_dir / row.cover_stored_name).unlink(missing_ok=True)

    if list_data is not None:
        mime_type = _validate_image(list_data, list_mime)
        ext = _ALLOWED_IMAGE_MIME[mime_type]
        list_stored_name = f"list-{uuid.uuid4().hex}{ext}"
        (case_dir / list_stored_name).write_bytes(list_data)
        if row and row.list_stored_name:
            (case_dir / row.list_stored_name).unlink(missing_ok=True)

    if row:
        row.cover_stored_name = cover_stored_name
        row.list_stored_name = list_stored_name
        row.mime_type = mime_type
    else:
        row = AuctionCaseThumbnail(
            case_id=case_id,
            cover_stored_name=cover_stored_name,
            list_stored_name=list_stored_name,
            mime_type=mime_type,
        )
        db.add(row)
    db.commit()
    db.refresh(row)
    logger.info("경매 썸네일 저장 case=%s", case_id)
    return row


def thumbnail_cover_path(row: AuctionCaseThumbnail) -> Optional[Path]:
    if not row.cover_stored_name:
        return None
    return _case_dir(row.case_id) / row.cover_stored_name


def thumbnail_list_path(row: AuctionCaseThumbnail) -> Optional[Path]:
    if not row.list_stored_name:
        return None
    return _case_dir(row.case_id) / row.list_stored_name


def delete_case_files(case_id: int) -> None:
    """케이스 삭제 시 디스크에 남은 파일 폴더 정리 (DB 행은 cascade로 삭제됨)."""
    import shutil

    case_dir = _case_dir(case_id)
    if case_dir.is_dir():
        shutil.rmtree(case_dir, ignore_errors=True)


def extract_pdf_text(data: bytes) -> tuple[str, int]:
    """PDF 바이트에서 전체 텍스트와 페이지 수를 추출한다 (PyMuPDF)."""
    import fitz  # PyMuPDF

    doc = fitz.open(stream=data, filetype="pdf")
    try:
        pages = [page.get_text() for page in doc]
        return "\n".join(pages), doc.page_count
    finally:
        doc.close()
