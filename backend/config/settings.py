"""
config/settings.py
StockMind 전체 설정 관리
"""
from pydantic_settings import BaseSettings
from pydantic import Field, field_validator
from functools import lru_cache


class Settings(BaseSettings):
    # ── KIS Open API ──────────────────────────────
    kis_app_key: str = Field("", env="KIS_APP_KEY")
    kis_app_secret: str = Field("", env="KIS_APP_SECRET")
    kis_account_no: str = Field("", env="KIS_ACCOUNT_NO")
    kis_is_mock: bool = Field(True, env="KIS_IS_MOCK")

    @field_validator(
        "kis_is_mock",
        "debug",
        "ai_fallback",
        "ai_skip_if_cached",
        "enable_bulk_youtube_analyze",
        "gemini_prompt_cache",
        "demo_mode",
        mode="before",
    )
    @classmethod
    def _parse_bool(cls, v):
        if isinstance(v, str):
            return v.strip().split()[0].lower() in ("true", "1", "yes")
        return v

    @field_validator("gemini_api_key", "openai_api_key", "anthropic_api_key", mode="before")
    @classmethod
    def _strip_api_key(cls, v):
        if isinstance(v, str):
            return v.strip().strip('"').strip("'")
        return v

    # ── AI API ────────────────────────────────────
    gemini_api_key: str = Field("", env="GEMINI_API_KEY")       # AIzaSy... 또는 AQ.... (신규)
    gemini_model: str = Field("gemini-3.1-flash-lite", env="GEMINI_MODEL")
    gemini_extract_model: str = Field("gemini-3.1-flash-lite", env="GEMINI_EXTRACT_MODEL")
    gemini_prompt_cache: bool = Field(False, env="GEMINI_PROMPT_CACHE")
    gemini_cache_ttl: str = Field("3600s", env="GEMINI_CACHE_TTL")
    anthropic_api_key: str = Field("", env="ANTHROPIC_API_KEY")  # Claude (기본 분석)
    anthropic_model: str = Field("claude-3-5-haiku-latest", env="ANTHROPIC_MODEL")
    openai_api_key: str = Field("", env="OPENAI_API_KEY")       # GPT (분석 옵션)
    openai_model: str = Field("gpt-4o-mini", env="OPENAI_MODEL")
    analysis_provider: str = Field("gemini", env="ANALYSIS_PROVIDER")  # claude|openai|gemini
    youtube_api_key: str = Field("", env="YOUTUBE_API_KEY")
    ai_fallback: bool = Field(False, env="AI_FALLBACK")  # false=선택 provider만, true=429 시만 전환
    ai_skip_if_cached: bool = Field(True, env="AI_SKIP_IF_CACHED")
    enable_bulk_youtube_analyze: bool = Field(False, env="ENABLE_BULK_YOUTUBE_ANALYZE")

    # ── 데이터베이스 ──────────────────────────────
    db_path: str = Field("./stockmind.db", env="DB_PATH")

    # ── 데모 모드 (공개 시연 — demo_portfolio.json, 실보유 미노출) ──
    demo_mode: bool = Field(False, env="DEMO_MODE")

    # ── 알림 설정 ─────────────────────────────────
    alert_threshold: float = Field(5.0, env="ALERT_THRESHOLD")
    smtp_host: str = Field("smtp.gmail.com", env="SMTP_HOST")
    smtp_port: int = Field(587, env="SMTP_PORT")
    smtp_email: str = Field("", env="SMTP_EMAIL")
    smtp_password: str = Field("", env="SMTP_PASSWORD")

    # ── 앱 설정 ───────────────────────────────────
    app_host: str = Field("0.0.0.0", env="APP_HOST")
    app_port: int = Field(8000, env="APP_PORT")
    debug: bool = Field(False, env="DEBUG")

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


@lru_cache()
def get_settings() -> Settings:
    """싱글톤 설정 인스턴스 반환"""
    return Settings()
