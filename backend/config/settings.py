"""
config/settings.py
StockMind 전체 설정 관리
"""
import json
import logging
from dataclasses import dataclass
from pydantic_settings import BaseSettings
from pydantic import Field, field_validator
from functools import lru_cache

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class KISAccountConfig:
    account_no: str
    app_key: str
    app_secret: str
    is_mock: bool | None = None


@dataclass(frozen=True)
class KiwoomAccountConfig:
    account_no: str
    app_key: str
    app_secret: str
    is_mock: bool | None = None


def _parse_broker_accounts_env(raw: str) -> list[dict]:
    """공용 계좌 설정 파서 — JSON 배열 또는 account|key|secret[|is_mock];... 형식 (KIS/키움 공용)."""
    text = (raw or "").strip()
    if not text:
        return []
    if text.startswith("["):
        data = json.loads(text)
        if not isinstance(data, list):
            raise ValueError("계좌 설정 JSON은 배열이어야 합니다")
        return data

    items: list[dict] = []
    for part in text.split(";"):
        part = part.strip()
        if not part:
            continue
        fields = [f.strip() for f in part.split("|")]
        if len(fields) < 3:
            raise ValueError(
                "계좌 설정 pipe 포맷: account_no|app_key|app_secret[|is_mock];..."
            )
        item: dict = {
            "account_no": fields[0],
            "app_key": fields[1],
            "app_secret": fields[2],
        }
        if len(fields) > 3 and fields[3]:
            item["is_mock"] = fields[3]
        items.append(item)
    return items


