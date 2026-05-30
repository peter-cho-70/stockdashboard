"""
core/ai_analyzer.py
하이브리드 AI 분석 엔진

[파이프라인]
1. YouTube  → Gemini: 영상 내용을 분석 가능한 문서로 추출
2. 뉴스/텍스트 → 본문 그대로 문서화
3. 문서     → GPT: 종목별 · 매크로 · 섹터별 구조화 분석 (1회 호출)
"""
import json
import logging
import re
import time
import httpx
from datetime import datetime
from typing import Optional
from sqlalchemy.orm import Session

from config.database import IntelContent, StockIssue, Stock

logger = logging.getLogger(__name__)

MAX_RETRIES = 3
RETRY_DELAY = 45

SECTORS = "반도체, AI·빅테크, 2차전지, 바이오·헬스케어, 금융, 에너지, 소비재, 자동차, 방산, 부동산·리츠, 기타"

# ── Gemini: YouTube → 문서 추출 ──────────────────────
YOUTUBE_EXTRACT_PROMPT = """당신은 경제·주식 유튜브 영상 분석 전문가입니다.
아래 YouTube 영상 내용을 분석·정리하여 JSON으로만 응답하세요.

출력 항목:
1. title: 영상 제목 (알 수 없으면 빈 문자열)
2. document: 분석용 상세 문서 (한국어)
   - 발언자/채널의 핵심 주장, 근거, 수치, 종목·섹터 언급, 경제 이벤트를 빠짐없이 정리
   - 시간순 또는 주제별로 구조화, 최소 500자 이상
3. speakers: 주요 발언자 (배열, 없으면 [])
4. topics: 다룬 주제 키워드 (배열, 5~10개)

응답 JSON만 출력:
{"title":"...","document":"...","speakers":[],"topics":[]}"""


def _build_gpt_prompt(document: str, portfolio_stocks: list[dict], source_label: str) -> str:
    """GPT 구조화 분석 프롬프트 (종목·매크로·섹터 통합)"""
    stock_section = ""
    if portfolio_stocks:
        items = ", ".join(f"{s['name']}({s['symbol']})" for s in portfolio_stocks)
        stock_section = f"""
10. stock_issues: 보유 종목 중 문서에서 언급된 종목만, 각 2~3문장 요약 + 감성.
   보유 종목: [{items}]
   형식: [{{"symbol":"005930","name":"삼성전자","summary":"...","sentiment":"POSITIVE"}}]
   (언급 없으면 [])"""

    return f"""당신은 주식·경제 전문 분석가입니다.
아래 [{source_label}] 문서를 분석하여 JSON만 출력하세요.

분석 항목:
1. summary: 전체 5~7문장 요약 (한국어)
2. key_points: 핵심 포인트 5개 이내 (배열)
3. mentioned_stocks: 언급 종목 (배열)
4. mentioned_sectors: 언급 섹터 (배열, 가능: [{SECTORS}])
5. keywords: 키워드 10개 이내 (배열)
6. sentiment: 전체 시장 톤 ("POSITIVE"/"NEUTRAL"/"NEGATIVE")
7. economic_events: 경제 이벤트 배열 (날짜 있으면 포함)
8. macro_analysis: 매크로(거시) 경제 분석
   {{"summary":"2~3문장","topics":[{{"topic":"금리","summary":"...","sentiment":"NEGATIVE","impact":"..."}}]}}
   (금리, 환율, CPI, GDP, FOMC, 유가, 중국/미국 정책 등)
9. sector_analysis: 섹터별 분석 배열
   [{{"sector":"반도체","summary":"2~3문장","sentiment":"POSITIVE","outlook":"단기/중기 전망","mentioned_stocks":["삼성전자"]}}]
   (문서에서 언급된 섹터만){stock_section}

응답 JSON:
{{"summary":"","key_points":[],"mentioned_stocks":[],"mentioned_sectors":[],"keywords":[],"sentiment":"NEUTRAL","economic_events":[],"macro_analysis":{{"summary":"","topics":[]}},"sector_analysis":[],"stock_issues":[]}}

[문서]
{document[:12000]}"""


