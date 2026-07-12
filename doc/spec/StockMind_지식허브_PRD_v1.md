# StockMind 지식 허브 (Knowledge Hub) PRD
**Version 1.0 | 2026.06.02 | 기반: stockdashboard + 지식-허브-요구사항.md**

---

## 목차
1. [배경과 트렌드 분석](#1-배경과-트렌드-분석)
2. [제품 비전과 원칙](#2-제품-비전과-원칙)
3. [현재 코드베이스 분석](#3-현재-코드베이스-분석)
4. [개념 모델](#4-개념-모델)
5. [기능 요구사항](#5-기능-요구사항)
6. [데이터 모델](#6-데이터-모델)
7. [API 설계](#7-api-설계)
8. [UI·정보 구조](#8-ui정보-구조)
9. [AI 파이프라인 설계](#9-ai-파이프라인-설계)
10. [핵심 코드 구조](#10-핵심-코드-구조)
11. [개발 로드맵](#11-개발-로드맵)
12. [성공 지표](#12-성공-지표)

---

## 1. 배경과 트렌드 분석

### 1.1 2026년 지식 관리 트렌드

2026년 현재 지식 관리 분야에서 가장 두드러진 트렌드는 **정보 홍수 속에서의 개인화된 필터링**입니다.

> "2026년, 문제는 더 이상 지식에 대한 접근성이 아니다. 뉴스레터, 소셜 피드, 회의, 웹페이지, 팟캐스트, 강의를 쏟아내는 홍수 속에서 살아남아 중요한 부분을 실제로 사용하는 것이다."

핵심 트렌드 3가지:

**① Second Brain의 AI 연동 가속화**
개인 지식 베이스에 AI가 연결되어 검색·연결·추론을 자동화하는 방향으로 진화 중.
단순 저장이 아닌 **복리 효과(compound)** 를 내는 지식 시스템이 목표.

**② 소비(Consumption) → 합성(Synthesis) 전환**
읽고 북마크하는 단계를 넘어, AI가 분야별로 내용을 합성해서 **인사이트 문서**로 변환하는 것이 핵심 가치.

**③ 학습 방법론: PARA + 간격 반복(Spaced Repetition)**
- PARA(Projects·Areas·Resources·Archives): 분야별 구조화
- 간격 반복: 이미 배운 내용을 주기적으로 리마인드해서 장기 기억으로 전환
- **이 두 가지를 합치면 StockMind 지식 허브의 핵심 학습 구조**

### 1.2 StockMind에서 지식 허브가 필요한 이유

현재 StockMind는 **주가 반영 인텔리전스** 중심입니다. 사용자는:
- AI, 반도체, 건강, 자기계발 등 **투자와 느슨하게 연결된 지식 채널**도 같은 앱에서 관리하고 싶어 합니다
- 학습한 내용을 **분야별로 정리해서 다시 볼 수 있기를** 원합니다
- 최신 뉴스와 유튜브 내용을 **AI가 요약해서 빠르게 파악**하고 싶습니다
- 과거에 공부한 내용을 **리마인드**해서 잊지 않기를 원합니다

---

## 2. 제품 비전과 원칙

### 2.1 비전

> **"내가 관심 있는 분야의 최신 동향을 AI가 정리하고, 예전에 배운 내용을 잊지 않게 리마인드해주는 개인 지식 파트너"**

### 2.2 핵심 원칙

| 원칙 | 설명 |
|------|------|
| **시장과 완전 분리** | 지식 콘텐츠는 Signal·캘린더·포트폴리오에 절대 섞이지 않음 |
| **분야(Domain) 중심** | 모든 콘텐츠는 반드시 하나의 관심 분야에 소속 |
| **소비 우선** | 읽기·탐색이 메인, 분석 입력은 보조 |
| **복리 학습** | 새 내용 + 이전 내용 리마인드를 함께 제공 |
| **AI 합성** | 단순 수집이 아닌 분야별 AI 요약·다이제스트로 인사이트 제공 |

### 2.3 시장 vs 지식 허브 비교

```
┌──────────────────────────────────────────────────────────────┐
│                      StockMind                               │
├─────────────────────────┬────────────────────────────────────┤
│   시장 인텔리전스 (/intel)  │     지식 허브 (/knowledge)          │
│                         │                                    │
│ · 캘린더·Signal·Digest    │ · 분야별 피드·타임라인               │
│ · 매크로·섹터·포트폴리오    │ · 분야 뉴스 자동 수집               │
│ · 주가 반영 YouTube       │ · 지식 채널 관리                    │
│ · StockSignal 생성        │ · 기본 지식 리마인드 카드            │
│                         │ · 분야별 AI 주간 다이제스트           │
└─────────────────────────┴────────────────────────────────────┘
              │                         │
              └──────────┬──────────────┘
                         ▼
           공통: IntelContent + Gemini 분석 파이프라인
           (market만 GPT 구조화·Signal 생성)
```

---

## 3. 현재 코드베이스 분석

### 3.1 기존 구현 현황 (stockdashboard 기준)

```
backend/
├── config/database.py     ← IntelContent, YouTubeChannel 모델
├── core/
│   ├── ai_analyzer.py     ← Gemini 추출 + Claude/GPT 구조화
│   ├── gemini_client.py   ← YouTube URL → 문서 추출
│   ├── move_explainer.py  ← Google News RSS 패턴 (참고용)
│   └── signal_extractor.py ← market Signal 생성
└── api/
    └── routes_youtube.py  ← 채널 등록·분석 API
```

### 3.2 기존 모델에서 확인된 것

**IntelContent** (intel_contents 테이블):
- `source_type`: YOUTUBE / NEWS / TEXT ✅
- `content_scope`: 필드 **없음** → 추가 필요
- `domain_id`: 필드 **없음** → 추가 필요
- `source_document`, `summary`, `key_points`, `keywords` ✅

**YouTubeChannel** (youtube_channels 테이블):
- `channel_kind`: 필드 **없음** → 추가 필요
- `domain_id`: 필드 **없음** → 추가 필요
- `default_market_impact`: **없음** (요구사항상 버그 수정 필요)

### 3.3 재사용 가능한 핵심 로직

```python
# ai_analyzer.py에서 재사용할 것들
YOUTUBE_EXTRACT_PROMPT   # Gemini YouTube 추출 (그대로 사용)
_extract_json()          # JSON 파싱 (그대로 사용)
_fetch_article()         # 뉴스 URL 크롤링 (그대로 사용)

# 지식 모드에서 스킵할 것들
_build_analysis_prompt() # market 구조화 프롬프트 → knowledge 전용 프롬프트로 교체
extract_signals()        # Signal 생성 → knowledge에서 호출 안 함
```

---

## 4. 개념 모델

### 4.1 관심 분야 (Knowledge Domain)

사용자가 자유롭게 정의하는 카테고리. 예시:

| 분야명 | 슬러그 | 이모지 | 키워드 예시 |
|--------|--------|--------|------------|
| AI·기술 | ai-tech | 🤖 | AI, ChatGPT, LLM, 반도체, 엔비디아 |
| 거시경제 | macro | 📊 | 금리, 인플레이션, FOMC, 달러 |
| 건강·바이오 | health | 🏥 | 바이오, 신약, 헬스케어, 임상 |
| 자기계발 | growth | 📚 | 독서, 습관, 생산성, 리더십 |
| 부동산 | real-estate | 🏢 | 경매, 임대, 리모델링, 공시가 |

### 4.2 지식 콘텐츠 유형

```
YouTube 영상  ─┐
뉴스 URL      ─┼─→ Gemini 추출 → 지식 분석 → 분야 저장
텍스트 입력   ─┘
분야 뉴스      ─→ RSS/검색 자동 수집 → 간단 요약 → 분야 저장
```

### 4.3 학습 사이클 (신규 개념)

```
[신규 콘텐츠 수집]
        ↓
[AI 분석·요약 저장]
        ↓
[분야 피드에 표시]
        ↓
[7일 후: 리마인드 카드로 재등장]  ← 간격 반복
        ↓
[30일 후: 분야 월간 다이제스트에 포함]
```

---

## 5. 기능 요구사항

### 5.1 관심 분야 관리 (Knowledge Domain)

| ID | 요구사항 | 우선순위 | 구현 위치 |
|----|----------|----------|-----------|
| KD-01 | 분야 생성·수정·삭제·정렬 | P0 | `/api/knowledge/domains` |
| KD-02 | 분야 속성: name, slug, emoji, color, description | P0 | `knowledge_domains` 테이블 |
| KD-03 | 분야별 키워드 목록 (뉴스 수집용) | P1 | keywords JSON 컬럼 |
| KD-04 | 분야 활성/비활성 토글 | P1 | is_active 컬럼 |
| KD-05 | 기본 분야 템플릿 5개 제공 | P2 | seed 데이터 |

**기본 제공 템플릿:**
```python
DEFAULT_DOMAINS = [
    {"name": "AI·기술", "slug": "ai-tech", "emoji": "🤖",
     "keywords": ["AI", "ChatGPT", "LLM", "반도체", "엔비디아", "딥러닝"]},
    {"name": "거시경제", "slug": "macro", "emoji": "📊",
     "keywords": ["금리", "인플레이션", "FOMC", "달러", "환율", "GDP"]},
    {"name": "건강·바이오", "slug": "health", "emoji": "🏥",
     "keywords": ["바이오", "신약", "헬스케어", "임상", "FDA"]},
    {"name": "자기계발", "slug": "growth", "emoji": "📚",
     "keywords": ["독서", "습관", "생산성", "리더십", "커리어"]},
    {"name": "부동산·경매", "slug": "real-estate", "emoji": "🏢",
     "keywords": ["경매", "임대", "부동산", "공시가", "리모델링"]},
]
```

### 5.2 지식 채널 관리

| ID | 요구사항 | 우선순위 |
|----|----------|----------|
| KC-01 | YouTube 채널 등록 시 `channel_kind=knowledge` + `domain_id` 필수 | P0 |
| KC-02 | 시장 채널과 UI 분리 (별도 등록 폼) | P0 |
| KC-03 | 채널 카드에 분야 뱃지 표시 | P0 |
| KC-04 | 채널 재등록 시 기존 콘텐츠 일괄 지식 처리 옵션 | P1 |
| KC-05 | 채널별 자동 분석 스케줄 (market과 동일, scope=knowledge) | P2 |

### 5.3 콘텐츠 수집·분석

| ID | 요구사항 | 우선순위 |
|----|----------|----------|
| KA-01 | YouTube → Gemini 추출 → 지식 분석 (요약·key_points·keywords) | P0 |
| KA-02 | market Signal·StockIssue 생성 **완전 금지** | P0 |
| KA-03 | 텍스트/URL 분석 시 지식 모드 선택 + domain 지정 | P1 |
| KA-04 | `force_reanalyze` 시에도 knowledge → market 구조화 호출 안 함 | P0 |
| KA-05 | 콘텐츠에 `domain_id` 저장 | P0 |

### 5.4 지식 허브 UI (핵심)

| ID | 요구사항 | 우선순위 |
|----|----------|----------|
| KU-01 | `/knowledge` 전용 진입점 (네비 메뉴) | P0 |
| KU-02 | 분야 보드: 등록 분야별 카드 그리드 | P0 |
| KU-03 | 분야 상세: 최신순 타임라인 (썸네일·제목·요약·날짜) | P0 |
| KU-04 | 카드 상세: 요약·핵심포인트·원문링크 | P0 |
| KU-05 | 분야별 통계: 이번 주 N건·채널 수 | P1 |
| KU-06 | 검색: 제목·요약·키워드·채널명 | P1 |
| KU-07 | 북마크·읽음 표시 | P2 |

### 5.5 리마인드 기능 (신규 — 학습 특화) ★

기존 요구사항에 없었지만 학습 트렌드 분석 결과 **핵심 차별화 기능**입니다.

| ID | 요구사항 | 우선순위 |
|----|----------|----------|
| KR-01 | **오늘의 리마인드 카드**: 7일·30일 전 콘텐츠 중 무작위 3건 표시 | P1 |
| KR-02 | 리마인드 카드에 "다시 읽기" / "충분히 기억함" 선택 | P1 |
| KR-03 | "충분히 기억함" 선택 시 90일 후 다시 리마인드 | P2 |
| KR-04 | 분야별 핵심 개념 플래시카드 (key_points에서 자동 생성) | P2 |

### 5.6 분야 뉴스 자동 수집

| ID | 요구사항 | 우선순위 |
|----|----------|----------|
| KN-01 | 분야 keywords로 Google News RSS 주기 수집 | P1 |
| KN-02 | 뉴스: 제목·링크·출처·발행시각·AI 1~2문장 요약 | P1 |
| KN-03 | 분야 상세 상단 뉴스 스트립 (최신 5~10건) | P1 |
| KN-04 | 뉴스 → 「지식으로 저장」(URL 분석 파이프라인 연동) | P2 |
| KN-05 | 중복 URL 디듀프 | P1 |
| KN-06 | 스케줄: 6~12시간마다 domain별 수집 | P1 |

### 5.7 분야별 AI 다이제스트

| ID | 요구사항 | 우선순위 |
|----|----------|----------|
| KG-01 | 주간 AI 다이제스트: 분야별 이번 주 핵심 내용 요약 문서 | P2 |
| KG-02 | 다이제스트 = "이번 주 분야 요약 + 놓치면 안 될 3가지" | P2 |
| KG-03 | 시장 digest와 완전히 별도 프롬프트·테이블 | P2 |

---

## 6. 데이터 모델

### 6.1 신규 테이블

#### `knowledge_domains`
```sql
CREATE TABLE knowledge_domains (
    id          INTEGER PRIMARY KEY,
    name        VARCHAR(50)  NOT NULL,
    slug        VARCHAR(50)  UNIQUE NOT NULL,
    emoji       VARCHAR(10),
    color       VARCHAR(20),             -- hex or tailwind color
    description TEXT,
    keywords    TEXT,                    -- JSON 배열 ["AI","LLM"]
    sort_order  INTEGER      DEFAULT 0,
    is_active   BOOLEAN      DEFAULT TRUE,
    created_at  DATETIME     DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME     DEFAULT CURRENT_TIMESTAMP
);
```

#### `knowledge_news_items`
```sql
CREATE TABLE knowledge_news_items (
    id           INTEGER PRIMARY KEY,
    domain_id    INTEGER      NOT NULL REFERENCES knowledge_domains(id),
    title        VARCHAR(300) NOT NULL,
    url          VARCHAR(500) UNIQUE NOT NULL,
    source_name  VARCHAR(100),
    published_at DATETIME,
    summary      TEXT,                  -- AI 1~2문장 요약
    fetched_at   DATETIME     DEFAULT CURRENT_TIMESTAMP
);
```

#### `knowledge_remind_logs`
```sql
CREATE TABLE knowledge_remind_logs (
    id           INTEGER PRIMARY KEY,
    content_id   INTEGER NOT NULL REFERENCES intel_contents(id),
    remind_date  VARCHAR(10) NOT NULL,  -- YYYY-MM-DD
    user_action  VARCHAR(20),           -- "remembered" | "needs_review"
    next_remind  VARCHAR(10),           -- YYYY-MM-DD
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

#### `knowledge_digests`
```sql
CREATE TABLE knowledge_digests (
    id           INTEGER PRIMARY KEY,
    domain_id    INTEGER NOT NULL REFERENCES knowledge_domains(id),
    period_start VARCHAR(10) NOT NULL,
    period_end   VARCHAR(10) NOT NULL,
    body_markdown TEXT,
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### 6.2 기존 테이블 컬럼 추가

#### `intel_contents` 에 추가
```sql
ALTER TABLE intel_contents ADD COLUMN content_scope VARCHAR(20) DEFAULT 'market';
-- 'market' | 'knowledge'
ALTER TABLE intel_contents ADD COLUMN domain_id INTEGER REFERENCES knowledge_domains(id);
```

#### `youtube_channels` 에 추가
```sql
ALTER TABLE youtube_channels ADD COLUMN channel_kind VARCHAR(20) DEFAULT 'market';
-- 'market' | 'knowledge'
ALTER TABLE youtube_channels ADD COLUMN domain_id INTEGER REFERENCES knowledge_domains(id);
ALTER TABLE youtube_channels ADD COLUMN default_market_impact BOOLEAN DEFAULT FALSE;
```

### 6.3 마이그레이션 정책

```python
# migrations/add_knowledge_hub.py

def migrate():
    # 1. 기본 「미분류」 도메인 생성
    db.execute("""
        INSERT OR IGNORE INTO knowledge_domains (name, slug, emoji, sort_order)
        VALUES ('미분류', 'uncategorized', '📁', 999)
    """)

    # 2. 기존 knowledge 콘텐츠 → 미분류 domain 매핑
    db.execute("""
        UPDATE intel_contents
        SET domain_id = (SELECT id FROM knowledge_domains WHERE slug='uncategorized')
        WHERE content_scope = 'knowledge' AND domain_id IS NULL
    """)

    # 3. default_market_impact=0 채널 → channel_kind=knowledge
    db.execute("""
        UPDATE youtube_channels
        SET channel_kind = 'knowledge'
        WHERE default_market_impact = 0
    """)
```

---

## 7. API 설계

### 7.1 Domain CRUD

```
GET    /api/knowledge/domains              # 목록 (is_active 필터)
POST   /api/knowledge/domains              # 생성
PATCH  /api/knowledge/domains/{id}         # 수정
DELETE /api/knowledge/domains/{id}         # 소프트 삭제
POST   /api/knowledge/domains/from-template # 기본 템플릿으로 일괄 생성
```

### 7.2 콘텐츠 피드

```
GET  /api/knowledge/feed
     ?domain_id=1&limit=20&cursor=&search=
     # 지식 콘텐츠 최신순 목록

GET  /api/knowledge/domains/{id}/stats
     # { week_count, total_count, channel_count, latest_at }

GET  /api/knowledge/remind
     # 오늘의 리마인드 카드 3건 (7일/30일 전 콘텐츠)

POST /api/knowledge/remind/{content_id}
     body: { action: "remembered" | "needs_review" }
```

### 7.3 채널 (knowledge 전용)

```
POST  /api/youtube/channels
      body: { channel_url, channel_kind: "knowledge", domain_id: 1 }

PATCH /api/youtube/channels/{id}
      body: { domain_id, channel_kind }

POST  /api/youtube/channels/{id}/migrate-to-knowledge
      body: { domain_id }  # 기존 분석 일괄 knowledge 처리
```

### 7.4 뉴스

```
GET  /api/knowledge/news?domain_id=1&limit=10
POST /api/knowledge/news/fetch?domain_id=1   # 수동 수집 트리거
POST /api/knowledge/news/{id}/save           # 지식으로 저장
```

### 7.5 분석 (knowledge 모드)

```
POST /api/intel/analyze
     body: {
       url: "https://youtube.com/...",
       content_scope: "knowledge",   # 추가 파라미터
       domain_id: 1
     }
```

---

## 8. UI·정보 구조

### 8.1 네비게이션 추가

```
기존 네비:
포트폴리오 | 차트 | 인텔리전스 | 알림 | 설정

변경 후:
포트폴리오 | 차트 | 인텔리전스 | 지식 ← 추가 | 알림 | 설정
```

### 8.2 지식 허브 IA

```
/knowledge                        ← 분야 보드 (메인)
├── [상단] 오늘의 리마인드 카드    ← 7일/30일 전 콘텐츠 3건
├── [그리드] 분야 카드
│   ├── AI·기술 카드
│   │   ├── 이번 주 5건
│   │   ├── 최신 콘텐츠 제목
│   │   └── 분야 뉴스 헤드라인 1건
│   └── 거시경제 카드 ...
└── [하단] 분야 추가 버튼

/knowledge/[slug]                 ← 분야 상세
├── [상단] 분야 뉴스 스트립       ← 최신 5건 자동 수집 뉴스
├── [탭] 콘텐츠 | 채널 | 통계
└── 콘텐츠 타임라인
    ├── 카드: 썸네일·제목·요약·날짜
    └── 클릭 → 상세 모달

/knowledge/[slug]/[content-id]    ← 콘텐츠 상세
├── 요약
├── 핵심 포인트
├── 키워드 태그
└── 원문 링크
```

### 8.3 분야 보드 와이어프레임

```
┌─────────────────────────────────────────────┐
│  📚 내 지식 허브           [+ 분야 추가]    │
├─────────────────────────────────────────────┤
│ 🔄 오늘의 리마인드                           │
│ ┌──────────┐ ┌──────────┐ ┌──────────┐    │
│ │ 7일 전   │ │ 30일 전  │ │ 30일 전  │    │
│ │ AI 요약  │ │ 금리 분석│ │ 부동산법 │    │
│ │ [기억함] │ │ [다시읽기│ │ [기억함] │    │
│ └──────────┘ └──────────┘ └──────────┘    │
├─────────────────────────────────────────────┤
│ 내 관심 분야                                 │
│ ┌──────────────┐  ┌──────────────┐         │
│ │ 🤖 AI·기술   │  │ 📊 거시경제  │         │
│ │ 이번주 5건   │  │ 이번주 3건   │         │
│ │ [엔비디아...]│  │ [Fed 금리...]│         │
│ │ 📰 뉴스 2건  │  │ 📰 뉴스 4건  │         │
│ └──────────────┘  └──────────────┘         │
│ ┌──────────────┐  ┌──────────────┐         │
│ │ 🏢 부동산   │  │ + 분야 추가  │         │
│ │ 이번주 8건   │  │              │         │
│ └──────────────┘  └──────────────┘         │
└─────────────────────────────────────────────┘
```

### 8.4 분야 상세 와이어프레임

```
┌─────────────────────────────────────────────┐
│ ← 지식 허브    🤖 AI·기술    [⚙️ 설정]     │
├─────────────────────────────────────────────┤
│ 📰 최신 뉴스                                │
│ · NVIDIA H200 출하량 예상치 상회 - 5분 전  │
│ · 삼성전자 HBM4 개발 착수 - 2시간 전       │
│ · OpenAI GPT-5 출시 일정 - 3시간 전        │
│ [더보기 →]                                  │
├─────────────────────────────────────────────┤
│ [콘텐츠] [채널] [통계]                      │
├─────────────────────────────────────────────┤
│ ┌────────────────────────────────────────┐  │
│ │ 🎬 [유튜브] 반도체 투자의 미래         │  │
│ │ 삼프로TV · 2026.06.01 · 읽음          │  │
│ │ HBM 시장 점유율 경쟁이 심화되고 있으  │  │
│ │ 며 삼성전자의 2분기 회복 가능성...    │  │
│ │ #반도체 #HBM #삼성전자                 │  │
│ └────────────────────────────────────────┘  │
│ ┌────────────────────────────────────────┐  │
│ │ 📰 [뉴스] AI 반도체 수출 규제 완화    │  │
│ │ Bloomberg · 2026.05.31               │  │
│ └────────────────────────────────────────┘  │
└─────────────────────────────────────────────┘
```

---

## 9. AI 파이프라인 설계

### 9.1 knowledge 분석 프롬프트 (market과 분리)

```python
KNOWLEDGE_ANALYSIS_PROMPT = """당신은 지식 정리 전문가입니다.
아래 문서를 분석하여 학습에 유용한 형태로 정리하세요.
JSON만 출력하세요.

출력 항목:
1. summary: 전체 5~7문장 요약 (한국어, 핵심 개념 중심)
2. key_points: 핵심 포인트 5개 이내 (배열, 기억해야 할 것들)
3. keywords: 키워드 10개 이내 (배열)
4. concepts: 등장한 핵심 개념 (배열)
   [{"term": "HBM", "definition": "High Bandwidth Memory, 고대역폭 메모리..."}]
5. learning_notes: 학습 메모 (초보자도 이해할 수 있는 설명 1~2문장)
6. related_topics: 더 공부하면 좋을 관련 주제 (배열, 3개 이내)
7. sentiment: 해당 분야 동향 ("POSITIVE"/"NEUTRAL"/"NEGATIVE")

⚠️ 주가 예측, Signal 생성, 매수/매도 의견은 절대 포함하지 마세요.

응답 JSON:
{"summary":"","key_points":[],"keywords":[],"concepts":[],
 "learning_notes":"","related_topics":[],"sentiment":"NEUTRAL"}
"""
```

### 9.2 분야 뉴스 수집 파이프라인

```python
# scheduler/knowledge_news_jobs.py

async def fetch_domain_news(domain_id: int, keywords: list[str]):
    """Google News RSS로 분야 뉴스 수집"""
    for keyword in keywords[:3]:  # 키워드당 최대 3개 수집
        url = f"https://news.google.com/rss/search?q={quote(keyword)}&hl=ko&gl=KR"
        items = parse_rss(url)
        for item in items[:5]:
            # 중복 체크
            if not is_duplicate(item.url):
                # AI 1~2문장 요약
                summary = await gemini_summarize(item.title + ": " + item.description)
                save_news_item(domain_id, item, summary)
```

### 9.3 리마인드 카드 생성 로직

```python
# core/knowledge_remind.py

def get_today_remind_cards(db: Session, limit: int = 3) -> list[IntelContent]:
    """7일 전·30일 전 콘텐츠 중 리마인드 대상 선정"""
    from datetime import date, timedelta

    today = date.today()
    targets = []

    # 7일 전 콘텐츠
    week_ago = (today - timedelta(days=7)).isoformat()
    targets += db.query(IntelContent).filter(
        IntelContent.content_scope == "knowledge",
        IntelContent.analyzed_at.like(f"{week_ago}%"),
        # remind_logs에 오늘 기록 없는 것만
    ).limit(2).all()

    # 30일 전 콘텐츠
    month_ago = (today - timedelta(days=30)).isoformat()
    targets += db.query(IntelContent).filter(
        IntelContent.content_scope == "knowledge",
        IntelContent.analyzed_at.like(f"{month_ago}%"),
    ).limit(1).all()

    return targets[:limit]
```

### 9.4 전체 파이프라인 분기 로직

```python
# core/ai_analyzer.py 수정 포인트

async def analyze_content(
    url: str,
    content_scope: str = "market",  # 추가
    domain_id: int | None = None,   # 추가
    ...
):
    # 1단계: Gemini 문서 추출 (공통)
    document = await gemini_client.extract_document(url)

    # 2단계: 분기
    if content_scope == "knowledge":
        # 지식 분석 (Signal 생성 없음)
        analysis = await _analyze_knowledge(document)
        return _save_knowledge_content(analysis, domain_id=domain_id)
    else:
        # 시장 분석 (기존 로직)
        analysis = await _analyze_market(document, portfolio_stocks)
        await extract_signals(analysis, ...)
        return _save_market_content(analysis)
```

---

## 10. 핵심 코드 구조

### 10.1 백엔드 추가 파일

```
backend/
├── api/
│   └── routes_knowledge.py     ← 신규: Domain·Feed·News·Remind API
├── core/
│   ├── knowledge_analyzer.py   ← 신규: 지식 전용 분석 함수
│   ├── knowledge_news.py       ← 신규: RSS 수집·디듀프
│   └── knowledge_remind.py     ← 신규: 리마인드 카드 로직
└── scheduler/
    └── knowledge_jobs.py       ← 신규: 뉴스 수집 스케줄
```

### 10.2 프론트엔드 추가 파일

```
frontend/app/
└── knowledge/
    ├── page.tsx                 ← 분야 보드 메인
    ├── [slug]/
    │   ├── page.tsx             ← 분야 상세 피드
    │   └── [id]/
    │       └── page.tsx         ← 콘텐츠 상세
    └── settings/
        ├── domains/page.tsx     ← 분야 관리
        └── channels/page.tsx    ← 지식 채널 등록
```

### 10.3 routes_knowledge.py 골격

```python
# backend/api/routes_knowledge.py

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from config.database import get_db, KnowledgeDomain, IntelContent, KnowledgeNewsItem
from core.knowledge_remind import get_today_remind_cards
from core.knowledge_news import fetch_domain_news_now

router = APIRouter(prefix="/api/knowledge", tags=["knowledge"])

@router.get("/domains")
def list_domains(db: Session = Depends(get_db)):
    return db.query(KnowledgeDomain).filter(
        KnowledgeDomain.is_active == True
    ).order_by(KnowledgeDomain.sort_order).all()

@router.post("/domains")
def create_domain(body: DomainCreate, db: Session = Depends(get_db)):
    domain = KnowledgeDomain(**body.dict())
    db.add(domain)
    db.commit()
    return domain

@router.get("/feed")
def get_feed(
    domain_id: int | None = None,
    limit: int = 20,
    cursor: str | None = None,
    search: str | None = None,
    db: Session = Depends(get_db)
):
    q = db.query(IntelContent).filter(
        IntelContent.content_scope == "knowledge"
    )
    if domain_id:
        q = q.filter(IntelContent.domain_id == domain_id)
    if search:
        q = q.filter(
            IntelContent.source_title.contains(search) |
            IntelContent.summary.contains(search) |
            IntelContent.keywords.contains(search)
        )
    if cursor:
        q = q.filter(IntelContent.id < int(cursor))
    return q.order_by(IntelContent.created_at.desc()).limit(limit).all()

@router.get("/remind")
def get_remind_cards(db: Session = Depends(get_db)):
    return get_today_remind_cards(db, limit=3)

@router.post("/remind/{content_id}")
def record_remind_action(
    content_id: int,
    body: RemindAction,
    db: Session = Depends(get_db)
):
    # 리마인드 액션 기록 (remembered / needs_review)
    log = KnowledgeRemindLog(
        content_id=content_id,
        remind_date=date.today().isoformat(),
        user_action=body.action,
        next_remind=calc_next_remind(body.action),
    )
    db.add(log)
    db.commit()
    return {"ok": True}

@router.get("/news")
def get_domain_news(domain_id: int, limit: int = 10, db: Session = Depends(get_db)):
    return db.query(KnowledgeNewsItem).filter(
        KnowledgeNewsItem.domain_id == domain_id
    ).order_by(KnowledgeNewsItem.published_at.desc()).limit(limit).all()

@router.post("/news/fetch")
async def trigger_news_fetch(domain_id: int, db: Session = Depends(get_db)):
    domain = db.query(KnowledgeDomain).filter(
        KnowledgeDomain.id == domain_id
    ).first()
    keywords = json.loads(domain.keywords or "[]")
    count = await fetch_domain_news_now(db, domain_id, keywords)
    return {"fetched": count}
```

---

## 11. 개발 로드맵

### Phase 0 — 기반 정리 (1~2일)
- [ ] DB 마이그레이션: `content_scope`, `domain_id`, `channel_kind` 컬럼 추가
- [ ] `knowledge_domains` 테이블 생성
- [ ] 기존 knowledge 콘텐츠 → 미분류 domain 매핑
- [ ] `default_market_impact` 덮어쓰기 버그 수정

### Phase 1 — MVP (1~2주)
- [ ] `routes_knowledge.py`: Domain CRUD + Feed API
- [ ] `knowledge_analyzer.py`: 지식 전용 분석 프롬프트
- [ ] YouTube 등록 폼: `channel_kind` + `domain_id` 선택 추가
- [ ] `/knowledge` 분야 보드 페이지 (Next.js)
- [ ] `/knowledge/[slug]` 분야 상세 피드 (Next.js)
- [ ] 시장 이력 vs 지식 이력 UI 탭 분리

### Phase 2 — 뉴스 + 리마인드 (1주)
- [ ] `knowledge_news.py`: Google News RSS 수집
- [ ] `knowledge_jobs.py`: 6시간마다 분야별 뉴스 수집 스케줄
- [ ] 분야 상단 뉴스 스트립 UI
- [ ] 리마인드 카드 로직 + UI (분야 보드 상단)

### Phase 3 — 고도화 (1~2주)
- [ ] 분야별 주간 AI 다이제스트
- [ ] 검색 기능
- [ ] 북마크·읽음 표시
- [ ] 핵심 개념 플래시카드
- [ ] 뉴스 → 원클릭 지식 저장

---

## 12. 성공 지표

| 지표 | 목표 | 측정 방법 |
|------|------|-----------|
| 등록 분야 수 | ≥ 3개 활성 | knowledge_domains COUNT |
| 주간 지식 소비 | 지식 피드 주 10회 이상 조회 | 페이지뷰 |
| 시장 오염률 | knowledge 콘텐츠의 Signal 생성 = 0건 | StockSignal JOIN |
| 뉴스 클릭률 | 분야 뉴스 CTR ≥ 10% | news item 클릭 / 노출 |
| 리마인드 활용률 | 리마인드 카드 액션 주 3회 이상 | remind_logs COUNT |
| 학습 복리 효과 | 30일 후 재방문율 | 리마인드 "기억함" 비율 |

---

## 13. 미결 사항 (제품 오너 확인 필요)

| 항목 | 선택지 | 권장 |
|------|--------|------|
| 분야 최대 개수 | 제한 없음 vs 20개 | 20개 (UX 단순화) |
| 지식 허브 캘린더 | 필요 vs 피드만 | 피드만 (초기) |
| 하나의 영상을 2개 분야에 | 허용 vs 금지 | 금지 (1:1 단순화) |
| 뉴스 키워드 영문/한글 | 자동 변환 vs 수동 | 수동 (초기) |
| 리마인드 주기 | 7일/30일 고정 vs 커스텀 | 고정 (초기) |

---

*StockMind 지식 허브 PRD v1.0 — 2026.06.02*
*기반: peter-cho-70/stockdashboard + 지식-허브-요구사항.md*
