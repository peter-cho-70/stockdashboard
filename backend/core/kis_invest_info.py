"""
한국투자증권 HTS 투자정보 — 종목 투자의견·증권사별 의견·투자자별 매매동향
"""
from __future__ import annotations

import json
import logging
import re
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Optional

from sqlalchemy.orm import Session

from config.database import Stock, StockPriceTarget
from config.settings import get_settings
from core.kis_client import create_kis_client_from_settings
from core.price_targets import list_price_targets

logger = logging.getLogger(__name__)

_CACHE_DIR = Path(__file__).resolve().parent.parent / "data" / "kis_invest_cache"
_CACHE_TTL_MINUTES = 30
_FETCH_DELAY_SEC = 0.8
_MAX_RETRIES = 3

OPINION_RATING_MAP = {
    "BUY": "매수",
    "STRONG BUY": "강력매수",
    "HOLD": "중립",
    "NEUTRAL": "중립",
    "SELL": "매도",
    "STRONG SELL": "강력매도",
    "매수": "매수",
    "중립": "중립",
    "매도": "매도",
}


def _row_dict(row: Any) -> dict[str, Any]:
    data = getattr(row, "__data__", None)
    if isinstance(data, dict):
        return data
    if isinstance(row, dict):
        return row
    return {}


def _safe_float(value: Any) -> float | None:
    if value is None:
        return None
    text = str(value).strip().replace(",", "")
    if not text:
        return None
    try:
        return float(text)
    except (TypeError, ValueError):
        return None


def _safe_int(value: Any) -> int | None:
    num = _safe_float(value)
    if num is None:
        return None
    return int(num)


def _format_yyyymmdd(value: str | None) -> str | None:
    raw = (value or "").strip()
    if len(raw) == 8 and raw.isdigit():
        return f"{raw[:4]}-{raw[4:6]}-{raw[6:8]}"
    return raw or None


def _map_rating(raw: str | None) -> str | None:
    text = (raw or "").strip()
    if not text:
        return None
    upper = text.upper()
    return OPINION_RATING_MAP.get(upper) or OPINION_RATING_MAP.get(text) or text


def _is_kr_symbol(symbol: str) -> bool:
    return bool(re.fullmatch(r"\d{6}", symbol.strip()))


def _is_rate_limit_error(exc: Exception) -> bool:
    text = str(exc).upper()
    return any(
        token in text
        for token in ("EGW00215", "호출 횟수", "RATE", "LIMIT", "초과")
    )


def _cache_path(symbol: str) -> Path:
    _CACHE_DIR.mkdir(parents=True, exist_ok=True)
    return _CACHE_DIR / f"{symbol.strip()}.json"


def _load_cache(symbol: str) -> dict[str, Any] | None:
    path = _cache_path(symbol)
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        fetched = datetime.fromisoformat(data.get("fetched_at", ""))
        if datetime.utcnow() - fetched > timedelta(minutes=_CACHE_TTL_MINUTES):
            return None
        return data
    except Exception:
        return None


def _save_cache(symbol: str, payload: dict[str, Any]) -> None:
    try:
        _cache_path(symbol).write_text(
            json.dumps(payload, ensure_ascii=False, indent=0),
            encoding="utf-8",
        )
    except Exception as e:
        logger.warning("KIS invest cache save failed %s: %s", symbol, e)


def _kis_fetch(path: str, tr_id: str, params: dict[str, str], kis: Any) -> list[dict[str, Any]]:
    last_error: Exception | None = None
    for attempt in range(1, _MAX_RETRIES + 1):
        time.sleep(_FETCH_DELAY_SEC * attempt)
        try:
            resp = kis.fetch(path, api=tr_id, params={k.lower(): v for k, v in params.items()})
            rt_cd = getattr(resp, "rt_cd", None)
            if rt_cd not in (None, "0", 0):
                msg = getattr(resp, "msg1", "") or getattr(resp, "msg_cd", "")
                if "EGW00215" in str(msg) or "초과" in str(msg):
                    raise RuntimeError(str(msg))
                raise RuntimeError(f"KIS API 오류 ({tr_id}): {msg}".strip())

            rows = getattr(resp, "output", None) or getattr(resp, "output1", None) or []
            if not isinstance(rows, list):
                return []
            return [_row_dict(row) for row in rows]
        except Exception as e:
            last_error = e
            if _is_rate_limit_error(e) and attempt < _MAX_RETRIES:
                wait = _FETCH_DELAY_SEC * (attempt + 2)
                logger.warning("KIS rate limit (%s) — %ss 후 재시도 %s/%s", tr_id, wait, attempt, _MAX_RETRIES)
                time.sleep(wait)
                continue
            raise
    if last_error:
        raise last_error
    return []


