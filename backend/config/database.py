"""
config/database.py
SQLAlchemy 데이터베이스 모델 및 연결 관리
"""
from datetime import datetime
from sqlalchemy import (
    create_engine, Column, Integer, String, Float,
    DateTime, Boolean, Text, ForeignKey
)
from sqlalchemy.orm import DeclarativeBase, relationship, sessionmaker
from config.settings import get_settings

settings = get_settings()
engine = create_engine(
    f"sqlite:///{settings.db_path}",
    connect_args={"check_same_thread": False}
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


# ─────────────────────────────────────────────
# 보유 종목
# ─────────────────────────────────────────────
class Stock(Base):
    __tablename__ = "stocks"

    id = Column(Integer, primary_key=True, index=True)
    symbol = Column(String(20), unique=True, nullable=False, index=True)  # 종목코드
    name = Column(String(100), nullable=False)                            # 종목명
    market = Column(String(20), nullable=False)    # KRX / NASDAQ / NYSE / etc
    sector = Column(String(50), nullable=True)     # 섹터
    currency = Column(String(10), default="KRW")  # KRW / USD

    # 보유 정보 (KIS API에서 동기화)
    qty = Column(Float, default=0)                 # 보유수량
    avg_price = Column(Float, default=0)           # 평균매입단가
    purchase_amount = Column(Float, default=0)     # 매입금액

    # 현재 시세 (매일 갱신)
    current_price = Column(Float, default=0)       # 현재가
    prev_price = Column(Float, default=0)          # 전일 종가
    change_rate = Column(Float, default=0)         # 전일 대비 등락률(%)

    # 메타
    memo = Column(Text, nullable=True)             # 투자 thesis / 메모
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    last_synced_at = Column(DateTime, nullable=True)  # KIS 마지막 동기화 시각

    # 관계
    price_history = relationship("PriceHistory", back_populates="stock")
    issues = relationship("StockIssue", back_populates="stock")

    @property
    def current_value(self) -> float:
        """현재 평가금액"""
        return self.qty * self.current_price

    @property
    def profit_loss(self) -> float:
        """수익금액"""
        return self.current_value - self.purchase_amount

    @property
    def profit_rate(self) -> float:
        """수익률(%)"""
        if self.purchase_amount == 0:
            return 0.0
        return (self.profit_loss / self.purchase_amount) * 100


# ─────────────────────────────────────────────
# 일별 가격 이력
# ─────────────────────────────────────────────
class PriceHistory(Base):
    __tablename__ = "price_history"

    id = Column(Integer, primary_key=True, index=True)
    stock_id = Column(Integer, ForeignKey("stocks.id"), nullable=False)
    date = Column(String(10), nullable=False, index=True)  # YYYY-MM-DD
    open_price = Column(Float, default=0)
    high_price = Column(Float, default=0)
    low_price = Column(Float, default=0)
    close_price = Column(Float, default=0)
    volume = Column(Float, default=0)
    change_rate = Column(Float, default=0)

    stock = relationship("Stock", back_populates="price_history")


# ─────────────────────────────────────────────
# 포트폴리오 일별 스냅샷
# ─────────────────────────────────────────────
class PortfolioSnapshot(Base):
    __tablename__ = "portfolio_snapshots"

    id = Column(Integer, primary_key=True, index=True)
    date = Column(String(10), nullable=False, unique=True, index=True)
    total_value = Column(Float, default=0)        # 총 평가금액
    total_purchase = Column(Float, default=0)     # 총 매입금액
    total_profit = Column(Float, default=0)       # 총 수익금액
    total_profit_rate = Column(Float, default=0)  # 총 수익률(%)
    created_at = Column(DateTime, default=datetime.utcnow)


# ─────────────────────────────────────────────
# 알림 이력
# ─────────────────────────────────────────────
class AlertHistory(Base):
    __tablename__ = "alert_history"

    id = Column(Integer, primary_key=True, index=True)
    stock_symbol = Column(String(20), nullable=False, index=True)
    alert_type = Column(String(20), nullable=False)  # PRICE_SURGE / PRICE_DROP / NEWS
    message = Column(Text, nullable=False)
    change_rate = Column(Float, nullable=True)
    is_read = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)


