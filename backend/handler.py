"""Vercel Serverless — ASGI app export"""
import os

os.environ.setdefault("SERVERLESS", "1")

from config.database import init_db

init_db()

from main import app  # noqa: F401
