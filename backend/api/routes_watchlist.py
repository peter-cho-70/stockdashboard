"""
api/routes_watchlist.py
관심 종목(지켜보기) + AI 추천 종목 API
"""
from datetime import date, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from config.database import Stock, WatchlistItem, StockIssue, get_db
from core.buy_score import calculate_buy_score
from core.recommendations import get_stock_recommendations
from core.sector_peers import normalize_sector
from core.stock_resolver import resolve_symbol
from core.watchlist_service import add_to_watchlist, ensure_stock_for_watch, serialize_watchlist_item
from core.watchlist_detail import (
    resolve_name_from_symbol,
    fetch_chart_records,
    chart_period_summary,
    price_move_highlights,
    issues_for_timeline,
    build_timeline,
)

watchlist_router = APIRouter()


class WatchlistCreate(BaseModel):
    stock_name: str
    symbol: Optional[str] = None
    sector: Optional[str] = None
    source_type: Optional[str] = "manual"
    source_id: Optional[int] = None
    memo: Optional[str] = None
    target_buy_price: Optional[float] = None


class WatchlistUpdate(BaseModel):
    memo: Optional[str] = None
    target_buy_price: Optional[float] = None
    sector: Optional[str] = None


class WatchlistBySymbol(BaseModel):
    symbol: str
    stock_name: Optional[str] = None
    target_buy_price: Optional[float] = None
    memo: Optional[str] = None


@watchlist_router.get("/watchlist/lookup-name")
def lookup_by_name(name: str = Query(..., min_length=1), db: Session = Depends(get_db)):
    """종목명 → 종목코드 조회"""
    nm = name.strip()
    sym = resolve_symbol(nm, db)
    if not sym:
        raise HTTPException(status_code=404, detail=f"종목코드를 찾을 수 없습니다: {nm}")
    official = resolve_name_from_symbol(sym) or nm
    stock = db.query(Stock).filter(Stock.symbol == sym).first()
    sector = stock.sector if stock else normalize_sector(None, sym)
    return {
        "symbol": sym,
        "stock_name": official,
        "sector": sector,
        "current_price": stock.current_price if stock else None,
    }


@watchlist_router.get("/watchlist/lookup/{symbol}")
def lookup_symbol(symbol: str, db: Session = Depends(get_db)):
    """종목코드 → 종목명 조회 (pykrx)"""
    sym = symbol.strip()
    if len(sym) != 6 or not sym.isdigit():
        raise HTTPException(status_code=400, detail="6자리 종목코드를 입력하세요.")
    name = resolve_name_from_symbol(sym)
    if not name:
        raise HTTPException(status_code=404, detail=f"종목을 찾을 수 없습니다: {sym}")
    stock = db.query(Stock).filter(Stock.symbol == sym).first()
    sector = stock.sector if stock else normalize_sector(None, sym)
    return {
        "symbol": sym,
        "stock_name": name,
        "sector": sector,
        "current_price": stock.current_price if stock else None,
    }


@watchlist_router.post("/watchlist/by-symbol")
def create_watchlist_by_symbol(body: WatchlistBySymbol, db: Session = Depends(get_db)):
    """종목코드로 관심 종목 등록"""
    sym = body.symbol.strip()
    if len(sym) != 6 or not sym.isdigit():
        raise HTTPException(status_code=400, detail="6자리 종목코드를 입력하세요.")
    name = (body.stock_name or "").strip() or resolve_name_from_symbol(sym)
    if not name:
        raise HTTPException(status_code=404, detail=f"종목명을 확인할 수 없습니다: {sym}")
    item = add_to_watchlist(
        db,
        stock_name=name,
        symbol=sym,
        sector=normalize_sector(None, sym),
        source_type="manual",
        memo=body.memo,
    )
    if body.target_buy_price is not None and body.target_buy_price > 0:
        item.target_buy_price = body.target_buy_price
        db.commit()
        db.refresh(item)
    stock = db.query(Stock).filter(Stock.symbol == sym).first()
    return serialize_watchlist_item(item, stock)


