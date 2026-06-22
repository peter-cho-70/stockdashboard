"""
core/auction_backup.py
경매허브 — 물건/세입자/비교사례/PDF/썸네일 전체 데이터를 ZIP으로 백업·복구
"""
from __future__ import annotations

import io
import json
import logging
import zipfile
from datetime import datetime
from typing import Any

from sqlalchemy.orm import Session

from config.database import AuctionCase
from core.auction_files import (
    delete_case_files,
    save_case_thumbnail,
    save_source_document,
    source_document_file_path,
    thumbnail_cover_path,
    thumbnail_list_path,
)
from core.auction_service import (
    CASE_FIELDS,
    COMPARABLE_FIELDS,
    TENANT_FIELDS,
    compute_bid_analysis,
    create_case,
    create_comparable,
    create_tenant,
)

logger = logging.getLogger(__name__)

BACKUP_VERSION = 1
BACKUP_APP = "stockmind-auctionhub"


def export_backup(db: Session) -> bytes:
    """전체 물건·세입자·비교사례·PDF·썸네일을 ZIP(manifest.json + files/) 한 덩어리로 내보낸다."""
    cases = db.query(AuctionCase).order_by(AuctionCase.id.asc()).all()
    manifest: dict[str, Any] = {
        "version": BACKUP_VERSION,
        "app": BACKUP_APP,
        "exportedAt": datetime.utcnow().isoformat() + "Z",
        "cases": [],
    }

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for case in cases:
            folder = f"files/case-{case.id}"
            entry: dict[str, Any] = {f: getattr(case, f) for f in CASE_FIELDS}
            entry.update({
                "extracted_text": case.extracted_text,
                "address_meta_json": case.address_meta_json,
                "thumbnail": None,
                "source_documents": [],
                "tenant_records": [
                    {f: getattr(t, f) for f in TENANT_FIELDS} for t in case.tenant_records
                ],
                "sale_comparables": [
                    {**{f: getattr(c, f) for f in COMPARABLE_FIELDS}, "bid_rate_pct": c.bid_rate_pct}
                    for c in case.sale_comparables
                ],
            })

            if case.thumbnail:
                thumb = case.thumbnail
                cover_path = thumbnail_cover_path(thumb)
                list_path = thumbnail_list_path(thumb)
                thumb_entry = {"mime_type": thumb.mime_type, "cover_file": None, "list_file": None}
                if cover_path and cover_path.is_file():
                    arc = f"{folder}/{cover_path.name}"
                    zf.write(cover_path, arc)
                    thumb_entry["cover_file"] = arc
                if list_path and list_path.is_file():
                    arc = f"{folder}/{list_path.name}"
                    zf.write(list_path, arc)
                    thumb_entry["list_file"] = arc
                entry["thumbnail"] = thumb_entry

            for doc in case.source_documents:
                path = source_document_file_path(doc)
                doc_entry = {
                    "kind": doc.kind,
                    "original_name": doc.original_name,
                    "mime_type": doc.mime_type,
                    "page_count": doc.page_count,
                    "extracted_text": doc.extracted_text,
                    "structured_json": doc.structured_json,
                    "file": None,
                }
                if path.is_file():
                    arc = f"{folder}/{path.name}"
                    zf.write(path, arc)
                    doc_entry["file"] = arc
                entry["source_documents"].append(doc_entry)

            manifest["cases"].append(entry)

        zf.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))

    return buf.getvalue()


def restore_backup(db: Session, zip_bytes: bytes) -> dict[str, Any]:
    """ZIP 백업으로 전체 데이터를 교체한다 (기존 물건·파일을 모두 삭제하고 복구)."""
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        try:
            manifest = json.loads(zf.read("manifest.json"))
        except KeyError as e:
            raise ValueError("manifest.json이 없는 백업 파일입니다.") from e
        if not isinstance(manifest.get("cases"), list):
            raise ValueError("백업 파일 형식이 올바르지 않습니다.")

        # 기존 데이터 전체 교체 — ORM 레벨에서 하나씩 삭제해야 cascade(세입자·비교사례·문서·썸네일)가 함께 정리된다
        existing_cases = db.query(AuctionCase).all()
        old_ids = [c.id for c in existing_cases]
        for c in existing_cases:
            db.delete(c)
        db.commit()
        for old_id in old_ids:
            delete_case_files(old_id)

        summary = {"cases": 0, "source_documents": 0, "tenant_records": 0, "sale_comparables": 0}

        for entry in manifest["cases"]:
            case = create_case(db, {f: entry.get(f) for f in CASE_FIELDS})
            if entry.get("extracted_text"):
                case.extracted_text = entry["extracted_text"]
            if entry.get("address_meta_json"):
                case.address_meta_json = entry["address_meta_json"]
            db.commit()
            summary["cases"] += 1

            thumb = entry.get("thumbnail")
            if thumb:
                cover_data = zf.read(thumb["cover_file"]) if thumb.get("cover_file") else None
                list_data = zf.read(thumb["list_file"]) if thumb.get("list_file") else None
                if cover_data or list_data:
                    save_case_thumbnail(
                        db, case.id,
                        cover_data=cover_data, cover_mime=thumb.get("mime_type") or "image/jpeg",
                        list_data=list_data, list_mime=thumb.get("mime_type") or "image/jpeg",
                    )

            for doc in entry.get("source_documents", []):
                if not doc.get("file"):
                    continue
                save_source_document(
                    db, case.id,
                    data=zf.read(doc["file"]),
                    mime_type=doc.get("mime_type") or "application/pdf",
                    original_name=doc.get("original_name"),
                    kind=doc.get("kind") or "pdf",
                    extracted_text=doc.get("extracted_text"),
                    structured_json=doc.get("structured_json"),
                    page_count=doc.get("page_count"),
                )
                summary["source_documents"] += 1

            for t in entry.get("tenant_records", []):
                create_tenant(db, case.id, {f: t.get(f) for f in TENANT_FIELDS})
                summary["tenant_records"] += 1

            for c in entry.get("sale_comparables", []):
                create_comparable(db, case.id, {f: c.get(f) for f in COMPARABLE_FIELDS})
                summary["sale_comparables"] += 1

            if entry.get("sale_comparables"):
                compute_bid_analysis(db, case.id)

    logger.info("경매허브 백업 복구 완료 cases=%s", summary["cases"])
    return {
        "ok": True,
        "restoredAt": datetime.utcnow().isoformat() + "Z",
        "summary": summary,
    }
