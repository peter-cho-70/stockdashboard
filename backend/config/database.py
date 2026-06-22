"""
config/database.py
SQLAlchemy 데이터베이스 모델 및 연결 관리
"""
from datetime import datetime
from sqlalchemy import (
    create_engine, Column, Integer, String, Float,
    DateTime, Boolean, Text, ForeignKey, UniqueConstraint
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
    position_source = Column(String(10), default="kis")  # kis | manual
    is_active = Column(Boolean, default=True)

    # 매수/매도 희망가 알림
    target_buy_price = Column(Float, nullable=True)    # 매수 희망가
    target_sell_price = Column(Float, nullable=True)   # 매도 희망가
    target_buy_alerted = Column(Boolean, default=False)   # 매수가 도달 알림 발송 여부 (재크로스 시 재알림)
    target_sell_alerted = Column(Boolean, default=False)  # 매도가 도달 알림 발송 여부
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    last_synced_at = Column(DateTime, nullable=True)  # KIS 마지막 동기화 시각

    # 관계
    price_history = relationship("PriceHistory", back_populates="stock")
    issues = relationship("StockIssue", back_populates="stock")
    move_causes = relationship("PriceMoveCause", back_populates="stock")
    trades = relationship("PortfolioTrade", back_populates="stock")

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
# 포트폴리오 매매 이력
# ─────────────────────────────────────────────
class PortfolioTrade(Base):
    __tablename__ = "portfolio_trades"

    id = Column(Integer, primary_key=True, index=True)
    stock_id = Column(Integer, ForeignKey("stocks.id"), nullable=False, index=True)
    side = Column(String(4), nullable=False)  # BUY | SELL
    qty = Column(Float, nullable=False)
    price = Column(Float, nullable=False)
    avg_price_before = Column(Float, nullable=True)  # 매도 직전 평균단가 스냅샷
    traded_at = Column(String(10), nullable=False, index=True)  # YYYY-MM-DD
    memo = Column(Text, nullable=True)
    source = Column(String(10), default="manual")
    external_id = Column(String(64), nullable=True, index=True)  # KIS 체결 dedup 키
    created_at = Column(DateTime, default=datetime.utcnow)

    stock = relationship("Stock", back_populates="trades")


# ─────────────────────────────────────────────
# 매도 후 기회비용 분석 (가상 매도/교체매수, 또는 실제 체결 내역 기반)
# ─────────────────────────────────────────────
class TradeWhatIf(Base):
    __tablename__ = "trade_what_ifs"

    id = Column(Integer, primary_key=True, index=True)
    kind = Column(String(20), nullable=False, default="sell_opportunity")  # sell_opportunity | mixed | buydate
    source = Column(String(10), nullable=False, default="virtual")  # virtual | real

    sell_symbol = Column(String(20), nullable=True, index=True)
    sell_name = Column(String(100), nullable=True)
    sell_qty = Column(Float, nullable=True)
    sell_price = Column(Float, nullable=True)
    sell_avg_price = Column(Float, nullable=True)   # 평단가 스냅샷 (가상매도·불타기물타기 실현손익 계산용)
    sell_date = Column(String(10), nullable=True)
    sell_trade_id = Column(Integer, ForeignKey("portfolio_trades.id"), nullable=True)
    sell_trade_ids = Column(Text, nullable=True)  # JSON array — 복수 실제 매도 체결 id

    buy_symbol = Column(String(20), nullable=True)
    buy_name = Column(String(100), nullable=True)
    buy_qty = Column(Float, nullable=True)
    buy_price = Column(Float, nullable=True)
    buy_date = Column(String(10), nullable=True)
    buy_trade_id = Column(Integer, ForeignKey("portfolio_trades.id"), nullable=True)

    position_qty_before = Column(Float, nullable=True)  # 불타기·물타기 기록 시점의 보유수량 스냅샷

    memo = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


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
# 지식 허브 — 관심 분야
# ─────────────────────────────────────────────
class KnowledgeDomain(Base):
    __tablename__ = "knowledge_domains"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(50), nullable=False)
    slug = Column(String(50), unique=True, nullable=False, index=True)
    emoji = Column(String(10), nullable=True)
    color = Column(String(20), nullable=True)
    description = Column(Text, nullable=True)
    keywords = Column(Text, default="[]")
    sort_order = Column(Integer, default=0)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class KnowledgeNewsItem(Base):
    __tablename__ = "knowledge_news_items"

    id = Column(Integer, primary_key=True, index=True)
    domain_id = Column(Integer, ForeignKey("knowledge_domains.id"), nullable=False, index=True)
    title = Column(String(300), nullable=False)
    url = Column(String(500), nullable=False, unique=True)
    source_name = Column(String(100), nullable=True)
    published_at = Column(DateTime, nullable=True, index=True)
    summary = Column(Text, nullable=True)
    fetched_at = Column(DateTime, default=datetime.utcnow)


