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

from config.database import (
    get_db, Stock, AlertHistory, IntelContent, StockIssue, PortfolioSnapshot,
    RealizedGain, PortfolioTrade,
)
from core.portfolio_positions import (
    serialize_stock,
    get_stock_by_symbol,
    apply_position,
    execute_trade,
    mark_manual,
)
from config.settings import get_settings
from core.kis_client import create_kis_client_from_settings
from core.portfolio import PortfolioManager
from core.ai_analyzer import (
    create_analyzer,
    serialize_intel,
    ensure_analysis_available,
    handle_provider_runtime_error,
    ProviderQuotaError,
    try_cached_intel,
)
from core.analysis_stream import run_intel_analysis, stream_analysis, run_explain_move
from core.move_explainer import explain_and_save, get_move_causes_for_stock, serialize_move_cause
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
    symbol = body.symbol.strip()
    existing = db.query(Stock).filter(Stock.symbol == symbol).first()
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
        existing.is_active = body.qty > 0
        existing.position_source = "manual"
        existing.last_synced_at = datetime.utcnow()
        db.commit()
        db.refresh(existing)
        return {"message": "종목 업데이트 완료", "stock": serialize_stock(existing)}

    stock = Stock(
        symbol=symbol,
        name=body.name,
        market=body.market,
        sector=body.sector,
        currency=body.currency,
        qty=body.qty,
        avg_price=body.avg_price,
        purchase_amount=purchase_amount,
        current_price=current_price,
        position_source="manual",
        is_active=body.qty > 0,
        last_synced_at=datetime.utcnow(),
    )
    db.add(stock)
    db.commit()
    db.refresh(stock)
    return {"message": "종목 등록 완료", "stock": serialize_stock(stock)}


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
            existing.position_source = "manual"
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
                position_source="manual",
                is_active=True,
                last_synced_at=datetime.utcnow(),
            )
            db.add(stock)
            results.append({"symbol": item.symbol, "action": "added"})
    db.commit()
    return {"message": f"{len(results)}개 종목 처리 완료", "results": results}


@router.delete("/portfolio/stocks/{symbol}")
def delete_stock(symbol: str, db: Session = Depends(get_db)):
    """종목 보유 제외 (soft delete)"""
    stock = get_stock_by_symbol(db, symbol)
    if not stock:
        raise HTTPException(status_code=404, detail=f"종목 없음: {symbol}")
    stock.is_active = False
    stock.qty = 0
    stock.purchase_amount = 0
    mark_manual(stock)
    db.commit()
    return {"message": "종목 비활성화 완료", "symbol": symbol}


class PositionUpdate(BaseModel):
    qty: Optional[float] = None
    avg_price: Optional[float] = None
    name: Optional[str] = None
    sector: Optional[str] = None
    current_price: Optional[float] = None


@router.patch("/portfolio/stocks/{symbol}")
def update_stock_position(symbol: str, body: PositionUpdate, db: Session = Depends(get_db)):
    """잔고 수동 수정 (수량·평단 등)"""
    stock = get_stock_by_symbol(db, symbol)
    if not stock:
        raise HTTPException(status_code=404, detail=f"종목 없음: {symbol}")

    if body.name is not None:
        stock.name = body.name.strip()
    if body.sector is not None:
        stock.sector = body.sector or None
    if body.current_price is not None:
        stock.current_price = body.current_price

    if body.qty is not None or body.avg_price is not None:
        qty = body.qty if body.qty is not None else stock.qty
        avg = body.avg_price if body.avg_price is not None else stock.avg_price
        try:
            apply_position(stock, qty=qty, avg_price=avg)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
    else:
        mark_manual(stock)

    db.commit()
    db.refresh(stock)
    return {"message": "잔고 수정 완료", "stock": serialize_stock(stock)}


class TradeCreate(BaseModel):
    side: str  # BUY | SELL
    qty: float
    price: float
    traded_at: Optional[str] = None
    memo: Optional[str] = None


