"""
migrations/add_knowledge_hub.py
Phase 0 — 지식 허브 DB 마이그레이션

실행: python -m migrations.add_knowledge_hub
또는 init_db() 호출 시 자동 실행 (_migrate_knowledge_hub 포함)

추가 항목:
  신규 테이블: knowledge_domains, knowledge_news_items,
               knowledge_remind_logs, knowledge_digests
  컬럼 추가:   intel_contents.content_scope / domain_id
               youtube_channels.channel_kind / domain_id / default_market_impact
  데이터:      기존 knowledge 콘텐츠 → '미분류' domain 매핑
               default_market_impact=0 채널 → channel_kind='knowledge'
"""

import logging
from sqlalchemy import text
from config.database import engine, SessionLocal

logger = logging.getLogger(__name__)


# ── 기본 분야 템플릿 ──────────────────────────────────────────────────────────
DEFAULT_DOMAINS = [
    {
        "name": "미분류",
        "slug": "uncategorized",
        "emoji": "📁",
        "color": "#6b7280",
        "description": "분야가 지정되지 않은 콘텐츠",
        "keywords": "[]",
        "sort_order": 999,
        "is_active": 1,
    },
    {
        "name": "AI·기술",
        "slug": "ai-tech",
        "emoji": "🤖",
        "color": "#6366f1",
        "description": "인공지능, 반도체, 빅테크 기술 트렌드",
        "keywords": '["AI", "ChatGPT", "LLM", "반도체", "엔비디아", "딥러닝", "GPU", "빅테크"]',
        "sort_order": 1,
        "is_active": 1,
    },
    {
        "name": "거시경제",
        "slug": "macro",
        "emoji": "📊",
        "color": "#0ea5e9",
        "description": "금리, 환율, 인플레이션 등 매크로 경제",
        "keywords": '["금리", "인플레이션", "FOMC", "달러", "환율", "GDP", "연준", "CPI"]',
        "sort_order": 2,
        "is_active": 1,
    },
    {
        "name": "건강·바이오",
        "slug": "health",
        "emoji": "🏥",
        "color": "#10b981",
        "description": "바이오, 헬스케어, 신약 개발",
        "keywords": '["바이오", "신약", "헬스케어", "임상", "FDA", "제약", "의료"]',
        "sort_order": 3,
        "is_active": 1,
    },
    {
        "name": "자기계발",
        "slug": "growth",
        "emoji": "📚",
        "color": "#f59e0b",
        "description": "독서, 생산성, 리더십, 커리어",
        "keywords": '["독서", "습관", "생산성", "리더십", "커리어", "자기계발", "스터디"]',
        "sort_order": 4,
        "is_active": 1,
    },
    {
        "name": "부동산·경매",
        "slug": "real-estate",
        "emoji": "🏢",
        "color": "#f97316",
        "description": "부동산 경매, 임대, 리모델링",
        "keywords": '["경매", "임대", "부동산", "공시가", "리모델링", "다가구", "낙찰"]',
        "sort_order": 5,
        "is_active": 1,
    },
]


def run_migration():
    """전체 마이그레이션 실행"""
    _create_knowledge_domains_table()
    _create_knowledge_news_items_table()
    _create_knowledge_remind_logs_table()
    _create_knowledge_digests_table()
    _add_intel_contents_columns()
    _add_youtube_channels_columns()
    _seed_default_domains()
    _migrate_existing_knowledge_contents()
    _migrate_existing_knowledge_channels()
    logger.info("✅ 지식 허브 마이그레이션 완료")


# ── 신규 테이블 생성 ──────────────────────────────────────────────────────────

def _create_knowledge_domains_table():
    with engine.connect() as conn:
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS knowledge_domains (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                name        VARCHAR(50)  NOT NULL,
                slug        VARCHAR(50)  NOT NULL UNIQUE,
                emoji       VARCHAR(10),
                color       VARCHAR(20),
                description TEXT,
                keywords    TEXT         DEFAULT '[]',
                sort_order  INTEGER      DEFAULT 0,
                is_active   BOOLEAN      DEFAULT 1,
                created_at  DATETIME     DEFAULT CURRENT_TIMESTAMP,
                updated_at  DATETIME     DEFAULT CURRENT_TIMESTAMP
            )
        """))
        conn.commit()
    logger.info("  ✓ knowledge_domains 테이블 준비")


def _create_knowledge_news_items_table():
    with engine.connect() as conn:
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS knowledge_news_items (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                domain_id    INTEGER      NOT NULL
                                REFERENCES knowledge_domains(id) ON DELETE CASCADE,
                title        VARCHAR(300) NOT NULL,
                url          VARCHAR(500) NOT NULL UNIQUE,
                source_name  VARCHAR(100),
                published_at DATETIME,
                summary      TEXT,
                fetched_at   DATETIME     DEFAULT CURRENT_TIMESTAMP
            )
        """))
        conn.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_kni_domain_pub "
            "ON knowledge_news_items(domain_id, published_at)"
        ))
        conn.commit()
    logger.info("  ✓ knowledge_news_items 테이블 준비")


