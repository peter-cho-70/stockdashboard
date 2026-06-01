"""
scheduler/jobs.py
APScheduler 자동 갱신 작업
"""
import logging
from datetime import datetime, timedelta

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from config.database import SessionLocal
from config.settings import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()


async def job_domestic_market_close():
    """[15:35 KST] pykrx 시세 갱신 + (선택) KIS 잔고 동기화"""
    logger.info("⏰ [스케줄] 국내 장 마감 후 동기화 시작 (15:35)")
    db = SessionLocal()
    try:
        from core.price_updater import save_daily_snapshot, update_prices_from_krx

        result = update_prices_from_krx(db, alert_threshold=settings.alert_threshold)
        logger.info("✅ 시세 갱신: %s개 / 알림: %s건", result["updated"], len(result["alerts"]))

        if settings.kis_app_key and settings.kis_account_no:
            try:
                from core.kis_client import create_kis_client_from_settings
                from core.portfolio import PortfolioManager

                kis = create_kis_client_from_settings()
                manager = PortfolioManager(db, kis)
                sync_result = manager.sync_all(alert_threshold=settings.alert_threshold)
                logger.info("✅ KIS 잔고 동기화: %s", sync_result["sync"])
            except Exception as e:
                logger.warning("⚠️ KIS 동기화 실패 (pykrx 결과 유지): %s", e)

        save_daily_snapshot(db)
        logger.info("✅ 국내 장 마감 동기화 완료")
    except Exception as e:
        logger.error("❌ 국내 장 마감 동기화 실패: %s", e)
    finally:
        db.close()


async def job_us_market_close():
    """[07:05 KST] 해외주식 잔고 동기화"""
    logger.info("⏰ [스케줄] 미국 장 마감 후 동기화 시작 (07:05)")
    if not (settings.kis_app_key and settings.kis_account_no):
        logger.info("ℹ️ KIS API 미설정 — 미국 장 마감 동기화 생략")
        return

    db = SessionLocal()
    try:
        from config.database import Stock
        from core.kis_client import create_kis_client_from_settings

        kis = create_kis_client_from_settings()
        overseas = kis.get_overseas_balance()
        updated = 0
        for item in overseas:
            stock = db.query(Stock).filter(Stock.symbol == item.symbol).first()
            if stock:
                prev = stock.current_price
                stock.current_price = item.current_price
                if prev and prev != item.current_price and prev > 0:
                    stock.prev_price = prev
                    stock.change_rate = (item.current_price - prev) / prev * 100
                updated += 1
        db.commit()
        logger.info("✅ 미국 장 마감 동기화 완료: %s개 종목", updated)
    except Exception as e:
        logger.error("❌ 미국 장 마감 동기화 실패: %s", e)
    finally:
        db.close()


async def job_us_morning_report():
    """[08:05 KST] 미국 증시 아침 리포트 생성 (전일 마감 반영)"""
    logger.info("⏰ [스케줄] 미국 증시 아침 리포트 생성 (08:05)")
    db = SessionLocal()
    try:
        from core.us_market_report import generate_us_morning_report

        report = generate_us_morning_report(db)
        logger.info("✅ 미국 아침 리포트: %s status=%s", report.get("report_date"), report.get("status"))
    except Exception as e:
        logger.error("❌ 미국 아침 리포트 생성 실패: %s", e)
    finally:
        db.close()


