"""
api/routes.py
FastAPI REST API 라우터
포트폴리오 조회, 동기화, 알림, AI 분석
"""
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional

from config.database import get_db, Stock, AlertHistory, IntelContent, StockIssue
from config.settings import get_settings
from core.kis_client import create_kis_client_from_settings
from core.portfolio import PortfolioManager
from core.ai_analyzer import AIAnalyzer

settings = get_settings()
router = APIRouter()


# ─────────────────────────────────────────────
# 헬스 체크
# ─────────────────────────────────────────────
@router.get("/health")
def health_check():
    return {"status": "ok", "service": "StockMind API"}


# ─────────────────────────────────────────────
# 포트폴리오
# ─────────────────────────────────────────────
@router.get("/portfolio/summary")
def get_portfolio_summary(db: Session = Depends(get_db)):
    """포트폴리오 요약 (총 평가금액, 수익률, 상위/하위 종목)"""
    stocks = db.query(Stock).filter(Stock.is_active == True).all()
    if not stocks:
        return {"message": "보유 종목 없음. /portfolio/sync 로 동기화하세요."}

    total_value = sum(s.current_value for s in stocks)
    total_purchase = sum(s.purchase_amount for s in stocks)
    total_profit = total_value - total_purchase
    total_profit_rate = (total_profit / total_purchase * 100) if total_purchase > 0 else 0

    return {
        "total_value": round(total_value, 0),
        "total_purchase": round(total_purchase, 0),
        "total_profit": round(total_profit, 0),
        "total_profit_rate": round(total_profit_rate, 2),
        "stock_count": len(stocks),
        "stocks": [
            {
                "symbol": s.symbol,
                "name": s.name,
                "market": s.market,
                "qty": s.qty,
                "avg_price": s.avg_price,
                "current_price": s.current_price,
                "change_rate": round(s.change_rate, 2),
                "profit_rate": round(s.profit_rate, 2),
                "profit_loss": round(s.profit_loss, 0),
                "current_value": round(s.current_value, 0),
                "currency": s.currency,
            }
            for s in sorted(stocks, key=lambda x: abs(x.change_rate), reverse=True)
        ],
    }


@router.get("/portfolio/stocks")
def get_stocks(db: Session = Depends(get_db)):
    """보유 종목 전체 목록"""
    stocks = db.query(Stock).filter(Stock.is_active == True).all()
    return [
        {
            "id": s.id,
            "symbol": s.symbol,
            "name": s.name,
            "market": s.market,
            "sector": s.sector,
            "currency": s.currency,
            "qty": s.qty,
            "avg_price": s.avg_price,
            "current_price": s.current_price,
            "change_rate": s.change_rate,
            "profit_rate": s.profit_rate,
            "memo": s.memo,
            "last_synced_at": s.last_synced_at.isoformat() if s.last_synced_at else None,
        }
        for s in stocks
    ]


