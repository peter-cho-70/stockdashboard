"""
core/ai_analyzer.py
하이브리드 AI 분석 엔진

[파이프라인]
1. YouTube  → Gemini: 영상 내용을 분석 가능한 문서로 추출
2. 뉴스/텍스트 → 본문 그대로 문서화
3. 문서     → Claude(기본) | GPT | Gemini: 종목·매크로·섹터 구조화 분석
"""
import json
import logging
import re
import time
import httpx
from datetime import datetime
from typing import Callable, Literal, Optional
from sqlalchemy.orm import Session

from config.database import IntelContent, StockIssue, Stock
from core.gemini_client import GeminiClient, GeminiAuthError, GeminiQuotaError
from core.signal_extractor import extract_signals

logger = logging.getLogger(__name__)

MAX_RETRIES = 1
RETRY_DELAY = 45

AnalysisProvider = Literal["claude", "openai", "gemini"]
ANALYSIS_PROVIDERS: tuple[AnalysisProvider, ...] = ("claude", "openai", "gemini")
FALLBACK_CHAIN: list[AnalysisProvider] = ["claude", "openai", "gemini"]

SECTORS = "반도체, AI·빅테크, 2차전지, 바이오·헬스케어, 금융, 에너지, 소비재, 자동차, 방산, 부동산·리츠, 기타"

YOUTUBE_EXTRACT_PROMPT = """당신은 경제·주식 유튜브 영상 분석 전문가입니다.
아래 YouTube 영상 내용(자막 또는 URL)을 분석·정리하여 JSON으로만 응답하세요.

출력 항목:
1. title: 영상 제목 (알 수 없으면 빈 문자열)
2. document: 분석용 상세 문서 (한국어, 마크다운 형식 권장)
   - 반드시 2,000자 이상, 가능하면 3,000~5,000자로 풍부하게 작성
   - ## 섹션 제목으로 구조화 (예: ## 핵심 주장, ## 매크로·정책, ## 섹터·종목, ## 수치·데이터, ## 전망·리스크)
   - 발언자/채널의 핵심 주장, 근거, 수치, 종목·섹터 언급, 경제 이벤트를 빠짐없이 정리
   - 시간순 또는 주제별로 구조화, 추상적 요약 금지 — 구체적 내용·숫자·종목명 포함
   - 자막에 있는 내용은 가능한 한 원문 의미를 유지하며 상세히 기록
3. speakers: 주요 발언자 (배열, 없으면 [])
4. topics: 다룬 주제 키워드 (배열, 8~15개)

응답 JSON만 출력:
{"title":"...","document":"...","speakers":[],"topics":[]}"""


class ProviderQuotaError(Exception):
    def __init__(self, provider: str, delay: int = RETRY_DELAY):
        self.provider = provider
        self.delay = delay
        super().__init__(f"{provider.upper()}_QUOTA_EXCEEDED:{delay}")


def _build_analysis_prompt(document: str, portfolio_stocks: list[dict], source_label: str) -> str:
    static, dynamic = _analysis_prompt_parts(portfolio_stocks, source_label, document)
    return static + dynamic


def _analysis_prompt_parts(
    portfolio_stocks: list[dict], source_label: str, document: str
) -> tuple[str, str]:
    stock_section = ""
    if portfolio_stocks:
        items = ", ".join(f"{s['name']}({s['symbol']})" for s in portfolio_stocks)
        stock_section = f"""
10. stock_issues: 보유 종목 중 문서에서 언급된 종목만, 각 2~3문장 요약 + 감성.
   보유 종목: [{items}]
   형식: [{{"symbol":"005930","name":"삼성전자","summary":"...","sentiment":"POSITIVE"}}]
   (언급 없으면 [])"""

    static = f"""당신은 주식·경제 전문 분석가입니다.
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
{{"summary":"","key_points":[],"mentioned_stocks":[],"mentioned_sectors":[],"keywords":[],"sentiment":"NEUTRAL","economic_events":[],"macro_analysis":{{"summary":"","topics":[]}},"sector_analysis":[],"stock_issues":[]}}"""
    dynamic = f"\n\n[문서]\n{document[:20000]}"
    return static, dynamic


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


