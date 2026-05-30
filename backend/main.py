"""
main.py
StockMind 앱 진입점
FastAPI 서버 + APScheduler 통합 실행
"""
import logging
import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config.database import init_db
from config.settings import get_settings
from api.routes import router
from api.routes_gains import gains_router
from api.routes_youtube import youtube_router
from scheduler.jobs import create_scheduler

# 로깅 설정
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)
settings = get_settings()
SERVERLESS = __import__("os").environ.get("SERVERLESS") == "1" or __import__("os").environ.get("VERCEL") == "1"


@asynccontextmanager
async def lifespan(app: FastAPI):
    """앱 시작/종료 이벤트"""
    logger.info("🚀 StockMind 시작 중... (serverless=%s)", SERVERLESS)

    init_db()

    scheduler = None
    if not SERVERLESS:
        scheduler = create_scheduler()
        scheduler.start()
        logger.info("✅ 스케줄러 시작됨")
    else:
        logger.info("ℹ️ Serverless 모드 — 스케줄러 비활성")

    yield

    if scheduler:
        scheduler.shutdown()
    logger.info("👋 StockMind 종료")


app = FastAPI(
    title="StockMind API",
    description="AI 기반 개인 주식 인텔리전스 플랫폼",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS 설정 (Next.js 프론트엔드 + Vercel 배포)
_cors_origins = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]
_frontend_url = __import__("os").environ.get("FRONTEND_URL")
if _frontend_url:
    _cors_origins.append(_frontend_url)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_origin_regex=r"https://.*\.vercel\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 라우터 등록
app.include_router(router, prefix="/api")
app.include_router(gains_router, prefix="/api")
app.include_router(youtube_router, prefix="/api")


@app.get("/")
def root():
    return {
        "service": "StockMind API",
        "version": "1.0.0",
        "docs": "/docs",
        "status": "running",
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host=settings.app_host,
        port=settings.app_port,
        reload=settings.debug,
        log_level="info",
    )
