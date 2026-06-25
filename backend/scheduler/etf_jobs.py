"""ETF 분석 채널 자동 수집 스케줄 작업."""
import logging

from apscheduler.triggers.cron import CronTrigger

logger = logging.getLogger(__name__)


async def job_analyze_etf_channels():
    """[정기] 등록된 ETF 분석 채널의 최신 영상을 자동으로 가져와 ETF 언급 분석"""
    from config.database import EtfYoutubeChannel, SessionLocal
    from config.settings import get_settings
    from core.etf_youtube import analyze_latest_videos

    settings = get_settings()
    if not settings.youtube_api_key or not settings.gemini_api_key:
        logger.info("ETF 채널 자동 분석 건너뜀 (YouTube/Gemini API 키 미설정)")
        return

    db = SessionLocal()
    total = 0
    try:
        channels = (
            db.query(EtfYoutubeChannel)
            .filter(EtfYoutubeChannel.is_active == True)  # noqa: E712
            .all()
        )
        for channel in channels:
            try:
                analyzed = analyze_latest_videos(
                    db,
                    channel,
                    youtube_api_key=settings.youtube_api_key,
                    gemini_api_key=settings.gemini_api_key,
                    gemini_model=settings.gemini_model,
                    max_results=3,
                )
                total += len(analyzed)
                if analyzed:
                    logger.info("  ETF 채널 %s → 신규 %d건 분석", channel.channel_name, len(analyzed))
            except Exception as e:
                logger.warning("  ETF 채널 분석 실패 (%s): %s", channel.channel_name, e)
    except Exception as e:
        logger.error("ETF 채널 자동 분석 실패: %s", e)
    finally:
        db.close()
    logger.info("✅ ETF 채널 자동 분석 완료: 총 %d건", total)


def register_etf_jobs(scheduler):
    scheduler.add_job(
        job_analyze_etf_channels,
        CronTrigger(hour="7,12,17,22", minute=15, timezone="Asia/Seoul"),
        id="etf_channel_analyze",
        name="ETF 분석 채널 자동 수집",
        replace_existing=True,
    )
    logger.info("✅ ETF 스케줄 등록 완료")
