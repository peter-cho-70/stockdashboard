"""
api/routes_morning.py
아침 루틴 — 시장 스냅샷 요약 + Gemini AI 매크로 판단
"""
from typing import List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from config.settings import get_settings
from core.gemini_client import GeminiClient, GeminiAuthError, GeminiQuotaError
from core.us_market_report import fetch_live_snapshot

morning_router = APIRouter(prefix="/morning", tags=["morning"])

_NEWS_TYPE_LABELS = {
    "FOMC": "FOMC/연준 이슈",
    "earnings": "기업 실적 발표",
    "geopolitics": "지정학적 리스크",
    "economic_indicator": "경제지표 발표",
    "other": "기타 이슈",
}


# ── 시장 스냅샷 (Phase 1/2 자동 입력) ────────────────────────────────────────

@morning_router.get("/snapshot")
def api_morning_snapshot():
    """yfinance 실시간 스냅샷을 Phase 1/2 입력 필드 형태로 가공."""
    try:
        snap = fetch_live_snapshot(mode="auto")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"시장 데이터 조회 실패: {e}") from e

    def _val(items: list, *keywords: str) -> Optional[float]:
        """등락률(change_pct) 반환 — 0.0도 유효값으로 처리."""
        for item in items:
            if item.get("error"):
                continue
            name = item.get("name", "")
            if all(kw.lower() in name.lower() for kw in keywords):
                v = item.get("change_pct")
                return v if v is not None else None
        return None

    def _price(items: list, *keywords: str) -> Optional[float]:
        """절대값(close) 반환 — VIX, 금리, 환율, 유가 등."""
        for item in items:
            if item.get("error"):
                continue
            name = item.get("name", "")
            if all(kw.lower() in name.lower() for kw in keywords):
                v = item.get("close")
                return v if v is not None else None
        return None

    indices = snap.get("us_indices", [])
    fx = snap.get("fx", [])
    treasury = snap.get("treasury", [])
    commodity = snap.get("commodity", [])

    return {
        "nasdaq":      _val(indices, "NASDAQ"),
        "sp500":       _val(indices, "S&P"),
        "dow":         _val(indices, "DOW"),
        "sox":         _val(indices, "반도체"),
        "vix":         _price(indices, "VIX"),
        "us10y_yield": _price(treasury, "10년"),
        "dxy":         _price(fx, "달러인덱스"),
        "usd_krw":     _price(fx, "원/달러"),
        "wti":         _price(commodity, "WTI"),
        "fetched_at":  snap.get("fetched_at_label"),
    }


# ── Gemini AI 매크로 판단 (Phase 2) ──────────────────────────────────────────

class MacroJudgmentRequest(BaseModel):
    nasdaq: Optional[float] = None
    sp500: Optional[float] = None
    vix: Optional[float] = None
    us10y_yield: Optional[float] = None
    dxy: Optional[float] = None
    usd_krw: Optional[float] = None
    wti: Optional[float] = None
    news_types: List[str] = []
    news_memo: Optional[str] = None


@morning_router.post("/macro-judgment")
def api_macro_judgment(body: MacroJudgmentRequest):
    """매크로 지표를 받아 Gemini AI가 오늘의 시장 판단 2문장을 생성."""
    settings = get_settings()
    if not settings.gemini_api_key:
        raise HTTPException(status_code=503, detail="Gemini API 키가 설정되지 않았습니다.")

    client = GeminiClient(api_key=settings.gemini_api_key, model=settings.gemini_model)
    if not client.ready:
        raise HTTPException(status_code=503, detail="Gemini 클라이언트 초기화 실패.")

    def fmt(v: Optional[float], suffix: str = "") -> str:
        return f"{v:+.2f}{suffix}" if v is not None else "미입력"

    news_label = (
        ", ".join(_NEWS_TYPE_LABELS.get(t, t) for t in body.news_types)
        if body.news_types
        else "없음"
    )

    prompt = f"""다음 글로벌 매크로 지표를 분석하여 오늘 국내 주식시장 투자자를 위한 판단을 한국어 2문장으로 작성하세요.
첫 문장: 핵심 매크로 흐름 요약. 둘째 문장: 국내 시장 영향 및 투자 방향.

[지표]
- 나스닥: {fmt(body.nasdaq, "%")}
- S&P 500: {fmt(body.sp500, "%")}
- VIX 공포지수: {body.vix if body.vix is not None else "미입력"} (20 이상 = 경고)
- 미국 10년물 금리: {body.us10y_yield if body.us10y_yield is not None else "미입력"}%
- 달러인덱스(DXY): {body.dxy if body.dxy is not None else "미입력"}
- 달러/원 환율: {body.usd_krw if body.usd_krw is not None else "미입력"}원 (1,400 이상 = 경고)
- WTI 유가: {body.wti if body.wti is not None else "미입력"}달러
- 주요 이슈: {news_label}
- 뉴스 메모: {body.news_memo or "없음"}

판단 (2문장, 최대 120자):"""

    try:
        result = client.generate_text(prompt, purpose="아침 매크로 판단")
        if not result:
            raise HTTPException(status_code=500, detail="AI 판단 생성 실패 — 빈 응답")
        return {"judgment": result.strip()}
    except GeminiAuthError as e:
        raise HTTPException(status_code=401, detail=e.message) from e
    except GeminiQuotaError as e:
        raise HTTPException(status_code=429, detail=f"Gemini 할당량 초과. {e.delay}초 후 재시도.") from e
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e
