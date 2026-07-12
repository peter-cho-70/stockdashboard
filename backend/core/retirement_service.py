"""
core/retirement_service.py
노후생활(은퇴 설계) — 프로필/진단 스냅샷/AI 의견/주간 리뷰
doc/retire_PRD.md 기반 v1: 글라이드 패스 목표배분·4% 룰 필요자금·재정보드 월 밸런스 연동.
저장은 finance 쪽 관례대로 FinanceJsonStore(store_key별 JSON)를 재사용한다.
"""
from __future__ import annotations

import json
import logging
from copy import deepcopy
from datetime import date, datetime, timedelta
from typing import Any

from sqlalchemy.orm import Session

from config.database import AlertHistory, FinanceAssetSnapshot
from core.finance_service import (
    get_finance_state,
    get_ledger_state,
    get_stock_snapshot,
    load_json_store,
    save_json_store,
)

logger = logging.getLogger(__name__)

RETIRE_PROFILE_KEY = "retire_profile"
RETIRE_OPINION_KEY = "retire_opinion"
RETIRE_REVIEWS_KEY = "retire_reviews"
MAX_REVIEWS = 30

# 4% 룰(Bengen) — 연 생활비 / 0.04 = 필요 노후자금
SAFE_WITHDRAWAL_RATE = 0.04

DEFAULT_RETIRE_PROFILE: dict[str, Any] = {
    "birth_year": None,          # 출생연도 (미입력 시 연령 기반 계산 생략)
    "target_retire_age": 65,     # 목표 은퇴 나이
    "target_monthly_expense": 3_000_000,  # 은퇴 후 목표 월 생활비(원)
    "risk_tolerance": "balanced",  # conservative | balanced | aggressive
    "notes": "",
}

# retire_PRD.md FR2 글라이드 패스 — 은퇴까지 잔여연수 → 목표 주식비중 밴드(%)
GLIDE_PATH_BANDS: list[tuple[int, int, int, str]] = [
    # (잔여연수 하한, 주식 하한, 주식 상한, 초점)
    (25, 80, 90, "자산형성 초기 — 복리 극대화, 세액공제·ISA 최대 납입"),
    (15, 65, 75, "형성기 정점 — 분산 강화, 연금 납입 지속"),
    (5, 45, 55, "보존기 전환(de-risking) — 채권·배당 확대, 인출 계획 수립"),
    (0, 30, 40, "인출기 — 버킷 전략, 절세 인출 순서, 현금 2~3년 확보"),
]

# AI 프롬프트에 넣는 제도 지식 요약 (retire_PRD.md 4·13장, 2026-07 조사 기준)
RETIRE_KNOWLEDGE_NOTES = """[제도 지식 — 2026-07 조사 기준, 세법 개정 가능]
- 연금저축+IRP 세액공제 한도 연 900만원(공제율 13.2~16.5%), 합산 납입 한도 연 1,800만원.
- ISA(중개형): 연 2,000만원·총 1억 납입, 비과세 200~500만원 + 초과 9.9% 분리과세, 3년 의무보유.
  만기자금을 연금계좌로 이전하면 전환액 10%(최대 300만원) 추가 세액공제(해지 후 60일 이내).
- 사적연금 수령: 연 1,500만원 이하면 저율 분리과세(55~69세 5.5%…)로 종결 — 수령액 분산이 핵심.
- 건강보험 피부양자: 합산소득 2,000만원 이하 & 금융소득 단독 1,000만원 이하 유지가 중요.
  사적연금(연금저축·IRP) 소득은 건보료 산정에서 제외되어 실수령 방어에 가장 유리.
- 글라이드 패스(목표 주식비중): 은퇴까지 25년+ 80~90% / 15~24년 65~75% / 5~14년 45~55% / 5년 미만·은퇴후 30~40%.
- 절세계좌 우선순위: ①연금 세액공제 900만 소진 → ②ISA 납입 → ③일반계좌."""


# ─────────────────────────────────────────────
# 프로필
# ─────────────────────────────────────────────
def get_retire_profile(db: Session) -> dict[str, Any]:
    saved = load_json_store(db, RETIRE_PROFILE_KEY)
    merged = deepcopy(DEFAULT_RETIRE_PROFILE)
    if isinstance(saved, dict):
        for k in merged:
            v = saved.get(k, merged[k])
            # birth_year만 정당하게 null일 수 있음 — 나머지는 저장값이 null이면 기본값 유지
            if v is None and k != "birth_year":
                continue
            merged[k] = v
    return merged


