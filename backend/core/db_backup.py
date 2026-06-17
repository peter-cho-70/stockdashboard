"""
SQLite DB 백업·복원 — 미국 증시 리포트·분석·포트폴리오 등 개발 데이터 보존
"""
from __future__ import annotations

import logging
import os
import re
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from config.settings import get_settings

logger = logging.getLogger(__name__)

_BACKUP_NAME_RE = re.compile(r"^stockmind_\d{8}_\d{6}_[\w-]+\.db$")
_DEFAULT_MAX_BACKUPS = 3


def resolve_db_path() -> Path:
    return Path(get_settings().db_path).expanduser().resolve()


def backup_dir() -> Path:
    custom = os.environ.get("DB_BACKUP_DIR")
    if custom:
        root = Path(custom).expanduser().resolve()
    else:
        root = Path(__file__).resolve().parent.parent / "data" / "backups"
    root.mkdir(parents=True, exist_ok=True)
    return root


def _safe_filename(name: str) -> Path:
    if not _BACKUP_NAME_RE.match(name):
        raise ValueError("유효하지 않은 백업 파일명입니다.")
    path = (backup_dir() / name).resolve()
    if backup_dir().resolve() not in path.parents:
        raise ValueError("백업 경로가 허용된 디렉터리 밖입니다.")
    return path


def _sqlite_backup(source: Path, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    src_conn = sqlite3.connect(f"file:{source}?mode=ro", uri=True)
    dest_conn = sqlite3.connect(str(dest))
    try:
        src_conn.backup(dest_conn)
        dest_conn.commit()
    finally:
        src_conn.close()
        dest_conn.close()


def create_backup(label: str = "manual") -> dict[str, Any]:
    """현재 DB를 backend/data/backups 에 스냅샷 저장."""
    src = resolve_db_path()
    if not src.is_file():
        raise FileNotFoundError(f"DB 파일이 없습니다: {src}")

    safe_label = re.sub(r"[^\w-]", "", label)[:32] or "manual"
    ts = datetime.now(timezone.utc).astimezone().strftime("%Y%m%d_%H%M%S")
    filename = f"stockmind_{ts}_{safe_label}.db"
    dest = backup_dir() / filename

    _sqlite_backup(src, dest)
    stat = dest.stat()
    meta = _db_summary(dest)
    logger.info("DB 백업 생성: %s (%s bytes)", filename, stat.st_size)
    return {
        "filename": filename,
        "label": safe_label,
        "created_at": datetime.fromtimestamp(stat.st_mtime).isoformat(),
        "size_bytes": stat.st_size,
        "db_path": str(src),
        "summary": meta,
    }


def list_backups() -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for path in sorted(backup_dir().glob("stockmind_*.db"), key=lambda p: p.stat().st_mtime, reverse=True):
        if not path.is_file():
            continue
        stat = path.stat()
        parts = path.stem.split("_")
        label = parts[-1] if len(parts) >= 4 else "unknown"
        items.append({
            "filename": path.name,
            "label": label,
            "created_at": datetime.fromtimestamp(stat.st_mtime).isoformat(),
            "size_bytes": stat.st_size,
        })
    return items


def delete_backup(filename: str) -> None:
    path = _safe_filename(filename)
    if not path.is_file():
        raise FileNotFoundError("백업 파일을 찾을 수 없습니다.")
    path.unlink()
    logger.info("DB 백업 삭제: %s", filename)


def prune_old_backups(max_count: Optional[int] = None) -> int:
    max_count = max_count or int(os.environ.get("DB_BACKUP_MAX_COUNT", str(_DEFAULT_MAX_BACKUPS)))
    files = sorted(backup_dir().glob("stockmind_*.db"), key=lambda p: p.stat().st_mtime, reverse=True)
    removed = 0
    for path in files[max_count:]:
        path.unlink(missing_ok=True)
        removed += 1
    if removed:
        logger.info("오래된 DB 백업 %s개 정리", removed)
    return removed


def _db_summary(db_path: Path) -> dict[str, Any]:
    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    try:
        cur = conn.cursor()
        tables = {
            row[0]
            for row in cur.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
            ).fetchall()
        }
        counts: dict[str, int] = {}
        for name in (
            "us_market_reports",
            "stocks",
            "intel_contents",
            "trade_monthly_reports",
            "watchlist",
        ):
            if name in tables:
                counts[name] = cur.execute(f"SELECT COUNT(*) FROM {name}").fetchone()[0]
        return {"tables": sorted(tables), "counts": counts}
    finally:
        conn.close()


def get_db_info() -> dict[str, Any]:
    src = resolve_db_path()
    info: dict[str, Any] = {
        "db_path": str(src),
        "exists": src.is_file(),
        "backup_dir": str(backup_dir()),
        "backup_count": len(list(backup_dir().glob("stockmind_*.db"))),
    }
    if src.is_file():
        stat = src.stat()
        info["size_bytes"] = stat.st_size
        info["modified_at"] = datetime.fromtimestamp(stat.st_mtime).isoformat()
        info["summary"] = _db_summary(src)
    return info


def restore_backup(filename: str) -> dict[str, Any]:
    """백업 파일로 DB 복원. 복원 전 현재 DB는 pre_restore 로 자동 백업."""
    backup_path = _safe_filename(filename)
    if not backup_path.is_file():
        raise FileNotFoundError("백업 파일을 찾을 수 없습니다.")

    db_path = resolve_db_path()
    pre = None
    if db_path.is_file():
        pre = create_backup(label="pre_restore")

    from config.database import engine

    engine.dispose()

    tmp = db_path.with_suffix(".db.restoring")
    try:
        _sqlite_backup(backup_path, tmp)
        tmp.replace(db_path)
    except Exception:
        tmp.unlink(missing_ok=True)
        raise

    logger.info("DB 복원 완료: %s → %s", filename, db_path)
    return {
        "ok": True,
        "restored_from": filename,
        "db_path": str(db_path),
        "pre_restore_backup": pre["filename"] if pre else None,
        "message": "복원이 완료되었습니다. 변경 사항을 안정적으로 반영하려면 백엔드를 재시작하세요.",
        "summary": _db_summary(db_path),
    }


def maybe_auto_backup_on_startup() -> Optional[dict[str, Any]]:
    """서버 시작 시 DB가 있으면 자동 백업 (최근 startup 백업이 4시간 이내면 생략)."""
    if os.environ.get("AUTO_DB_BACKUP_ON_START", "true").strip().lower() not in ("true", "1", "yes"):
        return None
    src = resolve_db_path()
    if not src.is_file() or src.stat().st_size == 0:
        return None

    recent = list_backups()
    if recent:
        latest = recent[0]
        if latest.get("label") == "startup":
            try:
                created = datetime.fromisoformat(latest["created_at"])
                age_h = (datetime.now() - created).total_seconds() / 3600
                if age_h < 4:
                    logger.info("최근 startup 백업이 있어 자동 백업을 건너뜁니다.")
                    return None
            except ValueError:
                pass

    try:
        meta = create_backup(label="startup")
        prune_old_backups()
        return meta
    except Exception as e:
        logger.warning("자동 DB 백업 실패: %s", e)
        return None
