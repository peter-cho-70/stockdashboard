"""Vercel Serverless — ASGI app export"""
import os
import sys
from pathlib import Path

_backend_dir = Path(__file__).resolve().parent
if str(_backend_dir) not in sys.path:
    sys.path.insert(0, str(_backend_dir))

os.environ.setdefault("SERVERLESS", "1")
if os.environ.get("VERCEL") and not os.environ.get("DB_PATH", "").strip():
    os.environ["DB_PATH"] = "/tmp/stockmind.db"

from config.database import init_db, SessionLocal
from core.demo_mode import ensure_demo_anchor_stocks, is_demo_mode

init_db()
if is_demo_mode():
    _db = SessionLocal()
    try:
        ensure_demo_anchor_stocks(_db)
    finally:
        _db.close()

from main import app  # noqa: F401
