"""
core/gemini_client.py
Google GenAI SDK (google-genai) — gemini-3.1-flash-lite + prompt cache
"""
import hashlib
import json
import logging
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Optional

from google import genai
from google.genai import types

logger = logging.getLogger(__name__)

DEFAULT_MODEL = "gemini-3.1-flash-lite"
CACHE_DIR = Path(__file__).resolve().parent.parent / "data"
CACHE_FILE = CACHE_DIR / "gemini_prompt_cache.json"
# Google cached content requires ~1024+ tokens; our static prompts are smaller.
MIN_CACHE_STATIC_CHARS = 4000
MAX_RETRIES = 1
RETRY_DELAY = 45


class GeminiAuthError(Exception):
    """API key invalid, expired, or revoked."""

    def __init__(self, message: str = "Gemini API 키가 만료되었거나 유효하지 않습니다."):
        self.message = message
        super().__init__(message)


class GeminiQuotaError(Exception):
    def __init__(self, delay: int = RETRY_DELAY):
        self.delay = delay
        super().__init__(f"GEMINI_QUOTA_EXCEEDED:{delay}")


def _extract_json(text: str) -> Optional[dict]:
    text = (text or "").strip()
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


class GeminiClient:
    def __init__(
        self,
        api_key: str,
        model: str = DEFAULT_MODEL,
        extract_model: str = DEFAULT_MODEL,
        prompt_cache_enabled: bool = True,
        cache_ttl: str = "3600s",
        on_log: Optional[Callable[[str, str], None]] = None,
    ):
        self.model = model or DEFAULT_MODEL
        self.extract_model = extract_model or self.model
        self.prompt_cache_enabled = prompt_cache_enabled
        self.cache_ttl = cache_ttl
        self._on_log = on_log
        self._client: Optional[genai.Client] = None

        self._cache_disabled_reason: Optional[str] = None

        if api_key:
            api_key = api_key.strip()
            try:
                self._client = genai.Client(api_key=api_key)
                prefix = "AQ." if api_key.startswith("AQ.") else "AIzaSy" if api_key.startswith("AIza") else api_key[:4]
                self._log("info", f"🔑 Gemini 키 로드 ({prefix}..., {len(api_key)}자)")
            except Exception as e:
                self._log("error", f"❌ Gemini Client 초기화 실패: {e}")

    @property
    def ready(self) -> bool:
        return self._client is not None

    def _log(self, level: str, msg: str):
        if self._on_log:
            try:
                self._on_log(level, msg)
            except Exception:
                pass
        getattr(logger, level if level != "warn" else "warning", logger.info)(msg)

    def _load_cache_index(self) -> dict:
        if not CACHE_FILE.exists():
            return {"entries": {}}
        try:
            return json.loads(CACHE_FILE.read_text(encoding="utf-8"))
        except Exception:
            return {"entries": {}}

    def _save_cache_index(self, data: dict):
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        CACHE_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

    def _content_hash(self, text: str) -> str:
        return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]

    def _parse_api_error(self, err: str) -> Optional[Exception]:
        lower = err.lower()
        if "api key expired" in lower or "api key not valid" in lower or "invalid api key" in lower:
            return GeminiAuthError(
                "Gemini API 키가 만료되었거나 유효하지 않습니다. "
                "AI Studio에서 새 키(AIzaSy... 또는 AQ....)를 발급하고 백엔드를 재시작하세요."
            )
        if "429" in err or "resource_exhausted" in lower or "quota" in lower:
            delay_match = re.search(r"seconds:\s*(\d+)", err)
            delay = int(delay_match.group(1)) + 5 if delay_match else RETRY_DELAY
            return GeminiQuotaError(delay)
        return None

    def _should_skip_prompt_cache(self, static_text: str) -> bool:
        if not self.prompt_cache_enabled:
            return True
        if self._cache_disabled_reason:
            return True
        if len(static_text) < MIN_CACHE_STATIC_CHARS:
            return True
        return False

    def _handle_cache_error(self, err: str) -> None:
        lower = err.lower()
        if "cached content is too small" in lower or "min_total_token_count" in lower:
            self._cache_disabled_reason = "static_prompt_too_small"
            return
        if "freetier limit exceeded" in lower and "limit=0" in lower:
            self._cache_disabled_reason = "free_tier_no_context_cache"
            self._log(
                "info",
                "ℹ️ Gemini prompt cache — 무료 tier 미지원, 전체 프롬프트로 진행",
            )
            return
        parsed = self._parse_api_error(err)
        if isinstance(parsed, GeminiAuthError):
            raise parsed
        self._log("warn", f"⚠️ Gemini prompt cache 실패 — 전체 프롬프트 사용: {err[:120]}")

    def _get_cached_content_name(self, cache_key: str, static_text: str, model: str) -> Optional[str]:
        if not self._client:
            return None
        if self._should_skip_prompt_cache(static_text):
            return None

        content_hash = self._content_hash(static_text)
        index = self._load_cache_index()
        entry = index.get("entries", {}).get(cache_key)
        if entry and entry.get("hash") == content_hash and entry.get("model") == model:
            cache_name = entry.get("cache_name")
            if cache_name:
                try:
                    self._client.caches.get(name=cache_name)
                    return cache_name
                except Exception:
                    pass

        try:
            created = self._client.caches.create(
                model=model,
                config=types.CreateCachedContentConfig(
                    display_name=f"stockmind-{cache_key}-{content_hash}",
                    contents=[static_text],
                    ttl=self.cache_ttl,
                ),
            )
            cache_name = created.name
            index.setdefault("entries", {})[cache_key] = {
                "hash": content_hash,
                "cache_name": cache_name,
                "model": model,
                "created_at": datetime.now(timezone.utc).isoformat(),
            }
            self._save_cache_index(index)
            self._log("info", f"📦 Gemini prompt cache 생성 ({cache_key})")
            return cache_name
        except GeminiAuthError:
            raise
        except Exception as e:
            self._handle_cache_error(str(e))
            return None

    def _handle_error(self, err: str, attempt: int):
        """None=retry, Exception=raise, False=generic fail."""
        parsed = self._parse_api_error(err)
        if isinstance(parsed, GeminiAuthError):
            return parsed
        if isinstance(parsed, GeminiQuotaError):
            if attempt < MAX_RETRIES:
                self._log("warn", f"⏳ Gemini Quota 초과 — {parsed.delay}초 후 재시도 ({attempt}/{MAX_RETRIES})")
                time.sleep(parsed.delay)
                return None
            return parsed
        return False

    def generate_text(
        self,
        contents: str,
        *,
        purpose: str = "텍스트 생성",
        model: Optional[str] = None,
        cache_key: Optional[str] = None,
        cache_static: Optional[str] = None,
    ) -> Optional[str]:
        if not self._client:
            self._log("error", "❌ Gemini Client 미초기화")
            return None

        use_model = model or self.model
        prompt_len = len(contents) + (len(cache_static or "") if cache_static else 0)
        self._log("info", f"📡 Gemini 호출 ({purpose}, {use_model}, {prompt_len:,}자)")

        cached_name = None
        dynamic = contents
        if cache_key and cache_static:
            cached_name = self._get_cached_content_name(cache_key, cache_static, use_model)

        for attempt in range(1, MAX_RETRIES + 1):
            try:
                config = types.GenerateContentConfig(temperature=0.3, max_output_tokens=8192)
                if cached_name:
                    config.cached_content = cached_name

                resp = self._client.models.generate_content(
                    model=use_model,
                    contents=dynamic if cached_name else (f"{cache_static}\n\n{dynamic}" if cache_static else dynamic),
                    config=config,
                )
                text = resp.text or ""
                if text.strip():
                    self._log("info", "✅ Gemini 응답 수신")
                    return text
                self._log("error", "❌ Gemini 빈 응답")
                return None
            except (GeminiQuotaError, GeminiAuthError):
                raise
            except Exception as e:
                err = str(e)
                outcome = self._handle_error(err, attempt)
                if outcome is None:
                    continue
                if isinstance(outcome, Exception):
                    self._log("error", f"❌ {outcome}")
                    raise outcome
                self._log("error", f"❌ Gemini 실패: {err[:200]}")
                return None
        return None

    def generate_json(
        self,
        contents: str,
        *,
        purpose: str = "JSON 분석",
        model: Optional[str] = None,
        cache_key: Optional[str] = None,
        cache_static: Optional[str] = None,
        system_instruction: Optional[str] = None,
    ) -> Optional[dict]:
        if not self._client:
            self._log("error", "❌ Gemini Client 미초기화")
            return None

        use_model = model or self.model
        prompt_len = len(contents) + (len(cache_static or "") if cache_static else 0)
        self._log("info", f"📡 Gemini JSON ({purpose}, {use_model}, {prompt_len:,}자)")

        cached_name = None
        dynamic = contents
        if cache_key and cache_static:
            cached_name = self._get_cached_content_name(cache_key, cache_static, use_model)

        for attempt in range(1, MAX_RETRIES + 1):
            try:
                config = types.GenerateContentConfig(
                    temperature=0.3,
                    response_mime_type="application/json",
                )
                if system_instruction:
                    config.system_instruction = system_instruction
                if cached_name:
                    config.cached_content = cached_name

                resp = self._client.models.generate_content(
                    model=use_model,
                    contents=dynamic if cached_name else (f"{cache_static}\n\n{dynamic}" if cache_static else dynamic),
                    config=config,
                )
                raw = resp.text or ""
                result = _extract_json(raw)
                if result:
                    self._log("info", "✅ Gemini JSON 완료")
                    return result
                self._log("error", f"❌ Gemini JSON 파싱 실패: {raw[:200]}")
                return None
            except (GeminiQuotaError, GeminiAuthError):
                raise
            except Exception as e:
                err = str(e)
                outcome = self._handle_error(err, attempt)
                if outcome is None:
                    continue
                if isinstance(outcome, Exception):
                    self._log("error", f"❌ {outcome}")
                    raise outcome
                self._log("error", f"❌ Gemini 실패: {err[:200]}")
                return None
        return None
