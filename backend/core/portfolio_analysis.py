"""
core/portfolio_analysis.py
보유 종목 AI 포트폴리오 분석
- 보유 종목 구성·섹터 비중·손익·전일비 변화 현황
- 네이버에서 KOSPI/KOSDAQ 지수 맥락 수집
- Gemini(또는 fallback)로 종합 분석 리포트 생성
"""
from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Any

import httpx
from sqlalchemy.orm import Session

from config.database import Stock, PortfolioAISnapshot

logger = logging.getLogger(__name__)

UA = "Mozilla/5.0 (compatible; StockMind/1.0)"


def _fetch_market_context() -> dict[str, Any]:
    """KOSPI·KOSDAQ 지수 현황을 네이버 API에서 조회."""
    ctx: dict[str, Any] = {}
    for market_id, key in [("KOSPI", "kospi"), ("KOSDAQ", "kosdaq")]:
        try:
            r = httpx.get(
                f"https://m.stock.naver.com/api/index/{market_id}/basic",
                headers={"User-Agent": UA},
                timeout=8,
            )
            data = r.json()
            ctx[key] = {
                "name": market_id,
                "index": data.get("closePrice"),
                "change_rate": data.get("fluctuationsRatio"),
                "change_value": data.get("compareToPreviousClosePrice"),
            }
        except Exception as e:
            logger.debug("시장 지수 조회 실패 (%s): %s", market_id, e)
    return ctx


