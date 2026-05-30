"""
core/ai_analyzer.py
Gemini AI 분석 엔진
- YouTube 영상 분석
- 뉴스 기사 URL 분석
- 텍스트 직접 분석
- 섹터/종목 매핑
"""
import json
import logging
import httpx
from datetime import datetime
from typing import Optional
from sqlalchemy.orm import Session

from config.database import IntelContent, StockIssue, Stock

logger = logging.getLogger(__name__)

# 분석 프롬프트 템플릿
ANALYSIS_PROMPT = """
당신은 주식·경제 전문 분석가입니다.
아래 콘텐츠를 분석하여 JSON 형식으로만 응답하세요. 다른 텍스트 없이 JSON만 출력하세요.

분석 항목:
1. summary: 전체 내용 3~5문장 요약 (한국어)
2. key_points: 핵심 포인트 5개 이내 (배열)
3. mentioned_stocks: 언급된 종목 목록 (종목명 또는 티커, 배열)
4. mentioned_sectors: 언급된 섹터 목록 (배열)
   가능한 섹터: [반도체, AI·빅테크, 2차전지, 바이오·헬스케어, 금융, 에너지, 소비재, 자동차, 방산, 부동산·리츠, 기타]
5. keywords: 주요 키워드 10개 이내 (배열)
6. sentiment: 전체 시장 또는 주요 종목에 대한 톤 ("POSITIVE" / "NEUTRAL" / "NEGATIVE")
7. economic_events: 언급된 경제 이벤트 (금리, 실적발표, 지표 등) 배열

응답 형식:
{
  "summary": "...",
  "key_points": ["...", "..."],
  "mentioned_stocks": ["삼성전자", "NVDA", "..."],
  "mentioned_sectors": ["반도체", "AI·빅테크"],
  "keywords": ["금리", "AI", "..."],
  "sentiment": "POSITIVE",
  "economic_events": ["연준 금리 결정", "삼성전자 실적발표"]
}
"""

STOCK_ISSUE_PROMPT = """
아래 분석 결과에서 특정 종목 '{stock_name}({stock_symbol})'에 관련된 내용만 추출하세요.
해당 종목에 대한 핵심 내용을 2~3문장으로 요약하고,
감성을 POSITIVE / NEUTRAL / NEGATIVE 중 하나로 판단하세요.

JSON 형식으로만 응답:
{{"issue_summary": "...", "sentiment": "POSITIVE"}}

분석 결과:
{analysis_result}
"""


