"""
api/routes.py
FastAPI REST API 라우터
포트폴리오 조회, 동기화, 알림, AI 분석
"""
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime

from config.database import get_db, Stock, AlertHistory, IntelContent, StockIssue, PortfolioSnapshot, RealizedGain
from config.settings import get_settings
from core.kis_client import create_kis_client_from_settings
from core.portfolio import PortfolioManager
from core.ai_analyzer import create_analyzer, serialize_intel
from core.price_updater import update_prices_from_krx, save_daily_snapshot

settings = get_settings()
router = APIRouter()


# ─────────────────────────────────────────────
# 헬스 체크
# ─────────────────────────────────────────────
@router.get("/health")
def health_check():
    return {"status": "ok", "service": "StockMind API"}


# ─────────────────────────────────────────────
# 종목 수동 등록 / 일괄 등록
# ─────────────────────────────────────────────
class StockCreate(BaseModel):
    symbol: str
    name: str
    market: str = "KRX"
    sector: Optional[str] = None
    currency: str = "KRW"
    qty: float
    avg_price: float
    current_price: float = 0
    profit_rate: float = 0


@router.post("/portfolio/stocks")
def add_stock(body: StockCreate, db: Session = Depends(get_db)):
    """종목 단건 수동 등록 (KIS API 없이 직접 입력)"""
    existing = db.query(Stock).filter(Stock.symbol == body.symbol).first()
    purchase_amount = body.qty * body.avg_price
    current_price = body.current_price if body.current_price else body.avg_price
    if existing:
        existing.name = body.name
        existing.market = body.market
        existing.sector = body.sector
        existing.currency = body.currency
        existing.qty = body.qty
        existing.avg_price = body.avg_price
        existing.purchase_amount = purchase_amount
        existing.current_price = current_price
        existing.is_active = True
        existing.last_synced_at = datetime.utcnow()
        db.commit()
        return {"message": "종목 업데이트 완료", "symbol": body.symbol}

    stock = Stock(
        symbol=body.symbol,
        name=body.name,
        market=body.market,
        sector=body.sector,
        currency=body.currency,
        qty=body.qty,
        avg_price=body.avg_price,
        purchase_amount=purchase_amount,
        current_price=current_price,
        is_active=True,
        last_synced_at=datetime.utcnow(),
    )
    db.add(stock)
    db.commit()
    return {"message": "종목 등록 완료", "symbol": body.symbol}


@router.post("/portfolio/stocks/bulk")
def bulk_add_stocks(body: List[StockCreate], db: Session = Depends(get_db)):
    """종목 일괄 등록"""
    results = []
    for item in body:
        existing = db.query(Stock).filter(Stock.symbol == item.symbol).first()
        purchase_amount = item.qty * item.avg_price
        current_price = item.current_price if item.current_price else item.avg_price
        if existing:
            existing.name = item.name
            existing.market = item.market
            existing.sector = item.sector
            existing.currency = item.currency
            existing.qty = item.qty
            existing.avg_price = item.avg_price
            existing.purchase_amount = purchase_amount
            existing.current_price = current_price
            existing.is_active = True
            existing.last_synced_at = datetime.utcnow()
            results.append({"symbol": item.symbol, "action": "updated"})
        else:
            stock = Stock(
                symbol=item.symbol,
                name=item.name,
                market=item.market,
                sector=item.sector,
                currency=item.currency,
                qty=item.qty,
                avg_price=item.avg_price,
                purchase_amount=purchase_amount,
                current_price=current_price,
                is_active=True,
                last_synced_at=datetime.utcnow(),
            )
            db.add(stock)
            results.append({"symbol": item.symbol, "action": "added"})
    db.commit()
    return {"message": f"{len(results)}개 종목 처리 완료", "results": results}


@router.delete("/portfolio/stocks/{symbol}")
def delete_stock(symbol: str, db: Session = Depends(get_db)):
    """종목 삭제"""
    stock = db.query(Stock).filter(Stock.symbol == symbol).first()
    if not stock:
        raise HTTPException(status_code=404, detail=f"종목 없음: {symbol}")
    stock.is_active = False
    db.commit()
    return {"message": "종목 비활성화 완료", "symbol": symbol}


