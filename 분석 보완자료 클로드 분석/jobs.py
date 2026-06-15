"""
scheduler/jobs.py
APScheduler 자동 갱신 작업
국내/미국 장 시간에 맞춘 자동 동기화
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
    """
    [15:35 KST] 국내 장 마감 후 실행
    - 국내주식 잔고 동기화 (KIS API)
    - pykrx 시세 갱신 + 5% 알림 체크
    - 가격 이력 저장
    - 포트폴리오 스냅샷 저장
    """
    logger.info("⏰ [스케줄] 국내 장 마감 후 동기화 시작 (15:35)")
    db = SessionLocal()
    try:
        from core.price_updater import update_prices_from_krx, save_daily_snapshot

        # 1) pykrx 시세 갱신 (KIS API 없이도 동작)
        result = update_prices_from_krx(db, alert_threshold=settings.alert_threshold)
        logger.info(f"✅ 시세 갱신: {result['updated']}개 / 알림: {len(result['alerts'])}건")

        # 2) KIS API 잔고 동기화 (API 키 있을 때만)
        if settings.kis_app_key and settings.kis_account_no:
            try:
                from core.kis_client import create_kis_client_from_settings
                from core.portfolio import PortfolioManager
                kis = create_kis_client_from_settings()
                manager = PortfolioManager(db, kis)
                sync_result = manager.sync_all(alert_threshold=settings.alert_threshold)
                logger.info(f"✅ KIS 잔고 동기화: {sync_result['sync']}")
            except Exception as e:
                logger.warning(f"⚠️ KIS 동기화 실패 (pykrx 결과 유지): {e}")

        # 3) 일별 스냅샷 저장
        save_daily_snapshot(db)
        logger.info("✅ 국내 장 마감 동기화 완료")

    except Exception as e:
        logger.error(f"❌ 국내 장 마감 동기화 실패: {e}")
    finally:
        db.close()


async def job_us_market_close():
    """
    [07:05 KST] 미국 장 마감 후 실행
    - 해외주식 잔고 동기화 (KIS API)
    """
    logger.info("⏰ [스케줄] 미국 장 마감 후 동기화 시작 (07:05)")
    db = SessionLocal()
    try:
        if not (settings.kis_app_key and settings.kis_account_no):
            logger.info("ℹ️ KIS API 키 미설정 — 미국 장 마감 동기화 생략")
            return

        from core.kis_client import create_kis_client_from_settings
        from config.database import Stock

        kis = create_kis_client_from_settings()
        overseas = kis.get_overseas_balance()
        updated = 0
        for item in overseas:
            stock = db.query(Stock).filter(Stock.symbol == item.symbol).first()
            if stock:
                # ✅ BUG FIX: profit_rate 는 @property — current_price 만 저장
                prev = stock.current_price
                stock.current_price = item.current_price
                if prev and prev > 0:
                    stock.prev_price = prev
                    stock.change_rate = (item.current_price - prev) / prev * 100
                updated += 1

        db.commit()
        logger.info(f"✅ 미국 장 마감 동기화 완료: {updated}개 종목")

    except Exception as e:
        logger.error(f"❌ 미국 장 마감 동기화 실패: {e}")
    finally:
        db.close()


async def job_pre_domestic_open():
    """
    [08:50 KST] 국내 장 시작 전
    ✅ Phase 2 구현:
    - 전일 Signal 집계 → 오전 브리핑 로그 출력
    - 급변 미설명 종목 목록 출력 (AI 원인 검색 유도)
    """
    logger.info("⏰ [스케줄] 국내 장 시작 전 준비 (08:50)")
    db = SessionLocal()
    try:
        now = datetime.now()
        today = now.strftime("%Y-%m-%d")
        yesterday = (now - timedelta(days=1)).strftime("%Y-%m-%d")

        from config.database import MacroSignal, SectorSignal, StockSignal, Stock, PriceMoveCause

        # 1) 전일 매크로 Signal 요약
        macro_sigs = (
            db.query(MacroSignal)
            .filter(MacroSignal.event_date >= yesterday)
            .all()
        )
        if macro_sigs:
            topics = [f"{m.topic}({m.sentiment})" for m in macro_sigs]
            logger.info(f"📊 [오전 브리핑] 매크로 Signal {len(macro_sigs)}개: {', '.join(topics[:5])}")

        # 2) 전일 섹터 Signal 요약
        sector_sigs = (
            db.query(SectorSignal)
            .filter(SectorSignal.event_date >= yesterday)
            .all()
        )
        if sector_sigs:
            sectors = [f"{s.sector}({s.sentiment})" for s in sector_sigs]
            logger.info(f"🏭 [오전 브리핑] 섹터 Signal {len(sector_sigs)}개: {', '.join(sectors[:5])}")

        # 3) 최근 7일 내 원인 미설명 급변 종목 알림
        week_ago = (now - timedelta(days=7)).strftime("%Y-%m-%d")
        stocks_with_causes = {
            r.stock_id
            for r in db.query(PriceMoveCause.stock_id)
            .filter(PriceMoveCause.event_date >= week_ago)
            .all()
        }
        all_stocks = db.query(Stock).filter(Stock.is_active == True).all()
        no_cause = [s.name for s in all_stocks if s.id not in stocks_with_causes]
        if no_cause:
            logger.info(f"⚠️ [오전 브리핑] AI 원인 검색 미실행 종목: {', '.join(no_cause[:10])}")

        logger.info(f"✅ 오전 브리핑 완료: {today}")

    except Exception as e:
        logger.error(f"❌ 장 시작 전 작업 실패: {e}")
    finally:
        db.close()


async def job_us_market_open():
    """
    [23:35 KST] 미국 장 오픈
    ✅ Phase 2 구현:
    - 오늘 저장된 매크로 Signal 중 미국 관련 요약 로그
    """
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
        logger.info(f"🇺🇸 미국 증시 오픈 — 관련 Signal {len(us_signals)}개")
        for s in us_signals[:3]:
            logger.info(f"   [{s.topic}] {(s.summary or '')[:80]}")

    except Exception as e:
        logger.error(f"❌ 미국 장 오픈 작업 실패: {e}")
    finally:
        db.close()


async def job_health_check():
    """[매 정각] 시스템 헬스 체크"""
    logger.info(f"💚 헬스 체크: {datetime.now().strftime('%Y-%m-%d %H:%M')}")


def create_scheduler() -> AsyncIOScheduler:
    """
    스케줄러 생성 및 작업 등록
    모든 시간은 KST (Asia/Seoul) 기준
    """
    scheduler = AsyncIOScheduler(timezone="Asia/Seoul")

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
        job_health_check,
        CronTrigger(minute=0, timezone="Asia/Seoul"),
        id="health_check",
        name="시스템 헬스 체크",
        replace_existing=True,
    )

    logger.info("✅ 스케줄러 작업 등록 완료")
    for job in scheduler.get_jobs():
        next_run = getattr(job, "next_run_time", "스케줄러 시작 후 확정")
        logger.info(f"   📌 {job.name}: {next_run}")

    return scheduler



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
        updated = 0
        for item in overseas:
            stock = db.query(Stock).filter(Stock.symbol == item.symbol).first()
            if stock:
                # ✅ BUG FIX: profit_rate 는 @property (계산값) — 컬럼이 아님
                # current_price 만 저장하면 profit_rate 는 자동 계산됨
                prev = stock.current_price
                stock.current_price = item.current_price
                # 전일가 갱신 (변동률 계산용)
                if prev and prev != item.current_price:
                    stock.prev_price = prev
                    stock.change_rate = (
                        (item.current_price - prev) / prev * 100
                    ) if prev > 0 else 0.0
                updated += 1

        db.commit()
        logger.info(f"✅ 미국 장 마감 동기화 완료: {updated}개 종목")

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
        next_run = getattr(job, "next_run_time", "스케줄러 시작 후 확정")
        logger.info(f"   📌 {job.name}: {next_run}")

    return scheduler