class AIAnalyzer:
    """
    Gemini AI 기반 콘텐츠 분석기

    사용법:
        analyzer = AIAnalyzer(api_key="...", db=db_session)

        # YouTube 분석
        result = analyzer.analyze_youtube("https://www.youtube.com/watch?v=...")

        # 뉴스 URL 분석
        result = analyzer.analyze_url("https://news.example.com/article/...")

        # 텍스트 직접 분석
        result = analyzer.analyze_text("오늘 반도체 섹터가 급등했다...")
    """

    def __init__(self, api_key: str, db: Session):
        self.api_key = api_key
        self.db = db
        self._model = None
        self._setup()

    def _setup(self):
        """Gemini API 초기화"""
        try:
            import google.generativeai as genai
            genai.configure(api_key=self.api_key)
            self._model = genai.GenerativeModel("gemini-2.0-flash")
            logger.info("✅ Gemini API 초기화 완료")
        except ImportError:
            logger.error("❌ google-generativeai 미설치. 'pip install google-generativeai' 실행 필요")
        except Exception as e:
            logger.error(f"❌ Gemini API 초기화 실패: {e}")

    def _call_gemini(self, prompt: str, content_parts: list = None) -> Optional[dict]:
        """Gemini API 호출 및 JSON 파싱"""
        if not self._model:
            return None
        try:
            parts = content_parts or []
            parts.append(prompt)
            response = self._model.generate_content(parts)
            text = response.text.strip()

            # JSON 코드블록 제거
            if text.startswith("```"):
                lines = text.split("\n")
                text = "\n".join(lines[1:-1])

            return json.loads(text)
        except json.JSONDecodeError as e:
            logger.error(f"❌ JSON 파싱 실패: {e}\n응답: {text[:200]}")
            return None
        except Exception as e:
            logger.error(f"❌ Gemini API 호출 실패: {e}")
            return None

    # ─────────────────────────────────────────
    # YouTube 영상 분석
    # ─────────────────────────────────────────
    def analyze_youtube(self, url: str, channel_name: str = "") -> Optional[IntelContent]:
        """
        YouTube URL → Gemini 직접 분석
        (Gemini API가 YouTube URL을 직접 처리)
        """
        logger.info(f"🎬 YouTube 분석 시작: {url}")

        try:
            import google.generativeai as genai

            # Gemini에 YouTube URL 직접 전달
            prompt = f"다음 YouTube 영상을 분석해주세요:\n{url}\n\n{ANALYSIS_PROMPT}"
            analysis = self._call_gemini(prompt)

            if not analysis:
                # Fallback: 유튜브 자막 추출 후 텍스트 분석
                logger.info("YouTube 직접 분석 실패, 자막 추출 시도...")
                transcript = self._get_youtube_transcript(url)
                if transcript:
                    analysis = self._call_gemini(
                        f"{ANALYSIS_PROMPT}\n\n[영상 자막]\n{transcript[:8000]}"
                    )

            if not analysis:
                logger.error(f"❌ YouTube 분석 실패: {url}")
                return None

            return self._save_intel_content(
                source_type="YOUTUBE",
                source_url=url,
                channel_name=channel_name,
                analysis=analysis,
            )

        except Exception as e:
            logger.error(f"❌ YouTube 분석 오류: {e}")
            return None

    def _get_youtube_transcript(self, url: str) -> Optional[str]:
        """YouTube 자막 추출 (youtube-transcript-api 사용)"""
        try:
            from youtube_transcript_api import YouTubeTranscriptApi
            import re

            video_id_match = re.search(r"(?:v=|youtu\.be/)([a-zA-Z0-9_-]{11})", url)
            if not video_id_match:
                return None

            video_id = video_id_match.group(1)
            transcript_list = YouTubeTranscriptApi.get_transcript(
                video_id, languages=["ko", "en"]
            )
            return " ".join([t["text"] for t in transcript_list])
        except Exception as e:
            logger.warning(f"자막 추출 실패: {e}")
            return None

    # ─────────────────────────────────────────
    # 뉴스 URL 분석
    # ─────────────────────────────────────────
    def analyze_url(self, url: str) -> Optional[IntelContent]:
        """뉴스/기사 URL → 본문 크롤링 → AI 분석"""
        logger.info(f"📰 URL 분석 시작: {url}")

        try:
            # 기사 본문 크롤링
            text = self._fetch_article(url)
            if not text:
                logger.error(f"❌ 기사 본문 추출 실패: {url}")
                return None

            analysis = self._call_gemini(
                f"{ANALYSIS_PROMPT}\n\n[기사 내용]\n{text[:6000]}"
            )
            if not analysis:
                return None

            return self._save_intel_content(
                source_type="NEWS",
                source_url=url,
                analysis=analysis,
            )
        except Exception as e:
            logger.error(f"❌ URL 분석 오류: {e}")
            return None

    def _fetch_article(self, url: str) -> Optional[str]:
        """기사 본문 크롤링"""
        try:
            headers = {"User-Agent": "Mozilla/5.0 (compatible; StockMind/1.0)"}
            resp = httpx.get(url, headers=headers, timeout=15, follow_redirects=True)
            resp.raise_for_status()

            # BeautifulSoup으로 본문 추출
            try:
                from bs4 import BeautifulSoup
                soup = BeautifulSoup(resp.text, "html.parser")
                # 불필요한 태그 제거
                for tag in soup(["script", "style", "nav", "header", "footer", "aside"]):
                    tag.decompose()
                return soup.get_text(separator="\n", strip=True)[:8000]
            except ImportError:
                # BeautifulSoup 없으면 raw text
                return resp.text[:8000]

        except Exception as e:
            logger.error(f"크롤링 실패: {e}")
            return None

    # ─────────────────────────────────────────
    # 텍스트 직접 분석
    # ─────────────────────────────────────────
    def analyze_text(self, text: str, title: str = "") -> Optional[IntelContent]:
        """텍스트 직접 입력 → AI 분석"""
        logger.info(f"📝 텍스트 분석 시작: {title[:30] if title else '(제목없음)'}...")

        analysis = self._call_gemini(
            f"{ANALYSIS_PROMPT}\n\n[입력 텍스트]\n{text[:8000]}"
        )
        if not analysis:
            return None

        return self._save_intel_content(
            source_type="TEXT",
            source_title=title,
            analysis=analysis,
        )

    # ─────────────────────────────────────────
    # DB 저장 및 종목 매핑
    # ─────────────────────────────────────────
    def _save_intel_content(
        self,
        source_type: str,
        analysis: dict,
        source_url: str = "",
        source_title: str = "",
        channel_name: str = "",
    ) -> IntelContent:
        """분석 결과 DB 저장 + 보유 종목 자동 매핑"""

        content = IntelContent(
            source_type=source_type,
            source_url=source_url,
            source_title=source_title or analysis.get("summary", "")[:100],
            channel_name=channel_name,
            summary=analysis.get("summary", ""),
            key_points=json.dumps(analysis.get("key_points", []), ensure_ascii=False),
            mentioned_stocks=json.dumps(analysis.get("mentioned_stocks", []), ensure_ascii=False),
            mentioned_sectors=json.dumps(analysis.get("mentioned_sectors", []), ensure_ascii=False),
            keywords=json.dumps(analysis.get("keywords", []), ensure_ascii=False),
            sentiment=analysis.get("sentiment", "NEUTRAL"),
            analyzed_at=datetime.utcnow(),
        )
        self.db.add(content)
        self.db.flush()  # ID 생성

        # 보유 종목과 매핑
        self._map_to_portfolio_stocks(content, analysis)

        self.db.commit()
        logger.info(f"✅ 분석 결과 저장 완료 (ID: {content.id})")
        return content

    def _map_to_portfolio_stocks(self, content: IntelContent, analysis: dict):
        """분석 결과에서 보유 종목 언급 감지 → StockIssue 생성"""
        mentioned = analysis.get("mentioned_stocks", [])
        if not mentioned:
            return

        # 보유 종목 전체 조회
        portfolio_stocks = self.db.query(Stock).filter(Stock.is_active == True).all()

        for stock in portfolio_stocks:
            # 종목명 또는 심볼이 언급 목록에 있는지 확인
            is_mentioned = any(
                stock.symbol.upper() in str(m).upper() or
                stock.name in str(m)
                for m in mentioned
            )

            if is_mentioned:
                # 해당 종목에 대한 세부 이슈 요약 생성
                issue_summary = self._get_stock_specific_summary(
                    stock.name, stock.symbol, analysis
                )

                issue = StockIssue(
                    stock_id=stock.id,
                    content_id=content.id,
                    issue_summary=issue_summary,
                    sentiment=analysis.get("sentiment", "NEUTRAL"),
                )
                self.db.add(issue)
                logger.info(f"🔗 종목 이슈 연결: {stock.name}({stock.symbol})")

    def _get_stock_specific_summary(
        self, stock_name: str, stock_symbol: str, analysis: dict
    ) -> str:
        """특정 종목에 대한 세부 요약 생성"""
        try:
            prompt = STOCK_ISSUE_PROMPT.format(
                stock_name=stock_name,
                stock_symbol=stock_symbol,
                analysis_result=json.dumps(analysis, ensure_ascii=False),
            )
            result = self._call_gemini(prompt)
            if result:
                return result.get("issue_summary", "")
        except Exception:
            pass
        return analysis.get("summary", "")[:200]