async def job_pre_domestic_open():
    """[08:50 KST] 전일 Signal 브리핑 로그 + 리포트 백업 생성"""
    logger.info("⏰ [스케줄] 국내 장 시작 전 준비 (08:50)")
    db = SessionLocal()
    try:
        from core.us_market_report import _kst_today, generate_us_morning_report, get_report

        today = _kst_today()
        if not get_report(db, today):
            try:
                generate_us_morning_report(db, report_date=today)
                logger.info("📰 [오전] 미국 리포트 백업 생성 완료")
            except Exception as e:
                logger.warning("⚠️ [오전] 미국 리포트 백업 실패: %s", e)

        now = datetime.now()
        yesterday = (now - timedelta(days=1)).strftime("%Y-%m-%d")

        from config.database import MacroSignal, PriceMoveCause, SectorSignal, Stock

        macro_sigs = db.query(MacroSignal).filter(MacroSignal.event_date >= yesterday).all()
        if macro_sigs:
            topics = [f"{m.topic}({m.sentiment})" for m in macro_sigs[:5]]
            logger.info("📊 [오전] 매크로 Signal %s개: %s", len(macro_sigs), ", ".join(topics))

        sector_sigs = db.query(SectorSignal).filter(SectorSignal.event_date >= yesterday).all()
        if sector_sigs:
            sectors = [f"{s.sector}({s.sentiment})" for s in sector_sigs[:5]]
            logger.info("🏭 [오전] 섹터 Signal %s개: %s", len(sector_sigs), ", ".join(sectors))

        week_ago = (now - timedelta(days=7)).strftime("%Y-%m-%d")
        stocks_with_cause = {
            r.stock_id
            for r in db.query(PriceMoveCause.stock_id).filter(PriceMoveCause.event_date >= week_ago).all()
        }
        holdings = db.query(Stock).filter(Stock.is_active == True, Stock.qty > 0).all()
        no_cause = [s.name for s in holdings if s.id not in stocks_with_cause]
        if no_cause:
            logger.info("⚠️ [오전] AI 원인 미검색 종목: %s", ", ".join(no_cause[:8]))
    except Exception as e:
        logger.error("❌ 장 시작 전 작업 실패: %s", e)
    finally:
        db.close()


async def job_us_market_open():
    """[23:35 KST] 미국 장 오픈 — 관련 매크로 Signal 요약"""
    logger.info("⏰ [스케줄] 미국 장 오픈 확인 (23:35)")
    db = SessionLocal()
    try:
        today = datetime.now().strftime("%Y-%m-%d")
        from config.database import MacroSignal

        us_signals = (
            db.query(MacroSignal)
            .filter(
                MacroSignal.event_date == today,
                MacroSignal.topic.in_(["FOMC/연준", "미국경제", "금리", "AI"]),
            )
            .all()
        )
        logger.info("🇺🇸 미국 장 오픈 — 관련 Signal %s건", len(us_signals))
        for s in us_signals[:3]:
            logger.info("   [%s] %s", s.topic, (s.summary or "")[:80])
    except Exception as e:
        logger.error("❌ 미국 장 오픈 작업 실패: %s", e)
    finally:
        db.close()


async def job_health_check():
    logger.info("💚 헬스 체크: %s", datetime.now().strftime("%Y-%m-%d %H:%M"))


async def job_compute_lead_lag():
    """[01:00 KST] PriceMoveCause × Signal Lead-Lag 갱신"""
    logger.info("⏰ [스케줄] Lead-Lag 분석 시작 (01:00)")
    db = SessionLocal()
    try:
        from core.lead_lag import compute_lead_lag, get_lead_lag_summary

        stats = compute_lead_lag(db)
        summary = get_lead_lag_summary(db)
        logger.info(
            "✅ Lead-Lag: created=%s total=%s insights=%s",
            stats.get("created", 0),
            stats.get("total_pairs", 0),
            len(summary.get("insights") or []),
        )
    except Exception as e:
        logger.error("❌ Lead-Lag 분석 실패: %s", e)
    finally:
        db.close()


async def job_check_signal_outcomes():
    """[00:30 KST] N일 지난 Signal의 주가 결과·적중 여부 기록"""
    logger.info("⏰ [스케줄] Signal 적중률 사후 검증 시작 (00:30)")
    db = SessionLocal()
    try:
        from core.signal_tracker import evaluate_signal_outcomes, get_signal_accuracy

        stats = evaluate_signal_outcomes(db)
        acc = get_signal_accuracy(db)
        logger.info(
            "✅ Signal outcomes: created=%s total=%s sector_hit=%s",
            stats.get("created", 0),
            stats.get("total_outcomes", 0),
            (acc.get("sector") or {}).get("overall_hit_rate"),
        )
    except Exception as e:
        logger.error("❌ Signal 적중률 검증 실패: %s", e)
    finally:
        db.close()