def _build_prompt(holdings: list[dict[str, Any]], market: dict[str, Any]) -> str:
    # ── 포트폴리오 집계 ──────────────────────────────
    valid = [h for h in holdings if h["avg_price"] > 0 and h["current_price"] > 0]

    total_buy     = sum(h["buy_amount"]  for h in valid)
    total_eval    = sum(h["eval_value"]  for h in valid)
    total_pnl     = total_eval - total_buy
    total_pnl_r   = total_pnl / total_buy * 100 if total_buy else 0

    prev_eval     = sum(h["prev_eval"]   for h in valid)
    daily_chg     = total_eval - prev_eval
    daily_chg_r   = daily_chg / prev_eval * 100 if prev_eval else 0

    profit_cnt    = sum(1 for h in valid if h["profit_rate"] > 0)
    loss_cnt      = sum(1 for h in valid if h["profit_rate"] < 0)

    # ── 섹터별 집계 ──────────────────────────────────
    sector_map: dict[str, dict[str, float]] = {}
    for h in valid:
        s = h["sector"] or "기타"
        if s not in sector_map:
            sector_map[s] = {"eval": 0, "buy": 0, "prev": 0}
        sector_map[s]["eval"] += h["eval_value"]
        sector_map[s]["buy"]  += h["buy_amount"]
        sector_map[s]["prev"] += h["prev_eval"]

    sector_lines = "\n".join(
        "  - {s}: 평가 {eval:,.0f}원 ({wt:.1f}%) | 손익 {pnl:+.1f}% | 전일비 {dchg:+.1f}%".format(
            s=s,
            eval=v["eval"],
            wt=v["eval"] / total_eval * 100 if total_eval else 0,
            pnl=(v["eval"] - v["buy"]) / v["buy"] * 100 if v["buy"] else 0,
            dchg=(v["eval"] - v["prev"]) / v["prev"] * 100 if v["prev"] else 0,
        )
        for s, v in sorted(sector_map.items(), key=lambda x: -x[1]["eval"])
    )

    # ── 상위 보유 종목 (비중순) ───────────────────────
    sorted_h = sorted(valid, key=lambda x: -x["eval_value"])
    top10_lines = "\n".join(
        "  - {name}({sym}) [{sector}]: {qty:.0f}주 | 비중 {wt:.1f}% | "
        "매입 {avg:,.0f}→현재 {cur:,.0f} | 손익 {pnl:+.1f}% | 전일비 {dchg:+.2f}%".format(
            name=h["name"], sym=h["symbol"], sector=h["sector"] or "미분류",
            qty=h["qty"], wt=h["eval_value"] / total_eval * 100 if total_eval else 0,
            avg=h["avg_price"], cur=h["current_price"],
            pnl=h["profit_rate"], dchg=h["change_rate"],
        )
        for h in sorted_h[:15]
    )

    # ── 나머지 종목 요약 ──────────────────────────────
    rest_lines = ""
    if len(sorted_h) > 15:
        rest_lines = "\n  (이하 {}종목 생략)".format(len(sorted_h) - 15)

    # ── 오늘 상승/하락 Top5 ───────────────────────────
    gainers = sorted(valid, key=lambda x: -x["change_rate"])[:5]
    losers  = sorted(valid, key=lambda x:  x["change_rate"])[:5]
    gainer_lines = " / ".join(f"{h['name']} {h['change_rate']:+.1f}%" for h in gainers)
    loser_lines  = " / ".join(f"{h['name']} {h['change_rate']:+.1f}%" for h in losers)

    # ── 최대 손익 종목 ────────────────────────────────
    top_gain = sorted(valid, key=lambda x: -x["profit_rate"])[:3]
    top_loss = sorted(valid, key=lambda x:  x["profit_rate"])[:3]
    top_gain_lines = " / ".join(f"{h['name']} {h['profit_rate']:+.1f}%" for h in top_gain)
    top_loss_lines = " / ".join(f"{h['name']} {h['profit_rate']:+.1f}%" for h in top_loss)

    # ── 집중도 (HHI) ─────────────────────────────────
    weights = [h["eval_value"] / total_eval for h in valid if total_eval > 0]
    hhi = sum(w ** 2 for w in weights) * 10000  # 0~10000

    # ── 시장 지수 ─────────────────────────────────────
    kospi  = market.get("kospi", {})
    kosdaq = market.get("kosdaq", {})
    market_str = (
        f"KOSPI {kospi.get('index', 'N/A')} ({kospi.get('change_rate', 'N/A')}%), "
        f"KOSDAQ {kosdaq.get('index', 'N/A')} ({kosdaq.get('change_rate', 'N/A')}%)"
    )

    prompt = f"""당신은 한국 주식시장 전문 포트폴리오 애널리스트입니다.
이 포트폴리오는 **주도주(시장 테마·모멘텀을 이끄는 대형 선두 종목)** 중심으로 구성되어 있습니다.
분석 시 이 점을 반드시 참고하여, 주도주 전략의 관점에서 해석해 주세요.

## 현재 시장
{market_str}

## 포트폴리오 전체 요약
- 보유 종목: {len(valid)}개 (가격 정보 없는 종목 제외)
- 총 매입금액: {total_buy:,.0f}원
- 총 평가금액: {total_eval:,.0f}원
- 총 누적 손익: {total_pnl:+,.0f}원 ({total_pnl_r:+.2f}%)
- **오늘 하루 변동**: {daily_chg:+,.0f}원 ({daily_chg_r:+.2f}%)
- 수익 종목: {profit_cnt}개 / 손실 종목: {loss_cnt}개
- HHI 집중도 지수: {hhi:.0f} (10000=1종목 집중, 낮을수록 분산)

## 섹터별 구성 (평가금액 기준)
{sector_lines}

## 주요 보유 종목 (상위 15종목, 비중순)
{top10_lines}{rest_lines}

## 오늘 등락 현황
- 상승 상위: {gainer_lines}
- 하락 상위: {loser_lines}

## 누적 손익 현황
- 수익률 상위: {top_gain_lines}
- 손실률 하위: {top_loss_lines}

---
위 데이터를 바탕으로 **주도주 중심 포트폴리오** 관점에서 아래 항목을 한국어로 분석해 주세요.
각 항목은 구체적 종목명과 수치를 반드시 언급하고, 3~5문장으로 충분히 서술하세요.

1. **characteristics**: 이 포트폴리오의 전반적 성격 — 주도주 전략으로서의 특징, 테마 집중도, 분산 수준
2. **sector_analysis**: 섹터별 비중·손익·오늘 등락 분석 — 어떤 섹터에 집중되어 있고 어떤 성과를 보이는지
3. **daily_analysis**: 오늘 하루 변동 분석 — 시장 대비 상대 성과, 특이 등락 종목, 원인 추정
4. **market_comparison**: KOSPI·KOSDAQ 대비 포트폴리오 성과 비교 — 주도주 전략이 시장 대비 유효했는지
5. **profit_loss_review**: 수익·손실 종목 리뷰 — 주도주로서 유효한 종목과 모멘텀이 약해진 종목 구분
6. **concentration_risk**: 집중 리스크 — HHI, 상위 종목·섹터 쏠림, 이에 따른 변동성 분석
7. **strategy_assessment**: 주도주 전략 평가 — 현재 포트폴리오가 시장 주도 테마를 잘 반영하고 있는지
8. **suggestions**: 개선 제언 — 주도주 전략을 강화하거나 리스크를 줄이기 위한 구체적 방향 제시
9. **summary**: 한 줄 요약 — 이 포트폴리오를 한 문장으로 표현

응답은 반드시 아래 JSON 형식으로 반환하세요:
{{
  "characteristics": "...",
  "sector_analysis": "...",
  "daily_analysis": "...",
  "market_comparison": "...",
  "profit_loss_review": "...",
  "concentration_risk": "...",
  "strategy_assessment": "...",
  "suggestions": "...",
  "summary": "..."
}}"""
    return prompt


