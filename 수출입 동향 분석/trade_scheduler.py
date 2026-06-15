"""
trade_scheduler.py
매월 자동 실행 스케줄러

실행 방법:
  python trade_scheduler.py          # 서버에서 상시 실행
  python trade_scheduler.py --now    # 즉시 1회 실행 테스트
"""

import os
import logging
import argparse
from datetime import datetime
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)


def run_monthly_collection():
    """월별 수출입 데이터 수집 및 분석 실행"""
    from trade_analyzer import TradeDataCollector, TradeAnalyzer, ReportGenerator, OUTPUT_DIR

    logger.info("🔄 월별 수출입 통계 수집 시작")
    start = datetime.now()

    public_api_key = os.getenv("PUBLIC_DATA_API_KEY")
    gemini_api_key = os.getenv("GEMINI_API_KEY")

    try:
        # 데이터 수집 (캐시 무시)
        collector = TradeDataCollector(api_key=public_api_key)
        data = collector.collect_months(months=13)

        reporter = ReportGenerator()
        reporter.save_excel(data)

        # AI 분석
        if gemini_api_key:
            analyzer  = TradeAnalyzer(gemini_api_key=gemini_api_key)
            ref_month = data["meta"].get("ref_month", "")
            analyses  = {
                "summary_trend": analyzer.analyze_summary_trend(data["summary"]) if not data["summary"].empty else "",
                "country_trade": analyzer.analyze_country_trade(data["countries"], ref_month) if not data["countries"].empty else "",
                "sector_items":  analyzer.analyze_sector_items(data["items"], ref_month) if not data["items"].empty else "",
                "integrated":    analyzer.analyze_integrated(data["summary"], data["countries"], data["items"], ref_month),
            }
            reporter.save_markdown(analyses, data["meta"])

        elapsed = (datetime.now() - start).seconds
        logger.info(f"✅ 월별 수집 완료 ({elapsed}초 소요)")

    except Exception as e:
        logger.error(f"❌ 월별 수집 실패: {e}", exc_info=True)


def main():
    parser = argparse.ArgumentParser(description="수출입 통계 자동 수집 스케줄러")
    parser.add_argument("--now", action="store_true", help="즉시 1회 실행")
    args = parser.parse_args()

    if args.now:
        print("🚀 즉시 1회 실행 모드")
        run_monthly_collection()
        return

    # APScheduler로 매월 자동 실행
    try:
        from apscheduler.schedulers.blocking import BlockingScheduler
        from apscheduler.triggers.cron import CronTrigger

        scheduler = BlockingScheduler(timezone="Asia/Seoul")

        # 매월 20일 09:00 (관세청 확정치 발표 후 약 5일 후)
        scheduler.add_job(
            run_monthly_collection,
            CronTrigger(day=20, hour=9, minute=0, timezone="Asia/Seoul"),
            id="monthly_trade",
            name="월별 수출입 통계 수집",
            replace_existing=True,
        )

        # 매월 1일 10:00 (산업부 잠정치 발표 직후)
        scheduler.add_job(
            run_monthly_collection,
            CronTrigger(day=1, hour=10, minute=0, timezone="Asia/Seoul"),
            id="monthly_trade_prelim",
            name="월별 수출입 통계 수집 (잠정치)",
            replace_existing=True,
        )

        logger.info("⏰ 스케줄 등록:")
        for job in scheduler.get_jobs():
            logger.info(f"   - {job.name}: {job.next_run_time}")

        logger.info("스케줄러 시작 (Ctrl+C로 종료)")
        scheduler.start()

    except ImportError:
        logger.error("apscheduler 미설치. pip install apscheduler")
        logger.info("수동 실행: python trade_scheduler.py --now")
    except KeyboardInterrupt:
        logger.info("스케줄러 종료")


if __name__ == "__main__":
    main()
