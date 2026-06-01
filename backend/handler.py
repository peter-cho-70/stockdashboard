"""Vercel Serverless — ASGI app export"""
import os

os.environ.setdefault("SERVERLESS", "1")

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
