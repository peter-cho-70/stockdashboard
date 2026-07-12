"""
core/pattern_library.py
매크로 이슈 → 섹터 반응 패턴 추출 (Phase 4, AI 호출 없음)

"금리 인하 기대(POSITIVE) 같은 매크로 Signal이 나온 뒤, 2차전지 섹터가 실제로 N일 후 어떻게
움직였는지"를 과거 MacroSignal × 가격 데이터로 집계해 PatternLibrary에 저장한다.
core/signal_tracker.py의 "Signal → N일 후 가격 변화" 계산과 동일한 방식을 재사용.
"""
from __future__ import annotations

import json
import logging
from datetime import date, datetime, timedelta
from typing import Any, Optional

from sqlalchemy.orm import Session

from config.database import AlertHistory, MacroSignal, PatternLibrary, Stock
from core.sector_peers import find_active_stocks_in_sector, sectors_match
from core.signal_tracker import price_change_pct

PATTERN_ALERT_MIN_HIT_RATE = 0.6

logger = logging.getLogger(__name__)


def _is_mature(event_date: str, check_days: int) -> bool:
    try:
        end = datetime.strptime(event_date[:10], "%Y-%m-%d").date() + timedelta(days=check_days)
        return end <= date.today()
    except ValueError:
        return False

MIN_PATTERN_SAMPLE = 3
CHECK_DAYS = 5
EXAMPLE_DATE_LIMIT = 5

# (trigger_topic, trigger_sentiment, target_sector, pattern_name)
# topic 표기는 core/signal_extractor.py의 _MACRO_TOPIC_MAP 정규화 결과와 맞춘다.
KNOWN_PATTERNS: list[tuple[str, str, str, str]] = [
    ("금리", "POSITIVE", "2차전지", "금리 인하 기대 → 2차전지 반응"),
    ("금리", "POSITIVE", "부동산·리츠", "금리 인하 기대 → 리츠 반응"),
    ("금리", "NEGATIVE", "금융", "금리 상승 우려 → 금융 반응"),
    ("환율", "NEGATIVE", "자동차", "원화 강세 → 수출주(자동차) 반응"),
    ("유가", "POSITIVE", "에너지", "유가 상승 → 에너지 반응"),
    ("AI", "POSITIVE", "반도체", "AI 투자 확대 기대 → 반도체 반응"),
    ("반도체", "POSITIVE", "반도체", "반도체 업황 긍정 Signal → 반도체 반응"),
    ("FOMC/연준", "NEGATIVE", "반도체", "FOMC 매파 → 반도체 반응"),
    ("미국경제", "POSITIVE", "AI·빅테크", "미국 경기 호조 → AI·빅테크 반응"),
]


def _pattern_avg_change(db: Session, sig: MacroSignal, stocks: list) -> Optional[float]:
    """이 MacroSignal 발생 시점 기준, 대상 섹터 종목들(stocks)의 평균 CHECK_DAYS일 후 변화율."""
    changes = [
        c for c in (price_change_pct(db, s.id, sig.event_date, CHECK_DAYS) for s in stocks)
        if c is not None
    ]
    if not changes:
        return None
    return sum(changes) / len(changes)


def extract_patterns(db: Session) -> dict[str, int]:
    """KNOWN_PATTERNS 각각을 MacroSignal × 대상 섹터 실제 가격변화로 검증해 PatternLibrary upsert."""
    stats = {"updated": 0, "insufficient_data": 0, "no_signal": 0}

    for trigger_topic, trigger_sentiment, target_sector, pattern_name in KNOWN_PATTERNS:
        signals = (
            db.query(MacroSignal)
            .filter(
                MacroSignal.topic == trigger_topic,
                MacroSignal.sentiment == trigger_sentiment,
            )
            .order_by(MacroSignal.event_date.asc())
            .all()
        )

        # 섹터 종목 목록은 패턴별로 불변 — 시그널 루프 밖에서 한 번만 조회
        sector_stocks = find_active_stocks_in_sector(db, target_sector)

        occurrences: list[tuple[str, float, bool]] = []  # (event_date, avg_change, hit)
        for sig in signals:
            if not sig.event_date or not _is_mature(sig.event_date, CHECK_DAYS):
                continue
            avg_change = _pattern_avg_change(db, sig, sector_stocks)
            if avg_change is None:
                continue
            predicted_up = trigger_sentiment == "POSITIVE"
            hit = predicted_up == (avg_change > 0)
            occurrences.append((sig.event_date, avg_change, hit))

        if not signals:
            stats["no_signal"] += 1

        row = (
            db.query(PatternLibrary)
            .filter(
                PatternLibrary.trigger_topic == trigger_topic,
                PatternLibrary.trigger_sentiment == trigger_sentiment,
                PatternLibrary.target_sector == target_sector,
            )
            .first()
        )
        if row is None:
            row = PatternLibrary(
                pattern_name=pattern_name,
                trigger_topic=trigger_topic,
                trigger_sentiment=trigger_sentiment,
                target_sector=target_sector,
                check_days=CHECK_DAYS,
            )
            db.add(row)

        total = len(occurrences)
        row.total_count = total
        if total >= MIN_PATTERN_SAMPLE:
            hit_count = sum(1 for _, _, h in occurrences if h)
            row.hit_count = hit_count
            row.hit_rate = round(hit_count / total, 4)
            row.avg_move_pct = round(sum(c for _, c, _ in occurrences) / total, 4)
            row.last_occurred = occurrences[-1][0]
            row.example_dates = json.dumps([d for d, _, _ in occurrences[-EXAMPLE_DATE_LIMIT:]])
            stats["updated"] += 1
        else:
            row.hit_count = sum(1 for _, _, h in occurrences if h)
            row.hit_rate = None  # 표본 부족 — "데이터 부족"으로 표시
            row.avg_move_pct = (
                round(sum(c for _, c, _ in occurrences) / total, 4) if total else None
            )
            row.last_occurred = occurrences[-1][0] if occurrences else None
            row.example_dates = json.dumps([d for d, _, _ in occurrences]) if occurrences else None
            stats["insufficient_data"] += 1
        row.updated_at = datetime.utcnow()

    db.commit()
    logger.info(
        "✅ 패턴 라이브러리 추출 완료 — 갱신 %d건, 표본부족 %d건, Signal없음 %d건",
        stats["updated"], stats["insufficient_data"], stats["no_signal"],
    )
    return stats