class Settings(BaseSettings):
    # ── KIS Open API ──────────────────────────────
    kis_app_key: str = Field("", env="KIS_APP_KEY")
    kis_app_secret: str = Field("", env="KIS_APP_SECRET")
    kis_account_no: str = Field("", env="KIS_ACCOUNT_NO")
    kis_account_nos: str = Field("", env="KIS_ACCOUNT_NOS")  # 공통 키 + 복수 계좌 (레거시)
    kis_accounts: str = Field(default="", validation_alias="KIS_ACCOUNTS")  # 계좌별 키 (JSON 또는 pipe)
    kis_hts_id: str = Field("", env="KIS_HTS_ID")  # HTS 로그인 ID (없으면 계좌번호 앞자리)
    kis_is_mock: bool = Field(True, env="KIS_IS_MOCK")
    autotrade_account_no: str = Field("", env="AUTOTRADE_ACCOUNT_NO")  # 자동매매 전용 계좌 — 이 계좌로만 주문 허용

    def _legacy_kis_account_nos(self) -> list[str]:
        raw = (self.kis_account_nos or "").strip()
        if raw:
            return [a.strip() for a in raw.split(",") if a.strip()]
        if (self.kis_account_no or "").strip():
            return [(self.kis_account_no or "").strip()]
        return []

    def get_kis_accounts(self) -> list[KISAccountConfig]:
        """동기화 대상 계좌 (계좌별 App Key/Secret)."""
        raw = (self.kis_accounts or "").strip()
        if raw:
            try:
                parsed = _parse_broker_accounts_env(raw)
                result: list[KISAccountConfig] = []
                for i, item in enumerate(parsed):
                    if not isinstance(item, dict):
                        continue
                    acct = str(item.get("account_no") or item.get("account") or "").strip()
                    key = str(item.get("app_key") or "").strip()
                    secret = str(item.get("app_secret") or "").strip()
                    mock = item.get("is_mock")
                    if isinstance(mock, str):
                        mock = mock.strip().lower() in ("true", "1", "yes")
                    if acct and key and secret:
                        result.append(KISAccountConfig(acct, key, secret, mock))
                    else:
                        logger.warning(
                            "KIS_ACCOUNTS[%s] skipped — account_no, app_key, app_secret required",
                            i,
                        )
                if result:
                    return result
            except (json.JSONDecodeError, ValueError) as e:
                logger.warning("KIS_ACCOUNTS parse failed: %s", e)

        shared_key = (self.kis_app_key or "").strip()
        shared_secret = (self.kis_app_secret or "").strip()
        if not shared_key or not shared_secret:
            return []

        return [
            KISAccountConfig(acct, shared_key, shared_secret, self.kis_is_mock)
            for acct in self._legacy_kis_account_nos()
        ]

    def kis_account_list(self) -> list[str]:
        return [a.account_no for a in self.get_kis_accounts()]

    def kis_is_configured(self) -> bool:
        return bool(self.get_kis_accounts())

    def kis_account_for(self, account_no: str) -> KISAccountConfig | None:
        for cfg in self.get_kis_accounts():
            if cfg.account_no == account_no:
                return cfg
        return None

    # ── 키움증권 REST API ──────────────────────────
    kiwoom_app_key: str = Field("", env="KIWOOM_APP_KEY")
    kiwoom_app_secret: str = Field("", env="KIWOOM_APP_SECRET")
    kiwoom_account_no: str = Field("", env="KIWOOM_ACCOUNT_NO")
    kiwoom_account_nos: str = Field("", env="KIWOOM_ACCOUNT_NOS")  # 공통 키 + 복수 계좌 (레거시)
    kiwoom_accounts: str = Field(default="", validation_alias="KIWOOM_ACCOUNTS")  # 계좌별 키 (JSON 또는 pipe)
    kiwoom_is_mock: bool = Field(True, env="KIWOOM_IS_MOCK")
    autotrade_kiwoom_account_no: str = Field("", env="AUTOTRADE_KIWOOM_ACCOUNT_NO")  # 키움 자동매매 전용 계좌

    def _legacy_kiwoom_account_nos(self) -> list[str]:
        raw = (self.kiwoom_account_nos or "").strip()
        if raw:
            return [a.strip() for a in raw.split(",") if a.strip()]
        if (self.kiwoom_account_no or "").strip():
            return [(self.kiwoom_account_no or "").strip()]
        return []

    def get_kiwoom_accounts(self) -> list[KiwoomAccountConfig]:
        """동기화 대상 키움 계좌 (계좌별 App Key/Secret)."""
        raw = (self.kiwoom_accounts or "").strip()
        if raw:
            try:
                parsed = _parse_broker_accounts_env(raw)
                result: list[KiwoomAccountConfig] = []
                for i, item in enumerate(parsed):
                    if not isinstance(item, dict):
                        continue
                    acct = str(item.get("account_no") or item.get("account") or "").strip()
                    key = str(item.get("app_key") or "").strip()
                    secret = str(item.get("app_secret") or "").strip()
                    mock = item.get("is_mock")
                    if isinstance(mock, str):
                        mock = mock.strip().lower() in ("true", "1", "yes")
                    if acct and key and secret:
                        result.append(KiwoomAccountConfig(acct, key, secret, mock))
                    else:
                        logger.warning(
                            "KIWOOM_ACCOUNTS[%s] skipped — account_no, app_key, app_secret required",
                            i,
                        )
                if result:
                    return result
            except (json.JSONDecodeError, ValueError) as e:
                logger.warning("KIWOOM_ACCOUNTS parse failed: %s", e)

        shared_key = (self.kiwoom_app_key or "").strip()
        shared_secret = (self.kiwoom_app_secret or "").strip()
        if not shared_key or not shared_secret:
            return []

        return [
            KiwoomAccountConfig(acct, shared_key, shared_secret, self.kiwoom_is_mock)
            for acct in self._legacy_kiwoom_account_nos()
        ]

    def kiwoom_account_list(self) -> list[str]:
        return [a.account_no for a in self.get_kiwoom_accounts()]

    def kiwoom_is_configured(self) -> bool:
        return bool(self.get_kiwoom_accounts())

    def kiwoom_account_for(self, account_no: str) -> KiwoomAccountConfig | None:
        for cfg in self.get_kiwoom_accounts():
            if cfg.account_no == account_no:
                return cfg
        return None

    @field_validator(
        "kis_is_mock",
        "kiwoom_is_mock",
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
        if v is None:
            return False
        if isinstance(v, str):
            s = v.strip()
            if not s:
                return False
            return s.split()[0].lower() in ("true", "1", "yes")
        return v

    @field_validator("db_path", mode="before")
    @classmethod
    def _parse_db_path(cls, v):
        if isinstance(v, str) and not v.strip():
            if __import__("os").environ.get("VERCEL") or __import__("os").environ.get("SERVERLESS"):
                return "/tmp/stockmind.db"
            return "./stockmind.db"
        return v

    @field_validator("alert_threshold", mode="before")
    @classmethod
    def _parse_float(cls, v):
        if isinstance(v, str) and not v.strip():
            return 5.0
        return v

    @field_validator(
        "gemini_api_key",
        "openai_api_key",
        "anthropic_api_key",
        "public_data_api_key",
        mode="before",
    )
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
    public_data_api_key: str = Field("", env="PUBLIC_DATA_API_KEY")
    ai_fallback: bool = Field(False, env="AI_FALLBACK")  # false=선택 provider만, true=429 시만 전환
    ai_skip_if_cached: bool = Field(True, env="AI_SKIP_IF_CACHED")
    enable_bulk_youtube_analyze: bool = Field(False, env="ENABLE_BULK_YOUTUBE_ANALYZE")

    # ── 데이터베이스 ──────────────────────────────
    db_path: str = Field("./stockmind.db", env="DB_PATH")
    db_backup_max_count: int = Field(3, env="DB_BACKUP_MAX_COUNT")
    auto_db_backup_on_start: bool = Field(True, env="AUTO_DB_BACKUP_ON_START")

    # ── 데모 모드 (공개 시연 — demo_portfolio.json, 실보유 미노출) ──
    demo_mode: bool = Field(False, env="DEMO_MODE")
    demo_pin: str = Field("", env="DEMO_PIN")  # 설정 화면 토글용 PIN (평문, .env만)

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
    cron_secret: str = Field("", env="CRON_SECRET")

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


@lru_cache()
def get_settings() -> Settings:
    """싱글톤 설정 인스턴스 반환"""
    return Settings()