@watchlist_router.get("/intel/recommendations")
def list_recommendations(
    sector: Optional[str] = Query(None),
    days: int = Query(30, ge=7, le=180),
    limit: int = Query(50, ge=1, le=100),
    db: Session = Depends(get_db),
):
    """섹터·AI 분석에서 언급된 추천 종목 (집계)"""
    items = get_stock_recommendations(db, sector=sector, days=days, limit=limit)
    return {"days": days, "sector": sector, "total": len(items), "recommendations": items}


@watchlist_router.get("/watchlist")
def get_watchlist(db: Session = Depends(get_db)):
    """관심 종목 목록"""
    items = db.query(WatchlistItem).order_by(WatchlistItem.created_at.desc()).all()
    result = []
    for item in items:
        stock = None
        if item.symbol:
            stock = db.query(Stock).filter(Stock.symbol == item.symbol).first()
        result.append(serialize_watchlist_item(item, stock))
    return {"total": len(result), "items": result}


@watchlist_router.post("/watchlist")
def create_watchlist_item(body: WatchlistCreate, db: Session = Depends(get_db)):
    """관심 종목 추가"""
    if not body.stock_name.strip():
        raise HTTPException(status_code=400, detail="stock_name 필요")
    item = add_to_watchlist(
        db,
        stock_name=body.stock_name.strip(),
        symbol=body.symbol,
        sector=body.sector,
        source_type=body.source_type,
        source_id=body.source_id,
        memo=body.memo,
    )
    if body.target_buy_price is not None and body.target_buy_price > 0:
        item.target_buy_price = body.target_buy_price
        db.commit()
        db.refresh(item)
    stock = db.query(Stock).filter(Stock.symbol == item.symbol).first() if item.symbol else None
    return serialize_watchlist_item(item, stock)


@watchlist_router.patch("/watchlist/{item_id}")
def update_watchlist_item(item_id: int, body: WatchlistUpdate, db: Session = Depends(get_db)):
    """관심 종목 수정 (매수 희망가·메모)"""
    item = db.query(WatchlistItem).filter(WatchlistItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="항목 없음")
    if body.memo is not None:
        item.memo = body.memo.strip() or None
    if body.target_buy_price is not None:
        item.target_buy_price = body.target_buy_price if body.target_buy_price > 0 else None
    if body.sector is not None:
        item.sector = body.sector.strip() or None
    if item.symbol or item.stock_name:
        ensure_stock_for_watch(
            db,
            stock_name=item.stock_name,
            symbol=item.symbol,
            sector=item.sector,
        )
    db.commit()
    db.refresh(item)
    stock = db.query(Stock).filter(Stock.symbol == item.symbol).first() if item.symbol else None
    return serialize_watchlist_item(item, stock)


@watchlist_router.get("/watchlist/{item_id}/detail")
def watchlist_detail(
    item_id: int,
    days: int = Query(90, ge=30, le=365),
    db: Session = Depends(get_db),
):
    """관심 종목 상세 — 3개월 소개·주요 사항"""
    item = db.query(WatchlistItem).filter(WatchlistItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="항목 없음")
    if not item.symbol:
        raise HTTPException(status_code=400, detail="종목코드가 없습니다. 종목코드로 다시 등록해 주세요.")

    stock = db.query(Stock).filter(Stock.symbol == item.symbol).first()
    if not stock:
        stock = ensure_stock_for_watch(
            db, stock_name=item.stock_name, symbol=item.symbol, sector=item.sector
        )
        db.commit()
    if not stock:
        raise HTTPException(status_code=404, detail="종목 정보 없음")

    since = (date.today() - timedelta(days=days)).strftime("%Y-%m-%d")
    records = fetch_chart_records(item.symbol, period_days=days)
    summary = chart_period_summary(records)
    if records and summary["end_close"]:
        stock.current_price = summary["end_close"]
        if summary["start_close"] > 0:
            stock.change_rate = round(
                (summary["end_close"] - records[-2]["close"]) / records[-2]["close"] * 100, 2
            ) if len(records) >= 2 else 0

    issue_rows = issues_for_timeline(db, stock, since, limit=20)
    price_moves = price_move_highlights(records, threshold=5.0)
    timeline = build_timeline(issue_rows, price_moves, limit=25)
    buy_score = calculate_buy_score(db, stock, days=min(days, 90))

    intro_parts = [
        f"{stock.name}({item.symbol})",
        f"최근 {days}일 수익률 {summary['period_return_pct']:+.2f}%",
        f"구간 고가 {summary['high']:,.0f}원 · 저가 {summary['low']:,.0f}원",
    ]
    if stock.sector or item.sector:
        intro_parts.insert(1, f"섹터 {stock.sector or item.sector}")
    if item.target_buy_price:
        intro_parts.append(f"매수 희망가 {item.target_buy_price:,.0f}원")

    return {
        "item": serialize_watchlist_item(item, stock),
        "profile": {
            "symbol": item.symbol,
            "name": stock.name,
            "sector": stock.sector or item.sector,
            "market": stock.market,
            "intro": " · ".join(intro_parts),
        },
        "chart_summary": summary,
        "buy_score": buy_score,
        "timeline": timeline,
        "days": days,
    }