def normalize_provider(provider: Optional[str], default: str = "claude") -> AnalysisProvider:
    p = (provider or default or "claude").lower().strip()
    if p not in ANALYSIS_PROVIDERS:
        raise ValueError(f"지원하지 않는 analysis_provider: {p} (claude|openai|gemini)")
    return p  # type: ignore[return-value]


def build_provider_chain(
    preferred: AnalysisProvider,
    analyzer: "AIAnalyzer",
    ai_fallback: bool = False,
) -> list[AnalysisProvider]:
    if not ai_fallback:
        return [preferred] if analyzer._provider_ready(preferred) else []
    chain: list[AnalysisProvider] = []
    for p in [preferred] + [x for x in FALLBACK_CHAIN if x != preferred]:
        if p not in chain and analyzer._provider_ready(p):
            chain.append(p)
    return chain


def get_cached_intel_by_url(db: Session, url: str) -> Optional[IntelContent]:
    if not url:
        return None
    return (
        db.query(IntelContent)
        .filter(IntelContent.source_url == url)
        .order_by(IntelContent.id.desc())
        .first()
    )


def try_cached_intel(
    db: Session,
    url: Optional[str],
    *,
    skip_if_cached: bool,
    force_reanalyze: bool,
    on_log: Optional[Callable[[dict], None]] = None,
) -> Optional[tuple[IntelContent, list]]:
    """URL 분석 캐시 hit 시 AI 호출 없이 저장 결과 반환."""
    if not url or force_reanalyze or not skip_if_cached:
        return None
    content = get_cached_intel_by_url(db, url)
    if not content:
        return None
    logs = [
        {
            "level": "info",
            "msg": "📦 저장된 분석 결과 반환 (AI 호출 생략)",
            "ts": datetime.utcnow().strftime("%H:%M:%S"),
        }
    ]
    if on_log:
        for entry in logs:
            on_log(entry)
    return content, logs


