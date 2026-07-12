"""
core/volatility_forecast.py
변동성 예측 스코어 (0~100, 높을수록 급변 가능성 높음) — AI 호출 없음
buy_score.py(매수 타이밍)와 짝을 이루는 "크기" 축.

국내(KRX) 종목만 대상 — 볼린저/거래량 계산에 pykrx 라이브 OHLCV가 필요하기 때문.
PriceHistory 테이블은 보유 종목만 성기게 쌓여 있어 신뢰하지 않고, 매매습관 차트(routes.py의
get_stock_chart)와 동일하게 그때그때 pykrx에서 받아온다.
"""
from __future__ import annotations

import logging
from datetime import date, datetime, timedelta
from typing import Optional

from sqlalchemy.orm import Session

from config.database import AlertHistory, MacroSignal, SectorSignal, Stock
from core.sector_peers import sectors_match

logger = logging.getLogger(__name__)

_SQUEEZE_STRONG = 30
_SQUEEZE_MILD = 15
_VOLUME_SPIKE = 20
_SIGNAL_DENSITY = 20
_ALERT_FREQ = 15
_SENTIMENT_SPLIT = 15


# 국내 종목 판정은 sector_peers와 단일 기준을 공유 (정의가 갈라지면 같은 종목이
# 섹터 로직에는 잡히고 변동성 스코어에서는 UNKNOWN이 되는 불일치가 생긴다)
from core.sector_peers import is_krx_stock as _is_krx_stock


def _fetch_recent_ohlcv(symbol: str, days: int = 45) -> Optional[list[dict]]:
    """최근 N일 OHLCV를 pykrx로 라이브 조회. 실패하면 None."""
    try:
        from pykrx import stock as krx

        end = date.today()
        start = end - timedelta(days=days)
        df = krx.get_market_ohlcv_by_date(start.strftime("%Y%m%d"), end.strftime("%Y%m%d"), symbol)
        if df is None or df.empty:
            return None
        rows = []
        for _, row in df.iterrows():
            rows.append({
                "close": float(row.get("종가", row.get("Close", 0))),
                "high": float(row.get("고가", row.get("High", 0))),
                "low": float(row.get("저가", row.get("Low", 0))),
                "volume": float(row.get("거래량", row.get("Volume", 0))),
            })
        return rows
    except Exception as e:
        logger.warning("⚠️ %s OHLCV 조회 실패 (변동성 스코어): %s", symbol, e)
        return None


def _bollinger_width_pct(closes: list[float], window: int = 20) -> Optional[float]:
    """최근 window일 종가의 볼린저 밴드 폭(중심 대비 %). 좁을수록 스퀴즈(급변 임박)."""
    if len(closes) < window:
        return None
    recent = closes[-window:]
    mean = sum(recent) / window
    if mean <= 0:
        return None
    variance = sum((c - mean) ** 2 for c in recent) / window
    std = variance ** 0.5
    band_width = (std * 4)  # ±2σ
    return (band_width / mean) * 100


def _volume_ratio(volumes: list[float], window: int = 20) -> Optional[float]:
    if len(volumes) < window + 1:
        return None
    avg = sum(volumes[-(window + 1):-1]) / window
    if avg <= 0:
        return None
    return volumes[-1] / avg