def save_retire_profile(db: Session, payload: dict[str, Any]) -> dict[str, Any]:
    clean = get_retire_profile(db)
    if payload.get("birth_year") is not None:
        try:
            year = int(payload["birth_year"])
            if 1930 <= year <= date.today().year:
                clean["birth_year"] = year
        except (TypeError, ValueError):
            pass
    if payload.get("target_retire_age") is not None:
        try:
            clean["target_retire_age"] = max(40, min(90, int(payload["target_retire_age"])))
        except (TypeError, ValueError):
            pass
    if payload.get("target_monthly_expense") is not None:
        try:
            clean["target_monthly_expense"] = max(0, int(payload["target_monthly_expense"]))
        except (TypeError, ValueError):
            pass
    if payload.get("risk_tolerance") in ("conservative", "balanced", "aggressive"):
        clean["risk_tolerance"] = payload["risk_tolerance"]
    if isinstance(payload.get("notes"), str):
        clean["notes"] = payload["notes"][:2000]
    save_json_store(db, RETIRE_PROFILE_KEY, clean)
    return clean


# ─────────────────────────────────────────────
# 진단 스냅샷 (AI 호출 없음)
# ─────────────────────────────────────────────
def _target_equity_band(years_to_retire: int | None) -> dict[str, Any] | None:
    if years_to_retire is None:
        return None
    for floor, lo, hi, focus in GLIDE_PATH_BANDS:
        if years_to_retire >= floor:
            return {"equity_min": lo, "equity_max": hi, "mid": (lo + hi) / 2, "focus": focus}
    return None


def _monthlyize(amount: float, cycle: str) -> float:
    if cycle == "monthly":
        return amount
    if cycle == "quarterly":
        return amount / 3
    if cycle in ("yearly", "seasonal"):
        return amount / 12
    return 0.0


def _asset_snapshot_at(rows: list[FinanceAssetSnapshot], days_ago: int) -> FinanceAssetSnapshot | None:
    """rows(날짜 오름차순)에서 days_ago일 전과 가장 가까운 스냅샷"""
    if not rows:
        return None
    target = (date.today() - timedelta(days=days_ago)).strftime("%Y-%m-%d")
    best = None
    for r in rows:
        if r.date <= target:
            best = r
        else:
            break
    return best  # 해당 시점 이전 스냅샷이 없으면 None (추세 계산 생략)


def _ledger_monthly_averages(ledger_state: dict[str, Any], months: int = 3) -> dict[str, Any]:
    """직전 N개 달(이번 달 제외) 가계부 평균 수입/지출. 거래가 있는 달만 평균에 넣는다."""
    today = date.today()
    month_keys: list[str] = []
    y, m = today.year, today.month
    for _ in range(months):
        m -= 1
        if m == 0:
            y, m = y - 1, 12
        month_keys.append(f"{y:04d}-{m:02d}")

    per_month: dict[str, dict[str, float]] = {k: {"income": 0.0, "expense": 0.0, "count": 0} for k in month_keys}
    for t in ledger_state.get("transactions", []):
        prefix = str(t.get("date", ""))[:7]
        if prefix not in per_month:
            continue
        bucket = per_month[prefix]
        bucket["count"] += 1
        if t.get("type") == "income":
            bucket["income"] += t.get("amount", 0) or 0
        elif t.get("type") == "expense":
            bucket["expense"] += t.get("amount", 0) or 0

    active = [v for v in per_month.values() if v["count"] > 0]
    if not active:
        return {"months_counted": 0, "avg_income": None, "avg_expense": None, "avg_net": None}
    avg_income = sum(v["income"] for v in active) / len(active)
    avg_expense = sum(v["expense"] for v in active) / len(active)
    return {
        "months_counted": len(active),
        "avg_income": round(avg_income),
        "avg_expense": round(avg_expense),
        "avg_net": round(avg_income - avg_expense),
    }


