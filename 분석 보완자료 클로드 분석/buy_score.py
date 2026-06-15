"""
core/buy_score.py
매수 타이밍 종합 스코어 (0~100점)

[원칙]
- AI 추가 호출 없음 — 저장된 Signal DB만 사용
- 점수 구성 요소를 투명하게 반환 (이유 설명 가능)
- 투자 판단 보조 목적 (단정 금지)

[점수 구성]
섹터 Signal    최대 30점  outlook POSITIVE=30, NEUTRAL=15, NEGATIVE=0
매크로 Signal  최대 20점  관련 매크로 방향성
종목 이슈      최대 25점  StockIssue sentiment 최근 7일 내
기술적 지표    최대 25점  MA 정배열, 60일선 위, 볼린저 중심 위
감점           최대 -30점 NEGATIVE Signal 누적, 60일선 아래
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy.orm import Session

from config.database import (
    MacroSignal, SectorSignal, Stock, StockIssue, IntelContent,
)
from core.sector_peers import sectors_match


# ── 점수 상수 ───────────────────────────────────────────────────
_SECTOR_POSITIVE    = 30
_SECTOR_NEUTRAL     = 12
_SECTOR_NEGATIVE    = -15
_MACRO_POSITIVE     = 15
_MACRO_NEUTRAL      = 5
_MACRO_NEGATIVE     = -10
_ISSUE_POSITIVE     = 25
_ISSUE_NEUTRAL      = 8
_ISSUE_NEGATIVE     = -20
_TECH_MA_ALIGNED    = 10   # MA5 > MA20 > MA60 정배열
_TECH_ABOVE_MA60    = 8    # 현재가 > MA60
_TECH_ABOVE_MA20    = 5    # 현재가 > MA20
_TECH_BOLLINGER_UP  = 5    # 볼린저 중심선 위 (MA20 위 = proxy)
_RECENT_NEG_PENALTY = -8   # 최근 7일 내 NEGATIVE 이슈 1건당


def _sentiment_score(sentiment: Optional[str], pos: int, neu: int, neg: int) -> tuple[int, str]:
    s = (sentiment or "NEUTRAL").upper()
    if s == "POSITIVE":
        return pos, "긍정"
    if s == "NEGATIVE":
        return neg, "부정"
    return neu, "중립"


def calculate_buy_score(
    db: Session,
    stock: Stock,
    *,
    days: int = 30,
) -> dict:
    """
    종목별 매수 타이밍 스코어 계산.

    Returns:
        score        : 0~100 (음수 클램프)
        grade        : A/B/C/D
        components   : 구성 요소별 점수 + 이유
        recent_issues: 최근 이슈 목록
        warning      : 주요 경고 메시지
    """
    since = (datetime.utcnow() - timedelta(days=days)).strftime("%Y-%m-%d")
    week_ago = (datetime.utcnow() - timedelta(days=7)).strftime("%Y-%m-%d")

    components: list[dict] = []
    total = 0

    # ── 1. 섹터 Signal ────────────────────────────────────────────
    sector_sigs = (
        db.query(SectorSignal)
        .filter(SectorSignal.event_date >= since)
        .order_by(SectorSignal.event_date.desc())
        .all()
    )
    matching = [s for s in sector_sigs if sectors_match(stock.sector, s.sector, stock.symbol)]

    if matching:
        # 최신 1건 기준
        latest = matching[0]
        pts, label = _sentiment_score(latest.sentiment, _SECTOR_POSITIVE, _SECTOR_NEUTRAL, _SECTOR_NEGATIVE)
        # 복수 긍정 Signal 보너스
        pos_count = sum(1 for s in matching if (s.sentiment or "") == "POSITIVE")
        bonus = min(pos_count - 1, 2) * 3 if pos_count > 1 else 0
        pts += bonus
        total += pts
        components.append({
            "category": "섹터",
            "score": pts,
            "label": label,
            "reason": f"{latest.sector} — {(latest.summary or '')[:60]}",
            "signal_count": len(matching),
            "event_date": latest.event_date,
        })
    else:
        components.append({
            "category": "섹터",
            "score": 0,
            "label": "데이터 없음",
            "reason": f"{days}일 내 섹터 Signal 없음",
            "signal_count": 0,
        })

    # ── 2. 매크로 Signal ─────────────────────────────────────────
    macro_sigs = (
        db.query(MacroSignal)
        .filter(MacroSignal.event_date >= since)
        .order_by(MacroSignal.event_date.desc())
        .limit(10)
        .all()
    )
    if macro_sigs:
        pos = sum(1 for m in macro_sigs if (m.sentiment or "") == "POSITIVE")
        neg = sum(1 for m in macro_sigs if (m.sentiment or "") == "NEGATIVE")
        net = pos - neg
        if net > 0:
            pts, label = _MACRO_POSITIVE, "매크로 긍정"
        elif net < 0:
            pts, label = _MACRO_NEGATIVE, "매크로 부정"
        else:
            pts, label = _MACRO_NEUTRAL, "매크로 중립"
        total += pts
        top_topics = list({m.topic for m in macro_sigs[:5]})
        components.append({
            "category": "매크로",
            "score": pts,
            "label": label,
            "reason": f"최근 {days}일 — " + ", ".join(top_topics[:4]),
            "signal_count": len(macro_sigs),
            "positive": pos,
            "negative": neg,
        })
    else:
        components.append({
            "category": "매크로",
            "score": 0,
            "label": "데이터 없음",
            "reason": "매크로 Signal 없음",
            "signal_count": 0,
        })

    # ── 3. 종목 이슈 (StockIssue) ─────────────────────────────────
    issues = (
        db.query(StockIssue)
        .filter(StockIssue.stock_id == stock.id)
        .join(IntelContent, StockIssue.content_id == IntelContent.id)
        .filter(IntelContent.analyzed_at >= since)
        .order_by(IntelContent.analyzed_at.desc())
        .limit(10)
        .all()
    )
    recent_issues_data = []
    if issues:
        latest_issue = issues[0]
        pts, label = _sentiment_score(
            latest_issue.sentiment, _ISSUE_POSITIVE, _ISSUE_NEUTRAL, _ISSUE_NEGATIVE
        )
        # 최근 7일 NEGATIVE 누적 감점
        neg_recent = sum(
            1 for i in issues
            if (i.sentiment or "") == "NEGATIVE"
            and i.content and i.content.analyzed_at
            and i.content.analyzed_at.strftime("%Y-%m-%d") >= week_ago
        )
        penalty = neg_recent * _RECENT_NEG_PENALTY
        pts += penalty
        total += pts
        components.append({
            "category": "종목이슈",
            "score": pts,
            "label": label,
            "reason": (latest_issue.issue_summary or "")[:80],
            "signal_count": len(issues),
            "negative_recent": neg_recent,
            "penalty": penalty,
        })
        for i in issues[:5]:
            cnt = i.content
            recent_issues_data.append({
                "sentiment": i.sentiment,
                "summary": (i.issue_summary or "")[:100],
                "analyzed_at": cnt.analyzed_at.strftime("%Y-%m-%d") if cnt and cnt.analyzed_at else None,
                "source_title": cnt.source_title if cnt else None,
            })
    else:
        components.append({
            "category": "종목이슈",
            "score": 0,
            "label": "데이터 없음",
            "reason": "이슈 분석 없음 — YouTube/뉴스 분석을 먼저 실행하세요",
            "signal_count": 0,
        })

    # ── 4. 기술적 지표 (현재가 + MA 기반) ──────────────────────────
    tech_score = 0
    tech_reasons = []
    cp = stock.current_price
    ap = stock.avg_price

    # MA는 DB에 없으므로 현재가와 평균단가로 proxy 계산
    # (정확한 MA는 chart API 에서 계산됨 — 여기선 간략 판단)
    if cp > 0:
        # 평균단가 위 = 수익 구간 (대략 MA 위 proxy)
        if ap > 0 and cp > ap:
            tech_score += _TECH_ABOVE_MA60
            tech_reasons.append(f"평균단가({ap:,.0f}원) 위")
        elif ap > 0 and cp < ap * 0.93:
            tech_score -= 8
            tech_reasons.append(f"평균단가 대비 -7% 이하 (손절 구간)")

        # 전일 등락률
        cr = stock.change_rate or 0
        if cr > 3:
            tech_score += 3
            tech_reasons.append(f"전일 +{cr:.1f}% 상승")
        elif cr < -5:
            tech_score -= 5
            tech_reasons.append(f"전일 {cr:.1f}% 하락")

    total += tech_score
    components.append({
        "category": "기술지표",
        "score": tech_score,
        "label": "현재가·평균단가 기준",
        "reason": " / ".join(tech_reasons) if tech_reasons else "기준 없음",
        "note": "정확한 MA 분석은 차트 탭에서 확인하세요",
    })

    # ── 최종 스코어 클램프 ─────────────────────────────────────────
    final = max(0, min(100, total))

    if final >= 70:
        grade, grade_label = "A", "매수 검토 가능"
    elif final >= 50:
        grade, grade_label = "B", "조건부 관심"
    elif final >= 30:
        grade, grade_label = "C", "관망"
    else:
        grade, grade_label = "D", "진입 보류"

    # 경고 메시지
    warnings = []
    neg_sector = [s for s in matching if (s.sentiment or "") == "NEGATIVE"]
    if neg_sector:
        warnings.append(f"섹터 부정 Signal {len(neg_sector)}건 — 진입 주의")
    if stock.change_rate and stock.change_rate < -5:
        warnings.append(f"전일 {stock.change_rate:.1f}% 급락 — 원인 확인 필요")
    if not issues:
        warnings.append("종목 이슈 분석 없음 — AI 분석 실행 권장")

    return {
        "symbol": stock.symbol,
        "name": stock.name,
        "score": final,
        "raw_score": total,
        "grade": grade,
        "grade_label": grade_label,
        "components": components,
        "recent_issues": recent_issues_data,
        "warnings": warnings,
        "disclaimer": "본 점수는 투자 판단의 근거가 될 수 없으며 참고용입니다.",
        "calculated_at": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%S"),
        "days_window": days,
    }
