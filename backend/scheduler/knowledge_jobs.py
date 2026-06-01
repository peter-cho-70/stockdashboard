"""지식 허브 스케줄 작업."""
import json
import logging

from apscheduler.triggers.cron import CronTrigger

logger = logging.getLogger(__name__)


async def job_fetch_all_domain_news():
    from config.database import KnowledgeDomain, SessionLocal
    from config.settings import get_settings
    from core.gemini_client import GeminiClient
    from core.knowledge_news import fetch_domain_news

    settings = get_settings()
    db = SessionLocal()
    total = 0
    try:
        gemini = None
        if settings.gemini_api_key:
            gemini = GeminiClient(settings.gemini_api_key, settings.gemini_model)
        domains = (
            db.query(KnowledgeDomain)
            .filter(KnowledgeDomain.is_active == True, KnowledgeDomain.slug != "uncategorized")
            .all()
        )
        for domain in domains:
            keywords = []
            try:
                keywords = json.loads(domain.keywords or "[]")
            except Exception:
                pass
            if not keywords:
                continue
            count = await fetch_domain_news(db, domain.id, keywords, gemini_client=gemini)
            total += count
            logger.info("  분야 뉴스 %s → %d건", domain.name, count)
    except Exception as e:
        logger.error("분야 뉴스 수집 실패: %s", e)
    finally:
        db.close()
    logger.info("✅ 전체 분야 뉴스 수집: %d건", total)


async def job_morning_remind_notify():
    from config.database import SessionLocal
    from core.knowledge_remind import get_today_remind_cards

    db = SessionLocal()
    try:
        cards = get_today_remind_cards(db, limit=3)
        if cards:
            logger.info(
                "📚 오늘의 리마인드 %d건: %s",
                len(cards),
                " | ".join((c.get("source_title") or "")[:20] for c in cards),
            )
    except Exception as e:
        logger.error("리마인드 알림 실패: %s", e)
    finally:
        db.close()


async def job_weekly_knowledge_digest():
    from config.database import SessionLocal
    from core.knowledge_digest import generate_all_weekly_digests

    logger.info("⏰ [스케줄] 지식 허브 주간 다이제스트 생성")
    db = SessionLocal()
    try:
        n = generate_all_weekly_digests(db)
        logger.info("✅ 주간 다이제스트 %d개 분야", n)
    except Exception as e:
        logger.error("❌ 주간 다이제스트 실패: %s", e)
    finally:
        db.close()


def register_knowledge_jobs(scheduler):
    scheduler.add_job(
        job_fetch_all_domain_news,
        CronTrigger(hour="0,6,12,18", minute=30, timezone="Asia/Seoul"),
        id="knowledge_news_fetch",
        name="분야 뉴스 자동 수집",
        replace_existing=True,
    )
    scheduler.add_job(
        job_morning_remind_notify,
        CronTrigger(hour=8, minute=0, timezone="Asia/Seoul"),
        id="knowledge_remind_notify",
        name="오늘의 리마인드",
        replace_existing=True,
    )
    scheduler.add_job(
        job_weekly_knowledge_digest,
        CronTrigger(day_of_week="sun", hour=20, minute=0, timezone="Asia/Seoul"),
        id="knowledge_weekly_digest",
        name="지식 허브 주간 다이제스트",
        replace_existing=True,
    )
    logger.info("✅ 지식 허브 스케줄 등록 완료")
