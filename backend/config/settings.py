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

    @field_validator("kis_is_mock", "debug", mode="before")
    @classmethod
    def _parse_bool(cls, v):
        if isinstance(v, str):
            return v.strip().split()[0].lower() in ("true", "1", "yes")
        return v

    # ── AI API ────────────────────────────────────
    gemini_api_key: str = Field("", env="GEMINI_API_KEY")   # YouTube 문서 추출
    openai_api_key: str = Field("", env="OPENAI_API_KEY")   # 종목·매크로·섹터 분석
    openai_model: str = Field("gpt-4o-mini", env="OPENAI_MODEL")
    youtube_api_key: str = Field("", env="YOUTUBE_API_KEY")

    # ── 데이터베이스 ──────────────────────────────
    db_path: str = Field("./stockmind.db", env="DB_PATH")

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