def _extract_json(text: str) -> Optional[dict]:
    text = text.strip()
    code_block = re.search(r"```(?:json)?\s*([\s\S]*?)```", text)
    if code_block:
        text = code_block.group(1).strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    json_match = re.search(r"\{[\s\S]*\}", text)
    if json_match:
        try:
            return json.loads(json_match.group(0))
        except json.JSONDecodeError:
            pass
    return None


class AIAnalyzer:
    def __init__(
        self,
        gemini_api_key: str,
        openai_api_key: str,
        db: Session,
        openai_model: str = "gpt-4o-mini",
    ):
        self.gemini_api_key = gemini_api_key
        self.openai_api_key = openai_api_key
        self.openai_model   = openai_model
        self.db             = db
        self._gemini        = None
        self._openai        = None
        self.logs: list[dict] = []
        self._setup()

    def _log(self, level: str, msg: str):
        entry = {"level": level, "msg": msg, "ts": datetime.utcnow().strftime("%H:%M:%S")}
        self.logs.append(entry)
        getattr(logger, level if level != "warn" else "warning", logger.info)(msg)

    def _setup(self):
        if self.gemini_api_key:
            try:
                import google.generativeai as genai
                genai.configure(api_key=self.gemini_api_key)
                self._gemini = genai.GenerativeModel("gemini-2.0-flash")
                self._log("info", "✅ Gemini 초기화 (YouTube 문서 추출용)")
            except Exception as e:
                self._log("error", f"❌ Gemini 초기화 실패: {e}")
        else:
            self._log("warn", "⚠️ GEMINI_API_KEY 미설정 — YouTube 분석 불가")

        if self.openai_api_key:
            try:
                from openai import OpenAI
                self._openai = OpenAI(api_key=self.openai_api_key)
                self._log("info", f"✅ OpenAI 초기화 ({self.openai_model}) — 종목·매크로·섹터 분석")
            except Exception as e:
                self._log("error", f"❌ OpenAI 초기화 실패: {e}")
        else:
            self._log("warn", "⚠️ OPENAI_API_KEY 미설정 — 구조화 분석 불가")

    # ── Gemini 호출 ────────────────────────────────────
    def _call_gemini_raw(self, prompt: str) -> Optional[str]:
        if not self._gemini:
            self._log("error", "❌ Gemini 미초기화")
            return None
        self._log("info", f"📡 Gemini 호출 (문서 추출, {len(prompt):,}자)")
        for attempt in range(1, MAX_RETRIES + 1):
            try:
                resp = self._gemini.generate_content(prompt)
                self._log("info", "✅ Gemini 응답 수신")
                return resp.text
            except Exception as e:
                err = str(e)
                if "429" in err or "RESOURCE_EXHAUSTED" in err or "quota" in err.lower():
                    delay_match = re.search(r"seconds:\s*(\d+)", err)
                    delay = int(delay_match.group(1)) + 5 if delay_match else RETRY_DELAY
                    if attempt < MAX_RETRIES:
                        self._log("warn", f"⏳ Gemini Quota 초과 — {delay}초 후 재시도 ({attempt}/{MAX_RETRIES})")
                        time.sleep(delay)
                        continue
                    raise RuntimeError(f"GEMINI_QUOTA_EXCEEDED:{delay}")
                self._log("error", f"❌ Gemini 실패: {err[:200]}")
                return None
        return None

    def _call_gemini_json(self, prompt: str) -> Optional[dict]:
        raw = self._call_gemini_raw(prompt)
        if not raw:
            return None
        result = _extract_json(raw)
        if not result:
            self._log("error", f"❌ Gemini JSON 파싱 실패: {raw[:200]}")
        return result

    # ── GPT 호출 ───────────────────────────────────────
    def _call_gpt(self, prompt: str) -> Optional[dict]:
        if not self._openai:
            self._log("error", "❌ OpenAI 미초기화 — OPENAI_API_KEY 확인")
            return None
        self._log("info", f"🤖 GPT 분석 요청 ({self.openai_model}, {len(prompt):,}자)")
        for attempt in range(1, MAX_RETRIES + 1):
            try:
                resp = self._openai.chat.completions.create(
                    model=self.openai_model,
                    messages=[
                        {"role": "system", "content": "주식·경제 전문 분석가. 반드시 유효한 JSON만 출력."},
                        {"role": "user", "content": prompt},
                    ],
                    response_format={"type": "json_object"},
                    temperature=0.3,
                )
                raw = resp.choices[0].message.content or ""
                result = _extract_json(raw)
                if result:
                    self._log("info", "✅ GPT 분석 완료 (종목·매크로·섹터)")
                    return result
                self._log("error", f"❌ GPT JSON 파싱 실패: {raw[:200]}")
                return None
            except Exception as e:
                err = str(e)
                if "429" in err or "rate_limit" in err.lower():
                    delay = RETRY_DELAY
                    if attempt < MAX_RETRIES:
                        self._log("warn", f"⏳ GPT Rate limit — {delay}초 후 재시도 ({attempt}/{MAX_RETRIES})")
                        time.sleep(delay)
                        continue
                    raise RuntimeError(f"OPENAI_QUOTA_EXCEEDED:{delay}")
                self._log("error", f"❌ GPT 실패: {err[:200]}")
                return None
        return None

    def _get_portfolio(self) -> list[dict]:
        stocks = self.db.query(Stock).filter(Stock.is_active == True).all()
        return [{"symbol": s.symbol, "name": s.name} for s in stocks]

    # ── YouTube: Gemini 문서 추출 → GPT 분석 ───────────
    def analyze_youtube(self, url: str, channel_name: str = "") -> Optional[IntelContent]:
        self._log("info", f"🎬 YouTube 분석 시작: {url}")
        if not self._gemini:
            self._log("error", "❌ Gemini API 키 필요 (YouTube 문서 추출)")
            return None
        if not self._openai:
            self._log("error", "❌ OpenAI API 키 필요 (종목·매크로·섹터 분석)")
            return None

        portfolio = self._get_portfolio()
        title     = self._get_youtube_title(url) or ""

        # Step 1: Gemini — YouTube → 문서
        transcript = self._get_youtube_transcript(url)
        if transcript:
            self._log("info", f"📝 자막 {len(transcript):,}자 → Gemini 문서화")
            extract_input = f"{YOUTUBE_EXTRACT_PROMPT}\n\n[YouTube 자막]\n{transcript[:12000]}"
        else:
            self._log("warn", "⚠️ 자막 없음 → Gemini URL 직접 분석")
            extract_input = f"{YOUTUBE_EXTRACT_PROMPT}\n\n[YouTube URL]\n{url}"

        extracted = self._call_gemini_json(extract_input)
        if not extracted:
            self._log("error", "❌ Gemini 문서 추출 실패")
            return None

        document = extracted.get("document", "")
        if not document:
            document = extracted.get("summary", "") or json.dumps(extracted, ensure_ascii=False)
        if title:
            extracted["title"] = title
        self._log("info", f"📄 Gemini 문서 추출 완료 ({len(document):,}자)")

        # Step 2: GPT — 구조화 분석
        analysis = self._analyze_document(document, portfolio, "YouTube")
        if not analysis:
            return None

        return self._save_intel_content(
            source_type="YOUTUBE",
            source_url=url,
            source_title=extracted.get("title") or title or analysis.get("summary", "")[:100],
            channel_name=channel_name,
            analysis=analysis,
            portfolio=portfolio,
            source_document=document,
        )

    def _analyze_document(
        self, document: str, portfolio: list[dict], source_label: str
    ) -> Optional[dict]:
        """GPT로 종목·매크로·섹터 통합 분석"""
        prompt = _build_gpt_prompt(document, portfolio, source_label)
        return self._call_gpt(prompt)

    def _get_youtube_transcript(self, url: str) -> Optional[str]:
        try:
            from youtube_transcript_api import YouTubeTranscriptApi
            vid = re.search(r"(?:v=|youtu\.be/)([a-zA-Z0-9_-]{11})", url)
            if not vid:
                return None
            self._log("info", f"🔍 자막 추출 (video_id: {vid.group(1)})")
            for langs in [["ko"], ["en"], ["ko", "en"]]:
                try:
                    parts = YouTubeTranscriptApi.get_transcript(vid.group(1), languages=langs)
                    text = " ".join(t["text"] for t in parts)
                    self._log("info", f"✅ 자막 {langs} ({len(text):,}자)")
                    return text
                except Exception:
                    continue
            return None
        except Exception as e:
            self._log("warn", f"⚠️ 자막 오류: {str(e)[:80]}")
            return None

    def _get_youtube_title(self, url: str) -> Optional[str]:
        try:
            r = httpx.get("https://www.youtube.com/oembed",
                          params={"url": url, "format": "json"}, timeout=5)
            return r.json().get("title")
        except Exception:
            return None

    # ── 뉴스 / 텍스트: GPT 직접 분석 ───────────────────
    def analyze_url(self, url: str) -> Optional[IntelContent]:
        self._log("info", f"📰 뉴스 분석: {url}")
        if not self._openai:
            self._log("error", "❌ OpenAI API 키 필요")
            return None
        text = self._fetch_article(url)
        if not text:
            return None
        portfolio = self._get_portfolio()
        analysis  = self._analyze_document(text, portfolio, "뉴스")
        if not analysis:
            return None
        return self._save_intel_content(
            source_type="NEWS", source_url=url,
            analysis=analysis, portfolio=portfolio,
            source_document=text[:8000],
        )

    def analyze_text(self, text: str, title: str = "") -> Optional[IntelContent]:
        label = title[:30] if title else "(제목없음)"
        self._log("info", f"📝 텍스트 분석: {label} ({len(text):,}자)")
        if not self._openai:
            self._log("error", "❌ OpenAI API 키 필요")
            return None
        portfolio = self._get_portfolio()
        analysis  = self._analyze_document(text[:8000], portfolio, "텍스트")
        if not analysis:
            return None
        return self._save_intel_content(
            source_type="TEXT", source_title=title,
            analysis=analysis, portfolio=portfolio,
            source_document=text[:8000],
        )

    def _fetch_article(self, url: str) -> Optional[str]:
        self._log("info", "🌐 기사 다운로드...")
        try:
            headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
            resp = httpx.get(url, headers=headers, timeout=15, follow_redirects=True)
            resp.raise_for_status()
            try:
                from bs4 import BeautifulSoup
                soup = BeautifulSoup(resp.text, "html.parser")
                for tag in soup(["script", "style", "nav", "header", "footer", "aside", "iframe"]):
                    tag.decompose()
                text = soup.get_text(separator="\n", strip=True)[:8000]
                self._log("info", f"✅ 본문 {len(text):,}자")
                return text
            except ImportError:
                return resp.text[:8000]
        except Exception as e:
            self._log("error", f"❌ 크롤링 실패: {str(e)[:120]}")
            return None

    # ── DB 저장 ────────────────────────────────────────
    def _save_intel_content(
        self,
        source_type: str,
        analysis: dict,
        portfolio: list[dict],
        source_url: str = "",
        source_title: str = "",
        channel_name: str = "",
        source_document: str = "",
    ) -> IntelContent:
        macro = analysis.get("macro_analysis") or {}
        sectors = analysis.get("sector_analysis") or []

        content = IntelContent(
            source_type=source_type,
            source_url=source_url,
            source_title=source_title or analysis.get("summary", "")[:100],
            channel_name=channel_name,
            source_document=source_document[:15000] if source_document else None,
            summary=analysis.get("summary", ""),
            key_points=json.dumps(analysis.get("key_points", []), ensure_ascii=False),
            mentioned_stocks=json.dumps(analysis.get("mentioned_stocks", []), ensure_ascii=False),
            mentioned_sectors=json.dumps(analysis.get("mentioned_sectors", []), ensure_ascii=False),
            keywords=json.dumps(analysis.get("keywords", []), ensure_ascii=False),
            macro_analysis=json.dumps(macro, ensure_ascii=False),
            sector_analysis=json.dumps(sectors, ensure_ascii=False),
            sentiment=analysis.get("sentiment", "NEUTRAL"),
            analyzed_at=datetime.utcnow(),
        )
        self.db.add(content)
        self.db.flush()
        self._save_stock_issues(content, analysis, portfolio)
        self.db.commit()

        macro_topics = len(macro.get("topics", [])) if isinstance(macro, dict) else 0
        self._log("info", f"✅ 저장 완료 (ID:{content.id}) — 섹터 {len(sectors)}개, 매크로 {macro_topics}개")
        return content

    def _save_stock_issues(self, content: IntelContent, analysis: dict, portfolio: list[dict]):
        issues_from_ai = analysis.get("stock_issues", [])
        self._log("info", f"🗂️ 보유 종목 매핑 ({len(issues_from_ai)}개)")

        name_map  = {s["name"]: s["symbol"] for s in portfolio}
        db_stocks = {s.symbol: s for s in
                     self.db.query(Stock).filter(Stock.is_active == True).all()}
        saved_symbols: set[str] = set()

        for issue in issues_from_ai:
            symbol   = issue.get("symbol", "")
            name     = issue.get("name", "")
            db_stock = db_stocks.get(symbol) or db_stocks.get(name_map.get(name, ""))
            if not db_stock:
                continue
            self.db.add(StockIssue(
                stock_id=db_stock.id,
                content_id=content.id,
                issue_summary=issue.get("summary", analysis.get("summary", "")[:200]),
                sentiment=issue.get("sentiment", analysis.get("sentiment", "NEUTRAL")),
            ))
            saved_symbols.add(db_stock.symbol)
            self._log("info", f"🔗 {db_stock.name} [{issue.get('sentiment', '?')}]")

        mentioned = analysis.get("mentioned_stocks", [])
        for stock in db_stocks.values():
            if stock.symbol in saved_symbols:
                continue
            if any(stock.symbol.upper() in str(m).upper() or stock.name in str(m) for m in mentioned):
                self.db.add(StockIssue(
                    stock_id=stock.id, content_id=content.id,
                    issue_summary=analysis.get("summary", "")[:200],
                    sentiment=analysis.get("sentiment", "NEUTRAL"),
                ))
                self._log("info", f"🔗 {stock.name} (fallback)")


