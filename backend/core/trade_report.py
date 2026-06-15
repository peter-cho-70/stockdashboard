"""
core/trade_report.py — 월별 수출입 동향 AI 리포트 생성·조회
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta
from typing import Any, Optional

import pandas as pd
from sqlalchemy.orm import Session

from config.database import TradeMonthlyReport
from config.settings import get_settings
from core.gemini_client import GeminiClient
from core.trade_collector import TradeDataCollector

logger = logging.getLogger(__name__)

SYSTEM = """당신은 한국 무역·거시경제 전문 애널리스트입니다.
수출입 통계를 투자자·연구자가 활용할 수 있게 해석합니다.
숫자 나열보다 전월·전년 대비 변화와 시사점을 중심으로 씁니다.
투자 권유·매수·매도 의견은 제시하지 않습니다."""


def _default_report_month() -> str:
    today = datetime.now()
    ref = today.replace(day=1) - timedelta(days=35)
    ref = ref.replace(day=1)
    return f"{ref.year}-{ref.month:02d}"


def _parse_month(report_month: str) -> tuple[int, int]:
    parts = report_month.strip().split("-")
    if len(parts) != 2:
        raise ValueError("report_month는 YYYY-MM 형식이어야 합니다.")
    return int(parts[0]), int(parts[1])


def _df_text(df: pd.DataFrame, max_rows: int = 24) -> str:
    if df is None or df.empty:
        return "(데이터 없음)"
    return df.head(max_rows).to_string(index=False)


def serialize_report(row: TradeMonthlyReport) -> dict[str, Any]:
    summary, countries, items, analyses, highlights = [], [], [], {}, []
    for attr, target in (
        ("summary_json", "summary"),
        ("countries_json", "countries"),
        ("items_json", "items"),
        ("analyses_json", "analyses"),
        ("highlights_json", "highlights"),
    ):
        raw = getattr(row, attr)
        try:
            if raw:
                val = json.loads(raw)
                if attr == "summary_json":
                    summary = val if isinstance(val, list) else []
                elif attr == "countries_json":
                    countries = val if isinstance(val, list) else []
                elif attr == "items_json":
                    items = val if isinstance(val, list) else []
                elif attr == "analyses_json":
                    analyses = val if isinstance(val, dict) else {}
                elif attr == "highlights_json":
                    highlights = val if isinstance(val, list) else []
        except json.JSONDecodeError:
            pass

    return {
        "id": row.id,
        "report_month": row.report_month,
        "ref_yyyymm": row.ref_yyyymm,
        "revision": row.revision,
        "summary": summary,
        "countries": countries,
        "items": items,
        "analyses": analyses,
        "highlights": highlights,
        "body_markdown": row.body_markdown,
        "status": row.status,
        "error_message": row.error_message,
        "model": row.model,
        "generated_at": row.generated_at.isoformat() if row.generated_at else None,
    }


def get_report(db: Session, report_month: str) -> Optional[dict[str, Any]]:
    row = (
        db.query(TradeMonthlyReport)
        .filter(TradeMonthlyReport.report_month == report_month)
        .first()
    )
    return serialize_report(row) if row else None


TRADE_HISTORY_MONTHS = 12


def list_reports(db: Session, limit: int = TRADE_HISTORY_MONTHS) -> list[dict[str, Any]]:
    rows = (
        db.query(TradeMonthlyReport)
        .order_by(TradeMonthlyReport.report_month.desc())
        .limit(limit)
        .all()
    )
    return [serialize_report(r) for r in rows]


def _run_ai(
    summary_df: pd.DataFrame,
    country_df: pd.DataFrame,
    item_df: pd.DataFrame,
    ref_month: str,
) -> dict[str, Any]:
    settings = get_settings()
    if not settings.gemini_api_key:
        raise ValueError("GEMINI_API_KEY가 설정되지 않았습니다.")

    client = GeminiClient(
        api_key=settings.gemini_api_key,
        model=settings.gemini_model,
        extract_model=settings.gemini_extract_model,
        prompt_cache_enabled=settings.gemini_prompt_cache,
        cache_ttl=settings.gemini_cache_ttl,
    )

    prompt = f"""기준월: {ref_month}

## 월별 수출입 총괄 (최근 {len(summary_df)}개월)
{_df_text(summary_df)}

## 국가별 ({ref_month})
{_df_text(country_df)}

## 주요 품목·섹터 ({ref_month})
{_df_text(item_df)}

