"""
scheduler/knowledge_jobs.py
지식 허브 스케줄 작업

기존 scheduler/jobs.py의 create_scheduler()에 아래를 추가:

    from scheduler.knowledge_jobs import register_knowledge_jobs
    register_knowledge_jobs(scheduler)
"""
import logging
from apscheduler.triggers.cron import CronTrigger

logger = logging.getLogger(__name__)


async def job_fetch_all_domain_news():
    """
    [매 6시간] 모든 활성 분야의 뉴스 수집
    """
    from config.database import SessionLocal, KnowledgeDomain
    from core.knowledge_news import fetch_domain_news
    from config.settings import get_settings
    import json

    settings = get_settings()
    db = SessionLocal()
    total = 0
    try:
        domains = db.query(KnowledgeDomain).filter(
            KnowledgeDomain.is_active == True,
            KnowledgeDomain.slug != "uncategorized",
        ).all()

        gemini_client = None
        if settings.gemini_api_key:
            from core.gemini_client import GeminiClient
            gemini_client = GeminiClient(
                settings.gemini_api_key, settings.gemini_model
            )

        for domain in domains:
            keywords = []
            try:
                keywords = json.loads(domain.keywords or "[]")
            except Exception:
                pass

            if not keywords:
                continue

            count = await fetch_domain_news(
                db           = db,
                domain_id    = domain.id,
                keywords     = keywords,
                gemini_client= gemini_client,
            )
            total += count
            logger.info("  분야 뉴스: %s → %d건", domain.name, count)

    except Exception as e:
        logger.error("분야 뉴스 수집 실패: %s", e)
    finally:
        db.close()

    logger.info("✅ 전체 분야 뉴스 수집 완료: 총 %d건", total)


async def job_morning_remind_notify():
    """
    [매일 08:00] 리마인드 카드 준비 로그 (알림 연동 확장 가능)
    """
    from config.database import SessionLocal
    from core.knowledge_remind import get_today_remind_cards

    db = SessionLocal()
    try:
        cards = get_today_remind_cards(db, limit=3)
        if cards:
            logger.info(
                "📚 오늘의 리마인드 카드 %d건 준비됨: %s",
                len(cards),
                " | ".join(c["source_title"][:20] for c in cards),
            )
    except Exception as e:
        logger.error("리마인드 알림 실패: %s", e)
    finally:
        db.close()


def register_knowledge_jobs(scheduler):
    """
    기존 create_scheduler()에서 호출:

        from scheduler.knowledge_jobs import register_knowledge_jobs
        scheduler = create_scheduler()
        register_knowledge_jobs(scheduler)
    """
    # 뉴스 수집 — 매 6시간 (0, 6, 12, 18시)
    scheduler.add_job(
        job_fetch_all_domain_news,
        CronTrigger(hour="0,6,12,18", minute=30, timezone="Asia/Seoul"),
        id="knowledge_news_fetch",
        name="분야 뉴스 자동 수집",
        replace_existing=True,
        misfire_grace_time=300,
    )

    # 리마인드 알림 — 매일 아침 8시
    scheduler.add_job(
        job_morning_remind_notify,
        CronTrigger(hour=8, minute=0, timezone="Asia/Seoul"),
        id="knowledge_remind_notify",
        name="오늘의 리마인드 알림",
        replace_existing=True,
    )

    logger.info("✅ 지식 허브 스케줄 작업 등록 완료")
