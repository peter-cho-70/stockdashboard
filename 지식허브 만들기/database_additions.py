"""
config/database_additions.py
database.py에 추가할 새 SQLAlchemy 모델

기존 database.py 파일의 마지막 부분에 붙여넣기 하거나,
database.py에서 아래처럼 임포트하세요:

    from config.database_additions import (
        KnowledgeDomain, KnowledgeNewsItem,
        KnowledgeRemindLog, KnowledgeDigest,
    )

그리고 init_db() 내에 마이그레이션 추가:

    from migrations.add_knowledge_hub import run_migration
    run_migration()
"""

from datetime import datetime
from sqlalchemy import (
    Boolean, Column, DateTime, ForeignKey,
    Integer, String, Text,
)
from sqlalchemy.orm import relationship

# database.py의 Base를 임포트해서 사용
# from config.database import Base
# (실제 사용 시 위 import 사용, 여기서는 설명용으로 Base를 가정)


# ─────────────────────────────────────────────
# 관심 분야 (Knowledge Domain)
# ─────────────────────────────────────────────
class KnowledgeDomain:  # (Base):  ← 실제 사용 시 Base 상속
    __tablename__ = "knowledge_domains"

    id          = Column(Integer, primary_key=True, index=True)
    name        = Column(String(50),  nullable=False)
    slug        = Column(String(50),  nullable=False, unique=True, index=True)
    emoji       = Column(String(10),  nullable=True)
    color       = Column(String(20),  nullable=True)
    description = Column(Text,        nullable=True)
    keywords    = Column(Text,        default="[]")   # JSON 배열
    sort_order  = Column(Integer,     default=0)
    is_active   = Column(Boolean,     default=True)
    created_at  = Column(DateTime,    default=datetime.utcnow)
    updated_at  = Column(DateTime,    default=datetime.utcnow, onupdate=datetime.utcnow)

    # 관계
    news_items  = relationship("KnowledgeNewsItem",  back_populates="domain")
    digests     = relationship("KnowledgeDigest",    back_populates="domain")


# ─────────────────────────────────────────────
# 분야 뉴스 아이템
# ─────────────────────────────────────────────
class KnowledgeNewsItem:  # (Base):
    __tablename__ = "knowledge_news_items"

    id           = Column(Integer,     primary_key=True, index=True)
    domain_id    = Column(Integer,     ForeignKey("knowledge_domains.id"), nullable=False, index=True)
    title        = Column(String(300), nullable=False)
    url          = Column(String(500), nullable=False, unique=True)
    source_name  = Column(String(100), nullable=True)
    published_at = Column(DateTime,    nullable=True,   index=True)
    summary      = Column(Text,        nullable=True)
    fetched_at   = Column(DateTime,    default=datetime.utcnow)

    domain = relationship("KnowledgeDomain", back_populates="news_items")


# ─────────────────────────────────────────────
# 리마인드 로그 (간격 반복)
# ─────────────────────────────────────────────
class KnowledgeRemindLog:  # (Base):
    __tablename__ = "knowledge_remind_logs"

    id           = Column(Integer,    primary_key=True, index=True)
    content_id   = Column(Integer,    ForeignKey("intel_contents.id"), nullable=False, index=True)
    remind_date  = Column(String(10), nullable=False)   # YYYY-MM-DD
    user_action  = Column(String(20), nullable=True)    # remembered | needs_review
    next_remind  = Column(String(10), nullable=True)    # YYYY-MM-DD
    created_at   = Column(DateTime,   default=datetime.utcnow)


# ─────────────────────────────────────────────
# 분야별 AI 주간 다이제스트
# ─────────────────────────────────────────────
class KnowledgeDigest:  # (Base):
    __tablename__ = "knowledge_digests"

    id           = Column(Integer,    primary_key=True, index=True)
    domain_id    = Column(Integer,    ForeignKey("knowledge_domains.id"), nullable=False, index=True)
    period_start = Column(String(10), nullable=False)   # YYYY-MM-DD
    period_end   = Column(String(10), nullable=False)   # YYYY-MM-DD
    body_markdown= Column(Text,       nullable=True)
    created_at   = Column(DateTime,   default=datetime.utcnow)

    domain = relationship("KnowledgeDomain", back_populates="digests")


# ─────────────────────────────────────────────
# database.py의 init_db()에 추가할 내용
# ─────────────────────────────────────────────
INIT_DB_ADDITIONS = """
# database.py의 init_db() 함수에 아래 두 줄 추가:

from migrations.add_knowledge_hub import run_migration
run_migration()
"""

# ─────────────────────────────────────────────
# IntelContent 모델에 추가할 컬럼 목록
# (database.py의 IntelContent 클래스에 직접 추가)
# ─────────────────────────────────────────────
INTEL_CONTENT_NEW_COLUMNS = """
# IntelContent 클래스에 추가:
content_scope  = Column(String(20), default="market", index=True)  # market | knowledge
domain_id      = Column(Integer, ForeignKey("knowledge_domains.id"), nullable=True, index=True)
concepts       = Column(Text, nullable=True)        # JSON: 핵심 개념 정의
learning_notes = Column(Text, nullable=True)        # 학습 메모
related_topics = Column(Text, nullable=True)        # JSON: 관련 주제
is_bookmarked  = Column(Boolean, default=False)
is_read        = Column(Boolean, default=False)

# 관계 추가:
domain = relationship("KnowledgeDomain")
"""

# ─────────────────────────────────────────────
# YouTubeChannel 모델에 추가할 컬럼 목록
# ─────────────────────────────────────────────
YOUTUBE_CHANNEL_NEW_COLUMNS = """
# YouTubeChannel 클래스에 추가:
channel_kind          = Column(String(20), default="market")   # market | knowledge
domain_id             = Column(Integer, ForeignKey("knowledge_domains.id"), nullable=True)
default_market_impact = Column(Boolean, default=True)
description           = Column(Text, nullable=True)
thumbnail             = Column(String(500), nullable=True)

# 관계 추가:
domain = relationship("KnowledgeDomain")
"""
