"""
core/ledger_mobile.py
모바일 가계부 빠른입력 — 인증 시스템이 없는 앱이라, 최소한의 접근 보호로
고정 PIN 하나만 확인한다 (핸드폰이 사설망을 통해 백엔드에 직접 닿을 때 사용).
받은상자(inbox)에 쓰는 API만 이 PIN을 요구하고, 그 외 조회·PC 쪽 처리는
앱의 나머지 부분과 동일하게 별도 인증 없이 열어둔다.
"""
from __future__ import annotations

import secrets

from fastapi import HTTPException

from config.settings import get_settings


def verify_ledger_mobile_pin(pin: str) -> None:
    expected = (get_settings().ledger_mobile_pin or "").strip()
    if not expected:
        raise HTTPException(
            status_code=503,
            detail="LEDGER_MOBILE_PIN이 서버 .env에 설정되지 않았습니다. backend/.env에 값을 넣고 서버를 재시작하세요.",
        )
    provided = (pin or "").strip()
    if len(provided) != len(expected) or not secrets.compare_digest(
        provided.encode("utf-8"), expected.encode("utf-8")
    ):
        raise HTTPException(status_code=403, detail="PIN 번호가 올바르지 않습니다.")