class AIAnalyzer:
    def __init__(
        self,
        gemini_api_key: str,
        openai_api_key: str,
        anthropic_api_key: str,
        db: Session,
        openai_model: str = "gpt-4o-mini",
        anthropic_model: str = "claude-3-5-haiku-latest",
        gemini_model: str = "gemini-3.1-flash-lite",
        gemini_extract_model: str = "gemini-3.1-flash-lite",
        gemini_prompt_cache: bool = True,
        gemini_cache_ttl: str = "3600s",
        default_provider: str = "claude",
        ai_fallback: bool = False,
        on_log: Optional[Callable[[dict], None]] = None,
    ):
        self.gemini_api_key = gemini_api_key
        self.openai_api_key = openai_api_key
        self.anthropic_api_key = anthropic_api_key
        self.openai_model = openai_model
        self.anthropic_model = anthropic_model
        self.gemini_model = gemini_model
        self.gemini_extract_model = gemini_extract_model
        self.gemini_prompt_cache = gemini_prompt_cache
        self.gemini_cache_ttl = gemini_cache_ttl
        self.default_provider = normalize_provider(default_provider)
        self.ai_fallback = ai_fallback
        self.db = db
        self._on_log = on_log
        self._gemini: Optional[GeminiClient] = None
        self._openai = None
        self._anthropic = None
        self.logs: list[dict] = []
        self._setup()

    def _log(self, level: str, msg: str):
        entry = {"level": level, "msg": msg, "ts": datetime.utcnow().strftime("%H:%M:%S")}
        self.logs.append(entry)
        if self._on_log:
            try:
                self._on_log(entry)
            except Exception:
                pass
        getattr(logger, level if level != "warn" else "warning", logger.info)(msg)

    def _provider_ready(self, provider: AnalysisProvider) -> bool:
        if provider == "claude":
            return bool(self._anthropic)
        if provider == "openai":
            return bool(self._openai)
        if provider == "gemini":
            return bool(self._gemini and self._gemini.ready)
        return False

    def _setup(self):
        if self.gemini_api_key:
            try:
                self._gemini = GeminiClient(
                    api_key=self.gemini_api_key,
                    model=self.gemini_model,
                    extract_model=self.gemini_extract_model,
                    prompt_cache_enabled=self.gemini_prompt_cache,
                    cache_ttl=self.gemini_cache_ttl,
                    on_log=lambda level, msg: self._log(level, msg),
                )
                if self._gemini.ready:
                    self._log(
                        "info",
                        f"✅ Gemini 초기화 ({self.gemini_extract_model} 추출 / {self.gemini_model} 분석, google-genai SDK)",
                    )
                else:
                    self._gemini = None
                    self._log("error", "❌ Gemini Client 초기화 실패")
            except Exception as e:
                self._log("error", f"❌ Gemini 초기화 실패: {e}")
        else:
            self._log("warn", "⚠️ GEMINI_API_KEY 미설정 — YouTube 분석 불가")

        if self.anthropic_api_key:
            try:
                from anthropic import Anthropic
                self._anthropic = Anthropic(api_key=self.anthropic_api_key)
                self._log("info", f"✅ Claude 초기화 ({self.anthropic_model}) — 기본 구조화 분석")
            except Exception as e:
                self._log("error", f"❌ Claude 초기화 실패: {e}")
        else:
            self._log("warn", "⚠️ ANTHROPIC_API_KEY 미설정 — Claude 분석 불가")

        if self.openai_api_key:
            try:
                from openai import OpenAI
                self._openai = OpenAI(api_key=self.openai_api_key)
                self._log("info", f"✅ OpenAI 초기화 ({self.openai_model}) — GPT 분석 옵션")
            except Exception as e:
                self._log("error", f"❌ OpenAI 초기화 실패: {e}")
        else:
            self._log("warn", "⚠️ OPENAI_API_KEY 미설정 — GPT 분석 불가")

    def _call_gemini_raw(
        self,
        prompt: str,
        purpose: str = "문서 추출",
        *,
        cache_key: Optional[str] = None,
        cache_static: Optional[str] = None,
        model: Optional[str] = None,
    ) -> Optional[str]:
        if not self._gemini or not self._gemini.ready:
            self._log("error", "❌ Gemini 미초기화")
            return None
        try:
            return self._gemini.generate_text(
                prompt,
                purpose=purpose,
                model=model or self.gemini_extract_model,
                cache_key=cache_key,
                cache_static=cache_static,
            )
        except GeminiAuthError:
            raise
        except GeminiQuotaError as e:
            raise ProviderQuotaError("gemini", e.delay)

    def _call_gemini_json(
        self,
        prompt: str,
        purpose: str = "구조화 분석",
        *,
        cache_key: Optional[str] = None,
        cache_static: Optional[str] = None,
        model: Optional[str] = None,
    ) -> Optional[dict]:
        if not self._gemini or not self._gemini.ready:
            self._log("error", "❌ Gemini 미초기화")
            return None
        try:
            return self._gemini.generate_json(
                prompt,
                purpose=purpose,
                model=model or self.gemini_model,
                cache_key=cache_key,
                cache_static=cache_static,
                system_instruction="주식·경제 전문 분석가. 반드시 유효한 JSON만 출력.",
            )
        except GeminiAuthError:
            raise
        except GeminiQuotaError as e:
            raise ProviderQuotaError("gemini", e.delay)

    def _call_claude(self, prompt: str) -> Optional[dict]:
        if not self._anthropic:
            self._log("error", "❌ Claude 미초기화 — ANTHROPIC_API_KEY 확인")
            return None
        self._log("info", f"🤖 Claude 분석 요청 ({self.anthropic_model}, {len(prompt):,}자)")
        for attempt in range(1, MAX_RETRIES + 1):
            try:
                resp = self._anthropic.messages.create(
                    model=self.anthropic_model,
                    max_tokens=4096,
                    system="주식·경제 전문 분석가. 반드시 유효한 JSON만 출력.",
                    messages=[{"role": "user", "content": prompt}],
                    temperature=0.3,
                )
                raw = resp.content[0].text if resp.content else ""
                result = _extract_json(raw)
                if result:
                    self._log("info", "✅ Claude 분석 완료 (종목·매크로·섹터)")
                    return result
                self._log("error", f"❌ Claude JSON 파싱 실패: {raw[:200]}")
                return None
            except Exception as e:
                err = str(e)
                if "429" in err or "rate_limit" in err.lower() or "overloaded" in err.lower():
                    if attempt < MAX_RETRIES:
                        self._log("warn", f"⏳ Claude Rate limit — {RETRY_DELAY}초 후 재시도 ({attempt}/{MAX_RETRIES})")
                        time.sleep(RETRY_DELAY)
                        continue
                    raise ProviderQuotaError("claude", RETRY_DELAY)
                self._log("error", f"❌ Claude 실패: {err[:200]}")
                return None
        return None

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
                    if attempt < MAX_RETRIES:
                        self._log("warn", f"⏳ GPT Rate limit — {RETRY_DELAY}초 후 재시도 ({attempt}/{MAX_RETRIES})")
                        time.sleep(RETRY_DELAY)
                        continue
                    raise ProviderQuotaError("openai", RETRY_DELAY)
                self._log("error", f"❌ GPT 실패: {err[:200]}")
                return None
        return None

    def _call_provider(
        self,
        provider: AnalysisProvider,
        prompt: str,
        gemini_cache: Optional[dict] = None,
    ) -> Optional[dict]:
        if provider == "claude":
            return self._call_claude(prompt)
        if provider == "openai":
            return self._call_gpt(prompt)
        if provider == "gemini":
            if gemini_cache:
                return self._call_gemini_json(
                    gemini_cache.get("dynamic", prompt),
                    purpose="구조화 분석",
                    cache_key=gemini_cache.get("cache_key"),
                    cache_static=gemini_cache.get("cache_static"),
                )
            return self._call_gemini_json(prompt, purpose="구조화 분석")
        return None

    def _get_portfolio(self) -> list[dict]:
        stocks = self.db.query(Stock).filter(Stock.is_active == True).all()
        return [{"symbol": s.symbol, "name": s.name} for s in stocks]

    def _analyze_document(
        self,
        document: str,
        portfolio: list[dict],
        source_label: str,
        provider: Optional[str] = None,
    ) -> Optional[dict]:
        preferred = normalize_provider(provider, self.default_provider)
        static, dynamic = _analysis_prompt_parts(portfolio, source_label, document)
        prompt = static + dynamic
        gemini_cache = {"cache_key": "analysis_v1", "cache_static": static, "dynamic": dynamic}
        return self._run_provider_chain(preferred, prompt, "📊 분석 AI", gemini_cache=gemini_cache)

    def analyze_json_prompt(
        self, prompt: str, provider: Optional[str] = None, log_label: str = "JSON 분석"
    ) -> Optional[dict]:
        """임의 프롬프트 → provider chain으로 JSON 분석"""
        preferred = normalize_provider(provider, self.default_provider)
        return self._run_provider_chain(preferred, prompt, f"🤖 {log_label}")

    def _run_provider_chain(
        self,
        preferred: AnalysisProvider,
        prompt: str,
        log_prefix: str,
        gemini_cache: Optional[dict] = None,
    ) -> Optional[dict]:
        chain = build_provider_chain(preferred, self, self.ai_fallback)
        if not chain:
            self._log("error", "❌ 구조화 분석 API 키 없음 (ANTHROPIC / OPENAI / GEMINI)")
            return None

        if self.ai_fallback and len(chain) > 1:
            self._log("info", f"{log_prefix}: {preferred} (429 시 fallback: {' → '.join(chain[1:])})")
        else:
            self._log("info", f"{log_prefix}: {preferred} (단일 provider, fallback 없음)")

        for i, p in enumerate(chain):
            try:
                result = self._call_provider(p, prompt, gemini_cache if p == "gemini" else None)
                if result:
                    if i > 0:
                        self._log("info", f"↪️ {chain[i - 1]} quota 초과 → {p}로 완료")
                    return result
                self._log("warn", f"❌ {p} 분석 실패 — 추가 provider 시도하지 않음")
                break
            except ProviderQuotaError:
                if self.ai_fallback and i < len(chain) - 1:
                    self._log("warn", f"↪️ {p} quota 초과 → {chain[i + 1]}로 전환")
                    continue
                raise
        self._log("error", "❌ 분석 AI 실패")
        return None

    def analyze_youtube(
        self,
        url: str,
        channel_name: str = "",
        analysis_provider: Optional[str] = None,
    ) -> Optional[IntelContent]:
        self._log("info", f"🎬 YouTube 분석 시작: {url}")
        if not self._gemini or not self._gemini.ready:
            self._log("error", "❌ Gemini API 키 필요 (YouTube 문서 추출)")
            return None

        portfolio = self._get_portfolio()
        title = self._get_youtube_title(url) or ""

        transcript = self._get_youtube_transcript(url)
        if transcript:
            self._log("info", f"📝 자막 {len(transcript):,}자 → Gemini 문서화")
            extract_dynamic = f"[YouTube 자막]\n{transcript[:30000]}"
        else:
            self._log("warn", "⚠️ 자막 없음 → Gemini URL 직접 분석")
            extract_dynamic = f"[YouTube URL]\n{url}"

        extracted = self._call_gemini_json(
            extract_dynamic,
            purpose="YouTube 문서 추출",
            cache_key="youtube_extract_v1",
            cache_static=YOUTUBE_EXTRACT_PROMPT,
            model=self.gemini_extract_model,
        )
        if not extracted:
            self._log("error", "❌ Gemini 문서 추출 실패")
            return None

        document = extracted.get("document", "")
        if not document:
            document = extracted.get("summary", "") or json.dumps(extracted, ensure_ascii=False)
        if title:
            extracted["title"] = title
        self._log("info", f"📄 Gemini 문서 추출 완료 ({len(document):,}자)")

        analysis = self._analyze_document(document, portfolio, "YouTube", analysis_provider)
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

    def analyze_url(self, url: str, analysis_provider: Optional[str] = None) -> Optional[IntelContent]:
        self._log("info", f"📰 뉴스 분석: {url}")
        text = self._fetch_article(url)
        if not text:
            return None
        portfolio = self._get_portfolio()
        analysis = self._analyze_document(text[:30000], portfolio, "뉴스", analysis_provider)
        if not analysis:
            return None
        return self._save_intel_content(
            source_type="NEWS",
            source_url=url,
            analysis=analysis,
            portfolio=portfolio,
            source_document=text[:30000],
        )

    def analyze_text(
        self,
        text: str,
        title: str = "",
        analysis_provider: Optional[str] = None,
    ) -> Optional[IntelContent]:
        label = title[:30] if title else "(제목없음)"
        self._log("info", f"📝 텍스트 분석: {label} ({len(text):,}자)")
        portfolio = self._get_portfolio()
        doc = text[:30000]
        analysis = self._analyze_document(doc, portfolio, "텍스트", analysis_provider)
        if not analysis:
            return None
        return self._save_intel_content(
            source_type="TEXT",
            source_title=title,
            analysis=analysis,
            portfolio=portfolio,
            source_document=doc,
        )

    def reanalyze_content(
        self,
        content_id: int,
        analysis_provider: Optional[str] = None,
    ) -> Optional[IntelContent]:
        content = self.db.query(IntelContent).filter(IntelContent.id == content_id).first()
        if not content:
            self._log("error", f"❌ 콘텐츠 ID {content_id} 없음")
            return None
        if not content.source_document:
            self._log("error", "❌ 저장된 원문 없음 — 재분석 불가")
            return None

        self._log("info", f"🔄 재분석 (ID:{content_id}, Gemini 재호출 없음)")
        portfolio = self._get_portfolio()
        label = {"YOUTUBE": "YouTube", "NEWS": "뉴스", "TEXT": "텍스트"}.get(content.source_type, "문서")
        analysis = self._analyze_document(content.source_document, portfolio, label, analysis_provider)
        if not analysis:
            return None

        self.db.query(StockIssue).filter(StockIssue.content_id == content_id).delete()
        macro = analysis.get("macro_analysis") or {}
        sectors = analysis.get("sector_analysis") or []
        content.summary = analysis.get("summary", "")
        content.key_points = json.dumps(analysis.get("key_points", []), ensure_ascii=False)
        content.mentioned_stocks = json.dumps(analysis.get("mentioned_stocks", []), ensure_ascii=False)
        content.mentioned_sectors = json.dumps(analysis.get("mentioned_sectors", []), ensure_ascii=False)
        content.keywords = json.dumps(analysis.get("keywords", []), ensure_ascii=False)
        content.macro_analysis = json.dumps(macro, ensure_ascii=False)
        content.sector_analysis = json.dumps(sectors, ensure_ascii=False)
        content.sentiment = analysis.get("sentiment", "NEUTRAL")
        content.analyzed_at = datetime.utcnow()
        self._save_stock_issues(content, analysis, portfolio)
        self.db.commit()
        self._log("info", f"✅ 재분석 완료 (ID:{content_id})")
        return content

    def _get_youtube_transcript(self, url: str) -> Optional[str]:
        try:
            from youtube_transcript_api import YouTubeTranscriptApi
            vid = re.search(r"(?:v=|youtu\.be/)([a-zA-Z0-9_-]{11})", url)
            if not vid:
                return None
            video_id = vid.group(1)
            self._log("info", f"🔍 자막 추출 (video_id: {video_id})")
            ytt = YouTubeTranscriptApi()
            for langs in [["ko"], ["en"], ["ko", "en"]]:
                try:
                    fetched = ytt.fetch(video_id, languages=langs)
                    text = " ".join(s.text for s in fetched)
                    if text.strip():
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
            r = httpx.get(
                "https://www.youtube.com/oembed",
                params={"url": url, "format": "json"},
                timeout=5,
            )
            return r.json().get("title")
        except Exception:
            return None

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
                text = soup.get_text(separator="\n", strip=True)[:30000]
                self._log("info", f"✅ 본문 {len(text):,}자")
                return text
            except ImportError:
                return resp.text[:30000]
        except Exception as e:
            self._log("error", f"❌ 크롤링 실패: {str(e)[:120]}")
            return None

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
            source_document=source_document[:50000] if source_document else None,
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

        # 신호 자동 파생
        try:
            portfolio_symbols = {s["symbol"] for s in portfolio if s.get("symbol")}
            extract_signals(content, self.db, portfolio_symbols)
        except Exception as _e:
            self._log("warn", f"⚠️ 신호 파생 실패 (무시): {_e}")

        return content

    def _save_stock_issues(self, content: IntelContent, analysis: dict, portfolio: list[dict]):
        issues_from_ai = analysis.get("stock_issues", [])
        self._log("info", f"🗂️ 보유 종목 매핑 ({len(issues_from_ai)}개)")

        name_map = {s["name"]: s["symbol"] for s in portfolio}
        db_stocks = {
            s.symbol: s
            for s in self.db.query(Stock).filter(Stock.is_active == True).all()
        }
        saved_symbols: set[str] = set()

        for issue in issues_from_ai:
            symbol = issue.get("symbol", "")
            name = issue.get("name", "")
            db_stock = db_stocks.get(symbol) or db_stocks.get(name_map.get(name, ""))
            if not db_stock:
                continue
            self.db.add(
                StockIssue(
                    stock_id=db_stock.id,
                    content_id=content.id,
                    issue_summary=issue.get("summary", analysis.get("summary", "")[:200]),
                    sentiment=issue.get("sentiment", analysis.get("sentiment", "NEUTRAL")),
                )
            )
            saved_symbols.add(db_stock.symbol)
            self._log("info", f"🔗 {db_stock.name} [{issue.get('sentiment', '?')}]")

        mentioned = analysis.get("mentioned_stocks", [])
        for stock in db_stocks.values():
            if stock.symbol in saved_symbols:
                continue
            if any(stock.symbol.upper() in str(m).upper() or stock.name in str(m) for m in mentioned):
                self.db.add(
                    StockIssue(
                        stock_id=stock.id,
                        content_id=content.id,
                        issue_summary=analysis.get("summary", "")[:200],
                        sentiment=analysis.get("sentiment", "NEUTRAL"),
                    )
                )
                self._log("info", f"🔗 {stock.name} (fallback)")