@router.post("/portfolio/sync")
async def sync_portfolio(background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    """KIS API 잔고 동기화 (백그라운드 실행)"""
    def run_sync():
        try:
            kis = create_kis_client_from_settings()
            manager = PortfolioManager(db, kis)
            result = manager.sync_all(alert_threshold=settings.alert_threshold)
            return result
        except Exception as e:
            return {"error": str(e)}

    background_tasks.add_task(run_sync)
    return {"message": "동기화 시작됨. /portfolio/summary 로 결과 확인하세요."}


@router.post("/portfolio/sync/now")
def sync_portfolio_now(db: Session = Depends(get_db)):
    """KIS API 잔고 동기화 (즉시 실행, 결과 반환)"""
    try:
        kis = create_kis_client_from_settings()
        manager = PortfolioManager(db, kis)
        result = manager.sync_all(alert_threshold=settings.alert_threshold)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ─────────────────────────────────────────────
# 종목 메모 수정
# ─────────────────────────────────────────────
class MemoUpdate(BaseModel):
    memo: str
    sector: Optional[str] = None


@router.patch("/portfolio/stocks/{symbol}/memo")
def update_stock_memo(symbol: str, body: MemoUpdate, db: Session = Depends(get_db)):
    """종목 메모 및 섹터 업데이트"""
    stock = db.query(Stock).filter(Stock.symbol == symbol).first()
    if not stock:
        raise HTTPException(status_code=404, detail=f"종목 없음: {symbol}")

    stock.memo = body.memo
    if body.sector:
        stock.sector = body.sector
    db.commit()
    return {"message": "업데이트 완료", "symbol": symbol}


# ─────────────────────────────────────────────
# 알림
# ─────────────────────────────────────────────
@router.get("/alerts")
def get_alerts(unread_only: bool = False, limit: int = 50, db: Session = Depends(get_db)):
    """알림 목록 조회"""
    query = db.query(AlertHistory)
    if unread_only:
        query = query.filter(AlertHistory.is_read == False)
    alerts = query.order_by(AlertHistory.created_at.desc()).limit(limit).all()

    return [
        {
            "id": a.id,
            "symbol": a.stock_symbol,
            "type": a.alert_type,
            "message": a.message,
            "change_rate": a.change_rate,
            "is_read": a.is_read,
            "created_at": a.created_at.isoformat(),
        }
        for a in alerts
    ]


@router.patch("/alerts/{alert_id}/read")
def mark_alert_read(alert_id: int, db: Session = Depends(get_db)):
    """알림 읽음 처리"""
    alert = db.query(AlertHistory).filter(AlertHistory.id == alert_id).first()
    if not alert:
        raise HTTPException(status_code=404, detail="알림 없음")
    alert.is_read = True
    db.commit()
    return {"message": "읽음 처리 완료"}


@router.patch("/alerts/read-all")
def mark_all_alerts_read(db: Session = Depends(get_db)):
    """전체 알림 읽음 처리"""
    db.query(AlertHistory).filter(AlertHistory.is_read == False).update({"is_read": True})
    db.commit()
    return {"message": "전체 읽음 처리 완료"}


# ─────────────────────────────────────────────
# AI 분석 (Phase 2)
# ─────────────────────────────────────────────
class AnalyzeRequest(BaseModel):
    url: Optional[str] = None           # YouTube 또는 뉴스 URL
    text: Optional[str] = None          # 직접 입력 텍스트
    title: Optional[str] = None         # 텍스트 제목 (선택)
    channel_name: Optional[str] = None  # 유튜브 채널명 (선택)


@router.post("/intel/analyze")
def analyze_content(body: AnalyzeRequest, db: Session = Depends(get_db)):
    """콘텐츠 AI 분석 (YouTube URL / 뉴스 URL / 텍스트)"""
    if not body.url and not body.text:
        raise HTTPException(status_code=400, detail="url 또는 text 중 하나는 필수입니다.")

    analyzer = AIAnalyzer(api_key=settings.gemini_api_key, db=db)

    if body.url:
        # YouTube vs 일반 URL 구분
        if "youtube.com" in body.url or "youtu.be" in body.url:
            content = analyzer.analyze_youtube(body.url, body.channel_name or "")
        else:
            content = analyzer.analyze_url(body.url)
    else:
        content = analyzer.analyze_text(body.text, body.title or "")

    if not content:
        raise HTTPException(status_code=500, detail="AI 분석 실패. 로그를 확인하세요.")

    import json
    return {
        "id": content.id,
        "source_type": content.source_type,
        "summary": content.summary,
        "key_points": json.loads(content.key_points or "[]"),
        "mentioned_stocks": json.loads(content.mentioned_stocks or "[]"),
        "mentioned_sectors": json.loads(content.mentioned_sectors or "[]"),
        "keywords": json.loads(content.keywords or "[]"),
        "sentiment": content.sentiment,
        "analyzed_at": content.analyzed_at.isoformat() if content.analyzed_at else None,
    }


@router.get("/intel/contents")
def get_intel_contents(
    limit: int = 20,
    source_type: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """분석 콘텐츠 목록 조회"""
    import json
    query = db.query(IntelContent)
    if source_type:
        query = query.filter(IntelContent.source_type == source_type)
    contents = query.order_by(IntelContent.created_at.desc()).limit(limit).all()

    return [
        {
            "id": c.id,
            "source_type": c.source_type,
            "source_url": c.source_url,
            "source_title": c.source_title,
            "channel_name": c.channel_name,
            "summary": c.summary,
            "mentioned_stocks": json.loads(c.mentioned_stocks or "[]"),
            "mentioned_sectors": json.loads(c.mentioned_sectors or "[]"),
            "sentiment": c.sentiment,
            "analyzed_at": c.analyzed_at.isoformat() if c.analyzed_at else None,
        }
        for c in contents
    ]


@router.get("/intel/stocks/{symbol}/issues")
def get_stock_issues(symbol: str, limit: int = 20, db: Session = Depends(get_db)):
    """특정 종목 이슈 타임라인 조회"""
    stock = db.query(Stock).filter(Stock.symbol == symbol).first()
    if not stock:
        raise HTTPException(status_code=404, detail=f"종목 없음: {symbol}")

    issues = (
        db.query(StockIssue)
        .filter(StockIssue.stock_id == stock.id)
        .order_by(StockIssue.created_at.desc())
        .limit(limit)
        .all()
    )

    return {
        "symbol": symbol,
        "name": stock.name,
        "issues": [
            {
                "id": i.id,
                "issue_summary": i.issue_summary,
                "sentiment": i.sentiment,
                "source_type": i.content.source_type if i.content else None,
                "source_url": i.content.source_url if i.content else None,
                "source_title": i.content.source_title if i.content else None,
                "created_at": i.created_at.isoformat(),
            }
            for i in issues
        ],
    }