class KnowledgeRemindLog(Base):
    __tablename__ = "knowledge_remind_logs"

    id = Column(Integer, primary_key=True, index=True)
    content_id = Column(Integer, ForeignKey("intel_contents.id"), nullable=False, index=True)
    remind_date = Column(String(10), nullable=False, index=True)
    user_action = Column(String(20), nullable=True)
    next_remind = Column(String(10), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class KnowledgeDigest(Base):
    __tablename__ = "knowledge_digests"
    __table_args__ = (
        UniqueConstraint("domain_id", "period_start", "period_end", name="uq_knowledge_digest_period"),
    )

    id = Column(Integer, primary_key=True, index=True)
    domain_id = Column(Integer, ForeignKey("knowledge_domains.id"), nullable=False, index=True)
    period_start = Column(String(10), nullable=False)
    period_end = Column(String(10), nullable=False)
    title = Column(String(300), nullable=True)
    body_markdown = Column(Text, nullable=True)
    highlights_json = Column(Text, nullable=True)
    status = Column(String(20), default="ready")
    model = Column(String(80), nullable=True)
    generated_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class StudyCategory(Base):
    """주식공부하기 — 사용자 정의 카테고리"""
    __tablename__ = "study_categories"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    description = Column(String(500), nullable=True)
    sort_order = Column(Integer, default=0)
    is_default = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)


class StudyCard(Base):
    """주식공부하기 — 유튜브/AI 분석에서 생성한 학습 카드"""
    __tablename__ = "study_cards"

    id = Column(Integer, primary_key=True, index=True)
    content_id = Column(Integer, ForeignKey("intel_contents.id"), nullable=True, index=True)
    category_id = Column(Integer, ForeignKey("study_categories.id"), nullable=True, index=True)
    lesson_id = Column(String(50), nullable=True, index=True)
    title = Column(String(300), nullable=False)
    summary = Column(Text, nullable=True)
    body_markdown = Column(Text, nullable=True)
    key_points = Column(Text, nullable=True)
    study_topics = Column(Text, nullable=True)
    quiz_items = Column(Text, nullable=True)
    source_title = Column(String(300), nullable=True)
    source_url = Column(String(500), nullable=True)
    source_type = Column(String(20), nullable=True)
    thumbnail = Column(String(500), nullable=True)
    origin = Column(String(20), default="ai")
    sort_order = Column(Integer, default=0)
    user_note = Column(Text, nullable=True)
    analysis_status = Column(String(20), default="none")
    simple_analysis = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)

    content = relationship("IntelContent", backref="study_cards")
    category = relationship("StudyCategory", backref="cards")


class StudyLessonImage(Base):
    """주식공부하기 — 레슨별 참고 이미지 (붙여넣기 업로드)"""
    __tablename__ = "study_lesson_images"

    id = Column(Integer, primary_key=True, index=True)
    lesson_id = Column(String(50), nullable=False, index=True)
    stored_name = Column(String(255), nullable=False)
    original_name = Column(String(255), nullable=True)
    mime_type = Column(String(80), default="image/png")
    caption = Column(String(300), nullable=True)
    sort_order = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)


class StudyLessonLink(Base):
    """주식공부하기 — 레슨별 참고 유튜브 링크"""
    __tablename__ = "study_lesson_links"

    id = Column(Integer, primary_key=True, index=True)
    lesson_id = Column(String(50), nullable=False, index=True)
    video_id = Column(String(20), nullable=False, index=True)
    url = Column(String(500), nullable=False)
    title = Column(String(300), nullable=False)
    channel_name = Column(String(200), nullable=True)
    thumbnail = Column(String(500), nullable=True)
    sort_order = Column(Integer, default=0)
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
    content_scope = Column(String(20), default="market", index=True)  # knowledge | market
    domain_id = Column(Integer, ForeignKey("knowledge_domains.id"), nullable=True, index=True)
    is_bookmarked = Column(Boolean, default=False)
    is_read = Column(Boolean, default=False)
    user_highlights = Column(Text, nullable=True)  # JSON: 핀·스니펫·사용자 포인트

    analyzed_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    issues = relationship("StockIssue", back_populates="content")
    macro_signals = relationship("MacroSignal", back_populates="content")
    sector_signals = relationship("SectorSignal", back_populates="content")
    stock_signals = relationship("StockSignal", back_populates="content")


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
    event_date = Column(String(10), nullable=True, index=True)   # 차트 연결용 YYYY-MM-DD
    match_source = Column(String(30), nullable=True)              # published_at | extracted | ...
    created_at = Column(DateTime, default=datetime.utcnow)

    stock = relationship("Stock", back_populates="issues")
    content = relationship("IntelContent", back_populates="issues")