def fetch_invest_opinions(symbol: str, *, days: int = 180, kis: Any | None = None) -> list[dict[str, Any]]:
    """종목 투자의견 (FHKST663300C0)."""
    end = datetime.now().strftime("%Y%m%d")
    start = (datetime.now() - timedelta(days=days)).strftime("%Y%m%d")
    client = kis or create_kis_client_from_settings()._kis
    rows = _kis_fetch(
        "/uapi/domestic-stock/v1/quotations/invest-opinion",
        "FHKST663300C0",
        {
            "FID_COND_MRKT_DIV_CODE": "J",
            "FID_COND_SCR_DIV_CODE": "16633",
            "FID_INPUT_ISCD": symbol,
            "FID_INPUT_DATE_1": start,
            "FID_INPUT_DATE_2": end,
        },
        client,
    )
    return [_normalize_opinion_row(row) for row in rows]


def fetch_invest_opinions_by_broker(symbol: str, *, days: int = 180, kis: Any | None = None) -> list[dict[str, Any]]:
    """증권사별 투자의견 (FHKST663400C0)."""
    end = datetime.now().strftime("%Y%m%d")
    start = (datetime.now() - timedelta(days=days)).strftime("%Y%m%d")
    client = kis or create_kis_client_from_settings()._kis
    rows = _kis_fetch(
        "/uapi/domestic-stock/v1/quotations/invest-opbysec",
        "FHKST663400C0",
        {
            "FID_COND_MRKT_DIV_CODE": "J",
            "FID_COND_SCR_DIV_CODE": "16634",
            "FID_DIV_CLS_CODE": "0",
            "FID_INPUT_ISCD": symbol,
            "FID_INPUT_DATE_1": start,
            "FID_INPUT_DATE_2": end,
        },
        client,
    )
    return [_normalize_opbysec_row(row) for row in rows]


def fetch_investor_trend(symbol: str, *, days: int = 30, kis: Any | None = None) -> list[dict[str, Any]]:
    """종목별 투자자 매매동향 (FHKST01010900)."""
    end = datetime.now().strftime("%Y%m%d")
    start = (datetime.now() - timedelta(days=days)).strftime("%Y%m%d")
    client = kis or create_kis_client_from_settings()._kis
    rows = _kis_fetch(
        "/uapi/domestic-stock/v1/quotations/inquire-investor",
        "FHKST01010900",
        {
            "FID_COND_MRKT_DIV_CODE": "J",
            "FID_INPUT_ISCD": symbol,
            "FID_INPUT_DATE_1": start,
            "FID_INPUT_DATE_2": end,
            "FID_PERIOD_DIV_CODE": "D",
        },
        client,
    )
    normalized: list[dict[str, Any]] = []
    for row in rows:
        foreign_qty = _safe_int(row.get("frgn_ntby_qty"))
        institution_qty = _safe_int(row.get("orgn_ntby_qty"))
        personal_qty = _safe_int(row.get("prsn_ntby_qty"))
        if foreign_qty is None and institution_qty is None and personal_qty is None:
            continue
        normalized.append(
            {
                "date": _format_yyyymmdd(row.get("stck_bsop_date")),
                "close": _safe_float(row.get("stck_clpr")),
                "change": _safe_float(row.get("prdy_vrss")),
                "foreign_net_qty": foreign_qty,
                "institution_net_qty": institution_qty,
                "personal_net_qty": personal_qty,
                "foreign_net_amount": _safe_float(row.get("frgn_ntby_tr_pbmn")),
                "institution_net_amount": _safe_float(row.get("orgn_ntby_tr_pbmn")),
            }
        )
    normalized.sort(key=lambda x: x.get("date") or "", reverse=True)
    return normalized


def _normalize_opinion_row(row: dict[str, Any]) -> dict[str, Any]:
    target = _safe_float(row.get("hts_goal_prc"))
    prev_close = _safe_float(row.get("stck_prdy_clpr"))
    upside_pct = _safe_float(row.get("dprt")) or _safe_float(row.get("nday_dprt"))
    return {
        "report_date": _format_yyyymmdd(row.get("stck_bsop_date")),
        "broker": (row.get("mbcr_name") or "").strip() or "미상",
        "rating": _map_rating(row.get("invt_opnn")),
        "prev_rating": _map_rating(row.get("rgbf_invt_opnn")),
        "target_price": target,
        "prev_close": prev_close,
        "upside_pct": upside_pct,
        "source": "kis_hts",
    }


def _normalize_opbysec_row(row: dict[str, Any]) -> dict[str, Any]:
    base = _normalize_opinion_row(row)
    base.update(
        {
            "symbol": (row.get("stck_shrn_iscd") or "").strip(),
            "name": (row.get("hts_kor_isnm") or "").strip(),
            "current_price": _safe_float(row.get("stck_prpr")),
            "change_rate": _safe_float(row.get("prdy_ctrt")),
        }
    )
    return base


