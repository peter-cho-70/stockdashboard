# 지식 허브 통합 가이드
**stockdashboard 기존 코드에 붙이는 방법**

---

## 1. 파일 복사 위치

| 생성된 파일 | 복사 위치 (stockdashboard 기준) |
|------------|-------------------------------|
| `migrations/add_knowledge_hub.py` | `backend/migrations/add_knowledge_hub.py` |
| `config/database_additions.py` | 참고용 — database.py에 직접 병합 |
| `core/knowledge_analyzer.py` | `backend/core/knowledge_analyzer.py` |
| `core/knowledge_news.py` | `backend/core/knowledge_news.py` |
| `core/knowledge_remind.py` | `backend/core/knowledge_remind.py` |
| `api/routes_knowledge.py` | `backend/api/routes_knowledge.py` |
| `scheduler/knowledge_jobs.py` | `backend/scheduler/knowledge_jobs.py` |
| `frontend/lib/knowledgeApi.ts` | `frontend/lib/knowledgeApi.ts` |
| `frontend/app/knowledge/page.tsx` | `frontend/app/knowledge/page.tsx` |
| `frontend/app/knowledge/[slug]/page.tsx` | `frontend/app/knowledge/[slug]/page.tsx` |
| `frontend/app/knowledge/settings/domains/page.tsx` | `frontend/app/knowledge/settings/domains/page.tsx` |

---

## 2. database.py 수정 (3곳)

### 2-1. IntelContent 클래스에 컬럼 추가

```python
# class IntelContent(Base): 내부에 추가
content_scope  = Column(String(20), default="market", index=True)  # market | knowledge
domain_id      = Column(Integer, ForeignKey("knowledge_domains.id"), nullable=True, index=True)
concepts       = Column(Text, nullable=True)
learning_notes = Column(Text, nullable=True)
related_topics = Column(Text, nullable=True)
is_bookmarked  = Column(Boolean, default=False)
is_read        = Column(Boolean, default=False)
```

### 2-2. YouTubeChannel 클래스에 컬럼 추가

```python
# class YouTubeChannel(Base): 내부에 추가
channel_kind          = Column(String(20), default="market")
domain_id             = Column(Integer, ForeignKey("knowledge_domains.id"), nullable=True)
default_market_impact = Column(Boolean, default=True)
```

### 2-3. 신규 모델 클래스 추가 (파일 맨 아래)

`database_additions.py` 파일을 열어서 KnowledgeDomain, KnowledgeNewsItem,
KnowledgeRemindLog, KnowledgeDigest 클래스를 database.py 맨 아래에 붙여넣으세요.
(Base 상속 주석 제거 후 실제 `(Base)` 상속으로 변경)

```python
class KnowledgeDomain(Base):
    __tablename__ = "knowledge_domains"
    # ... (database_additions.py 내용)

class KnowledgeNewsItem(Base):
    __tablename__ = "knowledge_news_items"
    # ...

class KnowledgeRemindLog(Base):
    __tablename__ = "knowledge_remind_logs"
    # ...

class KnowledgeDigest(Base):
    __tablename__ = "knowledge_digests"
    # ...
```

### 2-4. init_db()에 마이그레이션 추가

```python
def init_db():
    """테이블 생성"""
    Base.metadata.create_all(bind=engine)
    _migrate_intel_columns()
    _migrate_stock_columns()
    _migrate_stock_issue_columns()
    _migrate_youtube_channel_columns()
    _migrate_watchlist_columns()

    # ← 아래 두 줄 추가
    from migrations.add_knowledge_hub import run_migration
    run_migration()

    print("✅ 데이터베이스 초기화 완료")
```

---

## 3. main.py 수정 (라우터 등록)

```python
# 기존 import 아래에 추가
from api.routes_knowledge import knowledge_router
from scheduler.knowledge_jobs import register_knowledge_jobs

# lifespan 내 스케줄러 시작 직후에 추가
if not SERVERLESS:
    scheduler = create_scheduler()
    register_knowledge_jobs(scheduler)   # ← 추가
    scheduler.start()

# 라우터 등록 (기존 라우터들 아래에 추가)
app.include_router(knowledge_router, prefix="/api")
```

---

## 4. frontend/components/app-shell.tsx 수정

menuGroups 배열에 아래 그룹 추가:

```typescript
{
  title: "지식",
  links: [
    { href: "/knowledge", label: "지식 허브" },
  ],
},
```

---

## 5. 콘텐츠 상세 페이지 생성 (선택)

`frontend/app/knowledge/content/[id]/page.tsx` 를 추가로 만들면
콘텐츠 상세(핵심포인트·개념·학습메모)를 별도 페이지에서 볼 수 있습니다.
기본은 분야 피드 카드에서 직접 링크합니다.

---

## 6. 실행 확인

```bash
# 백엔드 재시작
cd backend && python main.py

# 마이그레이션 확인 (로그에서)
# ✅ 지식 허브 마이그레이션 완료

# API 확인
curl http://localhost:8000/api/knowledge/domains
# → 기본 분야 5개 반환

# 프론트엔드
cd frontend && npm run dev
# → http://localhost:3000/knowledge
```

---

## 7. 첫 사용 흐름

```
1. /knowledge 접속 → 분야 보드 확인
2. /knowledge/settings/domains → 관심 분야 추가 (또는 템플릿 선택)
3. /knowledge/ai-tech → 분야 상세
4. URL 입력란에 YouTube URL 붙여넣기 → [분석] 클릭
5. 3~10초 후 피드에 콘텐츠 등장
6. 뉴스 [새로고침] 클릭 → Google 뉴스 자동 수집
7. 7일 후 → 메인 보드에 리마인드 카드 등장
```

---

*생성일: 2026.06.02 | 기반: peter-cho-70/stockdashboard*