# ─────────────────────────────────────────────
# 주가 급변 원인 (AI 검색 저장)
# ─────────────────────────────────────────────
class PriceMoveCause(Base):
    __tablename__ = "price_move_causes"
    __table_args__ = (UniqueConstraint("stock_id", "event_date", name="uq_stock_move_date"),)

    id = Column(Integer, primary_key=True, index=True)
    stock_id = Column(Integer, ForeignKey("stocks.id"), nullable=False, index=True)
    event_date = Column(String(10), nullable=False, index=True)   # YYYY-MM-DD
    change_pct = Column(Float, nullable=False)
    direction = Column(String(10), nullable=False)                # up / down
    close_price = Column(Float, nullable=True)
    reason = Column(Text, nullable=False)
    sentiment = Column(String(20), default="NEUTRAL")
    key_factors = Column(Text, nullable=True)                       # JSON array
    source_urls = Column(Text, nullable=True)                       # JSON array
    confidence = Column(String(20), nullable=True)                  # high / medium / low
    analysis_provider = Column(String(20), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    stock = relationship("Stock", back_populates="move_causes")


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
    default_market_impact = Column(Boolean, default=False)  # False=지식 채널, True=주가 반영
    domain_id = Column(Integer, ForeignKey("knowledge_domains.id"), nullable=True, index=True)
    last_checked_at = Column(DateTime, nullable=True)
    last_videos_page_token = Column(String(255), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


# ─────────────────────────────────────────────
# 차트 날짜 메모 (종목별)
# ─────────────────────────────────────────────
class ChartDateMemo(Base):
    __tablename__ = "chart_date_memos"
    __table_args__ = (UniqueConstraint("symbol", "event_date", name="uq_chart_memo_symbol_date"),)

    id = Column(Integer, primary_key=True, index=True)
    symbol = Column(String(20), nullable=False, index=True)
    event_date = Column(String(10), nullable=False, index=True)  # YYYY-MM-DD
    body = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


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


# ─────────────────────────────────────────────
# 매크로 신호 (영상/텍스트에서 파생)
# ─────────────────────────────────────────────
class MacroSignal(Base):
    __tablename__ = "macro_signals"

    id = Column(Integer, primary_key=True, index=True)
    content_id = Column(Integer, ForeignKey("intel_contents.id"), nullable=False, index=True)
    topic = Column(String(50), nullable=False, index=True)   # 금리 | 환율 | CPI | FOMC | 유가 | 중국정책 | 미국정책 | 기타
    summary = Column(Text, nullable=True)
    sentiment = Column(String(20), nullable=True)            # POSITIVE / NEUTRAL / NEGATIVE
    impact = Column(Text, nullable=True)                     # 시장 영향 설명
    event_date = Column(String(10), nullable=True, index=True)  # YYYY-MM-DD (영상 날짜 기준)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)

    content = relationship("IntelContent", back_populates="macro_signals")


# ─────────────────────────────────────────────
# 섹터 신호 (영상/텍스트에서 파생)
# ─────────────────────────────────────────────
class SectorSignal(Base):
    __tablename__ = "sector_signals"

    id = Column(Integer, primary_key=True, index=True)
    content_id = Column(Integer, ForeignKey("intel_contents.id"), nullable=False, index=True)
    sector = Column(String(50), nullable=False, index=True)  # 반도체 | AI·빅테크 | 2차전지 | ...
    summary = Column(Text, nullable=True)
    sentiment = Column(String(20), nullable=True)
    outlook = Column(Text, nullable=True)                    # 단기/중기 전망 텍스트
    mentioned_stocks = Column(Text, nullable=True)           # JSON 배열 — 이 섹터에서 언급된 종목명
    event_date = Column(String(10), nullable=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)

    content = relationship("IntelContent", back_populates="sector_signals")


# ─────────────────────────────────────────────
# 종목 신호 — 언급된 모든 종목 (보유 여부 무관)
# ─────────────────────────────────────────────
class StockSignal(Base):
    __tablename__ = "stock_signals"

    id = Column(Integer, primary_key=True, index=True)
    content_id = Column(Integer, ForeignKey("intel_contents.id"), nullable=False, index=True)
    symbol = Column(String(20), nullable=True, index=True)   # 종목코드 (보유 종목이면 stocks.symbol 과 매칭)
    stock_name = Column(String(100), nullable=False)         # 종목명 (저장 시점)
    is_portfolio = Column(Boolean, default=False)            # 내 보유 종목 여부
    summary = Column(Text, nullable=True)                    # 종목 관련 요약
    sentiment = Column(String(20), nullable=True)
    event_date = Column(String(10), nullable=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)

    content = relationship("IntelContent", back_populates="stock_signals")


# ─────────────────────────────────────────────
# Signal 사후 검증 (적중률 추적)
# ─────────────────────────────────────────────
class SignalOutcome(Base):
    __tablename__ = "signal_outcomes"
    __table_args__ = (
        UniqueConstraint(
            "signal_type", "signal_id", "symbol", "check_days",
            name="uq_signal_outcome",
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    signal_type = Column(String(20), nullable=False, index=True)   # macro | sector | stock
    signal_id = Column(Integer, nullable=False, index=True)
    symbol = Column(String(30), nullable=False, index=True)        # 종목코드 또는 __sector_avg__:섹터
    signal_date = Column(String(10), nullable=False, index=True)
    signal_sentiment = Column(String(20), nullable=True)

    check_days = Column(Integer, nullable=False)
    check_date = Column(String(10), nullable=False)
    actual_change = Column(Float, nullable=True)                   # 등락률(%)
    hit = Column(Boolean, nullable=True)                           # None = NEUTRAL 등 스킵
    hit_magnitude = Column(Float, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)


# ─────────────────────────────────────────────
# 일일 AI 정리 문서 (Daily Digest)
# ─────────────────────────────────────────────
class IntelDailyDigest(Base):
    __tablename__ = "intel_daily_digests"

    id = Column(Integer, primary_key=True, index=True)
    date = Column(String(10), unique=True, nullable=False, index=True)  # YYYY-MM-DD
    title = Column(String(300), nullable=True)
    body_markdown = Column(Text, nullable=True)
    stats_json = Column(Text, nullable=True)
    source_content_ids = Column(Text, nullable=True)
    source_signal_ids = Column(Text, nullable=True)
    portfolio_highlight = Column(Text, nullable=True)
    generated_at = Column(DateTime, nullable=True)
    model = Column(String(80), nullable=True)
    status = Column(String(20), default="pending")  # pending | ready | failed
    error_message = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


# ─────────────────────────────────────────────
# Signal ↔ 주가 급변 Lead-Lag (선행 일수)
# ─────────────────────────────────────────────
class SignalLeadLag(Base):
    __tablename__ = "signal_lead_lag"
    __table_args__ = (
        UniqueConstraint(
            "symbol", "move_date", "signal_type", "signal_id",
            name="uq_signal_lead_lag",
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    symbol = Column(String(20), nullable=False, index=True)
    move_date = Column(String(10), nullable=False, index=True)
    move_pct = Column(Float, nullable=True)
    move_direction = Column(String(10), nullable=True)            # up / down
    signal_type = Column(String(20), nullable=False, index=True)   # macro | sector | stock
    signal_id = Column(Integer, nullable=False, index=True)
    signal_date = Column(String(10), nullable=False, index=True)
    signal_sentiment = Column(String(20), nullable=True)
    lead_days = Column(Integer, nullable=False)                    # move_date - signal_date
    sector = Column(String(50), nullable=True, index=True)
    macro_topic = Column(String(50), nullable=True)              # macro일 때 topic
    sentiment_aligned = Column(Boolean, default=True)            # Signal 감성 vs 급변 방향 일치
    created_at = Column(DateTime, default=datetime.utcnow)


# ─────────────────────────────────────────────
# 관심 종목 (지켜보기 — 모의투자 아님)
# ─────────────────────────────────────────────
# ─────────────────────────────────────────────
# 증권사·애널리스트 목표가 (차트 오버레이)
# ─────────────────────────────────────────────
class StockPriceTarget(Base):
    __tablename__ = "stock_price_targets"

    id = Column(Integer, primary_key=True, index=True)
    symbol = Column(String(20), nullable=False, index=True)
    stock_id = Column(Integer, ForeignKey("stocks.id"), nullable=True, index=True)
    source = Column(String(100), nullable=False)       # 증권사명
    analyst = Column(String(80), nullable=True)
    target_price = Column(Float, nullable=False)
    rating = Column(String(30), nullable=True)         # 매수 / 중립 / 매도 등
    report_date = Column(String(10), nullable=True)    # YYYY-MM-DD
    currency = Column(String(10), default="KRW")
    is_consensus = Column(Boolean, default=False)
    source_url = Column(String(500), nullable=True)
    source_title = Column(String(300), nullable=True)
    notes = Column(Text, nullable=True)
    fetched_at = Column(DateTime, default=datetime.utcnow, index=True)


class StockTargetSetting(Base):
    """종목별 목표가 평균·가중치·익절 설정 (매수적절가 계산용)"""
    __tablename__ = "stock_target_settings"

    id = Column(Integer, primary_key=True, index=True)
    symbol = Column(String(20), unique=True, nullable=False, index=True)
    avg_window_days = Column(Integer, default=30)       # 평균 산정 기간: 30/45/60일
    weight_pct = Column(Float, default=75)                # 가중치(%) — 매수적절가 = 평균목표가 × 가중치
    custom_profit_pct = Column(Float, default=10)        # 익절 목표치(%) — 5/10/15/20 외 사용자 지정값
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


# ─────────────────────────────────────────────
# 자동매매 (전용 KIS 계좌 — 매수적절가/익절 사다리 조건 기반)
# ─────────────────────────────────────────────
class AutoTradeRule(Base):
    """종목별 자동매매 규칙 — 매수적절가 도달 시 매수, 익절 5단 사다리(1/5씩) 도달 시 매도"""
    __tablename__ = "autotrade_rules"

    id = Column(Integer, primary_key=True, index=True)
    symbol = Column(String(20), nullable=False, index=True)
    name = Column(String(100), nullable=True)
    account_no = Column(String(30), nullable=False)        # 전용 자동매매 KIS 계좌 (대시보드 계좌와 분리)
    execution_mode = Column(String(10), default="semi")     # manual | semi | auto (Phase1은 semi만 사용)
    enabled = Column(Boolean, default=True)
    buy_qty = Column(Integer, nullable=False)               # 조건 충족 시 매수할 수량
    buy_triggered = Column(Boolean, default=False)          # 매수 조건 1회성 발동 dedup
    position_qty = Column(Integer, default=0)               # 이 규칙으로 보유 중인 수량 (매도 진행에 따라 감소)
    executed_buy_price = Column(Float, nullable=True)        # 실제 매수 체결가 — 익절 사다리는 이 값 기준으로 고정 계산
    sell_leg_done = Column(String(30), default="")           # 완료된 익절 레그 CSV, 예 "5,10"
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class AutoTradeEvent(Base):
    """자동매매 조건 충족 이벤트 — 반자동 모드에서는 승인 대기 상태로 생성됨"""
    __tablename__ = "autotrade_events"

    id = Column(Integer, primary_key=True, index=True)
    rule_id = Column(Integer, ForeignKey("autotrade_rules.id"), nullable=False, index=True)
    event_type = Column(String(10), nullable=False)         # BUY | SELL
    leg_pct = Column(Float, nullable=True)                  # SELL일 때 5/10/15/20/커스텀
    status = Column(String(20), default="PENDING_APPROVAL", index=True)
    # PENDING_APPROVAL | APPROVED | REJECTED | EXECUTED | FAILED
    trigger_price = Column(Float, nullable=False)
    qty = Column(Integer, nullable=False)
    order_id = Column(String(50), nullable=True)
    error_message = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    resolved_at = Column(DateTime, nullable=True)


# ─────────────────────────────────────────────
# 미국 증시 아침 리포트
# ─────────────────────────────────────────────
class TradeMonthlyReport(Base):
    """월별 수출입 동향 AI 리포트"""
    __tablename__ = "trade_monthly_reports"

    id = Column(Integer, primary_key=True, index=True)
    report_month = Column(String(7), unique=True, nullable=False, index=True)  # YYYY-MM
    ref_yyyymm = Column(String(6), nullable=True)
    revision = Column(String(20), default="auto")
    summary_json = Column(Text, nullable=True)
    countries_json = Column(Text, nullable=True)
    items_json = Column(Text, nullable=True)
    analyses_json = Column(Text, nullable=True)
    highlights_json = Column(Text, nullable=True)
    body_markdown = Column(Text, nullable=True)
    status = Column(String(20), default="pending")
    error_message = Column(Text, nullable=True)
    model = Column(String(80), nullable=True)
    generated_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class UsMarketReport(Base):
    __tablename__ = "us_market_reports"

    id = Column(Integer, primary_key=True, index=True)
    report_date = Column(String(10), unique=True, nullable=False, index=True)  # KST 기준 리포트 날짜
    session_date = Column(String(10), nullable=True)   # 미국 장 마감일 (전일)
    indices_json = Column(Text, nullable=True)
    highlights_json = Column(Text, nullable=True)
    body_markdown = Column(Text, nullable=True)
    status = Column(String(20), default="pending")     # pending | ready | failed
    error_message = Column(Text, nullable=True)
    model = Column(String(80), nullable=True)
    generated_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class EconomicCalendarEvent(Base):
    """검색·AI 추출 기반 주요 경제 일정 (캘린더 전용)"""
    __tablename__ = "economic_calendar_events"

    id = Column(Integer, primary_key=True, index=True)
    event_date = Column(String(10), nullable=False, index=True)
    title = Column(String(400), nullable=False)
    region = Column(String(20), default="GLOBAL")
    category = Column(String(80), nullable=True)
    summary = Column(Text, nullable=True)
    importance = Column(String(10), default="medium")
    source_url = Column(String(800), nullable=True)
    source_title = Column(String(400), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class WatchlistItem(Base):
    __tablename__ = "watchlist"

    id = Column(Integer, primary_key=True, index=True)
    symbol = Column(String(20), nullable=True, index=True)
    stock_name = Column(String(100), nullable=False, index=True)
    sector = Column(String(50), nullable=True)
    source_type = Column(String(20), nullable=True)   # sector | macro | manual | stock
    source_id = Column(Integer, nullable=True)
    memo = Column(Text, nullable=True)
    target_buy_price = Column(Float, nullable=True)  # 매수 희망가
    target_sell_price = Column(Float, nullable=True)  # 매도 희망가
    target_buy_alerted = Column(Boolean, default=False)
    target_sell_alerted = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)


# ─────────────────────────────────────────────
# 관계 묶어보기 — 사용자 지정 종목 그룹 (2단계: 수동)
# ─────────────────────────────────────────────
class StockGroup(Base):
    __tablename__ = "stock_groups"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)

    members = relationship(
        "StockGroupMember", back_populates="group", cascade="all, delete-orphan"
    )


class StockGroupMember(Base):
    __tablename__ = "stock_group_members"

    id = Column(Integer, primary_key=True, index=True)
    group_id = Column(Integer, ForeignKey("stock_groups.id"), nullable=False, index=True)
    symbol = Column(String(20), nullable=False, index=True)
    stock_name = Column(String(100), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    group = relationship("StockGroup", back_populates="members")

    __table_args__ = (UniqueConstraint("group_id", "symbol", name="uq_group_symbol"),)


# ─────────────────────────────────────────────
# 재정허브 — JSON 상태 저장
# ─────────────────────────────────────────────
class FinanceJsonStore(Base):
    __tablename__ = "finance_json_store"

    id = Column(Integer, primary_key=True, index=True)
    store_key = Column(String(50), unique=True, nullable=False, index=True)
    data_json = Column(Text, nullable=False, default="{}")
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class FinanceAssetSnapshot(Base):
    """날짜별 총자산·유동성자산 스냅샷 (재정보드를 열 때마다 그날 값을 upsert)"""
    __tablename__ = "finance_asset_snapshots"

    id = Column(Integer, primary_key=True, index=True)
    date = Column(String(10), nullable=False, unique=True, index=True)
    total_assets = Column(Float, default=0)        # 총자산
    liquid_assets = Column(Float, default=0)        # 유동성 자산(부채 차감 전)
    illiquid_assets = Column(Float, default=0)      # 비유동자산
    real_estate_assets = Column(Float, default=0)   # 부동산자산
    total_liabilities = Column(Float, default=0)    # 총부채
    liquid_net_worth = Column(Float, default=0)      # 유동순자산(유동성자산 - 총부채)
    created_at = Column(DateTime, default=datetime.utcnow)


# ─────────────────────────────────────────────
# 경매허브 (AuctionHub) — 물건(사건) 관리
# ─────────────────────────────────────────────

class AuctionCase(Base):
    """경매 물건(사건) 기본 정보"""
    __tablename__ = "auction_cases"

    id = Column(Integer, primary_key=True, index=True)
    case_number = Column(String(50), nullable=False, index=True)
    address = Column(String(300), nullable=False)
    list_title = Column(String(200), nullable=True)
    property_type = Column(String(50), nullable=True)
    built_year = Column(String(20), nullable=True)
    floor = Column(String(50), nullable=True)
    household_count = Column(Integer, nullable=True)
    land_area_sqm = Column(Float, nullable=True)
    building_area_sqm = Column(Float, nullable=True)
    parking_unit_count = Column(Integer, nullable=True)
    appraisal_price = Column(Float, nullable=True)
    min_price = Column(Float, nullable=True)
    expected_bid_price = Column(Float, nullable=True)
    bid_date = Column(String(20), nullable=True)
    current_round = Column(Integer, default=1)
    status = Column(String(30), default="watching", index=True)
    priority_level = Column(Integer, default=1)
    memo = Column(Text, nullable=True)
    # 월세·주변시세 메모 — 국토부/네이버 API 연동 전까지 수동 입력
    market_notes = Column(Text, nullable=True)
    extracted_text = Column(Text, nullable=True)
    address_meta_json = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    source_documents = relationship(
        "AuctionSourceDocument", back_populates="case", cascade="all, delete-orphan"
    )
    thumbnail = relationship(
        "AuctionCaseThumbnail", back_populates="case", uselist=False, cascade="all, delete-orphan"
    )
    tenant_records = relationship(
        "AuctionTenantRecord", back_populates="case", cascade="all, delete-orphan"
    )
    sale_comparables = relationship(
        "AuctionSaleComparable", back_populates="case", cascade="all, delete-orphan"
    )
    bid_analysis = relationship(
        "AuctionBidAnalysis", back_populates="case", uselist=False, cascade="all, delete-orphan"
    )


class AuctionSourceDocument(Base):
    """물건 등록 시 첨부한 PDF 원문"""
    __tablename__ = "auction_source_documents"

    id = Column(Integer, primary_key=True, index=True)
    case_id = Column(Integer, ForeignKey("auction_cases.id"), nullable=False, index=True)
    kind = Column(String(40), default="pdf")
    stored_name = Column(String(255), nullable=False)
    original_name = Column(String(255), nullable=True)
    mime_type = Column(String(80), default="application/pdf")
    file_size = Column(Integer, nullable=True)
    page_count = Column(Integer, nullable=True)
    extracted_text = Column(Text, nullable=True)
    structured_json = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    case = relationship("AuctionCase", back_populates="source_documents")


class AuctionCaseThumbnail(Base):
    """물건 표지 캡처(원본) + 목록용 썸네일"""
    __tablename__ = "auction_case_thumbnails"

    id = Column(Integer, primary_key=True, index=True)
    case_id = Column(Integer, ForeignKey("auction_cases.id"), unique=True, nullable=False, index=True)
    cover_stored_name = Column(String(255), nullable=True)
    list_stored_name = Column(String(255), nullable=True)
    mime_type = Column(String(80), default="image/jpeg")
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    case = relationship("AuctionCase", back_populates="thumbnail")


class AuctionTenantRecord(Base):
    """세입자 분석 — 호실별 임차인 기록"""
    __tablename__ = "auction_tenant_records"

    id = Column(Integer, primary_key=True, index=True)
    case_id = Column(Integer, ForeignKey("auction_cases.id"), nullable=False, index=True)
    unit = Column(String(50), nullable=True)
    occupant_name = Column(String(100), nullable=True)
    deposit = Column(Float, nullable=True)
    monthly_rent = Column(Float, nullable=True)
    move_in_date = Column(String(20), nullable=True)
    confirmed_date = Column(String(20), nullable=True)
    dividend_request_date = Column(String(20), nullable=True)
    has_opposing_power = Column(Boolean, nullable=True)
    dividend_amount = Column(Float, nullable=True)
    undivided_amount = Column(Float, nullable=True)
    dividend_status = Column(String(20), default="unknown")
    inquiry_notes = Column(Text, nullable=True)
    memo = Column(Text, nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    case = relationship("AuctionCase", back_populates="tenant_records")


class AuctionSaleComparable(Base):
    """입찰가 판단용 — 인근 경매 매각 비교사례 (수동 입력)"""
    __tablename__ = "auction_sale_comparables"

    id = Column(Integer, primary_key=True, index=True)
    case_id = Column(Integer, ForeignKey("auction_cases.id"), nullable=False, index=True)
    case_number = Column(String(50), nullable=True)
    address = Column(String(300), nullable=True)
    appraisal_price = Column(Float, nullable=True)
    winning_bid_price = Column(Float, nullable=True)
    bid_rate_pct = Column(Float, nullable=True)
    sold_round = Column(Integer, nullable=True)
    bid_date = Column(String(20), nullable=True)
    memo = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    case = relationship("AuctionCase", back_populates="sale_comparables")


class AuctionBidAnalysis(Base):
    """입찰가 통합 분석 결과 (비교사례 기반 제안가 캐시)"""
    __tablename__ = "auction_bid_analyses"

    id = Column(Integer, primary_key=True, index=True)
    case_id = Column(Integer, ForeignKey("auction_cases.id"), unique=True, nullable=False, index=True)
    peer_count = Column(Integer, default=0)
    median_bid_rate_pct = Column(Float, nullable=True)
    suggested_bid_won = Column(Float, nullable=True)
    suggested_bid_rate_pct = Column(Float, nullable=True)
    range_low_won = Column(Float, nullable=True)
    range_high_won = Column(Float, nullable=True)
    narrative = Column(Text, nullable=True)
    computed_at = Column(DateTime, default=datetime.utcnow)

    case = relationship("AuctionCase", back_populates="bid_analysis")


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


def _migrate_stock_columns():
    """stocks 테이블 컬럼 추가"""
    from sqlalchemy import text

    with engine.connect() as conn:
        try:
            conn.execute(text("ALTER TABLE stocks ADD COLUMN position_source VARCHAR(10)"))
            conn.commit()
        except Exception:
            pass
        try:
            conn.execute(
                text("UPDATE stocks SET position_source = 'kis' WHERE position_source IS NULL")
            )
            conn.commit()
        except Exception:
            pass


def _migrate_stock_issue_columns():
    """stock_issues event_date 컬럼 추가 및 published_at 백필"""
    from sqlalchemy import text

    with engine.connect() as conn:
        for col, typ in [
            ("event_date", "VARCHAR(10)"),
            ("match_source", "VARCHAR(30)"),
        ]:
            try:
                conn.execute(text(f"ALTER TABLE stock_issues ADD COLUMN {col} {typ}"))
                conn.commit()
            except Exception:
                pass

    db = SessionLocal()
    try:
        from core.issue_event_date import resolve_issue_event_date

        rows = db.query(StockIssue).filter(StockIssue.event_date.is_(None)).all()
        updated = 0
        for si in rows:
            content = si.content
            if not content:
                continue
            if content.published_at:
                si.event_date = content.published_at.strftime("%Y-%m-%d")
                si.match_source = "published_at"
                updated += 1
                continue
            ev, src = resolve_issue_event_date(
                content, si.issue_summary or "", content.source_title or ""
            )
            if ev:
                si.event_date = ev
                si.match_source = src
                updated += 1
        if updated:
            db.commit()
    except Exception:
        db.rollback()
    finally:
        db.close()


def _migrate_watchlist_columns():
    from sqlalchemy import text

    with engine.connect() as conn:
        try:
            conn.execute(text("ALTER TABLE watchlist ADD COLUMN target_buy_price FLOAT"))
            conn.commit()
        except Exception:
            pass


def _migrate_target_price_columns():
    """매수/매도 희망가 알림 컬럼 추가 (stocks + watchlist)"""
    from sqlalchemy import text

    with engine.connect() as conn:
        for ddl in (
            "ALTER TABLE stocks ADD COLUMN target_buy_price FLOAT",
            "ALTER TABLE stocks ADD COLUMN target_sell_price FLOAT",
            "ALTER TABLE stocks ADD COLUMN target_buy_alerted BOOLEAN DEFAULT 0",
            "ALTER TABLE stocks ADD COLUMN target_sell_alerted BOOLEAN DEFAULT 0",
            "ALTER TABLE watchlist ADD COLUMN target_sell_price FLOAT",
            "ALTER TABLE watchlist ADD COLUMN target_buy_alerted BOOLEAN DEFAULT 0",
            "ALTER TABLE watchlist ADD COLUMN target_sell_alerted BOOLEAN DEFAULT 0",
        ):
            try:
                conn.execute(text(ddl))
                conn.commit()
            except Exception:
                pass


def _migrate_youtube_channel_columns():
    from sqlalchemy import text

    with engine.connect() as conn:
        try:
            conn.execute(
                text("ALTER TABLE youtube_channels ADD COLUMN last_videos_page_token VARCHAR(255)")
            )
            conn.commit()
        except Exception:
            pass


def _migrate_content_scope_columns():
    from sqlalchemy import text

    with engine.connect() as conn:
        try:
            conn.execute(
                text("ALTER TABLE intel_contents ADD COLUMN content_scope VARCHAR(20) DEFAULT 'market'")
            )
            conn.commit()
        except Exception:
            pass
        try:
            conn.execute(text("UPDATE intel_contents SET content_scope='market' WHERE content_scope IS NULL"))
            conn.commit()
        except Exception:
            pass
        try:
            conn.execute(
                text("ALTER TABLE youtube_channels ADD COLUMN default_market_impact BOOLEAN DEFAULT 0")
            )
            conn.commit()
        except Exception:
            pass
        try:
            conn.execute(
                text(
                    "UPDATE youtube_channels SET default_market_impact=0 "
                    "WHERE default_market_impact IS NULL"
                )
            )
            conn.commit()
        except Exception:
            pass


def _migrate_knowledge_hub():
    from sqlalchemy import text

    with engine.connect() as conn:
        for ddl in (
            "ALTER TABLE intel_contents ADD COLUMN domain_id INTEGER",
            "ALTER TABLE intel_contents ADD COLUMN is_bookmarked BOOLEAN DEFAULT 0",
            "ALTER TABLE intel_contents ADD COLUMN is_read BOOLEAN DEFAULT 0",
            "ALTER TABLE youtube_channels ADD COLUMN domain_id INTEGER",
        ):
            try:
                conn.execute(text(ddl))
                conn.commit()
            except Exception:
                pass

        try:
            conn.execute(
                text(
                    "INSERT INTO knowledge_domains (name, slug, emoji, sort_order, is_active, keywords) "
                    "SELECT '미분류', 'uncategorized', '📁', 999, 1, '[]' "
                    "WHERE NOT EXISTS (SELECT 1 FROM knowledge_domains WHERE slug='uncategorized')"
                )
            )
            conn.commit()
        except Exception:
            pass

        try:
            conn.execute(
                text(
                    """
                    UPDATE intel_contents
                    SET domain_id = (SELECT id FROM knowledge_domains WHERE slug='uncategorized' LIMIT 1)
                    WHERE content_scope = 'knowledge'
                      AND (domain_id IS NULL OR domain_id = 0)
                    """
                )
            )
            conn.commit()
        except Exception:
            pass


def _migrate_user_highlights_column():
    from sqlalchemy import text

    with engine.connect() as conn:
        try:
            conn.execute(text("ALTER TABLE intel_contents ADD COLUMN user_highlights TEXT"))
            conn.commit()
        except Exception:
            pass


def _migrate_price_target_columns():
    from sqlalchemy import text

    with engine.connect() as conn:
        for col, typ in (
            ("source_url", "VARCHAR(500)"),
            ("source_title", "VARCHAR(300)"),
        ):
            try:
                conn.execute(text(f"ALTER TABLE stock_price_targets ADD COLUMN {col} {typ}"))
                conn.commit()
            except Exception:
                pass


def _migrate_portfolio_trade_columns():
    from sqlalchemy import text

    with engine.connect() as conn:
        for ddl in (
            "ALTER TABLE portfolio_trades ADD COLUMN external_id VARCHAR(64)",
            "ALTER TABLE portfolio_trades ADD COLUMN avg_price_before FLOAT",
        ):
            try:
                conn.execute(text(ddl))
                conn.commit()
            except Exception:
                pass


def _migrate_study_library_columns():
    from sqlalchemy import text

    with engine.connect() as conn:
        for col, typ in (
            ("category_id", "INTEGER"),
            ("thumbnail", "VARCHAR(500)"),
            ("origin", "VARCHAR(20) DEFAULT 'ai'"),
            ("sort_order", "INTEGER DEFAULT 0"),
            ("user_note", "TEXT"),
            ("analysis_status", "VARCHAR(20) DEFAULT 'none'"),
            ("simple_analysis", "TEXT"),
        ):
            try:
                conn.execute(text(f"ALTER TABLE study_cards ADD COLUMN {col} {typ}"))
                conn.commit()
            except Exception:
                pass


def _migrate_trade_what_if_schema():
    """trade_what_ifs: kind/position_qty_before 추가 + sell_* nullable 전환 (SQLite는 컬럼 제약 변경이 불가해 테이블을 재생성).
    시나리오 계산기(불타기·물타기/매수 시나리오)와 매도 후 기회비용 분석을 한 모달로 통합하면서 필요해졌다."""
    from sqlalchemy import text

    with engine.connect() as conn:
        cols = {row[1] for row in conn.execute(text("PRAGMA table_info(trade_what_ifs)")).fetchall()}
        if not cols or "kind" in cols:
            return
        try:
            conn.execute(text("""
                CREATE TABLE trade_what_ifs_new (
                    id INTEGER NOT NULL PRIMARY KEY,
                    kind VARCHAR(20) NOT NULL DEFAULT 'sell_opportunity',
                    source VARCHAR(10) NOT NULL,
                    sell_symbol VARCHAR(20),
                    sell_name VARCHAR(100),
                    sell_qty FLOAT,
                    sell_price FLOAT,
                    sell_avg_price FLOAT,
                    sell_date VARCHAR(10),
                    sell_trade_id INTEGER,
                    buy_symbol VARCHAR(20),
                    buy_name VARCHAR(100),
                    buy_qty FLOAT,
                    buy_price FLOAT,
                    buy_date VARCHAR(10),
                    buy_trade_id INTEGER,
                    position_qty_before FLOAT,
                    memo TEXT,
                    created_at DATETIME,
                    FOREIGN KEY(sell_trade_id) REFERENCES portfolio_trades (id),
                    FOREIGN KEY(buy_trade_id) REFERENCES portfolio_trades (id)
                )
            """))
            conn.execute(text("""
                INSERT INTO trade_what_ifs_new (
                    id, kind, source, sell_symbol, sell_name, sell_qty, sell_price, sell_avg_price,
                    sell_date, sell_trade_id, buy_symbol, buy_name, buy_qty, buy_price, buy_date,
                    buy_trade_id, memo, created_at
                )
                SELECT id, 'sell_opportunity', source, sell_symbol, sell_name, sell_qty, sell_price, sell_avg_price,
                    sell_date, sell_trade_id, buy_symbol, buy_name, buy_qty, buy_price, buy_date,
                    buy_trade_id, memo, created_at
                FROM trade_what_ifs
            """))
            conn.execute(text("DROP TABLE trade_what_ifs"))
            conn.execute(text("ALTER TABLE trade_what_ifs_new RENAME TO trade_what_ifs"))
            conn.execute(text("CREATE INDEX ix_trade_what_ifs_id ON trade_what_ifs (id)"))
            conn.execute(text("CREATE INDEX ix_trade_what_ifs_sell_symbol ON trade_what_ifs (sell_symbol)"))
            conn.commit()
        except Exception as e:
            print(f"trade_what_ifs 스키마 마이그레이션 실패: {e}")


def _migrate_trade_what_if_sell_trade_ids():
    from sqlalchemy import text

    with engine.connect() as conn:
        cols = {row[1] for row in conn.execute(text("PRAGMA table_info(trade_what_ifs)")).fetchall()}
        if not cols or "sell_trade_ids" in cols:
            return
        try:
            conn.execute(text("ALTER TABLE trade_what_ifs ADD COLUMN sell_trade_ids TEXT"))
            conn.commit()
        except Exception as e:
            print(f"trade_what_ifs sell_trade_ids 마이그레이션 실패: {e}")


def init_db():
    """테이블 생성"""
    Base.metadata.create_all(bind=engine)
    _migrate_trade_what_if_schema()
    _migrate_trade_what_if_sell_trade_ids()
    _migrate_intel_columns()
    _migrate_stock_columns()
    _migrate_stock_issue_columns()
    _migrate_youtube_channel_columns()
    _migrate_watchlist_columns()
    _migrate_content_scope_columns()
    _migrate_knowledge_hub()
    _migrate_price_target_columns()
    _migrate_user_highlights_column()
    _migrate_study_library_columns()
    _migrate_target_price_columns()
    _migrate_portfolio_trade_columns()
    print("✅ 데이터베이스 초기화 완료")


def get_db():
    """FastAPI 의존성 주입용 DB 세션"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
