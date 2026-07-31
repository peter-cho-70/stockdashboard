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
from datetime import datetime, date, timedelta

from config.database import (
    get_db, Stock, AlertHistory, IntelContent, StockIssue, PortfolioSnapshot,
    RealizedGain, PortfolioTrade, ChartDateMemo, TradeWhatIf,
)
from core.trade_what_if import create_what_if, evaluate_what_if, list_recent_trades, resolve_price
from core.datetime_kst import format_kst_label, format_utc_iso
from core.portfolio_positions import (
    serialize_stock,
    get_stock_by_symbol,
    apply_position,
    execute_trade,
    apply_mixed_trade,
    record_trade,
    list_all_trades,
    mark_manual,
    target_price_flags,
)
from config.settings import get_settings
from core.portfolio import PortfolioManager, create_quote_client_from_settings, sync_trade_history
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
from core.watchlist_service import ensure_stock_for_chart
from core.price_updater import update_prices_from_krx, save_daily_snapshot
from core.demo_mode import (
    is_demo_mode,
    demo_write_blocked,
    build_demo_summary,
    build_demo_stocks,
    build_demo_history,
    demo_info,
    get_demo_mode_status,
    set_demo_mode_db,
    verify_demo_pin,
    ensure_demo_anchor_stocks,
    load_demo_config,
)

settings = get_settings()
router = APIRouter()


# ─────────────────────────────────────────────
# 헬스 체크
# ─────────────────────────────────────────────
@router.get("/health")
def health_check():
    return {
        "status": "ok",
        "service": "StockMind API",
        "demo_mode": is_demo_mode(),
    }


@router.get("/demo/info")
def get_demo_info(db: Session = Depends(get_db)):
    if not is_demo_mode(db):
        return {"demo_mode": False}
    return demo_info()


class DemoModeUpdate(BaseModel):
    enabled: bool
    pin: str


@router.get("/settings/demo-mode")
def get_demo_mode_setting(db: Session = Depends(get_db)):
    """데모 모드 상태 (PIN 불필요)."""
    return get_demo_mode_status(db)


@router.patch("/settings/demo-mode")
def update_demo_mode_setting(body: DemoModeUpdate, db: Session = Depends(get_db)):
    """PIN 확인 후 데모 모드 전환 (재시작 불필요)."""
    verify_demo_pin(body.pin)
    set_demo_mode_db(db, body.enabled)
    if body.enabled:
        load_demo_config(force_reload=True)
        ensure_demo_anchor_stocks(db)
    status = get_demo_mode_status(db)
    return {
        **status,
        "message": "데모 모드가 적용되었습니다. 페이지를 새로고침하세요.",
    }


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
    demo_write_blocked()
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
    demo_write_blocked()
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
    demo_write_blocked()
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
    target_buy_price: Optional[float] = None
    target_sell_price: Optional[float] = None


@router.patch("/portfolio/stocks/{symbol}")
def update_stock_position(symbol: str, body: PositionUpdate, db: Session = Depends(get_db)):
    """잔고 수동 수정 (수량·평단·매수/매도 희망가 등)"""
    demo_write_blocked()
    stock = get_stock_by_symbol(db, symbol)
    if not stock:
        raise HTTPException(status_code=404, detail=f"종목 없음: {symbol}")

    if body.name is not None:
        stock.name = body.name.strip()
    if body.sector is not None:
        stock.sector = body.sector or None
    if body.current_price is not None:
        stock.current_price = body.current_price
    if body.target_buy_price is not None:
        stock.target_buy_price = body.target_buy_price if body.target_buy_price > 0 else None
        stock.target_buy_alerted = False
    if body.target_sell_price is not None:
        stock.target_sell_price = body.target_sell_price if body.target_sell_price > 0 else None
        stock.target_sell_alerted = False

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
    demo_write_blocked()
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


class MixedTradeCreate(BaseModel):
    sell_qty: float = 0
    sell_price: float = 0
    buy_qty: float = 0
    buy_price: float = 0
    traded_at: Optional[str] = None
    memo: Optional[str] = None


