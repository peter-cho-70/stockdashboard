"""
core/broker_deposit_sync.py
KIS/키움증권 예수금(CMA 포함) → finance cashAssets 자동 동기화
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime
from typing import Any

from sqlalchemy.orm import Session

from core.finance_service import get_finance_state, save_finance_state

logger = logging.getLogger(__name__)


def _get_kis_deposits() -> list[dict[str, Any]]:
    """KIS 계좌별 예수금 조회"""
    from config.settings import get_settings
    settings = get_settings()
    accounts = settings.get_kis_accounts()
    if not accounts:
        return []

    from core.kis_client import KISClient
    results: list[dict[str, Any]] = []
    for cfg in accounts:
        try:
            client = KISClient(
                app_key=cfg.app_key,
                app_secret=cfg.app_secret,
                account_no=cfg.account_no,
                is_mock=cfg.is_mock or False,
                hts_id=settings.kis_hts_id or None,
            )
            if not client.connect():
                continue
            amount = client.get_deposit_krw()
            if amount is not None:
                results.append({
                    "account_no": cfg.account_no,
                    "broker": "kis",
                    "name": f"한투 예수금 ({cfg.account_no[-4:]})",
                    "institution": "한국투자증권",
                    "amount": amount,
                })
        except Exception as e:
            logger.warning("KIS 예수금 조회 실패 (%s): %s", cfg.account_no, e)
    return results


def _get_kiwoom_deposits() -> list[dict[str, Any]]:
    """키움증권 계좌별 예수금 조회"""
    from config.settings import get_settings
    settings = get_settings()
    accounts = settings.get_kiwoom_accounts()
    if not accounts:
        return []

    from core.kiwoom_client import KiwoomClient
    results: list[dict[str, Any]] = []
    for cfg in accounts:
        try:
            client = KiwoomClient(
                app_key=cfg.app_key,
                app_secret=cfg.app_secret,
                account_no=cfg.account_no,
                is_mock=cfg.is_mock or False,
            )
            if not client.connect():
                continue
            amount = client.get_deposit_krw()
            if amount is not None:
                results.append({
                    "account_no": cfg.account_no,
                    "broker": "kiwoom",
                    "name": f"키움 예수금 ({cfg.account_no[-4:]})",
                    "institution": "키움증권",
                    "amount": amount,
                })
        except Exception as e:
            logger.warning("키움 예수금 조회 실패 (%s): %s", cfg.account_no, e)
    return results


def get_all_broker_deposits() -> list[dict[str, Any]]:
    """KIS + 키움 예수금 통합 조회"""
    kis = _get_kis_deposits()
    kiwoom = _get_kiwoom_deposits()
    return kis + kiwoom


def sync_broker_deposits_to_finance(db: Session) -> dict[str, Any]:
    """
    브로커 예수금을 조회해 finance cashAssets에 반영.
    syncSource 가 'kis_deposit' 또는 'kiwoom_deposit' 인 항목은 업데이트, 없으면 추가.
    """
    deposits = get_all_broker_deposits()
    if not deposits:
        return {"updated": 0, "added": 0, "deposits": []}

    state = get_finance_state(db)
    cash_assets: list[dict] = list(state.get("cashAssets") or [])
    now = datetime.utcnow().isoformat()
    updated = 0
    added = 0

    for dep in deposits:
        account_no = dep["account_no"]
        sync_source = f"{dep['broker']}_deposit"

        # 기존 항목 탐색: syncSource + syncMeta.accountNo
        existing = None
        for asset in cash_assets:
            meta = asset.get("syncMeta") or {}
            if asset.get("syncSource") == sync_source and meta.get("accountNo") == account_no:
                existing = asset
                break

        if existing:
            existing["amount"] = dep["amount"]
            existing["updatedAt"] = now
            updated += 1
        else:
            cash_assets.append({
                "id": str(uuid.uuid4()),
                "name": dep["name"],
                "institution": dep["institution"],
                "accountType": "securities",
                "amount": dep["amount"],
                "updatedAt": now,
                "syncSource": sync_source,
                "syncMeta": {"accountNo": account_no},
            })
            added += 1

    state["cashAssets"] = cash_assets
    save_finance_state(db, state)
    logger.info("✅ 브로커 예수금 동기화 완료: 업데이트=%s 추가=%s", updated, added)
    return {"updated": updated, "added": added, "deposits": deposits}
