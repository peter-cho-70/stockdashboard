"""
core/provider_scorecard.py
AI Provider(GPT/Claude/Gemini)별 Signal 적중률 비교 (Phase 5, AI 호출 없음)

IntelContent.analysis_provider(실제 분석에 성공한 provider) → SectorSignal.content_id →
SignalOutcome 으로 이어지는 기존 체인을 provider별로 나눠 집계한다. analysis_provider는
이번에 추가된 컬럼이라 앞으로 분석되는 콘텐츠부터 쌓인다 — 과거 데이터는 소급 적용 불가.
"""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

from sqlalchemy.orm import Session

from config.database import IntelContent, SectorSignal, SignalOutcome
from core.signal_tracker import _aggregate_bucket

MIN_SAMPLE_FOR_RECOMMEND = 10
PROVIDERS = ("claude", "openai", "gemini")


def get_provider_accuracy(db: Session, days: int = 90) -> dict[str, Any]:
    """Provider별 섹터 Signal 적중률 집계 + 추천 provider."""
    cutoff = datetime.utcnow() - timedelta(days=days)
    results: dict[str, Any] = {}

    for provider in PROVIDERS:
        content_ids = [
            row[0]
            for row in db.query(IntelContent.id)
            .filter(
                IntelContent.analysis_provider == provider,
                IntelContent.analyzed_at >= cutoff,
            )
            .all()
        ]
        if not content_ids:
            results[provider] = {
                "hit_rate": None,
                "sample_count": 0,
                "avg_magnitude": None,
                "insufficient_data": True,
            }
            continue

        sector_signal_ids = [
            row[0]
            for row in db.query(SectorSignal.id)
            .filter(SectorSignal.content_id.in_(content_ids))
            .all()
        ]
        if not sector_signal_ids:
            results[provider] = {
                "hit_rate": None,
                "sample_count": 0,
                "avg_magnitude": None,
                "insufficient_data": True,
            }
            continue

        outcomes = (
            db.query(SignalOutcome)
            .filter(
                SignalOutcome.signal_type == "sector",
                SignalOutcome.signal_id.in_(sector_signal_ids),
            )
            .all()
        )
        results[provider] = _aggregate_bucket(outcomes)

    candidates = [
        (p, r["hit_rate"])
        for p, r in results.items()
        if r["hit_rate"] is not None and r["sample_count"] >= MIN_SAMPLE_FOR_RECOMMEND
    ]
    recommended = max(candidates, key=lambda x: x[1])[0] if candidates else None

    return {
        "providers": results,
        "recommended_provider": recommended,
        "min_sample_for_recommend": MIN_SAMPLE_FOR_RECOMMEND,
        "days": days,
        "disclaimer": "과거 Signal 적중률 기준 참고 지표이며, 미래 분석 품질을 보장하지 않습니다.",
    }


def get_optimal_provider(db: Session, default: str = "gemini") -> str:
    """표본 10건 이상 provider 중 최고 적중률, 없으면 default(기존 동작 유지)."""
    try:
        acc = get_provider_accuracy(db)
        return acc.get("recommended_provider") or default
    except Exception:
        return default