def create_analyzer(db: Session) -> "AIAnalyzer":
    """설정 기반 AIAnalyzer 팩토리"""
    from config.settings import get_settings
    s = get_settings()
    return AIAnalyzer(
        gemini_api_key=s.gemini_api_key,
        openai_api_key=s.openai_api_key,
        db=db,
        openai_model=s.openai_model,
    )


def serialize_intel(content: IntelContent, db: Session, logs: list | None = None) -> dict:
    """IntelContent → API 응답 dict"""
    issues = db.query(StockIssue).filter(StockIssue.content_id == content.id).all()
    return {
        "id": content.id,
        "source_type": content.source_type,
        "source_url": content.source_url,
        "source_title": content.source_title,
        "channel_name": content.channel_name,
        "summary": content.summary,
        "key_points": json.loads(content.key_points or "[]"),
        "mentioned_stocks": json.loads(content.mentioned_stocks or "[]"),
        "mentioned_sectors": json.loads(content.mentioned_sectors or "[]"),
        "keywords": json.loads(content.keywords or "[]"),
        "macro_analysis": json.loads(content.macro_analysis or "{}"),
        "sector_analysis": json.loads(content.sector_analysis or "[]"),
        "sentiment": content.sentiment,
        "analyzed_at": content.analyzed_at.isoformat() if content.analyzed_at else None,
        "stock_issues": [
            {
                "stock_id": i.stock_id,
                "symbol": i.stock.symbol if i.stock else None,
                "name": i.stock.name if i.stock else None,
                "issue_summary": i.issue_summary,
                "sentiment": i.sentiment,
            }
            for i in issues
        ],
        "logs": logs or [],
    }