def build_retirement_snapshot(db: Session) -> dict[str, Any]:
    profile = get_retire_profile(db)
    today = date.today()

    age = today.year - profile["birth_year"] if profile.get("birth_year") else None
    years_to_retire = (
        max(0, profile["target_retire_age"] - age) if age is not None else None
    )
    glide = _target_equity_band(years_to_retire)

    # 자산 스냅샷(재정보드가 매일 upsert) — 최신 + 7일/90일 전 추세
    asset_rows = (
        db.query(FinanceAssetSnapshot).order_by(FinanceAssetSnapshot.date.asc()).all()
    )
    latest = asset_rows[-1] if asset_rows else None
    week_ago = _asset_snapshot_at(asset_rows, 7)
    quarter_ago = _asset_snapshot_at(asset_rows, 90)

    stock = get_stock_snapshot(db)
    total_assets = latest.total_assets if latest else 0
    total_liabilities = latest.total_liabilities if latest else 0
    net_worth = total_assets - total_liabilities
    equity_pct = round(stock["total_value"] / total_assets * 100, 1) if total_assets > 0 else None
    equity_drift = (
        round(equity_pct - glide["mid"], 1) if equity_pct is not None and glide else None
    )

    # 필요 노후자금(4% 룰)·달성률
    annual_expense = profile["target_monthly_expense"] * 12
    required_capital = round(annual_expense / SAFE_WITHDRAWAL_RATE) if annual_expense > 0 else None
    progress_pct = (
        round(net_worth / required_capital * 100, 1) if required_capital and net_worth > 0 else None
    )

    # 재정보드 등록 기반 월 수입/지출
    finance_state = get_finance_state(db)
    reg_income = sum(
        i.get("amount", 0) or 0
        for i in finance_state.get("incomes", [])
        if i.get("cycle") == "monthly"
    )
    reg_expense = sum(
        _monthlyize(e.get("amount", 0) or 0, e.get("cycle", "monthly"))
        for e in finance_state.get("fixedExpenses", [])
    )
    reg_interest = sum(
        l.get("monthlyInterest", 0) or 0 for l in finance_state.get("liabilities", [])
    )

    # 가계부 실측(직전 3개월 평균)
    measured = _ledger_monthly_averages(get_ledger_state(db))

    # 가계부 실측이 한 달이라도 있으면 수입·지출 모두 실측 기준(0도 실측값),
    # 없으면 둘 다 재정보드 등록 기준 — 소스가 섞이면 저축 여력이 왜곡된다.
    if measured["months_counted"] > 0:
        monthly_income = measured["avg_income"] or 0
        monthly_expense = measured["avg_expense"] or 0
    else:
        monthly_income = round(reg_income)
        monthly_expense = round(reg_expense + reg_interest)
    savings_capacity = monthly_income - monthly_expense

    def _net_worth_delta(past: FinanceAssetSnapshot | None) -> float | None:
        if not past:
            return None
        return round(net_worth - ((past.total_assets or 0) - (past.total_liabilities or 0)))

    return {
        "as_of": today.isoformat(),
        "profile": profile,
        "age": age,
        "years_to_retire": years_to_retire,
        "glide_path": glide,
        "assets": {
            "total_assets": total_assets,
            "total_liabilities": total_liabilities,
            "net_worth": net_worth,
            "liquid_assets": latest.liquid_assets if latest else 0,
            "real_estate_assets": latest.real_estate_assets if latest else 0,
            "snapshot_date": latest.date if latest else None,
            "net_worth_delta_7d": _net_worth_delta(week_ago),
            "net_worth_delta_90d": _net_worth_delta(quarter_ago),
        },
        "portfolio": {
            "stock_value": stock["total_value"],
            "stock_profit_rate": stock["total_profit_rate"],
            "stock_count": stock["stock_count"],
            "equity_pct_of_assets": equity_pct,
            "equity_drift_vs_target": equity_drift,
        },
        "retirement_goal": {
            "target_monthly_expense": profile["target_monthly_expense"],
            "required_capital": required_capital,
            "progress_pct": progress_pct,
        },
        "monthly_balance": {
            "income": monthly_income,
            "expense": monthly_expense,
            "savings_capacity": savings_capacity,
            "registered_income": round(reg_income),
            "registered_expense": round(reg_expense + reg_interest),
            "measured": measured,
        },
    }


# ─────────────────────────────────────────────
# AI 종합 의견
# ─────────────────────────────────────────────
def _build_opinion_prompt(snapshot: dict[str, Any]) -> str:
    return f"""당신은 은퇴 설계·자산배분 전문가입니다. 아래 사용자의 노후 준비 현황 데이터를 바탕으로 종합 의견을 작성하세요.
투자·세무 자문이 아닌 참고 의견이며, 과장 없이 데이터에 근거해 판단하세요.

[노후 준비 현황 데이터(JSON)]
{json.dumps(snapshot, ensure_ascii=False, indent=1)}

{RETIRE_KNOWLEDGE_NOTES}

다음 JSON 형식으로만 응답하세요. 마크다운 기호(#, ** 등) 없이 자연스러운 한국어 존댓말 문장으로 작성하세요:
{{
 "adequacy_score": 0~100 사이 정수 (현재 노후 준비 적절성 점수),
 "adequacy": "현재 포트폴리오·자산이 노후 준비에 적절한지 평가 2~3문단. 필요자금 달성률, 목표 주식비중 대비 드리프트, 자산 구성(부동산/유동성 편중)을 근거로.",
 "trend": "지금 추세(월 저축 여력, 최근 자산 변화)가 이어질 때 향후 전망 1~2문단.",
 "actions": ["지금 실행할 구체적 조치 3~5개 (절세계좌 납입, 리밸런싱, 지출 조정 등)"],
 "finance_balance": "월 소득-지출 밸런스 평가와 어떤 지출/소득 항목을 조절하면 좋을지 구체적 조언 1~2문단 (재정보드 연동용).",
 "risk_warnings": ["주의할 리스크 1~3개 (건보료, 시퀀스 리스크, 집중 위험 등 해당되는 것만)"]
}}"""