def _create_knowledge_remind_logs_table():
    with engine.connect() as conn:
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS knowledge_remind_logs (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                content_id   INTEGER NOT NULL
                                REFERENCES intel_contents(id) ON DELETE CASCADE,
                remind_date  VARCHAR(10) NOT NULL,
                user_action  VARCHAR(20),
                next_remind  VARCHAR(10),
                created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """))
        conn.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_krl_content "
            "ON knowledge_remind_logs(content_id)"
        ))
        conn.commit()
    logger.info("  ✓ knowledge_remind_logs 테이블 준비")


def _create_knowledge_digests_table():
    with engine.connect() as conn:
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS knowledge_digests (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                domain_id    INTEGER NOT NULL
                                REFERENCES knowledge_domains(id) ON DELETE CASCADE,
                period_start VARCHAR(10) NOT NULL,
                period_end   VARCHAR(10) NOT NULL,
                body_markdown TEXT,
                created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """))
        conn.commit()
    logger.info("  ✓ knowledge_digests 테이블 준비")


# ── 기존 테이블 컬럼 추가 ────────────────────────────────────────────────────

def _add_intel_contents_columns():
    """intel_contents: content_scope, domain_id 추가"""
    additions = [
        ("content_scope", "VARCHAR(20) DEFAULT 'market'"),
        ("domain_id",     "INTEGER"),
        ("concepts",      "TEXT"),          # 핵심 개념 JSON
        ("learning_notes","TEXT"),          # 학습 메모
        ("related_topics","TEXT"),          # 관련 주제 JSON
        ("is_bookmarked", "BOOLEAN DEFAULT 0"),
        ("is_read",       "BOOLEAN DEFAULT 0"),
    ]
    with engine.connect() as conn:
        for col, typedef in additions:
            try:
                conn.execute(text(
                    f"ALTER TABLE intel_contents ADD COLUMN {col} {typedef}"
                ))
                conn.commit()
            except Exception:
                pass  # 이미 존재하면 무시
    logger.info("  ✓ intel_contents 컬럼 추가 완료")


def _add_youtube_channels_columns():
    """youtube_channels: channel_kind, domain_id, default_market_impact 추가"""
    additions = [
        ("channel_kind",           "VARCHAR(20) DEFAULT 'market'"),
        ("domain_id",              "INTEGER"),
        ("default_market_impact",  "BOOLEAN DEFAULT 1"),
        ("description",            "TEXT"),
        ("thumbnail",              "VARCHAR(500)"),
    ]
    with engine.connect() as conn:
        for col, typedef in additions:
            try:
                conn.execute(text(
                    f"ALTER TABLE youtube_channels ADD COLUMN {col} {typedef}"
                ))
                conn.commit()
            except Exception:
                pass
    logger.info("  ✓ youtube_channels 컬럼 추가 완료")


# ── 시드 데이터 ──────────────────────────────────────────────────────────────

def _seed_default_domains():
    """기본 분야 템플릿 삽입 (없을 때만)"""
    with engine.connect() as conn:
        for d in DEFAULT_DOMAINS:
            existing = conn.execute(
                text("SELECT id FROM knowledge_domains WHERE slug = :slug"),
                {"slug": d["slug"]},
            ).fetchone()
            if not existing:
                conn.execute(
                    text("""
                        INSERT INTO knowledge_domains
                            (name, slug, emoji, color, description, keywords,
                             sort_order, is_active)
                        VALUES
                            (:name, :slug, :emoji, :color, :description, :keywords,
                             :sort_order, :is_active)
                    """),
                    d,
                )
        conn.commit()
    logger.info("  ✓ 기본 분야 시드 완료")


# ── 기존 데이터 이관 ─────────────────────────────────────────────────────────

def _migrate_existing_knowledge_contents():
    """
    기존 knowledge scope 콘텐츠 → '미분류' domain 매핑
    (content_scope 컬럼이 없던 시절 저장된 데이터 이관)
    """
    with engine.connect() as conn:
        row = conn.execute(
            text("SELECT id FROM knowledge_domains WHERE slug = 'uncategorized'")
        ).fetchone()
        if not row:
            return
        uncategorized_id = row[0]

        # content_scope = 'knowledge' 이면서 domain_id 없는 것
        conn.execute(text("""
            UPDATE intel_contents
            SET domain_id = :did
            WHERE content_scope = 'knowledge'
              AND (domain_id IS NULL OR domain_id = 0)
        """), {"did": uncategorized_id})
        conn.commit()
    logger.info("  ✓ 기존 knowledge 콘텐츠 → 미분류 domain 매핑")


def _migrate_existing_knowledge_channels():
    """
    default_market_impact = 0 채널 → channel_kind = 'knowledge' 로 전환
    (버그 수정: default_market_impact 덮어쓰기 제거 전제)
    """
    with engine.connect() as conn:
        row = conn.execute(
            text("SELECT id FROM knowledge_domains WHERE slug = 'uncategorized'")
        ).fetchone()
        uncategorized_id = row[0] if row else None

        conn.execute(text("""
            UPDATE youtube_channels
            SET channel_kind = 'knowledge',
                domain_id    = :did
            WHERE (default_market_impact = 0 OR default_market_impact IS NULL)
              AND (channel_kind IS NULL OR channel_kind = 'market')
        """), {"did": uncategorized_id})
        conn.commit()
    logger.info("  ✓ 기존 knowledge 채널 → channel_kind 전환")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    run_migration()