def create_analyzer(db: Session, on_log: Optional[Callable[[dict], None]] = None) -> AIAnalyzer:
    from config.settings import get_settings
    s = get_settings()
    return AIAnalyzer(
        gemini_api_key=s.gemini_api_key,
        openai_api_key=s.openai_api_key,
        anthropic_api_key=s.anthropic_api_key,
        db=db,
        openai_model=s.openai_model,
        anthropic_model=s.anthropic_model,
        gemini_model=s.gemini_model,
        gemini_extract_model=s.gemini_extract_model,
        gemini_prompt_cache=s.gemini_prompt_cache,
        gemini_cache_ttl=s.gemini_cache_ttl,
        default_provider=s.analysis_provider,
        ai_fallback=s.ai_fallback,
        on_log=on_log,
    )


def ensure_analysis_available(settings, provider: Optional[str] = None) -> AnalysisProvider:
    """요청 provider + fallback chain 중 하나라도 키가 있어야 함."""
    preferred = normalize_provider(provider, settings.analysis_provider)
    key_map = {
        "claude": settings.anthropic_api_key,
        "openai": settings.openai_api_key,
        "gemini": settings.gemini_api_key,
    }
    chain = [preferred] + [p for p in FALLBACK_CHAIN if p != preferred]
    if not any(key_map.get(p) for p in chain):
        raise ValueError(
            "구조화 분석 API 키가 없습니다. ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY 중 하나 이상 필요"
        )
    return preferred


