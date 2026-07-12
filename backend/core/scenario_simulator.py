"""
core/scenario_simulator.py
포트폴리오 시나리오 시뮬레이터 (Phase 7, AI 호출 없음)

"이 트리거(예: 금리 인하 기대)가 오늘 발생하면 내 포트폴리오는 얼마나 움직일까"를
Phase 4에서 실측한 PatternLibrary(avg_move_pct·hit_rate)를 그대로 재사용해 추정한다.
새 하드코딩 시나리오 테이블 없음 — pattern_library의 실측치만 사용.
"""
from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from config.database import PatternLibrary, Stock
from core.sector_peers import sectors_match

MIN_PATTERN_SAMPLE = 3


def simulate_scenario(db: Session, trigger_topic: str, trigger_sentiment: str) -> dict[str, Any]:
    """PatternLibrary에서 trigger_topic×trigger_sentiment와 일치하는 패턴을 찾아,
    보유 종목 각각을 섹터 매칭해 avg_move_pct를 적용하고 포트폴리오 비중으로 가중합산."""
    patterns = (
        db.query(PatternLibrary)
        .filter(
            PatternLibrary.trigger_topic == trigger_topic,
            PatternLibrary.trigger_sentiment == trigger_sentiment,
            PatternLibrary.avg_move_pct.isnot(None),
            # 표본 부족(1~2건) 패턴의 avg_move_pct는 노이즈일 수 있으므로 추정에서 제외
            PatternLibrary.total_count >= MIN_PATTERN_SAMPLE,
        )
        .all()
    )

    held = db.query(Stock).filter(Stock.is_active == True, Stock.qty > 0).all()
    total_value = sum(s.current_value for s in held)

    matched_patterns = [
        {
            "pattern_name": p.pattern_name,
            "target_sector": p.target_sector,
            "avg_move_pct": p.avg_move_pct,
            "hit_rate": p.hit_rate,
            "total_count": p.total_count,
            "insufficient_data": p.total_count < MIN_PATTERN_SAMPLE,
        }
        for p in patterns
    ]

    contributions: list[dict[str, Any]] = []
    weighted_sum = 0.0
    for stock in held:
        weight_pct = (stock.current_value / total_value * 100) if total_value else 0.0
        match = next(
            (p for p in patterns if sectors_match(stock.sector, p.target_sector, stock.symbol)),
            None,
        )
        move_pct = match.avg_move_pct if match else 0.0
        contribution_pct = weight_pct / 100 * move_pct
        weighted_sum += contribution_pct
        contributions.append({
            "symbol": stock.symbol,
            "name": stock.name,
            "sector": stock.sector,
            "matched_pattern": match.pattern_name if match else None,
            "avg_move_pct": match.avg_move_pct if match else None,
            "weight_pct": round(weight_pct, 2),
            "contribution_pct": round(contribution_pct, 4),
        })

    contributions.sort(key=lambda c: -abs(c["contribution_pct"]))

    return {
        "trigger_topic": trigger_topic,
        "trigger_sentiment": trigger_sentiment,
        "no_pattern_found": len(matched_patterns) == 0,
        "matched_patterns": matched_patterns,
        "estimated_total_change_pct": round(weighted_sum, 4),
        "estimated_pnl": round(weighted_sum / 100 * total_value, 0),
        "total_portfolio_value": round(total_value, 0),
        "contributions": contributions,
        "disclaimer": "패턴 라이브러리 실측 평균(avg_move_pct)을 종목별 섹터 매칭·비중으로 단순 가중합산한 추정치이며, 실제 결과를 보장하지 않습니다.",
    }
