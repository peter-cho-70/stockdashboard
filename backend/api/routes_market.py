"""
목표가·미국 증시 리포트 API
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from config.database import get_db
from core.price_targets import (
    add_manual_target,
    delete_price_target,
    fetch_price_targets_with_ai,
    get_target_setting,
    list_price_targets,
    save_target_setting,
)
from core.trade_report import (
    generate_trade_report,
    get_report as get_trade_report,
    list_reports as list_trade_reports,
)
from core.us_market_report import (
    SECTOR_LABELS,
    add_tracked_us_stock,
    fetch_live_snapshot,
    generate_us_morning_report,
    get_report,
    list_reports,
    list_tracked_us_stocks,
    refresh_us_report_news,
    remove_tracked_us_stock,
    update_tracked_us_stock,
)
from core.kr_market_snapshot import fetch_kr_market_snapshot, fetch_kr_group_stocks
from core.kis_invest_info import fetch_kis_invest_info, sync_kis_price_targets
from core.stock_basics import fetch_stock_basics
from core.holdings_analysis import build_holdings_analysis
from core.portfolio_positions import serialize_stock
from core.watchlist_service import ensure_stock_for_chart

market_router = APIRouter(tags=["market"])


class ManualTargetBody(BaseModel):
    source: str = Field(..., min_length=1, max_length=100)
    target_price: float = Field(..., gt=0)
    analyst: Optional[str] = None
    rating: Optional[str] = None
    report_date: Optional[str] = None
    is_consensus: bool = False


# ── 목표가 ────────────────────────────────────────────────────────

@market_router.get("/stocks/{symbol}/price-targets")
def api_list_price_targets(symbol: str, db: Session = Depends(get_db)):
    return {"symbol": symbol, "targets": list_price_targets(db, symbol)}


@market_router.post("/stocks/{symbol}/price-targets/fetch")
def api_fetch_price_targets(symbol: str, db: Session = Depends(get_db)):
    try:
        return fetch_price_targets_with_ai(db, symbol.strip())
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@market_router.post("/stocks/{symbol}/price-targets")
def api_add_price_target(symbol: str, body: ManualTargetBody, db: Session = Depends(get_db)):
    row = add_manual_target(
        db,
        symbol.strip(),
        source=body.source,
        target_price=body.target_price,
        analyst=body.analyst,
        rating=body.rating,
        report_date=body.report_date,
        is_consensus=body.is_consensus,
    )
    return row


@market_router.delete("/stocks/{symbol}/price-targets/{target_id}")
def api_delete_price_target(symbol: str, target_id: int, db: Session = Depends(get_db)):
    if not delete_price_target(db, symbol.strip(), target_id):
        raise HTTPException(status_code=404, detail="목표가 없음")
    return {"ok": True}


class TargetSettingBody(BaseModel):
    avg_window_days: Optional[int] = None
    weight_pct: Optional[float] = None
    custom_profit_pct: Optional[float] = None


@market_router.get("/stocks/{symbol}/target-setting")
def api_get_target_setting(symbol: str, db: Session = Depends(get_db)):
    return get_target_setting(db, symbol.strip())


@market_router.put("/stocks/{symbol}/target-setting")
def api_save_target_setting(symbol: str, body: TargetSettingBody, db: Session = Depends(get_db)):
    return save_target_setting(db, symbol.strip(), body.model_dump(exclude_none=True))


@market_router.get("/stocks/{symbol}/kis-invest-info")
def api_kis_invest_info(symbol: str, force: bool = Query(False)):
    try:
        return fetch_kis_invest_info(symbol.strip(), force=force)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"KIS 투자정보 조회 실패: {e}") from e


@market_router.post("/stocks/{symbol}/price-targets/fetch-kis")
def api_fetch_kis_price_targets(symbol: str, db: Session = Depends(get_db)):
    try:
        return sync_kis_price_targets(db, symbol.strip())
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"KIS 목표가 조회 실패: {e}") from e


@market_router.get("/stocks/{symbol}/basics")
def api_stock_basics(symbol: str):
    try:
        return fetch_stock_basics(symbol.strip())
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"종목 기초정보 조회 실패: {e}") from e


@market_router.get("/stocks/{symbol}/holdings-analysis")
def api_holdings_analysis(
    symbol: str,
    db: Session = Depends(get_db),
):
    try:
        return build_holdings_analysis(db, symbol.strip())
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"보유 종목 분석 실패: {e}") from e


@market_router.get("/research/report-links")
def api_report_links(nid: int = Query(..., description="네이버 리서치 리포트 ID")):
    """네이버 리서치 리포트 페이지에서 PDF URL과 관련 링크를 추출합니다."""
    import httpx
    from bs4 import BeautifulSoup

    naver_url = f"https://finance.naver.com/research/company_read.naver?nid={nid}"
    try:
        resp = httpx.get(
            naver_url,
            headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"},
            timeout=10,
            follow_redirects=True,
        )
        resp.raise_for_status()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"리포트 페이지 조회 실패: {e}") from e

    soup = BeautifulSoup(resp.text, "html.parser")
    pdf_url: Optional[str] = None

    # pstatic.net PDF 링크 추출
    for a in soup.find_all("a", href=True):
        href = str(a.get("href", ""))
        if "pstatic.net" in href and ".pdf" in href.lower():
            pdf_url = href
            break

    # 리포트 제목·증권사 추출
    title = ""
    broker = ""
    title_el = soup.select_one(".view_tit") or soup.select_one(".tit_type")
    if title_el:
        title = title_el.get_text(strip=True)
    broker_el = soup.select_one(".source") or soup.select_one(".writer")
    if broker_el:
        broker = broker_el.get_text(strip=True)

    news_search_url = (
        f"https://search.naver.com/search.naver?where=news&query={nid}"
        if not title
        else f"https://search.naver.com/search.naver?where=news&query={title.replace(' ', '+')}"
    )

    return {
        "nid": nid,
        "naver_url": naver_url,
        "pdf_url": pdf_url,
        "title": title,
        "broker": broker,
        "news_search_url": news_search_url,
    }


# ── 미국 증시 리포트 ──────────────────────────────────────────────

@market_router.get("/reports/us/daily")
def api_us_daily_reports(
    days: int = Query(7, ge=1, le=30),
    date: Optional[str] = Query(None, description="YYYY-MM-DD, 단일 조회"),
    db: Session = Depends(get_db),
):
    if date:
        one = get_report(db, date)
        return {"report": one}
    return {"reports": list_reports(db, days=days)}


@market_router.post("/reports/us/daily/generate")
def api_generate_us_report(
    date: Optional[str] = Query(None, description="YYYY-MM-DD"),
    force: bool = Query(False),
    db: Session = Depends(get_db),
):
    try:
        report = generate_us_morning_report(db, report_date=date, force=force)
        return {"report": report}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"리포트 생성 실패: {e}") from e


@market_router.get("/reports/us/daily/live-snapshot")
def api_us_live_snapshot(
    mode: str = Query("auto", description="auto | cash | futures"),
):
    if mode not in ("auto", "cash", "futures"):
        raise HTTPException(status_code=400, detail="mode는 auto, cash, futures 중 하나")
    try:
        return {"snapshot": fetch_live_snapshot(mode=mode)}  # type: ignore[arg-type]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)[:300]) from e


@market_router.post("/reports/us/daily/refresh-news")
def api_refresh_us_report_news(
    date: Optional[str] = Query(None, description="YYYY-MM-DD"),
    refresh_quotes: bool = Query(False, description="시세도 함께 갱신"),
    db: Session = Depends(get_db),
):
    try:
        report = refresh_us_report_news(
            db, report_date=date, refresh_quotes=refresh_quotes
        )
        return {"report": report}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


# ── 추적 미국 종목 (설정 화면에서 추가/수정/삭제) ──────────────────────

class TrackedUsStockBody(BaseModel):
    ticker: str = Field(..., min_length=1, max_length=10)
    name_kr: str = Field(..., min_length=1, max_length=100)
    sector: str = Field("other", max_length=30)
    korea_related: Optional[str] = Field(None, max_length=200)


class TrackedUsStockUpdateBody(BaseModel):
    name_kr: Optional[str] = Field(None, min_length=1, max_length=100)
    sector: Optional[str] = Field(None, max_length=30)
    korea_related: Optional[str] = Field(None, max_length=200)


@market_router.get("/reports/us/tracked-stocks")
def api_list_tracked_us_stocks(db: Session = Depends(get_db)):
    return {"stocks": list_tracked_us_stocks(db), "sectors": SECTOR_LABELS}


@market_router.post("/reports/us/tracked-stocks")
def api_add_tracked_us_stock(body: TrackedUsStockBody, db: Session = Depends(get_db)):
    try:
        stock = add_tracked_us_stock(
            db,
            ticker=body.ticker,
            name_kr=body.name_kr,
            sector=body.sector,
            korea_related=body.korea_related,
        )
        return {"stock": stock}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@market_router.patch("/reports/us/tracked-stocks/{ticker}")
def api_update_tracked_us_stock(
    ticker: str, body: TrackedUsStockUpdateBody, db: Session = Depends(get_db)
):
    try:
        stock = update_tracked_us_stock(
            db,
            ticker,
            name_kr=body.name_kr,
            sector=body.sector,
            korea_related=body.korea_related,
        )
        return {"stock": stock}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e


@market_router.delete("/reports/us/tracked-stocks/{ticker}")
def api_remove_tracked_us_stock(ticker: str, db: Session = Depends(get_db)):
    try:
        remove_tracked_us_stock(db, ticker)
        return {"ok": True}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e


# ── 국내 증시 스냅샷 ──────────────────────────────────────────────

@market_router.get("/market/kr/snapshot")
def api_kr_market_snapshot(force: bool = Query(False)):
    try:
        return {"snapshot": fetch_kr_market_snapshot(force=force)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)[:300]) from e


@market_router.get("/market/kr/group-stocks")
def api_kr_group_stocks(
    group_type: str = Query(..., description="theme | upjong"),
    group_no: str = Query(..., min_length=1),
    limit: int = Query(10, ge=1, le=30),
):
    """테마/업종 구성 종목 (등락률 상위)"""
    try:
        return fetch_kr_group_stocks(group_type, group_no, limit=limit)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@market_router.post("/market/kr/stocks/{symbol}/ensure")
def api_ensure_kr_stock(symbol: str, db: Session = Depends(get_db)):
    """차트 조회용 임시 종목 등록 (qty=0)"""
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


# ── 수출입 월간 리포트 ──────────────────────────────────────────────

@market_router.get("/reports/trade/monthly")
def api_trade_monthly_reports(
    month: Optional[str] = Query(None, description="YYYY-MM, 단일 조회"),
    limit: int = Query(12, ge=1, le=12, description="최대 12개월(1년)"),
    db: Session = Depends(get_db),
):
    if month:
        return {"report": get_trade_report(db, month)}
    return {"reports": list_trade_reports(db, limit=limit)}


@market_router.post("/reports/trade/monthly/generate")
def api_generate_trade_report(
    month: Optional[str] = Query(None, description="YYYY-MM"),
    force: bool = Query(False),
    db: Session = Depends(get_db),
):
    try:
        report = generate_trade_report(db, report_month=month, force=force)
        return {"report": report}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        from core.trade_report import _default_report_month, get_report as get_trade_report_by_month

        saved = get_trade_report_by_month(db, month or _default_report_month())
        if saved and saved.get("summary"):
            return {"report": saved, "warning": str(e)[:300]}
        raise HTTPException(status_code=500, detail=str(e)[:300]) from e