@router.post("/portfolio/stocks/{symbol}/trades")
def create_stock_trade(symbol: str, body: TradeCreate, db: Session = Depends(get_db)):
    """매수·매도 체결 반영"""
    stock = get_stock_by_symbol(db, symbol)
    if not stock:
        raise HTTPException(status_code=404, detail=f"종목 없음: {symbol}")

    try:
        trade = execute_trade(
            db,
            stock,
            side=body.side,
            qty=body.qty,
            price=body.price,
            traded_at=body.traded_at,
            memo=body.memo,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    db.commit()
    db.refresh(stock)
    db.refresh(trade)
    return {
        "message": f"{'매수' if body.side.upper() == 'BUY' else '매도'} 반영 완료",
        "stock": serialize_stock(stock),
        "trade": {
            "id": trade.id,
            "side": trade.side,
            "qty": trade.qty,
            "price": trade.price,
            "traded_at": trade.traded_at,
            "memo": trade.memo,
        },
    }


@router.get("/portfolio/stocks/{symbol}/trades")
def list_stock_trades(symbol: str, limit: int = 30, db: Session = Depends(get_db)):
    """종목별 매매 이력"""
    stock = get_stock_by_symbol(db, symbol)
    if not stock:
        raise HTTPException(status_code=404, detail=f"종목 없음: {symbol}")

    trades = (
        db.query(PortfolioTrade)
        .filter(PortfolioTrade.stock_id == stock.id)
        .order_by(PortfolioTrade.traded_at.desc(), PortfolioTrade.id.desc())
        .limit(limit)
        .all()
    )
    return {
        "symbol": symbol,
        "trades": [
            {
                "id": t.id,
                "side": t.side,
                "qty": t.qty,
                "price": t.price,
                "traded_at": t.traded_at,
                "memo": t.memo,
                "created_at": t.created_at.isoformat() if t.created_at else None,
            }
            for t in trades
        ],
    }


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
            return {
                "symbol": symbol,
                "name": stock.name,
                "sector": stock.sector,
                "avg_price": stock.avg_price or 0,
                "current_price": stock.current_price or 0,
                "profit_rate": stock.profit_rate,
                "period": period,
                "data": [],
            }

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
        return {
            "total_value": 0,
            "total_purchase": 0,
            "total_profit": 0,
            "total_profit_rate": 0,
            "stock_count": 0,
            "stocks": [],
        }

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
    """보유 종목 전체 목록 (qty > 0)"""
    stocks = db.query(Stock).filter(Stock.is_active == True, Stock.qty > 0).all()
    return [serialize_stock(s) for s in stocks]


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
    analysis_provider: Optional[str] = None  # claude | openai | gemini
    force_reanalyze: bool = False       # true면 캐시 무시하고 AI 재호출


class ReanalyzeRequest(BaseModel):
    analysis_provider: Optional[str] = None


class ExplainMoveRequest(BaseModel):
    event_date: str
    change_pct: float
    direction: str
    close_price: Optional[float] = None
    analysis_provider: Optional[str] = None
    force: bool = False                 # true면 저장된 원인 무시하고 재검색


@router.post("/intel/analyze")
def analyze_content(body: AnalyzeRequest, db: Session = Depends(get_db)):
    """콘텐츠 AI 분석 (YouTube→Gemini 추출 / 구조화→Claude·GPT·Gemini)"""
    if not body.url and not body.text:
        raise HTTPException(status_code=400, detail="url 또는 text 중 하나는 필수입니다.")

    is_youtube = body.url and ("youtube.com" in body.url or "youtu.be" in body.url)
    if is_youtube and not settings.gemini_api_key:
        raise HTTPException(status_code=400, detail="YouTube 분석에 GEMINI_API_KEY가 필요합니다.")
    try:
        ensure_analysis_available(settings, body.analysis_provider)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    cached = try_cached_intel(
        db,
        body.url,
        skip_if_cached=settings.ai_skip_if_cached,
        force_reanalyze=body.force_reanalyze,
    )
    if cached:
        content, logs = cached
        return serialize_intel(content, db, logs)

    analyzer = create_analyzer(db)
    provider = body.analysis_provider

    try:
        if body.url:
            if is_youtube:
                content = analyzer.analyze_youtube(body.url, body.channel_name or "", provider)
            else:
                content = analyzer.analyze_url(body.url, provider)
        else:
            content = analyzer.analyze_text(body.text, body.title or "", provider)
    except ProviderQuotaError as e:
        handle_provider_runtime_error(e)
    except RuntimeError as e:
        handle_provider_runtime_error(e)

    if not content:
        raise HTTPException(
            status_code=500,
            detail={"message": "AI 분석 실패. API 키와 로그를 확인하세요.", "logs": analyzer.logs},
        )

    return serialize_intel(content, db, analyzer.logs)


@router.post("/intel/analyze/stream")
async def analyze_content_stream(body: AnalyzeRequest):
    """콘텐츠 AI 분석 (SSE 실시간 로그)"""
    if not body.url and not body.text:
        raise HTTPException(status_code=400, detail="url 또는 text 중 하나는 필수입니다.")

    is_youtube = body.url and ("youtube.com" in body.url or "youtu.be" in body.url)
    if is_youtube and not settings.gemini_api_key:
        raise HTTPException(status_code=400, detail="YouTube 분석에 GEMINI_API_KEY가 필요합니다.")
    try:
        ensure_analysis_available(settings, body.analysis_provider)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return await stream_analysis(
        lambda on_log: run_intel_analysis(
            url=body.url,
            text=body.text,
            title=body.title or "",
            channel_name=body.channel_name or "",
            analysis_provider=body.analysis_provider,
            force_reanalyze=body.force_reanalyze,
            skip_if_cached=settings.ai_skip_if_cached,
            on_log=on_log,
        )
    )


@router.post("/intel/reanalyze/{content_id}")
def reanalyze_content(
    content_id: int,
    body: ReanalyzeRequest,
    db: Session = Depends(get_db),
):
    """저장된 원문으로 Gemini 재호출 없이 다른 AI로 재분석"""
    try:
        ensure_analysis_available(settings, body.analysis_provider)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    analyzer = create_analyzer(db)
    try:
        content = analyzer.reanalyze_content(content_id, body.analysis_provider)
    except ProviderQuotaError as e:
        handle_provider_runtime_error(e)
    except RuntimeError as e:
        handle_provider_runtime_error(e)

    if not content:
        raise HTTPException(
            status_code=500,
            detail={"message": "재분석 실패.", "logs": analyzer.logs},
        )
    return serialize_intel(content, db, analyzer.logs)


@router.get("/intel/providers")
def list_analysis_providers():
    """사용 가능한 분석 AI 목록"""
    return {
        "default": settings.analysis_provider,
        "ai_fallback": settings.ai_fallback,
        "ai_skip_if_cached": settings.ai_skip_if_cached,
        "enable_bulk_youtube_analyze": settings.enable_bulk_youtube_analyze,
        "providers": [
            {
                "id": "claude",
                "label": "Claude",
                "available": bool(settings.anthropic_api_key),
                "model": settings.anthropic_model,
            },
            {
                "id": "openai",
                "label": "GPT (기본)",
                "available": bool(settings.openai_api_key),
                "model": settings.openai_model,
            },
            {
                "id": "gemini",
                "label": "Gemini",
                "available": bool(settings.gemini_api_key),
                "model": settings.gemini_model,
                "extract_model": settings.gemini_extract_model,
            },
        ],
    }


@router.get("/intel/contents")
def get_intel_contents(
    limit: int = 20,
    source_type: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """분석 콘텐츠 목록 조회"""
    query = db.query(IntelContent)
    if source_type:
        query = query.filter(IntelContent.source_type == source_type)
    contents = query.order_by(IntelContent.created_at.desc()).limit(limit).all()
    return [serialize_intel(c, db) for c in contents]


@router.get("/intel/contents/{content_id}")
def get_intel_content(content_id: int, db: Session = Depends(get_db)):
    """분석 콘텐츠 상세 (추출 문서·원문 포함)"""
    c = db.query(IntelContent).filter(IntelContent.id == content_id).first()
    if not c:
        raise HTTPException(status_code=404, detail="콘텐츠 없음")
    return serialize_intel(c, db)


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
                "event_date": i.event_date,
                "match_source": i.match_source,
                "source_type": i.content.source_type if i.content else None,
                "source_url": i.content.source_url if i.content else None,
                "source_title": i.content.source_title if i.content else None,
                "published_at": (
                    i.content.published_at.isoformat()
                    if i.content and i.content.published_at
                    else None
                ),
                "created_at": i.created_at.isoformat(),
                "analyzed_at": (
                    i.content.analyzed_at.isoformat()
                    if i.content and i.content.analyzed_at
                    else None
                ),
            }
            for i in issues
        ],
    }