@watchlist_router.get("/watchlist/{item_id}/insight")
def watchlist_insight(item_id: int, days: int = Query(30, ge=7, le=90), db: Session = Depends(get_db)):
    """관심 종목 AI·이슈 요약 (차트/매수 판단 보조)"""
    item = db.query(WatchlistItem).filter(WatchlistItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="항목 없음")
    if not item.symbol:
        raise HTTPException(status_code=400, detail="종목코드가 없어 AI 요약을 불러올 수 없습니다.")

    stock = db.query(Stock).filter(Stock.symbol == item.symbol).first()
    if not stock:
        stock = ensure_stock_for_watch(
            db, stock_name=item.stock_name, symbol=item.symbol, sector=item.sector
        )
        db.commit()
    if not stock:
        raise HTTPException(status_code=404, detail="종목 정보 없음")

    issues = (
        db.query(StockIssue)
        .filter(StockIssue.stock_id == stock.id)
        .order_by(StockIssue.created_at.desc())
        .limit(5)
        .all()
    )
    buy_score = calculate_buy_score(db, stock, days=days)

    ai_lines: list[str] = []
    if item.target_buy_price and stock.current_price:
        gap = stock.current_price - item.target_buy_price
        if stock.current_price <= item.target_buy_price:
            ai_lines.append(
                f"현재가 {stock.current_price:,.0f}원이 매수 희망가 {item.target_buy_price:,.0f}원 이하입니다."
            )
        else:
            ai_lines.append(
                f"매수 희망가까지 약 {gap:,.0f}원({(gap / item.target_buy_price * 100):.1f}%) 남았습니다."
            )
    ai_lines.append(f"매수 타이밍 점수 {buy_score['score']}점 ({buy_score['grade_label']}).")
    for w in buy_score.get("warnings", [])[:2]:
        ai_lines.append(w)
    if buy_score.get("recent_issues"):
        ri = buy_score["recent_issues"][0]
        ai_lines.append(f"최근 이슈: {ri.get('summary', '')[:120]}")

    return {
        "item": serialize_watchlist_item(item, stock),
        "buy_score": buy_score,
        "issues": [
            {
                "id": i.id,
                "issue_summary": i.issue_summary,
                "sentiment": i.sentiment,
                "event_date": i.event_date,
                "source_title": i.content.source_title if i.content else None,
                "source_url": i.content.source_url if i.content else None,
                "created_at": i.created_at.isoformat() if i.created_at else None,
            }
            for i in issues
        ],
        "ai_summary": " ".join(ai_lines),
    }


@watchlist_router.delete("/watchlist/{item_id}")
def delete_watchlist_item(item_id: int, db: Session = Depends(get_db)):
    """관심 종목 삭제"""
    item = db.query(WatchlistItem).filter(WatchlistItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="항목 없음")
    db.delete(item)
    db.commit()
    return {"ok": True, "id": item_id}
