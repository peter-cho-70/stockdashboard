"""
core/finance_service.py
재정허브 상태 — SQLite JSON 저장 (단일 사용자 로컬 DB)
"""
from __future__ import annotations

import json
import logging
from copy import deepcopy
from datetime import datetime
from typing import Any

from sqlalchemy.orm import Session

from config.database import FinanceJsonStore, Stock

logger = logging.getLogger(__name__)

FINANCE_STORE_KEY = "finance"
LEDGER_STORE_KEY = "ledger"

DEFAULT_LEDGER_SETTINGS = {
    "categories": [
        {"name": "식비", "sub": ["외식", "식재료", "편의점", "카페"], "color": "amber", "incomeOk": False},
        {"name": "교통", "sub": ["대중교통", "주유", "주차", "톨비"], "color": "blue", "incomeOk": False},
        {"name": "통신", "sub": ["휴대폰", "인터넷", "OTT 구독"], "color": "violet", "incomeOk": False},
        {"name": "의료", "sub": ["병원", "약국", "건강기능식품"], "color": "rose", "incomeOk": False},
        {"name": "교육", "sub": ["자녀학원", "자기계발", "도서"], "color": "green", "incomeOk": False},
        {"name": "문화", "sub": ["영화/공연", "여행", "취미"], "color": "pink", "incomeOk": False},
        {"name": "경조사", "sub": ["결혼/조의", "명절", "생일"], "color": "yellow", "incomeOk": False},
        {"name": "보험", "sub": ["생명보험", "실손", "자동차보험"], "color": "slate", "incomeOk": False},
        {"name": "대출상환", "sub": ["원금", "이자"], "color": "red", "incomeOk": False},
        {"name": "주거관리", "sub": ["관리비", "공과금", "수선"], "color": "teal", "incomeOk": False},
        {"name": "용돈", "sub": ["본인", "자녀", "부모"], "color": "indigo", "incomeOk": False},
        {"name": "임대수입", "sub": ["월세"], "color": "emerald", "incomeOk": True},
        {"name": "급여", "sub": ["본봉", "상여", "부업"], "color": "emerald", "incomeOk": True},
        {"name": "기타", "sub": [], "color": "gray", "incomeOk": True},
    ],
    "cardIssuers": [
        "삼성카드", "현대카드", "신한카드", "국민카드",
        "롯데카드", "우리카드", "하나카드", "NH농협카드",
    ],
    "users": [],
}

DEFAULT_FINANCE_STATE: dict[str, Any] = {
    "cashAssets": [],
    "illiquidAssets": [],
    "realEstateAssets": [],
    "liabilities": [],
    "fixedExpenses": [],
    "incomes": [],
    "fundingNeeds": [],
}

DEFAULT_LEDGER_STATE: dict[str, Any] = {
    "transactions": [],
    "budgets": [],
    "settings": DEFAULT_LEDGER_SETTINGS,
}


def _load_row(db: Session, store_key: str) -> FinanceJsonStore | None:
    return db.query(FinanceJsonStore).filter(FinanceJsonStore.store_key == store_key).first()


def _parse_json(raw: str, fallback: dict[str, Any]) -> dict[str, Any]:
    try:
        parsed = json.loads(raw or "{}")
        if not isinstance(parsed, dict):
            return deepcopy(fallback)
        return parsed
    except json.JSONDecodeError:
        logger.warning("finance JSON 파싱 실패 — 기본값 사용")
        return deepcopy(fallback)


def get_finance_state(db: Session) -> dict[str, Any]:
    row = _load_row(db, FINANCE_STORE_KEY)
    if not row:
        return deepcopy(DEFAULT_FINANCE_STATE)
    data = _parse_json(row.data_json, DEFAULT_FINANCE_STATE)
    merged = deepcopy(DEFAULT_FINANCE_STATE)
    merged.update({k: data.get(k, merged[k]) for k in merged})
    return merged


