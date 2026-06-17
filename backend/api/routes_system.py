"""
시스템 — DB 백업·복원
"""
import os
import threading
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from core.db_backup import (
    create_backup,
    delete_backup,
    get_db_info,
    list_backups,
    prune_old_backups,
    restore_backup,
)

system_router = APIRouter(prefix="/system", tags=["system"])


class RestoreBody(BaseModel):
    filename: str = Field(..., min_length=1, max_length=200)


class BackupCreateBody(BaseModel):
    label: Optional[str] = Field("manual", max_length=32)

class DevRestartBody(BaseModel):
    label: Optional[str] = Field("pre_restart", max_length=32)


@system_router.get("/db")
def api_db_info():
    return get_db_info()


@system_router.get("/db/backups")
def api_list_backups():
    return {"backups": list_backups(), "db": get_db_info()}


@system_router.post("/db/backups")
def api_create_backup(body: BackupCreateBody | None = None):
    label = (body.label if body else None) or "manual"
    try:
        meta = create_backup(label=label)
        prune_old_backups()
        return {"backup": meta, "backups": list_backups()}
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"백업 실패: {e}") from e


@system_router.post("/db/restore")
def api_restore_backup(body: RestoreBody):
    try:
        return restore_backup(body.filename)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"복원 실패: {e}") from e


@system_router.delete("/db/backups/{filename}")
def api_delete_backup(filename: str):
    try:
        delete_backup(filename)
        return {"ok": True, "backups": list_backups()}
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@system_router.post("/dev/restart")
def api_dev_restart(request: Request, body: DevRestartBody | None = None):
    """
    개발용: DB 백업 후 백엔드 프로세스 재시작 요청.

    - 서버는 "종료"만 수행 (SIGTERM)
    - start-dev.sh 같은 외부 러너가 자동 재기동해야 함
    """
    enabled = os.environ.get("DEV_RESTART", "").strip().lower() in ("true", "1", "yes")
    if not enabled:
        raise HTTPException(status_code=403, detail="DEV_RESTART가 비활성화되어 있습니다.")

    host = getattr(getattr(request, "client", None), "host", None)
    if host not in ("127.0.0.1", "::1", "localhost"):
        raise HTTPException(status_code=403, detail="로컬 요청만 허용됩니다.")

    label = ((body.label if body else None) or "pre_restart").strip()[:32] or "pre_restart"
    try:
        meta = create_backup(label=label)
        prune_old_backups()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"백업 실패: {e}") from e

    # 응답을 보낸 뒤, 약간 지연 후 프로세스 종료 (exit 0)
    # start-dev.sh가 exit code 0을 보고 백엔드를 다시 띄운다.
    threading.Timer(0.3, lambda: os._exit(0)).start()
    return {"ok": True, "message": "백업 후 재시작을 요청했습니다.", "backup": meta}