def get_saved_retirement_opinion(db: Session) -> dict[str, Any] | None:
    return load_json_store(db, RETIRE_OPINION_KEY)


def generate_retirement_opinion(db: Session, provider: str | None = None) -> dict[str, Any]:
    from core.ai_analyzer import create_analyzer

    snapshot = build_retirement_snapshot(db)
    prompt = _build_opinion_prompt(snapshot)
    analyzer = create_analyzer(db)
    result = analyzer.analyze_json_prompt(prompt, provider, log_label="노후 준비 종합 의견")
    if not result or not result.get("adequacy"):
        raise RuntimeError("AI 노후 의견 생성에 실패했습니다. 로그를 확인하세요.")

    payload: dict[str, Any] = {
        "adequacy_score": result.get("adequacy_score"),
        "adequacy": result.get("adequacy"),
        "trend": result.get("trend"),
        "actions": result.get("actions") or [],
        "finance_balance": result.get("finance_balance"),
        "risk_warnings": result.get("risk_warnings") or [],
        "snapshot": snapshot,
        "generated_at": datetime.utcnow().isoformat(),
    }
    save_json_store(db, RETIRE_OPINION_KEY, payload)
    return payload


# ─────────────────────────────────────────────
# 주간 리뷰 (스케줄러: 매주 일요일)
# ─────────────────────────────────────────────
def _build_weekly_review_prompt(snapshot: dict[str, Any]) -> str:
    return f"""당신은 은퇴 설계 전문가입니다. 아래는 사용자의 이번 주 노후 준비 현황입니다.
매주 반복되는 주간 리뷰이므로 장황한 총론 대신, 이번 주 상태와 방향성 중심으로 짧고 실용적으로 작성하세요.

[이번 주 노후 준비 현황(JSON)]
{json.dumps(snapshot, ensure_ascii=False, indent=1)}

{RETIRE_KNOWLEDGE_NOTES}

다음 JSON 형식으로만 응답하세요. 마크다운 기호 없이 한국어 존댓말로:
{{
 "summary": "이번 주 노후 준비 상태 요약 1문단 (필요자금 달성률·최근 7일 순자산 변화·저축 여력 언급)",
 "direction": "다음 주에 유지/조정할 방향성 1문단",
 "actions": ["이번 주 기준 실행 제안 1~3개"]
}}"""


def list_retirement_reviews(db: Session) -> list[dict[str, Any]]:
    saved = load_json_store(db, RETIRE_REVIEWS_KEY)
    return saved if isinstance(saved, list) else []


def run_weekly_retirement_review(db: Session, provider: str | None = None) -> dict[str, Any]:
    from core.ai_analyzer import create_analyzer

    snapshot = build_retirement_snapshot(db)
    prompt = _build_weekly_review_prompt(snapshot)
    analyzer = create_analyzer(db)
    result = analyzer.analyze_json_prompt(prompt, provider, log_label="노후 준비 주간 리뷰")
    if not result or not result.get("summary"):
        raise RuntimeError("AI 주간 리뷰 생성에 실패했습니다. 로그를 확인하세요.")

    entry: dict[str, Any] = {
        "week_of": snapshot["as_of"],
        "summary": result.get("summary"),
        "direction": result.get("direction"),
        "actions": result.get("actions") or [],
        "progress_pct": (snapshot.get("retirement_goal") or {}).get("progress_pct"),
        "net_worth": (snapshot.get("assets") or {}).get("net_worth"),
        "savings_capacity": (snapshot.get("monthly_balance") or {}).get("savings_capacity"),
        "created_at": datetime.utcnow().isoformat(),
    }
    reviews = list_retirement_reviews(db)
    # 같은 날짜에 재실행하면 덮어쓴다 (수동 재실행 대비)
    reviews = [r for r in reviews if r.get("week_of") != entry["week_of"]]
    reviews.insert(0, entry)
    save_json_store(db, RETIRE_REVIEWS_KEY, reviews[:MAX_REVIEWS])

    summary_text = str(entry["summary"] or "")
    db.add(
        AlertHistory(
            stock_symbol="노후생활",
            alert_type="RETIRE_REVIEW",
            message=f"📅 주간 노후 준비 리뷰: {summary_text[:180]}",
        )
    )
    db.commit()
    return entry
