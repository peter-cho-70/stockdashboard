"""
core/auction_pdf_vision.py
경매허브 — 매각물건명세서처럼 스캔 이미지로만 구성된 PDF(텍스트 레이어 없음)에서
임차인현황(점유관계)을 비전 모델로 읽어내는 보조 모듈.
"""
from __future__ import annotations

import base64
import logging
from typing import Any, Optional

logger = logging.getLogger(__name__)

_MAX_PAGES = 8

TENANT_EXTRACTION_PROMPT = """다음은 한국 법원 경매 매각물건명세서(또는 임차인현황 조사서) PDF 페이지를 이미지로 캡처한 것입니다.
이 문서의 "점유관계" 또는 "임차인현황" 표에서 임차인(점유자) 정보를 모두 찾아 추출하세요.

각 임차인 행마다 다음 정보를 찾으세요:
- unit: 점유 호실/부분 (예: "101호", "전부")
- occupant_name: 임차인(점유자) 성명
- deposit: 보증금 (숫자만, 원 단위. "1,000만원"이면 10000000)
- monthly_rent: 월세 (숫자만, 원 단위. 없으면 null)
- move_in_date: 전입일자 (YYYY-MM-DD, 없으면 null)
- confirmed_date: 확정일자 (YYYY-MM-DD, 없으면 null)
- dividend_request_date: 배당요구일자/배당요구종기 (YYYY-MM-DD, 없으면 null)
- has_opposing_power: 대항력 여부 (있음=true, 없음=false, 불명=null)
- inquiry_notes: 비고/기타 특이사항 (간단히 요약, 없으면 null)

표가 없거나 임차인이 없으면 tenants를 빈 배열로 반환하세요.
사건번호와 주소도 보이면 함께 추출하세요 (case_number, address).

다음 JSON 형식으로만 응답하세요 (마크다운 없이):
{"case_number": "...|null", "address": "...|null", "tenants": [{"unit": "...", "occupant_name": "...", "deposit": 0, "monthly_rent": 0, "move_in_date": "...", "confirmed_date": "...", "dividend_request_date": "...", "has_opposing_power": true, "inquiry_notes": "..."}]}
"""


def render_pdf_pages_to_png_b64(data: bytes, *, max_pages: int = _MAX_PAGES, zoom: float = 2.0) -> list[str]:
    """PDF 각 페이지를 PNG(base64)로 렌더링한다. 비전 모델 입력용."""
    import fitz  # PyMuPDF

    doc = fitz.open(stream=data, filetype="pdf")
    try:
        images: list[str] = []
        matrix = fitz.Matrix(zoom, zoom)
        for page in doc:
            if len(images) >= max_pages:
                break
            pix = page.get_pixmap(matrix=matrix)
            images.append(base64.b64encode(pix.tobytes("png")).decode("ascii"))
        return images
    finally:
        doc.close()


def render_pdf_cover_and_thumbnail(data: bytes, *, zoom: float = 2.0) -> tuple[bytes, bytes]:
    """
    PDF 첫 페이지를 이미지(표지 원본)로 렌더링하고, 그 일부를 잘라 목록용 썸네일을 만든다.
    물건 등록 시 PDF만 첨부해도 카드 목록에 보일 이미지가 자동으로 생기도록 하기 위함.
    반환값: (cover_jpeg_bytes, thumbnail_jpeg_bytes)
    """
    import io

    import fitz  # PyMuPDF
    from PIL import Image

    doc = fitz.open(stream=data, filetype="pdf")
    try:
        if doc.page_count == 0:
            raise ValueError("PDF에 페이지가 없습니다.")
        pix = doc[0].get_pixmap(matrix=fitz.Matrix(zoom, zoom))
        cover_img = Image.open(io.BytesIO(pix.tobytes("png"))).convert("RGB")
    finally:
        doc.close()

    cover_buf = io.BytesIO()
    cover_img.save(cover_buf, format="JPEG", quality=85)

    # 목록 카드 비율(16:10)에 맞춰 표지 상단부를 잘라 작은 썸네일로 축소한다.
    width, height = cover_img.size
    target_ratio = 16 / 10
    crop_height = min(height, round(width / target_ratio))
    thumb_img = cover_img.crop((0, 0, width, crop_height))
    thumb_img.thumbnail((800, 500))
    thumb_buf = io.BytesIO()
    thumb_img.save(thumb_buf, format="JPEG", quality=80)

    return cover_buf.getvalue(), thumb_buf.getvalue()


def normalize_tenant_row(row: dict[str, Any]) -> dict[str, Any]:
    def _num(v: Any) -> Optional[float]:
        if v is None or v == "":
            return None
        if isinstance(v, (int, float)):
            return float(v)
        try:
            return float(str(v).replace(",", "").replace("원", "").strip())
        except (TypeError, ValueError):
            return None

    return {
        "unit": row.get("unit") or None,
        "occupant_name": row.get("occupant_name") or None,
        "deposit": _num(row.get("deposit")),
        "monthly_rent": _num(row.get("monthly_rent")),
        "move_in_date": row.get("move_in_date") or None,
        "confirmed_date": row.get("confirmed_date") or None,
        "dividend_request_date": row.get("dividend_request_date") or None,
        "has_opposing_power": row.get("has_opposing_power"),
        "inquiry_notes": row.get("inquiry_notes") or None,
    }


def extract_tenants_from_sale_statement(analyzer: Any, data: bytes, provider: Optional[str] = None) -> dict[str, Any]:
    """
    매각물건명세서 PDF 바이트 → 비전 모델로 임차인현황을 읽어 구조화한다.
    analyzer는 core.ai_analyzer.AIAnalyzer 인스턴스 (vision 지원 provider 체인 사용).
    """
    images = render_pdf_pages_to_png_b64(data)
    if not images:
        raise ValueError("PDF에서 페이지를 렌더링할 수 없습니다.")

    result = analyzer.analyze_images_json_prompt(
        TENANT_EXTRACTION_PROMPT, images, provider, log_label="매각물건명세서 임차인 추출"
    )
    if not result:
        raise RuntimeError("임차인현황 추출에 실패했습니다. AI 응답이 비어있습니다.")

    tenants = [normalize_tenant_row(r) for r in result.get("tenants", []) if isinstance(r, dict)]
    return {
        "case_number": result.get("case_number") or None,
        "address": result.get("address") or None,
        "tenants": tenants,
        "page_count": len(images),
    }