def calculate_volatility_score(db: Session, stock: Stock, *, days: int = 30) -> dict:
    """
    변동성 스코어(0~100) 계산. buy_score.py의 calculate_buy_score와 반환 형태를 맞춘다.
    국내 종목 외에는 데이터 부족으로 처리(이번 버전은 pykrx 라이브 조회 기반이라 국내주 한정).
    """
    if not _is_krx_stock(stock):
        return {
            "symbol": stock.symbol,
            "name": stock.name,
            "score": 0,
            "level": "UNKNOWN",
            "factors": [],
            "interpretation": "국내 상장 종목이 아니어서 변동성 스코어를 계산하지 않습니다.",
            "disclaimer": "본 점수는 투자 판단의 근거가 될 수 없으며 참고용입니다.",
            "calculated_at": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%S"),
        }

    score = 0
    factors: list[dict] = []

    ohlcv = _fetch_recent_ohlcv(stock.symbol)
    if ohlcv and len(ohlcv) >= 21:
        closes = [r["close"] for r in ohlcv if r["close"] > 0]
        volumes = [r["volume"] for r in ohlcv]

        bw = _bollinger_width_pct(closes)
        if bw is not None:
            if bw < 5:
                score += _SQUEEZE_STRONG
                factors.append({
                    "factor": "볼린저 스퀴즈", "score": _SQUEEZE_STRONG,
                    "desc": f"20일 밴드 폭 {bw:.1f}% — 강한 스퀴즈, 방향 불문 큰 움직임 예고",
                })
            elif bw < 10:
                score += _SQUEEZE_MILD
                factors.append({
                    "factor": "볼린저 스퀴즈", "score": _SQUEEZE_MILD,
                    "desc": f"20일 밴드 폭 {bw:.1f}% — 완만한 스퀴즈",
                })

        vr = _volume_ratio(volumes)
        if vr is not None and vr > 2.0:
            score += _VOLUME_SPIKE
            factors.append({
                "factor": "거래량 급증", "score": _VOLUME_SPIKE,
                "desc": f"20일 평균 대비 {vr:.1f}배 — 수급 변화 가능성",
            })
    else:
        factors.append({
            "factor": "가격 데이터", "score": 0,
            "desc": "최근 OHLCV 조회 실패 — 볼린저/거래량 팩터 생략",
        })

    since7 = (datetime.utcnow() - timedelta(days=7)).strftime("%Y-%m-%d")
    since14 = (datetime.utcnow() - timedelta(days=14)).strftime("%Y-%m-%d")

    sector_sigs_7d = [
        s for s in db.query(SectorSignal).filter(SectorSignal.event_date >= since7).all()
        if sectors_match(stock.sector, s.sector, stock.symbol)
    ]
    macro_sigs_7d = db.query(MacroSignal).filter(MacroSignal.event_date >= since7).all()
    signal_count = len(sector_sigs_7d) + len(macro_sigs_7d)
    if signal_count >= 5:
        score += _SIGNAL_DENSITY
        factors.append({
            "factor": "Signal 과밀", "score": _SIGNAL_DENSITY,
            "desc": f"최근 7일 매크로+섹터 Signal {signal_count}건 — 정보 과부하 구간",
        })

    since90 = datetime.utcnow() - timedelta(days=90)
    alert_count = (
        db.query(AlertHistory)
        .filter(AlertHistory.stock_symbol == stock.symbol, AlertHistory.created_at >= since90)
        .count()
    )
    if alert_count >= 5:
        score += _ALERT_FREQ
        factors.append({
            "factor": "고빈도 급변 이력", "score": _ALERT_FREQ,
            "desc": (
                f"최근 90일 급등락 알림 {alert_count}건 — "
                "단, 알림 중복재발송 버그 수정 이전 기간이 섞여 있어 절대값보다 상대 비교용 참고"
            ),
        })

    sector_sigs_14d = [
        s for s in db.query(SectorSignal).filter(SectorSignal.event_date >= since14).all()
        if sectors_match(stock.sector, s.sector, stock.symbol)
    ]
    macro_sigs_14d = db.query(MacroSignal).filter(MacroSignal.event_date >= since14).all()
    pos = sum(1 for s in sector_sigs_14d if s.sentiment == "POSITIVE") + sum(
        1 for m in macro_sigs_14d if m.sentiment == "POSITIVE"
    )
    neg = sum(1 for s in sector_sigs_14d if s.sentiment == "NEGATIVE") + sum(
        1 for m in macro_sigs_14d if m.sentiment == "NEGATIVE"
    )
    if pos > 0 and neg > 0:
        score += _SENTIMENT_SPLIT
        factors.append({
            "factor": "감성 분열", "score": _SENTIMENT_SPLIT,
            "desc": f"긍정 {pos}건 · 부정 {neg}건 동시 존재 — 시장 불확실성 높음",
        })

    final = max(0, min(100, score))
    level = "HIGH" if final >= 60 else "MEDIUM" if final >= 30 else "LOW"

    return {
        "symbol": stock.symbol,
        "name": stock.name,
        "score": final,
        "level": level,
        "factors": factors,
        "interpretation": _interpret(level, final),
        "disclaimer": "본 점수는 투자 판단의 근거가 될 수 없으며 참고용입니다.",
        "calculated_at": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%S"),
        "days_window": days,
    }


def _interpret(level: str, score: int) -> str:
    if level == "HIGH":
        return f"변동성 높음({score}점) — 단기 급변 가능. 분할 매수·손절 라인 설정 권장"
    if level == "MEDIUM":
        return f"변동성 보통({score}점) — 추세 방향 확인 후 진입 권장"
    return f"변동성 낮음({score}점) — 상대적으로 안정적인 흐름"
