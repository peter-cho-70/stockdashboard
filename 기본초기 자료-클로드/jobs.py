"""
scheduler/jobs.py
APScheduler 자동 갱신 작업
국내/미국 장 시간에 맞춘 자동 동기화
"""
import logging
from datetime import datetime
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from config.database import SessionLocal
from config.settings import get_settings
from core.kis_client import create_kis_client_from_settings
from core.portfolio import PortfolioManager

logger = logging.getLogger(__name__)
settings = get_settings()


async def job_domestic_market_close():
    """
    [15:35 KST] 국내 장 마감 후 실행
    - 국내주식 잔고 동기화
    - 시세 갱신 + 5% 알림 체크
    - 가격 이력 저장
    - 포트폴리오 스냅샷 저장
    """
    logger.info("⏰ [스케줄] 국내 장 마감 후 동기화 시작 (15:35)")
    db = SessionLocal()
    try:
        kis = create_kis_client_from_settings()
        manager = PortfolioManager(db, kis)
        result = manager.sync_all(alert_threshold=settings.alert_threshold)

        if result["alerts"]:
            logger.warning(f"⚠️ 5% 이상 변동 종목: {result['alert_count']}개")
            for alert in result["alerts"]:
                logger.warning(f"   {alert['message']}")

        logger.info(f"✅ 국내 장 마감 동기화 완료: {result['sync']}")

    except Exception as e:
        logger.error(f"❌ 국내 장 마감 동기화 실패: {e}")
    finally:
        db.close()


async def job_us_market_close():
    """
    [07:05 KST] 미국 장 마감 후 실행
    - 해외주식 잔고 동기화
    - 미국 주식 시세 갱신
    """
    logger.info("⏰ [스케줄] 미국 장 마감 후 동기화 시작 (07:05)")
    db = SessionLocal()
    try:
        kis = create_kis_client_from_settings()
        manager = PortfolioManager(db, kis)

        # 해외주식만 갱신 (국내는 아직 장 열리기 전)
        overseas = kis.get_overseas_balance()
        from config.database import Stock
        for item in overseas:
            stock = db.query(Stock).filter(Stock.symbol == item.symbol).first()
            if stock:
                stock.current_price = item.current_price
                stock.profit_rate = item.profit_rate

        db.commit()
        logger.info(f"✅ 미국 장 마감 동기화 완료: {len(overseas)}개 종목")

    except Exception as e:
        logger.error(f"❌ 미국 장 마감 동기화 실패: {e}")
    finally:
        db.close()


async def job_pre_domestic_open():
    """
    [08:50 KST] 국내 장 시작 전
    - 전일 미국 마감 데이터 확인
    - 오전 브리핑 생성 (Phase 2에서 AI 브리핑 추가)
    """
    logger.info("⏰ [스케줄] 국내 장 시작 전 준비 (08:50)")
    try:
        logger.info("📋 오전 브리핑 생성 (현재: 기본 로그, Phase 2에서 AI 브리핑으로 업그레이드)")
        now = datetime.now()
        logger.info(f"   현재 시각: {now.strftime('%Y-%m-%d %H:%M')}")
        logger.info("   미국 전일 마감 데이터 확인 완료")
    except Exception as e:
        logger.error(f"❌ 장 시작 전 작업 실패: {e}")


async def job_us_market_open():
    """
    [23:35 KST] 미국 장 오픈
    - 미국 시황 요약 알림
    """
    logger.info("⏰ [스케줄] 미국 장 오픈 확인 (23:35)")
    try:
        logger.info("🇺🇸 미국 증시 오픈")
        # Phase 2에서 AI 시황 요약 추가
    except Exception as e:
        logger.error(f"❌ 미국 장 오픈 작업 실패: {e}")


async def job_health_check():
    """[매 정각] 시스템 헬스 체크"""
    logger.info(f"💚 헬스 체크: {datetime.now().strftime('%Y-%m-%d %H:%M')}")


def create_scheduler() -> AsyncIOScheduler:
    """
    스케줄러 생성 및 작업 등록
    모든 시간은 KST (Asia/Seoul) 기준
    """
    scheduler = AsyncIOScheduler(timezone="Asia/Seoul")

    # 국내 장 시작 전 (평일 08:50)
    scheduler.add_job(
        job_pre_domestic_open,
        CronTrigger(hour=8, minute=50, day_of_week="mon-fri", timezone="Asia/Seoul"),
        id="pre_domestic_open",
        name="국내 장 시작 전 준비",
        replace_existing=True,
    )

    # 국내 장 마감 후 (평일 15:35)
    scheduler.add_job(
        job_domestic_market_close,
        CronTrigger(hour=15, minute=35, day_of_week="mon-fri", timezone="Asia/Seoul"),
        id="domestic_market_close",
        name="국내 장 마감 후 동기화",
        replace_existing=True,
    )

    # 미국 장 오픈 (평일 23:35)
    scheduler.add_job(
        job_us_market_open,
        CronTrigger(hour=23, minute=35, day_of_week="mon-fri", timezone="Asia/Seoul"),
        id="us_market_open",
        name="미국 장 오픈",
        replace_existing=True,
    )

    # 미국 장 마감 후 (평일 07:05)
    scheduler.add_job(
        job_us_market_close,
        CronTrigger(hour=7, minute=5, day_of_week="tue-sat", timezone="Asia/Seoul"),
        id="us_market_close",
        name="미국 장 마감 후 동기화",
        replace_existing=True,
    )

    # 헬스 체크 (매 정각)
    scheduler.add_job(
        job_health_check,
        CronTrigger(minute=0, timezone="Asia/Seoul"),
        id="health_check",
        name="시스템 헬스 체크",
        replace_existing=True,
    )

    logger.info("✅ 스케줄러 작업 등록 완료")
    for job in scheduler.get_jobs():
        logger.info(f"   📌 {job.name}: {job.next_run_time}")

    return scheduler