위 데이터로 JSON만 응답하세요:
{{
  "highlights": ["한 줄 핵심 3~5개"],
  "body_markdown": "통합 리포트(마크다운, ## 소제목, **굵게** 활용)",
  "sections": {{
    "summary_trend": "총괄 트렌드",
    "country_trade": "국가별",
    "sector_items": "품목·섹터",
    "integrated": "투자·거시 통합 시사점"
  }}
}}
"""

    parsed = client.generate_json(prompt, purpose="수출입 월간 리포트", system_instruction=SYSTEM) or {}

    highlights = parsed.get("highlights") or []
    if not isinstance(highlights, list):
        highlights = [str(highlights)]
    highlights = [str(h).strip() for h in highlights if str(h).strip()][:8]

    sections = parsed.get("sections") if isinstance(parsed.get("sections"), dict) else {}
    body = (parsed.get("body_markdown") or "").strip()
    if not body and sections:
        parts = []
        for key, title in (
            ("summary_trend", "수출입 총괄"),
            ("country_trade", "국가별 무역"),
            ("sector_items", "품목·섹터"),
            ("integrated", "통합 시사점"),
        ):
            text = sections.get(key)
            if text:
                parts.append(f"## {title}\n\n{text}")
        body = "\n\n".join(parts)

    return {
        "highlights": highlights,
        "body_markdown": body,
        "sections": sections,
        "model": settings.gemini_model,
    }


def generate_trade_report(
    db: Session,
    report_month: Optional[str] = None,
    *,
    force: bool = False,
    history_months: int = TRADE_HISTORY_MONTHS,
) -> dict[str, Any]:
    history_months = min(max(1, history_months), TRADE_HISTORY_MONTHS)
    report_month = report_month or _default_report_month()
    year, month = _parse_month(report_month)
    ref_yyyymm = f"{year}{month:02d}"

    existing = (
        db.query(TradeMonthlyReport)
        .filter(TradeMonthlyReport.report_month == report_month)
        .first()
    )
    if existing and existing.status == "ready" and not force:
        return serialize_report(existing)

    if not existing:
        existing = TradeMonthlyReport(
            report_month=report_month,
            ref_yyyymm=ref_yyyymm,
            status="pending",
        )
        db.add(existing)
    else:
        existing.status = "pending"
        existing.error_message = None
    db.commit()

    settings = get_settings()
    api_key = (settings.public_data_api_key or "").strip()
    collector = TradeDataCollector(api_key=api_key)

    try:
        data = collector.collect_for_month(year, month, history_months=history_months)
        summary_df = data["summary"]
        country_df = data["countries"]
        item_df = data["items"]

        if summary_df is None or summary_df.empty:
            raise ValueError(
                "수출입 통계를 수집하지 못했습니다. "
                "네트워크 연결과 PUBLIC_DATA_API_KEY(선택)·Gemini 키를 확인한 뒤 다시 생성해 주세요."
            )

        existing.summary_json = json.dumps(
            summary_df.to_dict(orient="records") if not summary_df.empty else [],
            ensure_ascii=False,
        )
        existing.countries_json = json.dumps(
            country_df.to_dict(orient="records") if not country_df.empty else [],
            ensure_ascii=False,
        )
        existing.items_json = json.dumps(
            item_df.to_dict(orient="records") if not item_df.empty else [],
            ensure_ascii=False,
        )
        existing.ref_yyyymm = ref_yyyymm
        db.commit()

        try:
            ai = _run_ai(summary_df, country_df, item_df, report_month)
            existing.analyses_json = json.dumps(ai.get("sections") or {}, ensure_ascii=False)
            existing.highlights_json = json.dumps(ai.get("highlights") or [], ensure_ascii=False)
            existing.body_markdown = ai.get("body_markdown")
            existing.model = ai.get("model")
            existing.status = "ready"
            existing.error_message = None
        except Exception as ai_err:
            logger.warning("trade AI step failed (data kept): %s", ai_err)
            existing.status = "partial"
            existing.error_message = f"AI 분석 실패: {ai_err}"[:500]
            if not existing.body_markdown:
                existing.body_markdown = (
                    f"## 데이터 수집 완료\n\n"
                    f"통계는 수집되었으나 AI 해석에 실패했습니다. "
                    f"`GEMINI_API_KEY`를 확인한 뒤 재생성해 주세요.\n\n"
                    f"오류: {ai_err}"
                )

        existing.generated_at = datetime.utcnow()
        db.commit()
        db.refresh(existing)
        return serialize_report(existing)
    except Exception as e:
        logger.exception("trade report failed: %s", report_month)
        has_data = False
        try:
            has_data = bool(existing.summary_json and json.loads(existing.summary_json))
        except json.JSONDecodeError:
            pass
        existing.status = "partial" if has_data else "failed"
        existing.error_message = str(e)[:500]
        db.commit()
        if has_data:
            return serialize_report(existing)
        raise
