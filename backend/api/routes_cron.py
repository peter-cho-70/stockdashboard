"""
Vercel Cron / 외부 스케줄러용 엔드포인트 (SERVERLESS에서 APScheduler 대체)
Authorization: Bearer {CRON_SECRET} 헤더 필요 (CRON_SECRET 미설정 시 로컬만 허용)
"""
import logging
import os

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy.orm import Session

from config.database import get_db
from config.settings import get_settings

logger = logging.getLogger(__name__)
cron_router = APIRouter(prefix="/internal/cron", tags=["cron"])


def _verify_cron(authorization: str | None = Header(None)) -> None:
    secret = (get_settings().cron_secret or "").strip()
    serverless = os.environ.get("VERCEL") == "1" or os.environ.get("SERVERLESS") == "1"
    if not secret:
        if serverless:
            raise HTTPException(status_code=503, detail="CRON_SECRET 미설정")
        return
    expected = f"Bearer {secret}"
    if authorization != expected:
        raise HTTPException(status_code=401, detail="Cron 인증 실패")


@cron_router.get("/us-morning-report")
@cron_router.post("/us-morning-report")
def cron_us_morning_report(
    db: Session = Depends(get_db),
    _: None = Depends(_verify_cron),
):
    from core.us_market_report import generate_us_morning_report

    try:
        report = generate_us_morning_report(db)
        logger.info("Cron: US morning report %s status=%s", report.get("report_date"), report.get("status"))
        return {"ok": True, "report_date": report.get("report_date"), "status": report.get("status")}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@cron_router.get("/domestic-market-close")
@cron_router.post("/domestic-market-close")
def cron_domestic_market_close(
    db: Session = Depends(get_db),
    _: None = Depends(_verify_cron),
):
    from config.settings import get_settings as gs
    from core.price_updater import save_daily_snapshot, update_prices_from_krx

    settings = gs()
    result = update_prices_from_krx(db, alert_threshold=settings.alert_threshold)
    if settings.kis_is_configured():
        try:
            from core.kis_client import create_kis_client_from_settings
            from core.portfolio import PortfolioManager

            kis = create_kis_client_from_settings()
            PortfolioManager(db, kis).sync_all(alert_threshold=settings.alert_threshold)
        except Exception as e:
            logger.warning("Cron KIS sync failed: %s", e)
    save_daily_snapshot(db)
    return {"ok": True, "updated": result.get("updated"), "alerts": len(result.get("alerts") or [])}