def save_finance_state(db: Session, payload: dict[str, Any]) -> dict[str, Any]:
    clean = deepcopy(DEFAULT_FINANCE_STATE)
    for key in clean:
        if key in payload and isinstance(payload[key], list):
            clean[key] = payload[key]
    row = _load_row(db, FINANCE_STORE_KEY)
    now = datetime.utcnow()
    encoded = json.dumps(clean, ensure_ascii=False)
    if row:
        row.data_json = encoded
        row.updated_at = now
    else:
        db.add(FinanceJsonStore(store_key=FINANCE_STORE_KEY, data_json=encoded, updated_at=now))
    db.commit()
    return clean


def get_ledger_state(db: Session) -> dict[str, Any]:
    row = _load_row(db, LEDGER_STORE_KEY)
    if not row:
        return deepcopy(DEFAULT_LEDGER_STATE)
    data = _parse_json(row.data_json, DEFAULT_LEDGER_STATE)
    merged = deepcopy(DEFAULT_LEDGER_STATE)
    merged["transactions"] = data.get("transactions") or []
    merged["budgets"] = data.get("budgets") or []
    settings = data.get("settings") or {}
    merged["settings"] = {
        **DEFAULT_LEDGER_SETTINGS,
        **settings,
        "categories": settings.get("categories") or DEFAULT_LEDGER_SETTINGS["categories"],
        "cardIssuers": settings.get("cardIssuers") or DEFAULT_LEDGER_SETTINGS["cardIssuers"],
        "users": settings.get("users") or DEFAULT_LEDGER_SETTINGS["users"],
    }
    return merged


def save_ledger_state(db: Session, payload: dict[str, Any]) -> dict[str, Any]:
    clean = get_ledger_state(db)
    if isinstance(payload.get("transactions"), list):
        clean["transactions"] = payload["transactions"]
    if isinstance(payload.get("budgets"), list):
        clean["budgets"] = payload["budgets"]
    if isinstance(payload.get("settings"), dict):
        settings = payload["settings"]
        clean["settings"] = {
            **clean["settings"],
            **settings,
            "categories": settings.get("categories") or clean["settings"]["categories"],
            "cardIssuers": settings.get("cardIssuers") or clean["settings"]["cardIssuers"],
            "users": settings.get("users") if "users" in settings else clean["settings"]["users"],
        }
    row = _load_row(db, LEDGER_STORE_KEY)
    now = datetime.utcnow()
    encoded = json.dumps(clean, ensure_ascii=False)
    if row:
        row.data_json = encoded
        row.updated_at = now
    else:
        db.add(FinanceJsonStore(store_key=LEDGER_STORE_KEY, data_json=encoded, updated_at=now))
    db.commit()
    return clean


def reset_finance_state(db: Session) -> dict[str, Any]:
    return save_finance_state(db, DEFAULT_FINANCE_STATE)


def reset_ledger_state(db: Session) -> dict[str, Any]:
    return save_ledger_state(db, DEFAULT_LEDGER_STATE)


def get_stock_snapshot(db: Session) -> dict[str, Any]:
    """StockMind 포트폴리오 요약 — 재정허브 대시보드 연동용"""
    stocks = db.query(Stock).filter(Stock.is_active == True).all()  # noqa: E712
    total_value = sum(s.current_value for s in stocks)
    total_purchase = sum(s.purchase_amount for s in stocks)
    total_profit = total_value - total_purchase
    total_profit_rate = (total_profit / total_purchase * 100) if total_purchase > 0 else 0
    return {
        "total_value": round(total_value, 0),
        "total_purchase": round(total_purchase, 0),
        "total_profit": round(total_profit, 0),
        "total_profit_rate": round(total_profit_rate, 2),
        "stock_count": len(stocks),
        "updated_at": datetime.utcnow().isoformat() + "Z",
    }


BACKUP_VERSION = 1
BACKUP_APP = "stockmind-financehub"
LEGACY_BACKUP_APPS = {"financehub", "stockmind-financehub"}


def _normalize_cash_assets(cash_assets: list[Any]) -> list[Any]:
    normalized: list[Any] = []
    for asset in cash_assets:
        if not isinstance(asset, dict):
            continue
        row = dict(asset)
        if not row.get("accountType"):
            label = f"{row.get('name', '')}{row.get('institution', '')}"
            row["accountType"] = "securities" if "증권" in label else "bank"
        normalized.append(row)
    return normalized