# ─────────────────────────────────────────────
# 인텔리전스 콘텐츠 (Phase 2)
# ─────────────────────────────────────────────
class IntelContent(Base):
    __tablename__ = "intel_contents"

    id = Column(Integer, primary_key=True, index=True)
    source_type = Column(String(20), nullable=False)  # YOUTUBE / NEWS / TEXT
    source_url = Column(String(500), nullable=True)
    source_title = Column(String(300), nullable=True)
    channel_name = Column(String(100), nullable=True)
    published_at = Column(DateTime, nullable=True)

    # AI 분석 결과
    source_document = Column(Text, nullable=True)     # Gemini 추출 원문 문서 (YouTube)
    summary = Column(Text, nullable=True)             # 전체 요약
    key_points = Column(Text, nullable=True)          # JSON: 핵심 포인트 목록
    mentioned_stocks = Column(Text, nullable=True)    # JSON: 언급 종목 목록
    mentioned_sectors = Column(Text, nullable=True)   # JSON: 언급 섹터 목록
    keywords = Column(Text, nullable=True)            # JSON: 키워드 목록
    macro_analysis = Column(Text, nullable=True)      # JSON: 매크로 분석 (GPT)
    sector_analysis = Column(Text, nullable=True)     # JSON: 섹터별 분석 (GPT)
    sentiment = Column(String(20), nullable=True)     # POSITIVE / NEUTRAL / NEGATIVE

    analyzed_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    issues = relationship("StockIssue", back_populates="content")


# ─────────────────────────────────────────────
# 종목별 이슈 (콘텐츠 ↔ 종목 매핑)
# ─────────────────────────────────────────────
class StockIssue(Base):
    __tablename__ = "stock_issues"

    id = Column(Integer, primary_key=True, index=True)
    stock_id = Column(Integer, ForeignKey("stocks.id"), nullable=False)
    content_id = Column(Integer, ForeignKey("intel_contents.id"), nullable=False)
    issue_summary = Column(Text, nullable=True)   # 해당 종목 관련 요약만 추출
    sentiment = Column(String(20), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    stock = relationship("Stock", back_populates="issues")
    content = relationship("IntelContent", back_populates="issues")


# ─────────────────────────────────────────────
# 유튜브 채널 등록 (Phase 2)
# ─────────────────────────────────────────────
class YouTubeChannel(Base):
    __tablename__ = "youtube_channels"

    id = Column(Integer, primary_key=True, index=True)
    channel_id = Column(String(50), unique=True, nullable=False)
    channel_name = Column(String(100), nullable=False)
    channel_url = Column(String(300), nullable=False)
    is_active = Column(Boolean, default=True)
    last_checked_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


# ─────────────────────────────────────────────
# 연도별 실현 수익 (매도 수익 + 배당 수익)
# ─────────────────────────────────────────────
class RealizedGain(Base):
    __tablename__ = "realized_gains"

    id          = Column(Integer, primary_key=True, index=True)
    year        = Column(Integer, nullable=False, index=True)   # 연도
    gain_type   = Column(String(20), nullable=False)            # CAPITAL / DIVIDEND
    symbol      = Column(String(20), nullable=True)             # 종목코드 (선택)
    stock_name  = Column(String(100), nullable=True)            # 종목명 (선택)
    amount      = Column(Float, nullable=False)                 # 수익금액 (원)
    tax_amount  = Column(Float, default=0)                      # 세금 (원)
    trade_date  = Column(String(10), nullable=True)             # YYYY-MM-DD (선택)
    note        = Column(Text, nullable=True)                   # 메모
    created_at  = Column(DateTime, default=datetime.utcnow)
    updated_at  = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


# ─────────────────────────────────────────────
# 앱 설정 (예수금 등 사용자 설정값)
# ─────────────────────────────────────────────
class AppConfig(Base):
    __tablename__ = "app_config"

    key        = Column(String(50), primary_key=True)
    value      = Column(Text, nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


# ─────────────────────────────────────────────
# YouTube 영상 캐시 (채널별 최신 영상 목록)
# ─────────────────────────────────────────────
class VideoCache(Base):
    __tablename__ = "video_cache"

    id           = Column(Integer, primary_key=True, index=True)
    channel_id   = Column(String(50), nullable=False, index=True)   # YouTubeChannel.channel_id
    video_id     = Column(String(20), nullable=False)
    title        = Column(String(300), nullable=False)
    description  = Column(Text, nullable=True)
    published_at = Column(String(30), nullable=True)
    thumbnail    = Column(String(500), nullable=True)
    url          = Column(String(200), nullable=False)
    cached_at    = Column(DateTime, default=datetime.utcnow)


def _migrate_intel_columns():
    """기존 DB에 새 컬럼 추가 (SQLite)"""
    from sqlalchemy import text
    new_cols = [
        ("source_document", "TEXT"),
        ("macro_analysis", "TEXT"),
        ("sector_analysis", "TEXT"),
    ]
    with engine.connect() as conn:
        for col, typ in new_cols:
            try:
                conn.execute(text(f"ALTER TABLE intel_contents ADD COLUMN {col} {typ}"))
                conn.commit()
            except Exception:
                pass


def init_db():
    """테이블 생성"""
    Base.metadata.create_all(bind=engine)
    _migrate_intel_columns()
    print("✅ 데이터베이스 초기화 완료")


def get_db():
    """FastAPI 의존성 주입용 DB 세션"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
