"""
api/routes_etf.py — ETF 랭킹 · 구성종목 · 종목→ETF 역검색 · AI 전망
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session
from typing import Optional

from config.database import EtfFavorite, EtfMemo, Stock, get_db
from config.settings import get_settings
from core.etf_data import (
    ETF_CATEGORIES,
    SORT_COLUMNS,
    fetch_etf_basic_stats,
    fetch_etf_holdings,
    fetch_etf_listing_dates,
    fetch_etf_rankings,
    find_etfs_by_stock,
    generate_etf_outlook,
)
from core.etf_youtube import (
    add_channel,
    analyze_latest_videos,
    analyze_video_url,
    get_channel,
    get_youtube_insights_for_etf,
    list_channel_videos,
    list_channels,
    list_link_analyzed_videos,
    remove_channel,
)

etf_router = APIRouter(prefix="/etf", tags=["etf"])


class EtfChannelAddBody(BaseModel):
    handle: str
    custom_name: Optional[str] = None


class EtfAnalyzeLatestBody(BaseModel):
    max_results: int = 5


class EtfAnalyzeUrlBody(BaseModel):
    url: str
    force: bool = False


class EtfMemoBody(BaseModel):
    memo: str


class EtfFavoriteBody(BaseModel):
    code: str
    name: Optional[str] = None


@etf_router.get("/favorites")
def api_list_favorites(db: Session = Depends(get_db)):
    rows = db.query(EtfFavorite).order_by(EtfFavorite.created_at.desc()).all()
    return {"codes": [r.code for r in rows]}


@etf_router.post("/favorites/toggle")
def api_toggle_favorite(body: EtfFavoriteBody, db: Session = Depends(get_db)):
    row = db.query(EtfFavorite).filter(EtfFavorite.code == body.code).first()
    if row:
        db.delete(row)
        db.commit()
        return {"code": body.code, "favorited": False}
    db.add(EtfFavorite(code=body.code, name=body.name))
    db.commit()
    return {"code": body.code, "favorited": True}


_ETF_PREFIXES = (
    "KODEX", "TIGER", "PLUS", "RISE", "ACE", "SOL", "HANARO",
    "ARIRANG", "KBSTAR", "KoAct", "FOCUS", "파워", "히어로즈", "마이다스",
)

def _is_etf(name: str, sector: str | None) -> bool:
    if sector == "ETF":
        return True
    return any(name.startswith(p) for p in _ETF_PREFIXES)


@etf_router.get("/my-holdings")
def api_etf_my_holdings(db: Session = Depends(get_db)):
    """포트폴리오에서 보유 중(qty > 0)인 ETF 코드 + 수량 + 가격 + 시가총액 + 3개월수익률 반환"""
    rows = db.query(
        Stock.symbol, Stock.name, Stock.qty,
        Stock.avg_price, Stock.current_price, Stock.change_rate,
        Stock.sector,
    ).filter(Stock.qty > 0).all()
    etf_rows = [r for r in rows if _is_etf(r.name, r.sector)]

    # 시가총액·3개월수익률을 네이버 API에서 병렬 조회
    codes = [r.symbol for r in etf_rows]
    stats = fetch_etf_basic_stats(codes) if codes else {}

    holdings = [
        {
            "code": r.symbol,
            "name": r.name,
            "qty": r.qty,
            "avg_price": r.avg_price or 0,
            "current_price": r.current_price or 0,
            "change_rate": r.change_rate or 0,
            "market_cap": stats.get(r.symbol, {}).get("market_cap"),
            "return_3m": stats.get(r.symbol, {}).get("return_3m"),
        }
        for r in etf_rows
    ]
    return {"codes": [h["code"] for h in holdings], "holdings": holdings}


@etf_router.get("/{code}/memo")
def api_get_etf_memo(code: str, db: Session = Depends(get_db)):
    row = db.query(EtfMemo).filter(EtfMemo.code == code.strip()).first()
    return {"code": code, "memo": row.memo if row else ""}


@etf_router.put("/{code}/memo")
def api_set_etf_memo(code: str, body: EtfMemoBody, db: Session = Depends(get_db)):
    row = db.query(EtfMemo).filter(EtfMemo.code == code.strip()).first()
    if row:
        row.memo = body.memo
    else:
        row = EtfMemo(code=code.strip(), memo=body.memo)
        db.add(row)
    db.commit()
    return {"code": code, "memo": row.memo}


@etf_router.get("/categories")
def list_categories():
    return {
        "categories": [{"code": k, "label": v} for k, v in ETF_CATEGORIES.items()],
        "sort_columns": [{"key": k, "label": v} for k, v in SORT_COLUMNS.items()],
    }


@etf_router.get("/rankings")
def api_etf_rankings(
    category: int = Query(0, ge=0, le=7),
    sort: str = Query("market_sum"),
    order: str = Query("desc", pattern="^(asc|desc)$"),
    limit: int = Query(30, ge=1, le=100),
):
    if sort not in SORT_COLUMNS:
        raise HTTPException(status_code=400, detail=f"지원하지 않는 정렬 기준: {sort}")
    try:
        items = fetch_etf_rankings(category=category, sort=sort, order=order, limit=limit)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"ETF 랭킹 조회 실패: {e}") from e
    return {"category": category, "sort": sort, "order": order, "items": items}


@etf_router.get("/listing-dates")
def api_etf_listing_dates(codes: str = Query(..., description="콤마 구분 ETF 코드 목록 (최대 100개)")):
    """여러 ETF의 상장일을 병렬 조회."""
    code_list = [c.strip() for c in codes.split(",") if c.strip()][:100]
    if not code_list:
        return {"dates": {}}
    return {"dates": fetch_etf_listing_dates(code_list)}


@etf_router.get("/search-by-stock")
def api_find_etfs_by_stock(query: str = Query(..., min_length=1), db: Session = Depends(get_db)):
    return find_etfs_by_stock(query, db)


@etf_router.get("/{code}/holdings")
def api_etf_holdings(code: str):
    result = fetch_etf_holdings(code.strip())
    if not result.get("name") and not result.get("holdings"):
        raise HTTPException(status_code=404, detail="ETF 정보를 찾을 수 없습니다.")
    return result


@etf_router.get("/{code}/outlook")
def api_etf_outlook(code: str, force: bool = False, db: Session = Depends(get_db)):
    settings = get_settings()
    if not settings.gemini_api_key:
        raise HTTPException(status_code=400, detail="Gemini API 키가 설정되어 있지 않습니다.")

    holdings = fetch_etf_holdings(code.strip())
    if not holdings.get("name"):
        raise HTTPException(status_code=404, detail="ETF 정보를 찾을 수 없습니다.")

    all_rankings = fetch_etf_rankings(category=0, sort="market_sum", order="desc", limit=2000)
    meta = next((it for it in all_rankings if it["code"] == code.strip()), None)
    category_label = ETF_CATEGORIES.get(meta["category"], "전체") if meta else "전체"
    return_3m = meta.get("return_3m") if meta else None

    return generate_etf_outlook(
        db,
        code=code.strip(),
        name=holdings["name"],
        category_label=category_label,
        return_3m=return_3m,
        holdings=holdings.get("holdings", []),
        gemini_api_key=settings.gemini_api_key,
        gemini_model=settings.gemini_model,
        force=force,
    )


@etf_router.get("/channels")
def api_list_etf_channels(db: Session = Depends(get_db)):
    return {"channels": list_channels(db)}


@etf_router.post("/channels")
def api_add_etf_channel(body: EtfChannelAddBody, db: Session = Depends(get_db)):
    settings = get_settings()
    if not settings.youtube_api_key:
        raise HTTPException(status_code=400, detail="YouTube API 키가 설정되지 않았습니다.")
    try:
        return add_channel(db, body.handle, settings.youtube_api_key, body.custom_name)
    except FileExistsError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e


@etf_router.delete("/channels/{channel_db_id}")
def api_remove_etf_channel(channel_db_id: int, db: Session = Depends(get_db)):
    try:
        remove_channel(db, channel_db_id)
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    return {"ok": True}


@etf_router.post("/channels/{channel_db_id}/analyze-latest")
def api_analyze_latest_etf_videos(
    channel_db_id: int, body: EtfAnalyzeLatestBody, db: Session = Depends(get_db)
):
    settings = get_settings()
    if not settings.youtube_api_key:
        raise HTTPException(status_code=400, detail="YouTube API 키가 설정되지 않았습니다.")
    if not settings.gemini_api_key:
        raise HTTPException(status_code=400, detail="Gemini API 키가 설정되어 있지 않습니다.")
    try:
        channel = get_channel(db, channel_db_id)
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e

    try:
        analyzed = analyze_latest_videos(
            db,
            channel,
            youtube_api_key=settings.youtube_api_key,
            gemini_api_key=settings.gemini_api_key,
            gemini_model=settings.gemini_model,
            max_results=body.max_results,
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"영상 분석 실패: {e}") from e
    return {"analyzed": analyzed, "count": len(analyzed)}


@etf_router.get("/channels/{channel_db_id}/videos")
def api_list_etf_channel_videos(channel_db_id: int, db: Session = Depends(get_db)):
    try:
        channel = get_channel(db, channel_db_id)
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    return {"videos": list_channel_videos(db, channel.channel_id)}


@etf_router.get("/videos/link-analyzed")
def api_list_link_analyzed(limit: int = Query(30, ge=1, le=100), db: Session = Depends(get_db)):
    """채널 등록 없이 링크로 분석한 영상 기록."""
    return {"videos": list_link_analyzed_videos(db, limit=limit)}


@etf_router.post("/videos/analyze-url")
def api_analyze_etf_video_url(body: EtfAnalyzeUrlBody, db: Session = Depends(get_db)):
    settings = get_settings()
    if not settings.youtube_api_key:
        raise HTTPException(status_code=400, detail="YouTube API 키가 설정되지 않았습니다.")
    if not settings.gemini_api_key:
        raise HTTPException(status_code=400, detail="Gemini API 키가 설정되어 있지 않습니다.")
    try:
        return analyze_video_url(
            db,
            body.url.strip(),
            youtube_api_key=settings.youtube_api_key,
            gemini_api_key=settings.gemini_api_key,
            gemini_model=settings.gemini_model,
            force=body.force,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"영상 분석 실패: {e}") from e


@etf_router.get("/{code}/youtube-insights")
def api_etf_youtube_insights(code: str, db: Session = Depends(get_db)):
    holdings = fetch_etf_holdings(code.strip())
    return {"insights": get_youtube_insights_for_etf(db, code.strip(), holdings.get("name"))}