def evaluate_supply_checks(trend: list[dict[str, Any]]) -> dict[str, Any]:
    """투자자 매매동향 기반 수급 체크리스트."""
    usable = [row for row in trend if row.get("foreign_net_qty") is not None]
    foreign_3d = False
    institution_accompany = False

    if len(usable) >= 3:
        recent3 = usable[:3]
        foreign_3d = all((row.get("foreign_net_qty") or 0) > 0 for row in recent3)

    if usable:
        latest = usable[0]
        foreign_qty = latest.get("foreign_net_qty") or 0
        institution_qty = latest.get("institution_net_qty") or 0
        institution_accompany = foreign_qty > 0 and institution_qty > 0

    passed = sum([foreign_3d, institution_accompany])
    return {
        "available": bool(usable),
        "passed": passed,
        "total": 3,
        "latest_date": usable[0]["date"] if usable else None,
        "items": [
            {
                "label": "외국인 3일 이상 연속 순매수",
                "passed": foreign_3d,
                "unavailable": not usable,
            },
            {
                "label": "기관 동반 순매수",
                "passed": institution_accompany,
                "unavailable": not usable,
            },
            {
                "label": "공매도 비중 5% 이하",
                "passed": False,
                "unavailable": True,
            },
        ],
    }


def fetch_kis_invest_info(symbol: str, *, use_cache: bool = True, force: bool = False) -> dict[str, Any]:
    """한투 HTS 투자정보 통합 조회."""
    symbol = symbol.strip()
    if not _is_kr_symbol(symbol):
        raise ValueError("국내 6자리 종목코드만 KIS 투자정보를 조회할 수 있습니다.")

    settings = get_settings()
    if not settings.kis_is_configured():
        raise ValueError("KIS API가 설정되지 않았습니다 (.env — KIS_ACCOUNTS)")

    if use_cache and not force:
        cached = _load_cache(symbol)
        if cached:
            cached["cached"] = True
            return cached

    client = create_kis_client_from_settings()
    kis = client._kis
    if not kis:
        raise ValueError("KIS API 연결에 실패했습니다.")

    opinions = fetch_invest_opinions(symbol, kis=kis)
    by_broker = fetch_invest_opinions_by_broker(symbol, kis=kis)
    trend = fetch_investor_trend(symbol, kis=kis)
    supply = evaluate_supply_checks(trend)

    payload = {
        "symbol": symbol,
        "source": "kis_hts",
        "fetched_at": datetime.utcnow().isoformat(),
        "cached": False,
        "opinions": opinions,
        "opinions_by_broker": by_broker,
        "investor_trend": trend,
        "supply_check": supply,
    }
    _save_cache(symbol, payload)
    return payload


def sync_kis_price_targets(db: Session, symbol: str, *, force: bool = False) -> dict[str, Any]:
    """KIS HTS 투자의견을 목표가 DB에 반영."""
    symbol = symbol.strip()
    if not _is_kr_symbol(symbol):
        raise ValueError("국내 6자리 종목코드만 KIS 목표가를 가져올 수 있습니다.")

    info = fetch_kis_invest_info(symbol, force=force)
    stock = db.query(Stock).filter(Stock.symbol == symbol).first()
    stock_id = stock.id if stock else None
    name = stock.name if stock else symbol

    db.query(StockPriceTarget).filter(
        StockPriceTarget.symbol == symbol,
        StockPriceTarget.notes.like("%KIS HTS%"),
    ).delete(synchronize_session=False)

    seen: set[tuple[str, str, int]] = set()
    saved: list[StockPriceTarget] = []

    for item in info["opinions_by_broker"] or info["opinions"]:
        target = item.get("target_price")
        broker = (item.get("broker") or "미상").strip()
        report_date = item.get("report_date")
        if not target or target <= 0 or not broker:
            continue
        key = (broker, report_date or "", int(round(target)))
        if key in seen:
            continue
        seen.add(key)

        upside = item.get("upside_pct")
        note_parts = ["KIS HTS 투자의견"]
        if item.get("prev_rating") and item.get("rating"):
            note_parts.append(f"변경 {item['prev_rating']}→{item['rating']}")
        if upside is not None:
            note_parts.append(f"괴리율 {upside:.1f}%")

        row = StockPriceTarget(
            symbol=symbol,
            stock_id=stock_id,
            source=broker[:100],
            target_price=float(target),
            rating=item.get("rating"),
            report_date=report_date,
            is_consensus=False,
            source_title=f"KIS HTS — {broker} {report_date or ''}".strip(),
            notes=" | ".join(note_parts),
        )
        db.add(row)
        saved.append(row)

    db.commit()
    for row in saved:
        db.refresh(row)

    logger.info("KIS 목표가 저장 %s: %d건", name, len(saved))

    return {
        "symbol": symbol,
        "name": name,
        "fetched_count": len(saved),
        "disclaimer": "한국투자증권 HTS 투자의견 API — 증권사 리포트 원문은 HTS에서 확인하세요.",
        "kis_invest_info": {
            "supply_check": info["supply_check"],
            "investor_trend": info["investor_trend"][:10],
            "opinion_count": len(info["opinions"]),
            "cached": info.get("cached", False),
        },
        "targets": list_price_targets(db, symbol),
    }