def handle_provider_runtime_error(e: Exception) -> None:
    from fastapi import HTTPException
    if isinstance(e, GeminiAuthError):
        raise HTTPException(status_code=401, detail=e.message)
    if isinstance(e, ProviderQuotaError):
        raise HTTPException(
            status_code=429,
            detail=f"{e.provider.upper()} API 한도 초과. {e.delay}초 후 재시도하거나 다른 AI를 선택하세요.",
        )
    err = str(e)
    if err.startswith("GEMINI_QUOTA_EXCEEDED:"):
        secs = err.split(":")[1]
        raise HTTPException(status_code=429, detail=f"Gemini API 한도 초과. {secs}초 후 재시도.")
    if err.startswith("OPENAI_QUOTA_EXCEEDED:"):
        secs = err.split(":")[1]
        raise HTTPException(status_code=429, detail=f"OpenAI API 한도 초과. {secs}초 후 재시도.")
    if err.startswith("CLAUDE_QUOTA_EXCEEDED:"):
        secs = err.split(":")[1]
        raise HTTPException(status_code=429, detail=f"Claude API 한도 초과. {secs}초 후 재시도.")
    raise HTTPException(status_code=500, detail=err)


def serialize_intel(content: IntelContent, db: Session, logs: list | None = None) -> dict:
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
        "source_document": content.source_document,
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