# ─────────────────────────────────────────────
# 주가 차트 데이터 (pykrx — 최대 1년 OHLCV)
# ─────────────────────────────────────────────
@router.get("/portfolio/stocks/{symbol}/chart")
def get_stock_chart(
    symbol: str,
    period: str = "3M",   # 1M / 3M / 6M / 1Y
    db: Session = Depends(get_db)
):
    """
    종목 OHLCV 차트 데이터 (pykrx)
    period: 1M=1개월, 3M=3개월, 6M=6개월, 1Y=1년
    """
    from datetime import date, timedelta
    from pykrx import stock as krx
    import time as _time

    stock = db.query(Stock).filter(Stock.symbol == symbol).first()
    if not stock:
        raise HTTPException(status_code=404, detail=f"종목 없음: {symbol}")

    period_days = {"1M": 30, "3M": 90, "6M": 180, "1Y": 365}.get(period, 90)
    end_date = date.today()
    start_date = end_date - timedelta(days=period_days)

    try:
        df = krx.get_market_ohlcv_by_date(
            start_date.strftime("%Y%m%d"),
            end_date.strftime("%Y%m%d"),
            symbol
        )
        if df.empty:
            return {"symbol": symbol, "name": stock.name, "data": []}

        # 이동평균 계산
        closes = df.iloc[:, 3] if "종가" not in df.columns else df["종가"]

        records = []
        closes_list = list(closes)
        for i, (idx, row) in enumerate(df.iterrows()):
            date_str = idx.strftime("%Y-%m-%d") if hasattr(idx, "strftime") else str(idx)[:10]

            # 컬럼명 대응 (한글/영문)
            col_map = {c.lower(): c for c in df.columns}
            def gcol(kw_list):
                for kw in kw_list:
                    if kw in col_map:
                        return float(row[col_map[kw]])
                return 0.0

            close_price = gcol(["종가", "close"])

            # 이동평균
            ma5  = sum(closes_list[max(0,i-4):i+1])  / min(i+1, 5)
            ma20 = sum(closes_list[max(0,i-19):i+1]) / min(i+1, 20)
            ma60 = sum(closes_list[max(0,i-59):i+1]) / min(i+1, 60)

            records.append({
                "date":   date_str,
                "open":   gcol(["시가", "open"]),
                "high":   gcol(["고가", "high"]),
                "low":    gcol(["저가", "low"]),
                "close":  close_price,
                "volume": gcol(["거래량", "volume"]),
                "ma5":    round(ma5,  0),
                "ma20":   round(ma20, 0),
                "ma60":   round(ma60, 0),
            })

        return {
            "symbol": symbol,
            "name": stock.name,
            "sector": stock.sector,
            "avg_price": stock.avg_price,
            "current_price": stock.current_price,
            "profit_rate": stock.profit_rate,
            "period": period,
            "data": records,
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"차트 데이터 조회 실패: {e}")


# ─────────────────────────────────────────────
# KRX 시세 갱신 (pykrx — KIS API 불필요)
# ─────────────────────────────────────────────
@router.post("/portfolio/refresh-prices")
def refresh_prices_krx(db: Session = Depends(get_db)):
    """pykrx로 국내 종목 현재가 갱신 (KIS API 없이 사용 가능)"""
    try:
        result = update_prices_from_krx(db, alert_threshold=settings.alert_threshold)
        save_daily_snapshot(db)
        return {
            "message": f"시세 갱신 완료: {result['updated']}개 종목",
            "updated": result["updated"],
            "alerts": result["alerts"],
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ─────────────────────────────────────────────
# 포트폴리오 이력 (수익률 차트용)
# ─────────────────────────────────────────────
@router.get("/portfolio/history")
def get_portfolio_history(days: int = 30, db: Session = Depends(get_db)):
    """일별 포트폴리오 수익률 이력 (차트용)"""
    snapshots = (
        db.query(PortfolioSnapshot)
        .order_by(PortfolioSnapshot.date.desc())
        .limit(days)
        .all()
    )
    return [
        {
            "date": s.date,
            "total_value": s.total_value,
            "total_profit": s.total_profit,
            "total_profit_rate": round(s.total_profit_rate, 2),
        }
        for s in reversed(snapshots)
    ]


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
    """콘텐츠 AI 분석 (YouTube→Gemini+GPT / 뉴스·텍스트→GPT)"""
    if not body.url and not body.text:
        raise HTTPException(status_code=400, detail="url 또는 text 중 하나는 필수입니다.")

    is_youtube = body.url and ("youtube.com" in body.url or "youtu.be" in body.url)
    if is_youtube and not settings.gemini_api_key:
        raise HTTPException(status_code=400, detail="YouTube 분석에 GEMINI_API_KEY가 필요합니다.")
    if not settings.openai_api_key:
        raise HTTPException(status_code=400, detail="구조화 분석에 OPENAI_API_KEY가 필요합니다.")

    analyzer = create_analyzer(db)

    try:
        if body.url:
            if is_youtube:
                content = analyzer.analyze_youtube(body.url, body.channel_name or "")
            else:
                content = analyzer.analyze_url(body.url)
        else:
            content = analyzer.analyze_text(body.text, body.title or "")
    except RuntimeError as e:
        err = str(e)
        if err.startswith("GEMINI_QUOTA_EXCEEDED:"):
            secs = err.split(":")[1]
            raise HTTPException(status_code=429, detail=f"Gemini API 한도 초과. {secs}초 후 재시도.")
        if err.startswith("OPENAI_QUOTA_EXCEEDED:"):
            secs = err.split(":")[1]
            raise HTTPException(status_code=429, detail=f"OpenAI API 한도 초과. {secs}초 후 재시도.")
        raise HTTPException(status_code=500, detail=str(e))

    if not content:
        raise HTTPException(
            status_code=500,
            detail={"message": "AI 분석 실패. API 키와 로그를 확인하세요.", "logs": analyzer.logs},
        )

    return serialize_intel(content, db, analyzer.logs)


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
            "macro_analysis": json.loads(c.macro_analysis or "{}"),
            "sector_analysis": json.loads(c.sector_analysis or "[]"),
            "sentiment": c.sentiment,
            "analyzed_at": c.analyzed_at.isoformat() if c.analyzed_at else None,
        }
        for c in contents
    ]


@router.get("/intel/by-url")
def get_intel_by_url(url: str, db: Session = Depends(get_db)):
    """URL로 분석 결과 조회"""
    c = db.query(IntelContent).filter(IntelContent.source_url == url).order_by(IntelContent.id.desc()).first()
    if not c:
        raise HTTPException(status_code=404, detail="분석 결과 없음")
    return serialize_intel(c, db)


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