def get_patterns(db: Session) -> list[dict[str, Any]]:
    rows = db.query(PatternLibrary).order_by(PatternLibrary.hit_rate.desc().nullslast()).all()
    result = []
    for r in rows:
        result.append({
            "id": r.id,
            "pattern_name": r.pattern_name,
            "trigger_topic": r.trigger_topic,
            "trigger_sentiment": r.trigger_sentiment,
            "target_sector": r.target_sector,
            "check_days": r.check_days,
            "avg_move_pct": r.avg_move_pct,
            "hit_count": r.hit_count,
            "total_count": r.total_count,
            "hit_rate": r.hit_rate,
            "insufficient_data": r.total_count < MIN_PATTERN_SAMPLE,
            "last_occurred": r.last_occurred,
            "example_dates": json.loads(r.example_dates) if r.example_dates else [],
        })
    return result


def check_pattern_alerts(db: Session, macro_signals: list[MacroSignal]) -> list[dict]:
    """새로 생성된 MacroSignal이 고신뢰(hit_rate>=0.6, 표본 3+) 패턴과 일치하면
    해당 target_sector 보유 종목에 AlertHistory(PATTERN_MATCH) 생성. AI 재호출 없음 —
    이미 계산된 PatternLibrary 캐시만 조회. 같은 종목·같은 패턴으로 오늘 이미 알렸으면 스킵."""
    if not macro_signals:
        return []

    today_str = datetime.utcnow().strftime("%Y-%m-%d")
    alerts: list[dict] = []
    # 보유 종목은 시그널 루프와 무관하게 동일 — 한 번만 조회
    held_stocks = db.query(Stock).filter(Stock.is_active == True, Stock.qty > 0).all()  # noqa: E712

    for sig in macro_signals:
        patterns = (
            db.query(PatternLibrary)
            .filter(
                PatternLibrary.trigger_topic == sig.topic,
                PatternLibrary.trigger_sentiment == sig.sentiment,
                PatternLibrary.hit_rate.isnot(None),
                PatternLibrary.hit_rate >= PATTERN_ALERT_MIN_HIT_RATE,
                PatternLibrary.total_count >= MIN_PATTERN_SAMPLE,
            )
            .all()
        )
        if not patterns:
            continue

        for pattern in patterns:
            matched = [s for s in held_stocks if sectors_match(s.sector, pattern.target_sector, s.symbol)]
            for stock in matched:
                msg = (
                    f"📊 패턴 감지: [{pattern.pattern_name}] "
                    f"적중률 {pattern.hit_rate:.0%} · 평균 {pattern.avg_move_pct:+.1f}% "
                    f"({pattern.check_days}일 후)"
                )
                dup = (
                    db.query(AlertHistory)
                    .filter(
                        AlertHistory.stock_symbol == stock.symbol,
                        AlertHistory.alert_type == "PATTERN_MATCH",
                        AlertHistory.message == msg,
                        AlertHistory.created_at >= today_str,
                    )
                    .first()
                )
                if dup:
                    continue
                db.add(AlertHistory(stock_symbol=stock.symbol, alert_type="PATTERN_MATCH", message=msg))
                alerts.append({"symbol": stock.symbol, "name": stock.name, "message": msg, "type": "PATTERN_MATCH"})

    if alerts:
        db.commit()
    return alerts