def generate_portfolio_analysis(db: Session, provider: str | None = None) -> dict[str, Any]:
    from core.ai_analyzer import create_analyzer

    stocks = (
        db.query(Stock)
        .filter(Stock.qty > 0, Stock.is_active.is_(True))
        .all()
    )
    if not stocks:
        raise ValueError("보유 종목이 없습니다.")

    holdings = []
    for s in stocks:
        buy_amount  = (s.avg_price or 0) * (s.qty or 0)
        eval_value  = (s.current_price or 0) * (s.qty or 0)
        prev_eval   = (s.prev_price or 0) * (s.qty or 0)
        profit_rate = (
            ((s.current_price or 0) - (s.avg_price or 0)) / (s.avg_price or 1) * 100
            if s.avg_price else 0
        )
        holdings.append({
            "symbol":        s.symbol,
            "name":          s.name,
            "sector":        s.sector,
            "qty":           s.qty or 0,
            "avg_price":     s.avg_price or 0,
            "current_price": s.current_price or 0,
            "prev_price":    s.prev_price or 0,
            "change_rate":   s.change_rate or 0,
            "buy_amount":    buy_amount,
            "eval_value":    eval_value,
            "prev_eval":     prev_eval,
            "profit_rate":   profit_rate,
        })

    market = _fetch_market_context()
    prompt = _build_prompt(holdings, market)

    analyzer = create_analyzer(db)
    result = analyzer.analyze_json_prompt(prompt, provider, log_label="포트폴리오 AI 분석")
    if not result:
        raise RuntimeError("AI 분석 생성에 실패했습니다.")

    valid = [h for h in holdings if h["avg_price"] > 0 and h["current_price"] > 0]
    total_buy   = sum(h["buy_amount"]  for h in valid)
    total_eval  = sum(h["eval_value"]  for h in valid)
    prev_eval   = sum(h["prev_eval"]   for h in valid)
    daily_chg   = total_eval - prev_eval
    daily_chg_r = daily_chg / prev_eval * 100 if prev_eval else 0

    meta = {
        "stock_count":    len(valid),
        "total_buy":      total_buy,
        "total_eval":     total_eval,
        "total_pnl":      total_eval - total_buy,
        "total_pnl_rate": (total_eval - total_buy) / total_buy * 100 if total_buy else 0,
        "daily_change":   daily_chg,
        "daily_change_rate": daily_chg_r,
        "profit_count":   sum(1 for h in valid if h["profit_rate"] > 0),
        "loss_count":     sum(1 for h in valid if h["profit_rate"] < 0),
        "market":         market,
    }

    # 항상 최신 1행만 유지 — 기존 행 삭제 후 새로 저장
    db.query(PortfolioAISnapshot).delete()
    now = datetime.utcnow()
    db.add(PortfolioAISnapshot(
        analysis=json.dumps(result, ensure_ascii=False),
        meta=json.dumps(meta, ensure_ascii=False),
        analyzed_at=now,
    ))
    db.commit()

    return {"analysis": result, "meta": meta, "analyzed_at": now.isoformat()}
