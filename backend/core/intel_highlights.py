"""
사용자 직접 강조 — IntelContent.user_highlights JSON 스키마
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy.orm import Session

from config.database import IntelContent

ALLOWED_COLORS = frozenset({"amber", "green", "sky", "violet", "rose"})

EMPTY_HIGHLIGHTS: dict[str, Any] = {
    "pinned_key_point_indexes": [],
    "pin_colors": {},
    "user_key_points": [],
    "snippets": [],
}


def _norm_color(value: Any, default: str = "amber") -> str:
    c = (str(value or default)).lower().strip()
    return c if c in ALLOWED_COLORS else default


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def parse_user_highlights(raw: Optional[str]) -> dict[str, Any]:
    if not raw:
        return dict(EMPTY_HIGHLIGHTS)
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return dict(EMPTY_HIGHLIGHTS)
    if not isinstance(data, dict):
        return dict(EMPTY_HIGHLIGHTS)
    out = dict(EMPTY_HIGHLIGHTS)
    out["pin_colors"] = {}
    pins = data.get("pinned_key_point_indexes")
    if isinstance(pins, list):
        out["pinned_key_point_indexes"] = sorted(
            {int(i) for i in pins if isinstance(i, (int, float)) and int(i) >= 0}
        )
    pin_colors = data.get("pin_colors")
    if isinstance(pin_colors, dict):
        for k, v in pin_colors.items():
            try:
                idx = int(k)
            except (TypeError, ValueError):
                continue
            if idx >= 0:
                out["pin_colors"][str(idx)] = _norm_color(v)
    ukp = data.get("user_key_points")
    if isinstance(ukp, list):
        out["user_key_points"] = [str(x).strip() for x in ukp if str(x).strip()]
    snippets = data.get("snippets")
    if isinstance(snippets, list):
        clean = []
        for s in snippets:
            if not isinstance(s, dict):
                continue
            text = (s.get("text") or "").strip()
            if not text:
                continue
            clean.append({
                "id": s.get("id") or str(uuid.uuid4())[:12],
                "field": (s.get("field") or "summary")[:40],
                "text": text[:2000],
                "note": (s.get("note") or "")[:500],
                "color": _norm_color(s.get("color")),
                "created_at": s.get("created_at") or _now_iso(),
            })
        out["snippets"] = clean
    return out


def save_user_highlights(db: Session, content_id: int, payload: dict[str, Any]) -> dict[str, Any]:
    c = db.query(IntelContent).filter(IntelContent.id == content_id).first()
    if not c:
        raise ValueError("콘텐츠 없음")
    normalized = parse_user_highlights(json.dumps(payload, ensure_ascii=False))
    c.user_highlights = json.dumps(normalized, ensure_ascii=False)
    db.commit()
    db.refresh(c)
    return normalized


def normalize_key_point_item(item: Any) -> dict[str, Any]:
    """문자열 또는 {text, importance} → 통일."""
    if isinstance(item, str):
        text = item.strip()
        importance = "high" if text.startswith("[중요]") or text.startswith("★") else "normal"
        if text.startswith("[중요]"):
            text = text[4:].strip()
        elif text.startswith("★"):
            text = text.lstrip("★").strip()
        return {"text": text, "importance": importance, "by": "ai"}
    if isinstance(item, dict):
        text = (item.get("text") or "").strip()
        imp = (item.get("importance") or "normal").lower()
        if imp not in ("high", "normal", "low"):
            imp = "normal"
        by = item.get("by") or "ai"
        return {"text": text, "importance": imp, "by": by}
    return {"text": str(item), "importance": "normal", "by": "ai"}


def normalize_key_points_list(raw: Any) -> list[dict[str, Any]]:
    if not raw:
        return []
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except json.JSONDecodeError:
            return []
    if not isinstance(raw, list):
        return []
    return [normalize_key_point_item(x) for x in raw if normalize_key_point_item(x).get("text")]
