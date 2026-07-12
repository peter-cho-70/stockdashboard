"""
core/sector_rotation.py
섹터 로테이션 감지 — "돈이 어느 섹터에서 어느 섹터로 이동하고 있는가" (Phase 8, AI 호출 없음)

최근 window_days를 전반기/후반기로 나눠 섹터별 SectorSignal 감성 점수 변화를 비교한다.
새 테이블 없음 — 기존 SectorSignal만 사용.
"""
from __future__ import annotations

from datetime import date, timedelta
from typing import Any

from sqlalchemy.orm import Session

from config.database import SectorSignal, Stock
from core.sector_peers import sectors_match

MIN_SIGNAL_COUNT = 3
ROTATION_SECTORS = [
    "반도체", "AI·빅테크", "2차전지", "바이오·헬스케어",
    "금융", "에너지", "소비재", "자동차", "방산", "부동산·리츠",
]


def _sentiment_score(sentiment: str | None) -> float:
    s = (sentiment or "NEUTRAL").upper()
    if s == "POSITIVE":
        return 1.0
    if s == "NEGATIVE":
        return -1.0
    return 0.0


def _avg_sentiment(rows: list[SectorSignal]) -> float:
    if not rows:
        return 0.0
    return round(sum(_sentiment_score(r.sentiment) for r in rows) / len(rows), 4)


def detect_sector_rotation(db: Session, window_days: int = 30) -> dict[str, Any]:
    half = window_days // 2
    today = date.today()
    early_start = (today - timedelta(days=window_days)).strftime("%Y-%m-%d")
    mid = (today - timedelta(days=half)).strftime("%Y-%m-%d")
    late_end = today.strftime("%Y-%m-%d")

    all_sectors: dict[str, dict[str, Any]] = {}
    for sector in ROTATION_SECTORS:
        early_rows = (
            db.query(SectorSignal)
            .filter(SectorSignal.sector == sector, SectorSignal.event_date >= early_start, SectorSignal.event_date < mid)
            .all()
        )
        late_rows = (
            db.query(SectorSignal)
            .filter(SectorSignal.sector == sector, SectorSignal.event_date >= mid, SectorSignal.event_date <= late_end)
            .all()
        )
        early_score = _avg_sentiment(early_rows)
        late_score = _avg_sentiment(late_rows)
        delta = round(late_score - early_score, 4)
        signal_count = len(early_rows) + len(late_rows)
        trend = "상승" if delta > 0.2 else "하락" if delta < -0.2 else "유지"
        all_sectors[sector] = {
            "early_score": early_score,
            "late_score": late_score,
            "delta": delta,
            "trend": trend,
            "signal_count": signal_count,
            "insufficient_data": signal_count < MIN_SIGNAL_COUNT,
        }

    ranked = sorted(
        (item for item in all_sectors.items() if not item[1]["insufficient_data"]),
        key=lambda x: -x[1]["delta"],
    )
    rising = [{"sector": s, **v} for s, v in ranked[:3] if v["delta"] > 0]
    falling = [{"sector": s, **v} for s, v in reversed(ranked[-3:]) if v["delta"] < 0] if ranked else []

    # 보유 종목 중 falling 섹터 비중 경고
    falling_sectors = {f["sector"] for f in falling}
    warnings: list[str] = []
    if falling_sectors:
        held = db.query(Stock).filter(Stock.is_active == True, Stock.qty > 0).all()
        total_value = sum(s.current_value for s in held) or 1
        for sector in falling_sectors:
            matched = [s for s in held if sectors_match(s.sector, sector, s.symbol)]
            if not matched:
                continue
            weight = sum(s.current_value for s in matched) / total_value * 100
            if weight >= 10:
                names = ", ".join(s.name for s in matched[:3])
                warnings.append(f"{sector} 비중 {weight:.0f}% ({names}) — 하락 섹터 편중")

    return {
        "window_days": window_days,
        "rising_sectors": rising,
        "falling_sectors": falling,
        "all_sectors": all_sectors,
        "warnings": warnings,
        "disclaimer": "최근 Signal 감성 흐름 기반 참고 지표이며, 실제 수급 이동을 보장하지 않습니다.",
    }
