"""
core/ledger_inbox_store.py
가계부 모바일 받은상자 — SQLite DB(FinanceJsonStore)를 거치지 않고
LEDGER_INBOX_FILE 경로의 JSON 파일에 직접 읽고 쓴다.

DB와 분리해둔 이유: 배포 환경(Render/Vercel 서버리스)에서는 DB_PATH가
/tmp 아래를 가리켜 재시작 때마다 사라질 수 있는데, 모바일에서 밖에서
입력한 내역까지 그렇게 날아가면 곤란하다. 이 파일은 독립된 저장소라
DB_PATH 설정과 무관하게 원하는 위치(예: 구글 드라이브 동기화 폴더)를
LEDGER_INBOX_FILE로 지정해 영속시킬 수 있다.
"""
from __future__ import annotations

import json
import logging
import threading
from datetime import datetime
from pathlib import Path
from typing import Any

from config.settings import get_settings

logger = logging.getLogger(__name__)

_lock = threading.Lock()


def _file_path() -> Path:
    raw = (get_settings().ledger_inbox_file or "./data/ledger_inbox.json").strip()
    return Path(raw).expanduser()


def _read_all() -> list[dict[str, Any]]:
    path = _file_path()
    if not path.exists():
        return []
    try:
        with path.open("r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, list) else []
    except (json.JSONDecodeError, OSError):
        logger.warning("가계부 받은상자 파일 파싱 실패 (%s) — 빈 목록으로 처리", path)
        return []


def _write_all(items: list[dict[str, Any]]) -> None:
    path = _file_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_suffix(path.suffix + ".tmp")
    with tmp_path.open("w", encoding="utf-8") as f:
        json.dump(items, f, ensure_ascii=False, indent=2)
    tmp_path.replace(path)  # 원자적 교체 — 쓰는 도중 프로세스가 죽어도 원본 파일은 안전


def list_ledger_inbox() -> list[dict[str, Any]]:
    with _lock:
        return _read_all()


def add_ledger_inbox_item(item: dict[str, Any]) -> dict[str, Any]:
    with _lock:
        items = _read_all()
        new_item = {
            **item,
            "id": f"inbox{int(datetime.utcnow().timestamp() * 1000)}",
            "receivedAt": datetime.utcnow().isoformat() + "Z",
        }
        items.insert(0, new_item)
        _write_all(items)
        return new_item


def delete_ledger_inbox_item(item_id: str) -> bool:
    with _lock:
        items = _read_all()
        remaining = [i for i in items if i.get("id") != item_id]
        if len(remaining) == len(items):
            return False
        _write_all(remaining)
        return True