@router.post("/portfolio/stocks/{symbol}/trades/mixed")
def create_mixed_trade(symbol: str, body: MixedTradeCreate, db: Session = Depends(get_db)):
    """불타기·물타기 등 매도+매수 혼합 체결을 한 번에 반영"""
    demo_write_blocked()
    stock = get_stock_by_symbol(db, symbol)
    if not stock:
        raise HTTPException(status_code=404, detail=f"종목 없음: {symbol}")

    sell_avg_price_before = stock.avg_price if body.sell_qty > 0 else None
    try:
        realized_pnl = apply_mixed_trade(
            stock,
            sell_qty=body.sell_qty,
            sell_price=body.sell_price,
            buy_qty=body.buy_qty,
            buy_price=body.buy_price,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    trades = []
    if body.sell_qty > 0:
        trades.append(
            record_trade(
                db,
                stock,
                side="SELL",
                qty=body.sell_qty,
                price=body.sell_price,
                traded_at=body.traded_at,
                memo=body.memo,
                avg_price_before=sell_avg_price_before,
            )
        )
    if body.buy_qty > 0:
        trades.append(
            record_trade(db, stock, side="BUY", qty=body.buy_qty, price=body.buy_price, traded_at=body.traded_at, memo=body.memo)
        )

    db.commit()
    db.refresh(stock)
    for t in trades:
        db.refresh(t)

    return {
        "message": "혼합 매매 반영 완료",
        "stock": serialize_stock(stock),
        "realized_pnl": realized_pnl,
        "trades": [
            {
                "id": t.id,
                "side": t.side,
                "qty": t.qty,
                "price": t.price,
                "traded_at": t.traded_at,
                "memo": t.memo,
            }
            for t in trades
        ],
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
# 매도 후 기회비용 분석 (가상 매도/교체매수, 또는 실제 체결 내역 선택)
# ─────────────────────────────────────────────
class TradeWhatIfCreate(BaseModel):
    kind: str = "sell_opportunity"
    sell_symbol: Optional[str] = None
    sell_qty: Optional[float] = None
    sell_price: Optional[float] = None
    sell_date: Optional[str] = None
    sell_trade_id: Optional[int] = None
    sell_trade_ids: Optional[list[int]] = None
    buy_symbol: Optional[str] = None
    buy_qty: Optional[float] = None
    buy_price: Optional[float] = None
    buy_date: Optional[str] = None
    buy_trade_id: Optional[int] = None
    memo: Optional[str] = None


@router.get("/portfolio/trade-what-ifs/recent-trades")
def get_recent_trades_for_what_if(
    side: str = "SELL",
    limit: int = 500,
    symbol: Optional[str] = None,
    start: Optional[str] = None,
    end: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """선택 UI용 — 실제 매도/매수 내역 목록 (전 종목 또는 종목·기간 필터)"""
    if side.upper() not in ("SELL", "BUY"):
        raise HTTPException(status_code=400, detail="side는 SELL 또는 BUY 여야 합니다.")
    return {
        "trades": list_recent_trades(
            db, side, limit=min(limit, 2000), symbol=symbol, start=start, end=end,
        ),
    }


@router.post("/portfolio/trade-what-ifs")
def create_trade_what_if(body: TradeWhatIfCreate, db: Session = Depends(get_db)):
    """가상 매도(+교체매수) 기록 생성, 또는 실제 체결 내역을 선택해 분석 기록 생성"""
    demo_write_blocked()
    try:
        wif = create_what_if(db, **body.model_dump())
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"message": "기록 저장 완료", "trade": evaluate_what_if(wif)}


@router.get("/portfolio/trade-what-ifs")
def list_trade_what_ifs(as_of: Optional[str] = None, db: Session = Depends(get_db)):
    """저장된 분석 기록 목록 (as_of 지정 시 그 날짜 종가 기준, 미지정 시 현재가 기준)"""
    rows = db.query(TradeWhatIf).order_by(TradeWhatIf.created_at.desc()).all()
    results = []
    for wif in rows:
        try:
            results.append(evaluate_what_if(wif, as_of))
        except ValueError as e:
            results.append({"id": wif.id, "error": str(e)})
    return {"trades": results}


@router.delete("/portfolio/trade-what-ifs/{what_if_id}")
def delete_trade_what_if(what_if_id: int, db: Session = Depends(get_db)):
    demo_write_blocked()
    wif = db.query(TradeWhatIf).filter(TradeWhatIf.id == what_if_id).first()
    if not wif:
        raise HTTPException(status_code=404, detail="기록을 찾을 수 없습니다.")
    db.delete(wif)
    db.commit()
    return {"message": "삭제 완료"}


@router.get("/portfolio/stocks/{symbol}/price-on-date")
def get_price_on_date(symbol: str, date: Optional[str] = None, db: Session = Depends(get_db)):
    """특정 날짜(YYYY-MM-DD) 종가 조회 (미지정 시 현재가) — 매수 시나리오 계산기용"""
    try:
        price = resolve_price(symbol, date)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"symbol": symbol, "date": date, "price": price}


# ─────────────────────────────────────────────
# 주가 차트 데이터 (pykrx — 최대 1년 OHLCV)
# ─────────────────────────────────────────────
@router.post("/portfolio/stocks/{symbol}/ensure")
def ensure_stock_preview(symbol: str, db: Session = Depends(get_db)):
    """차트 조회용 임시 종목 등록 (qty=0, 보유 목록 미포함)"""
    try:
        stock, created = ensure_stock_for_chart(db, symbol)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    msg = "조회용 종목이 등록되었습니다." if created else "종목 정보를 갱신했습니다."
    return {
        "message": msg,
        "created": created,
        "stock": serialize_stock(stock),
    }


@router.get("/portfolio/stocks/{symbol}/related-sector")
def get_related_sector_stocks(symbol: str, limit: int = 12, db: Session = Depends(get_db)):
    """같은 섹터의 다른 보유·관심 종목 묶어보기 (1단계: 섹터 기반 자동 매칭)"""
    stock = get_stock_by_symbol(db, symbol)
    if not stock:
        raise HTTPException(status_code=404, detail=f"종목 없음: {symbol}")
    from core.sector_peers import find_sector_peers

    return find_sector_peers(db, stock, limit=limit)


@router.get("/portfolio/stocks/{symbol}/chart")
def get_stock_chart(
    symbol: str,
    period: str = "3M",   # 1M / 3M / 6M / 1Y
    end_date: Optional[str] = None,  # YYYY-MM-DD — 과거 특정 시점 기준 조회 (예: 매매일 전후 흐름)
    db: Session = Depends(get_db)
):
    """
    종목 OHLCV 차트 데이터 (pykrx)
    period: 1M=1개월, 3M=3개월, 6M=6개월, 1Y=1년
    end_date: 지정하면 오늘이 아니라 그 날짜를 기준으로 과거 period만큼 조회 (매매습관의 "그날 흐름" 용)
    """
    from datetime import date, timedelta, datetime as _datetime
    from pykrx import stock as krx
    import time as _time

    stock = db.query(Stock).filter(Stock.symbol == symbol).first()
    if not stock:
        try:
            stock, _ = ensure_stock_for_chart(db, symbol)
        except ValueError as e:
            raise HTTPException(status_code=404, detail=str(e)) from e

    period_days = {"1M": 30, "3M": 90, "6M": 180, "1Y": 365}.get(period, 90)
    if end_date:
        try:
            end = _datetime.strptime(end_date, "%Y-%m-%d").date()
        except ValueError:
            raise HTTPException(status_code=400, detail="end_date는 YYYY-MM-DD 형식이어야 합니다")
        end = min(end, date.today())
    else:
        end = date.today()
    start_date = end - timedelta(days=period_days)

    try:
        df = krx.get_market_ohlcv_by_date(
            start_date.strftime("%Y%m%d"),
            end.strftime("%Y%m%d"),
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

            prev_close = closes_list[i - 1] if i > 0 else None
            change_rate = ((close_price - prev_close) / prev_close * 100) if prev_close else 0.0

            records.append({
                "date":   date_str,
                "open":   gcol(["시가", "open"]),
                "high":   gcol(["고가", "high"]),
                "low":    gcol(["저가", "low"]),
                "close":  close_price,
                "change_rate": round(change_rate, 2),
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


class ChartDateMemoBody(BaseModel):
    event_date: str
    body: str


class ChartDateMemoUpdate(BaseModel):
    body: str


def _memo_dict(m: ChartDateMemo) -> dict:
    return {
        "id": m.id,
        "symbol": m.symbol,
        "event_date": m.event_date,
        "body": m.body,
        "created_at": m.created_at.isoformat() if m.created_at else None,
        "updated_at": m.updated_at.isoformat() if m.updated_at else None,
    }


@router.get("/portfolio/stocks/{symbol}/chart-memos")
def list_chart_memos(symbol: str, db: Session = Depends(get_db)):
    """종목 차트 날짜 메모 목록"""
    stock = get_stock_by_symbol(db, symbol)
    if not stock:
        raise HTTPException(status_code=404, detail=f"종목 없음: {symbol}")
    memos = (
        db.query(ChartDateMemo)
        .filter(ChartDateMemo.symbol == symbol)
        .order_by(ChartDateMemo.event_date.desc())
        .all()
    )
    return [_memo_dict(m) for m in memos]


@router.post("/portfolio/stocks/{symbol}/chart-memos")
def create_chart_memo(symbol: str, body: ChartDateMemoBody, db: Session = Depends(get_db)):
    """차트 날짜 메모 추가 (같은 날짜는 덮어쓰기)"""
    stock = get_stock_by_symbol(db, symbol)
    if not stock:
        raise HTTPException(status_code=404, detail=f"종목 없음: {symbol}")
    text = (body.body or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="메모 내용을 입력해 주세요.")
    event_date = body.event_date.strip()
    if len(event_date) != 10:
        raise HTTPException(status_code=400, detail="날짜는 YYYY-MM-DD 형식이어야 합니다.")

    existing = (
        db.query(ChartDateMemo)
        .filter(ChartDateMemo.symbol == symbol, ChartDateMemo.event_date == event_date)
        .first()
    )
    if existing:
        existing.body = text
        existing.updated_at = datetime.utcnow()
        db.commit()
        db.refresh(existing)
        return {"message": "메모 수정됨", "memo": _memo_dict(existing)}

    memo = ChartDateMemo(symbol=symbol, event_date=event_date, body=text)
    db.add(memo)
    db.commit()
    db.refresh(memo)
    return {"message": "메모 추가됨", "memo": _memo_dict(memo)}


@router.delete("/portfolio/chart-memos/{memo_id}")
def delete_chart_memo(memo_id: int, db: Session = Depends(get_db)):
    memo = db.query(ChartDateMemo).filter(ChartDateMemo.id == memo_id).first()
    if not memo:
        raise HTTPException(status_code=404, detail="메모 없음")
    db.delete(memo)
    db.commit()
    return {"message": "삭제 완료"}


# ─────────────────────────────────────────────
# KRX 시세 갱신 (pykrx — KIS API 불필요)
# ─────────────────────────────────────────────
@router.post("/portfolio/refresh-prices")
def refresh_prices_krx(db: Session = Depends(get_db)):
    """pykrx로 국내 종목 현재가 갱신 (KIS API 없이 사용 가능)"""
    if is_demo_mode():
        from core.demo_mode import demo_symbol_set

        symbols = demo_symbol_set()
        updated = 0
        for sym in symbols:
            stock = db.query(Stock).filter(Stock.symbol == sym).first()
            if not stock:
                continue
            try:
                from pykrx import stock as krx
                from datetime import date as _date

                today = _date.today().strftime("%Y%m%d")
                df = krx.get_market_ohlcv_by_date(today, today, sym)
                if df is not None and not df.empty:
                    stock.current_price = float(df.iloc[-1]["종가"])
                    updated += 1
            except Exception:
                pass
        db.commit()
        return {
            "message": f"데모 종목 시세 갱신: {updated}개",
            "updated": updated,
            "alerts": [],
        }
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


@router.post("/portfolio/price-history/catchup")
def catchup_price_history_endpoint(db: Session = Depends(get_db)):
    """마지막으로 저장된 이후 비어있는 날짜의 국내 종목 시세 이력 + 포트폴리오
    스냅샷(총 평가금액·손익·수익률)을 복원. 컴퓨터를 꺼둬서 장마감 스케줄러가 못
    돈 날짜의 실제 등락률·수익을 다시 확인할 수 있게 한다 (앱 시작 시 자동으로도
    실행되지만, 필요할 때 수동으로도 재실행 가능). 수동 호출이므로 자동 실행
    쿨다운(`CATCHUP_COOLDOWN_MINUTES`)과 무관하게 항상 실행(`force=True`)."""
    from core.price_updater import catchup_portfolio_snapshots, catchup_price_history

    try:
        price_result = catchup_price_history(db, force=True)
        snap_result = catchup_portfolio_snapshots(db)

        parts = []
        if price_result.get("days_filled"):
            parts.append(f"시세 {price_result['stocks_filled']}개 종목 {price_result['days_filled']}일치")
        if snap_result.get("days_filled"):
            parts.append(f"수익 이력 {snap_result['days_filled']}일치")
        message = f"{' + '.join(parts)} 복원 완료" if parts else "복원할 누락 날짜가 없습니다 (이미 최신 상태)"

        return {
            "message": message,
            **price_result,
            "snapshot_days_filled": snap_result.get("days_filled", 0),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ─────────────────────────────────────────────
# 포트폴리오 이력 (수익률 차트용)
# ─────────────────────────────────────────────
@router.get("/portfolio/history")
def get_portfolio_history(days: int = 30, db: Session = Depends(get_db)):
    """일별 포트폴리오 수익률 이력 (차트용, 최대 400일)"""
    days = max(1, min(days, 400))
    if is_demo_mode():
        summary = build_demo_summary(db)
        return build_demo_history(days, summary)
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
    if is_demo_mode():
        return build_demo_summary(db)
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
                **target_price_flags(s),
            }
            for s in sorted(stocks, key=lambda x: x.change_rate, reverse=True)
        ],
    }


@router.get("/portfolio/stocks")
def get_stocks(db: Session = Depends(get_db)):
    """보유 종목 전체 목록 (qty > 0)"""
    if is_demo_mode():
        return build_demo_stocks(db)
    stocks = db.query(Stock).filter(Stock.is_active == True, Stock.qty > 0).all()
    return [serialize_stock(s) for s in stocks]


@router.post("/portfolio/sync")
async def sync_portfolio(background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    """KIS/키움 잔고 동기화 (백그라운드 실행)"""
    demo_write_blocked()
    def run_sync():
        try:
            manager = PortfolioManager(db, create_quote_client_from_settings())
            result = manager.sync_all(alert_threshold=settings.alert_threshold)
            return result
        except Exception as e:
            return {"error": str(e)}

    background_tasks.add_task(run_sync)
    return {"message": "동기화 시작됨. /portfolio/summary 로 결과 확인하세요."}


@router.post("/portfolio/sync/now")
def sync_portfolio_now(db: Session = Depends(get_db)):
    """KIS/키움 잔고 동기화 (즉시 실행, 결과 반환)"""
    demo_write_blocked()
    try:
        manager = PortfolioManager(db, create_quote_client_from_settings())
        result = manager.sync_all(alert_threshold=settings.alert_threshold)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/portfolio/sync/trades")
def sync_portfolio_trade_history(
    days: int = 90,
    start: Optional[str] = None,
    end: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """KIS API 일별 체결내역 동기화 + 잔고 자동 갱신.
    start/end(YYYY-MM-DD)를 지정하면 해당 기간을, 없으면 days(기본 90일)를 사용한다."""
    demo_write_blocked()
    try:
        end_date = datetime.strptime(end, "%Y-%m-%d").date() if end else date.today()
        start_date = datetime.strptime(start, "%Y-%m-%d").date() if start else end_date - timedelta(days=days)
        result = sync_trade_history(db, start_date, end_date)

        # 신규 체결이 있으면 잔고도 즉시 갱신 — 오늘 신규 매수한 종목이 종목현황에 바로 나타나도록
        balance_result = None
        if result.get("added", 0) > 0:
            try:
                manager = PortfolioManager(db, create_quote_client_from_settings())
                balance_result = manager.sync_balance()
            except Exception as be:
                balance_result = {"error": str(be)}

        updated_part = f", 수정 {result['updated']}건" if result.get("updated") else ""
        return {
            "message": (
                f"체결내역 동기화 완료 ({start_date}~{end_date}, "
                f"신규 {result['added']}건{updated_part}, 기존 {result['skipped']}건)"
                + (f" · 잔고 갱신: 추가 {balance_result['added']}건, 수정 {balance_result['updated']}건"
                   if balance_result and "added" in balance_result else "")
            ),
            "start": start_date.isoformat(),
            "end": end_date.isoformat(),
            "balance_sync": balance_result,
            **result,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/portfolio/trades")
def get_all_trades(
    side: Optional[str] = None,
    symbol: Optional[str] = None,
    source: Optional[str] = None,
    start: Optional[str] = None,
    end: Optional[str] = None,
    limit: int = 500,
    offset: int = 0,
    db: Session = Depends(get_db),
):
    """전 종목 매매내역 (체결내역 페이지) — 날짜·종목·매수/매도·출처 필터"""
    items, total = list_all_trades(
        db, side=side, symbol=symbol, source=source, start=start, end=end,
        limit=limit, offset=offset,
    )
    return {"trades": items, "total": total}


# ─────────────────────────────────────────────
# 종목 메모 수정
# ─────────────────────────────────────────────
class MemoUpdate(BaseModel):
    memo: str
    sector: Optional[str] = None


@router.patch("/portfolio/stocks/{symbol}/memo")
def update_stock_memo(symbol: str, body: MemoUpdate, db: Session = Depends(get_db)):
    """종목 메모 및 섹터 업데이트"""
    demo_write_blocked()
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
            "created_at": format_utc_iso(a.created_at),
            "created_at_kst": format_kst_label(a.created_at),
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
    market_impact: bool = False         # True=주가 반영, False=지식(기본)
    detailed_extract: bool = False      # YouTube: 약 3배 상세 추출
    domain_id: Optional[int] = None     # 지식 분석 시 분야 ID


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
    if not body.market_impact and not settings.gemini_api_key:
        raise HTTPException(status_code=400, detail="지식 분석(요약 추출)에 GEMINI_API_KEY가 필요합니다.")
    if body.market_impact:
        try:
            ensure_analysis_available(settings, body.analysis_provider)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))

    cached = try_cached_intel(
        db,
        body.url,
        skip_if_cached=settings.ai_skip_if_cached,
        force_reanalyze=body.force_reanalyze or (body.detailed_extract and bool(is_youtube)),
    )
    if cached:
        content, logs = cached
        return serialize_intel(content, db, logs)

    analyzer = create_analyzer(db)
    provider = body.analysis_provider

    try:
        if body.url:
            if is_youtube:
                content = analyzer.analyze_youtube(
                    body.url,
                    body.channel_name or "",
                    provider,
                    market_impact=body.market_impact,
                    detailed_extract=body.detailed_extract,
                    domain_id=body.domain_id if not body.market_impact else None,
                )
            else:
                content = analyzer.analyze_url(
                    body.url,
                    provider,
                    market_impact=body.market_impact,
                    domain_id=body.domain_id if not body.market_impact else None,
                )
        else:
            content = analyzer.analyze_text(
                body.text,
                body.title or "",
                provider,
                market_impact=body.market_impact,
                domain_id=body.domain_id if not body.market_impact else None,
            )
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
    if not body.market_impact and not settings.gemini_api_key:
        raise HTTPException(status_code=400, detail="지식 분석(요약 추출)에 GEMINI_API_KEY가 필요합니다.")
    if body.market_impact:
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
            market_impact=body.market_impact,
            detailed_extract=body.detailed_extract,
            domain_id=body.domain_id if not body.market_impact else None,
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
    limit: int = 500,
    source_type: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """분석 콘텐츠 목록 조회 (analyzed_at 기준 최신순)"""
    query = db.query(IntelContent)
    if source_type:
        query = query.filter(IntelContent.source_type == source_type)
    contents = query.order_by(IntelContent.analyzed_at.desc()).limit(limit).all()
    return [serialize_intel(c, db) for c in contents]


@router.get("/intel/contents/{content_id}")
def get_intel_content(content_id: int, db: Session = Depends(get_db)):
    """분석 콘텐츠 상세 (추출 문서·원문 포함)"""
    c = db.query(IntelContent).filter(IntelContent.id == content_id).first()
    if not c:
        raise HTTPException(status_code=404, detail="콘텐츠 없음")
    return serialize_intel(c, db)


class IntelContentScopeBody(BaseModel):
    scope: str  # knowledge | market


class HighlightSnippetBody(BaseModel):
    id: str
    field: str = "summary"
    text: str
    note: Optional[str] = ""
    color: Optional[str] = "amber"
    created_at: Optional[str] = None


class UserHighlightsBody(BaseModel):
    pinned_key_point_indexes: List[int] = []
    pin_colors: dict[str, str] = {}
    user_key_points: List[str] = []
    snippets: List[HighlightSnippetBody] = []


@router.get("/intel/contents/{content_id}/highlights")
def get_intel_highlights(content_id: int, db: Session = Depends(get_db)):
    """사용자 강조(핀·스니펫·직접 포인트) 조회."""
    from core.intel_highlights import parse_user_highlights

    c = db.query(IntelContent).filter(IntelContent.id == content_id).first()
    if not c:
        raise HTTPException(status_code=404, detail="콘텐츠 없음")
    return parse_user_highlights(getattr(c, "user_highlights", None))


@router.patch("/intel/contents/{content_id}/highlights")
def patch_intel_highlights(
    content_id: int,
    body: UserHighlightsBody,
    db: Session = Depends(get_db),
):
    """사용자 강조 저장."""
    from core.intel_highlights import save_user_highlights

    try:
        data = save_user_highlights(
            db,
            content_id,
            body.model_dump(mode="json"),
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"강조 저장 실패: {str(e)[:200]}") from e
    return {"ok": True, "user_highlights": data}


@router.patch("/intel/contents/{content_id}/scope")
def patch_intel_content_scope(
    content_id: int,
    body: IntelContentScopeBody,
    db: Session = Depends(get_db),
):
    """지식 ↔ 주가 반영 전환. knowledge 시 Signal·이슈 삭제."""
    from core.content_scope import SCOPE_KNOWLEDGE, SCOPE_MARKET, set_content_scope

    scope = (body.scope or "").strip().lower()
    if scope not in (SCOPE_KNOWLEDGE, SCOPE_MARKET):
        raise HTTPException(status_code=400, detail="scope는 knowledge 또는 market")
    try:
        content = set_content_scope(db, content_id, scope)  # type: ignore[arg-type]
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    return {"ok": True, "content": serialize_intel(content, db)}


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
