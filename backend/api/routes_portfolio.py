"""
api/routes_portfolio.py
포트폴리오 AI 분석
  GET  /api/portfolio/ai-analysis  — 마지막 저장 결과 반환 (없으면 null)
  POST /api/portfolio/ai-analysis  — 새로 생성 후 저장
"""
import json
from typing import Optional

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from config.database import get_db, PortfolioAISnapshot
from core.portfolio_analysis import generate_portfolio_analysis

portfolio_router = APIRouter()


class PortfolioAnalysisBody(BaseModel):
    analysis_provider: Optional[str] = None


@portfolio_router.get("/portfolio/ai-analysis")
def get_portfolio_ai_analysis(db: Session = Depends(get_db)):
    row = db.query(PortfolioAISnapshot).order_by(PortfolioAISnapshot.id.desc()).first()
    if not row:
        return JSONResponse(content=None)
    return {
        "analysis":    json.loads(row.analysis),
        "meta":        json.loads(row.meta),
        "analyzed_at": row.analyzed_at.isoformat(),
    }


@portfolio_router.post("/portfolio/ai-analysis")
def portfolio_ai_analysis(
    body: PortfolioAnalysisBody = PortfolioAnalysisBody(),
    db: Session = Depends(get_db),
):
    return generate_portfolio_analysis(db, body.analysis_provider)