def _normalize_finance_import(data: dict[str, Any]) -> dict[str, Any]:
    clean = deepcopy(DEFAULT_FINANCE_STATE)
    for key in clean:
        if key in data and isinstance(data[key], list):
            clean[key] = data[key]
    clean["cashAssets"] = _normalize_cash_assets(clean["cashAssets"])
    return clean


def _normalize_ledger_import(data: dict[str, Any]) -> dict[str, Any]:
    clean = deepcopy(DEFAULT_LEDGER_STATE)
    if isinstance(data.get("transactions"), list):
        clean["transactions"] = data["transactions"]
    if isinstance(data.get("budgets"), list):
        clean["budgets"] = data["budgets"]
    if isinstance(data.get("settings"), dict):
        settings = data["settings"]
        clean["settings"] = {
            **DEFAULT_LEDGER_SETTINGS,
            **settings,
            "categories": settings.get("categories") or DEFAULT_LEDGER_SETTINGS["categories"],
            "cardIssuers": settings.get("cardIssuers") or DEFAULT_LEDGER_SETTINGS["cardIssuers"],
            "users": settings.get("users") if "users" in settings else DEFAULT_LEDGER_SETTINGS["users"],
        }
    return clean


def export_backup(db: Session) -> dict[str, Any]:
    """FinanceHub 호환 JSON 백업 생성"""
    return {
        "version": BACKUP_VERSION,
        "app": BACKUP_APP,
        "exportedAt": datetime.utcnow().isoformat() + "Z",
        "ledger": get_ledger_state(db),
        "finance": get_finance_state(db),
    }


def backup_summary(finance: dict[str, Any], ledger: dict[str, Any]) -> dict[str, int]:
    return {
        "transactions": len(ledger.get("transactions") or []),
        "budgets": len(ledger.get("budgets") or []),
        "categories": len((ledger.get("settings") or {}).get("categories") or []),
        "cashAssets": len(finance.get("cashAssets") or []),
        "illiquidAssets": len(finance.get("illiquidAssets") or []),
        "realEstateAssets": len(finance.get("realEstateAssets") or []),
        "liabilities": len(finance.get("liabilities") or []),
        "fixedExpenses": len(finance.get("fixedExpenses") or []),
        "incomes": len(finance.get("incomes") or []),
        "fundingNeeds": len(finance.get("fundingNeeds") or []),
    }


def restore_backup(db: Session, payload: dict[str, Any]) -> dict[str, Any]:
    """FinanceHub JSON 백업 복구 (financehub / stockmind-financehub 형식)"""
    if not isinstance(payload, dict):
        raise ValueError("백업 파일 형식이 올바르지 않습니다.")

    finance_raw = payload.get("finance")
    ledger_raw = payload.get("ledger")

    # 구형: finance/ledger 키 없이 최상위에 state만 있는 경우
    if finance_raw is None and any(k in payload for k in DEFAULT_FINANCE_STATE):
        finance_raw = {k: payload.get(k) for k in DEFAULT_FINANCE_STATE}
    if ledger_raw is None and any(k in payload for k in ("transactions", "budgets", "settings")):
        ledger_raw = {
            "transactions": payload.get("transactions"),
            "budgets": payload.get("budgets"),
            "settings": payload.get("settings"),
        }

    if not isinstance(finance_raw, dict) and not isinstance(ledger_raw, dict):
        raise ValueError("finance 또는 ledger 데이터가 필요합니다.")

    app_name = payload.get("app")
    if app_name and app_name not in LEGACY_BACKUP_APPS:
        logger.warning("알 수 없는 백업 app=%s — 복구를 계속합니다.", app_name)

    finance_state = get_finance_state(db)
    ledger_state = get_ledger_state(db)

    if isinstance(finance_raw, dict):
        finance_state = save_finance_state(db, _normalize_finance_import(finance_raw))
    if isinstance(ledger_raw, dict):
        ledger_state = save_ledger_state(db, _normalize_ledger_import(ledger_raw))

    return {
        "ok": True,
        "restoredAt": datetime.utcnow().isoformat() + "Z",
        "sourceExportedAt": payload.get("exportedAt"),
        "summary": backup_summary(finance_state, ledger_state),
        "finance": finance_state,
        "ledger": ledger_state,
    }