@router.get("/intel/stocks/{symbol}/move-causes")
def get_move_causes(
    symbol: str,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """저장된 주가 급변 AI 원인 목록"""
    stock = db.query(Stock).filter(Stock.symbol == symbol).first()
    if not stock:
        raise HTTPException(status_code=404, detail=f"종목 없음: {symbol}")

    rows = get_move_causes_for_stock(db, stock, from_date=from_date, to_date=to_date)
    return {
        "symbol": symbol,
        "name": stock.name,
        "causes": [serialize_move_cause(r) for r in rows],
    }


@router.post("/intel/stocks/{symbol}/explain-move")
def explain_move(
    symbol: str,
    body: ExplainMoveRequest,
    db: Session = Depends(get_db),
):
    """주가 급변 구간 AI 원인 검색 (동기)"""
    stock = db.query(Stock).filter(Stock.symbol == symbol).first()
    if not stock:
        raise HTTPException(status_code=404, detail=f"종목 없음: {symbol}")

    try:
        ensure_analysis_available(settings, body.analysis_provider)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    try:
        row, logs = explain_and_save(
            db,
            stock,
            event_date=body.event_date,
            change_pct=body.change_pct,
            direction=body.direction,
            close_price=body.close_price,
            analysis_provider=body.analysis_provider,
            force=body.force,
        )
    except ProviderQuotaError as e:
        handle_provider_runtime_error(e)
    except RuntimeError as e:
        handle_provider_runtime_error(e)

    if not row:
        raise HTTPException(
            status_code=500,
            detail={"message": "AI 원인 분석 실패. API 키와 로그를 확인하세요.", "logs": logs},
        )

    return {**serialize_move_cause(row), "logs": logs}


@router.post("/intel/stocks/{symbol}/explain-move/stream")
async def explain_move_stream(symbol: str, body: ExplainMoveRequest, db: Session = Depends(get_db)):
    """주가 급변 구간 AI 원인 검색 (SSE 실시간 로그)"""
    stock = db.query(Stock).filter(Stock.symbol == symbol).first()
    if not stock:
        raise HTTPException(status_code=404, detail=f"종목 없음: {symbol}")

    try:
        ensure_analysis_available(settings, body.analysis_provider)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    stock_id = stock.id

    return await stream_analysis(
        lambda on_log: run_explain_move(
            stock_id=stock_id,
            event_date=body.event_date,
            change_pct=body.change_pct,
            direction=body.direction,
            close_price=body.close_price,
            analysis_provider=body.analysis_provider,
            force=body.force,
            on_log=on_log,
        ),
        serialize_result=lambda row, logs: {**serialize_move_cause(row), "logs": logs},
    )