async def job_sync_economic_calendar():
    """[06:30 KST] 향후 6주 경제 일정 검색·동기화"""
    logger.info("⏰ [스케줄] 경제 일정 동기화 (06:30)")
    db = SessionLocal()
    try:
        from core.economic_calendar import sync_economic_calendar

        today = datetime.now().strftime("%Y-%m-%d")
        end = (datetime.now() + timedelta(days=42)).strftime("%Y-%m-%d")
        result = sync_economic_calendar(db, today, end, force=False)
        logger.info("✅ 경제 일정: %s", result)
    except Exception as e:
        logger.error("❌ 경제 일정 동기화 실패: %s", e)
    finally:
        db.close()


async def job_generate_daily_digest():
    """[00:45 KST] 어제 일일 AI digest 생성"""
    logger.info("⏰ [스케줄] 일일 digest 생성 시작 (00:45)")
    db = SessionLocal()
    try:
        from core.demo_mode import is_demo_mode
        from core.intel_digest import generate_yesterday_digest

        if is_demo_mode(db):
            logger.info("ℹ️ 데모 모드 — digest 스케줄 생략")
            return
        row = generate_yesterday_digest(db)
        if row:
            logger.info("✅ digest %s status=%s", row.date, row.status)
    except Exception as e:
        logger.error("❌ 일일 digest 생성 실패: %s", e)
    finally:
        db.close()


def create_scheduler() -> AsyncIOScheduler:
    scheduler = AsyncIOScheduler(timezone="Asia/Seoul")

    scheduler.add_job(
        job_sync_economic_calendar,
        CronTrigger(hour=6, minute=30, timezone="Asia/Seoul"),
        id="sync_economic_calendar",
        name="경제 일정 동기화",
        replace_existing=True,
    )
    scheduler.add_job(
        job_us_morning_report,
        CronTrigger(hour=8, minute=5, day_of_week="mon-fri", timezone="Asia/Seoul"),
        id="us_morning_report",
        name="미국 증시 아침 리포트",
        replace_existing=True,
    )
    scheduler.add_job(
        job_pre_domestic_open,
        CronTrigger(hour=8, minute=50, day_of_week="mon-fri", timezone="Asia/Seoul"),
        id="pre_domestic_open",
        name="국내 장 시작 전 준비",
        replace_existing=True,
    )
    scheduler.add_job(
        job_domestic_market_close,
        CronTrigger(hour=15, minute=35, day_of_week="mon-fri", timezone="Asia/Seoul"),
        id="domestic_market_close",
        name="국내 장 마감 후 동기화",
        replace_existing=True,
    )
    scheduler.add_job(
        job_us_market_open,
        CronTrigger(hour=23, minute=35, day_of_week="mon-fri", timezone="Asia/Seoul"),
        id="us_market_open",
        name="미국 장 오픈",
        replace_existing=True,
    )
    scheduler.add_job(
        job_us_market_close,
        CronTrigger(hour=7, minute=5, day_of_week="tue-sat", timezone="Asia/Seoul"),
        id="us_market_close",
        name="미국 장 마감 후 동기화",
        replace_existing=True,
    )
    scheduler.add_job(
        job_check_signal_outcomes,
        CronTrigger(hour=0, minute=30, timezone="Asia/Seoul"),
        id="check_signal_outcomes",
        name="Signal 적중률 사후 검증",
        replace_existing=True,
    )
    scheduler.add_job(
        job_generate_daily_digest,
        CronTrigger(hour=0, minute=45, timezone="Asia/Seoul"),
        id="generate_daily_digest",
        name="일일 AI digest 생성",
        replace_existing=True,
    )
    scheduler.add_job(
        job_compute_lead_lag,
        CronTrigger(hour=1, minute=0, timezone="Asia/Seoul"),
        id="compute_lead_lag",
        name="Signal Lead-Lag 분석",
        replace_existing=True,
    )
    scheduler.add_job(
        job_health_check,
        CronTrigger(minute=0, timezone="Asia/Seoul"),
        id="health_check",
        name="시스템 헬스 체크",
        replace_existing=True,
    )

    from scheduler.knowledge_jobs import register_knowledge_jobs

    register_knowledge_jobs(scheduler)

    logger.info("✅ 스케줄러 작업 등록 완료")
    for job in scheduler.get_jobs():
        next_run = getattr(job, "next_run_time", "스케줄러 시작 후 확정")
        logger.info("   📌 %s: %s", job.name, next_run)
    return scheduler
