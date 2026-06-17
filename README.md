# StockMind — AI 주식 인텔리전스 플랫폼

> 한국투자증권 계좌 연동 + Gemini/Claude/GPT AI로 유튜브·뉴스를 분석하고,  
> **매크로·섹터·종목 신호**를 포트폴리오와 차트에 연결하는 개인용 주식 대시보드

---

## 📚 상세 문서

- [AI 분석 · 저장 · 차트 연동 가이드](docs/AI-분석-저장-차트연동.md) — 분석 파이프라인, Signal 레이어, 차트 급변 연결
- [AI 인텔리전스 허브 전면 개편안](docs/AI-인텔리전스-허브-전면개편안.md) — 캘린더 허브, 일일 digest, 정량 대시보드 (설계)

---

## 📁 프로젝트 구조

```
stockdashboard/
├── backend/                    Python FastAPI 백엔드
│   ├── config/
│   │   ├── settings.py         환경변수 (Gemini, KIS, AI provider)
│   │   └── database.py         SQLAlchemy 모델
│   ├── core/
│   │   ├── kis_client.py       KIS Open API
│   │   ├── portfolio.py        포트폴리오 동기화·알림
│   │   ├── ai_analyzer.py      하이브리드 AI 분석 (YouTube→Gemini, 구조화→GPT/Claude)
│   │   ├── gemini_client.py      google-genai SDK (gemini-3.1-flash-lite)
│   │   ├── signal_extractor.py   IntelContent → Macro/Sector/Stock Signal
│   │   ├── signal_related.py     연관 분석 점수·공유 신호
│   │   ├── sector_peers.py       섹터 정규화 (자동차 peer 등)
│   │   ├── recommendations.py    AI 언급 종목 집계
│   │   ├── watchlist_service.py  관심 종목 등록
│   │   └── move_explainer.py     주가 급변 AI 원인 + 신호 재사용
│   ├── api/
│   │   ├── routes.py           포트폴리오·차트·인텔
│   │   ├── routes_youtube.py   YouTube 채널·영상 분석
│   │   ├── routes_signals.py   신호·브리핑·공유·연관 API
│   │   └── routes_watchlist.py 관심 종목·추천 API
│   ├── scheduler/jobs.py         자동 갱신 (08:50 / 15:35 / 23:35 / 07:05 KST)
│   └── main.py
└── frontend/                   Next.js 14
    ├── app/
    │   ├── page.tsx            대시보드 홈
    │   ├── portfolio/          종목 현황 (컬럼 정렬)
    │   ├── chart/              차트 + 급변·섹터·매크로 연동
    │   ├── intelligence/       AI 분석·브리핑·매크로·섹터·리마인드
    │   ├── watchlist/          관심 종목 + AI 추천
    │   ├── alerts/             알림
    │   ├── gains/              실현 수익
    │   └── settings/           API 키 설정
    └── lib/
        ├── api.ts              REST 클라이언트
        └── chartAnalysis.ts    차트 분석·급변·공유 신호 매칭
```

---

## 🚀 빠른 시작

### 한 번에 실행 (권장)

프로젝트 루트에서 백엔드·프론트를 동시에 띄웁니다.

| OS | 명령 |
|----|------|
| **macOS / Linux** | `./start-dev.sh` |
| **Windows** | `start-dev.bat` 더블클릭 또는 명령 프롬프트에서 실행 |

- 최초 실행 시 `backend/venv`, `frontend/node_modules` 가 없으면 자동 설치를 시도합니다.
- `backend/.env` 가 없으면 안내 후 종료합니다 (`cp backend/.env.example backend/.env`).
- `frontend/.env.local` 이 없으면 `NEXT_PUBLIC_API_URL=http://localhost:8000/api` 를 생성합니다.
- 백엔드: [http://localhost:8000/docs](http://localhost:8000/docs) · 프론트: [http://localhost:4000](http://localhost:4000)
- macOS/Linux: **Ctrl+C** 로 두 프로세스 모두 종료 · Windows: 각 터미널 창을 닫으면 종료
- `venv` 폴더만 있고 패키지가 없으면 스크립트가 `pip install` 을 자동 실행합니다. 실패 시:

```bash
cd backend && source venv/bin/activate && pip install -r requirements.txt
```

```bash
# macOS/Linux — 최초 1회 실행 권한
chmod +x start-dev.sh
./start-dev.sh
```

포트 변경 (선택):

```bash
BACKEND_PORT=8000 FRONTEND_PORT=4000 ./start-dev.sh
```

### 백엔드만

```bash
cd backend
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # API 키 입력
python3 main.py
# → http://localhost:8000/docs
```

### 프론트엔드만

```bash
cd frontend
npm install
npm run dev
# → http://localhost:4000
```

---

## 🔑 API 키

| 키 | 용도 | 필수 |
|----|------|------|
| `KIS_APP_KEY` / `KIS_APP_SECRET` | 잔고·시세 동기화 | ✅ |
| `GEMINI_API_KEY` | YouTube 문서 추출 (`AIzaSy...` 또는 `AQ....`) | ✅ |
| `OPENAI_API_KEY` | 구조화 분석 (기본 `gpt-4o-mini`) | 권장 |
| `ANTHROPIC_API_KEY` | Claude 분석 옵션 | 선택 |
| `YOUTUBE_API_KEY` | 채널 영상 목록 | 선택 |

모델: `GEMINI_MODEL=gemini-3.1-flash-lite` (기본)

---

## ✨ 주요 기능

### Phase 1 — 포트폴리오 ✅
- KIS API 잔고 동기화 (국내·해외)
- 종목별 수익률·평가손익·전일대비
- **종목 현황 컬럼 정렬** (평가금액·수익률·섹터 등, localStorage 저장)
- ±5% 변동 알림
- 자동 갱신 스케줄러

### Phase 2 — AI 인텔리전스 ✅

**분석 파이프라인**
1. YouTube → Gemini: 영상 → 문서 추출
2. 문서 → GPT/Claude/Gemini: 매크로·섹터·종목 구조화 JSON
3. 저장 → Signal 테이블 자동 파생

**Signal 레이어 (3단계)**
| 테이블 | 내용 |
|--------|------|
| `MacroSignal` | 금리·환율·CPI·FOMC 등 매크로 토픽 |
| `SectorSignal` | 섹터별 요약·전망·`mentioned_stocks` |
| `StockSignal` | 언급 종목 (보유 여부 `is_portfolio`) |

**UI 탭 (AI 분석 페이지)**
- 분석 요청 / 채널 구독 / 분석 이력
- **일별 브리핑** — 날짜별 분석·토픽 요약 + 백필
- **매크로** — 토픽별 신호 허브
- **섹터** — 섹터별 신호 + **AI 언급 종목 → 지켜보기**
- **리마인드** — 보유 종목 관련 신호

### Phase 2.5 — 신호 공유·연관 ✅

**섹터 peer 정규화** (`sector_peers.py`)
- `운송장비·부품` → `자동차`, 현대차·기아·모비스 코드 매핑
- 같은 섹터 Signal을 peer 종목 차트에 **자동 연결**

**차트 급변 구간**
- 우선순위: 종목 이슈 → **섹터 공유** → **매크로** → AI 원인 검색
- 클릭 시 **관련 분석 패널** (키워드·섹터·매크로 점수순, 참고용)
- AI 원인 검색: Gemini/GPT/Claude 선택, **동일일 섹터 신호면 AI 스킵**

**API**
```
GET  /api/intel/daily
GET  /api/intel/macro
GET  /api/intel/sectors
GET  /api/intel/portfolio/remind
GET  /api/intel/stocks/{symbol}/shared-signals
GET  /api/intel/stocks/{symbol}/related?date=YYYY-MM-DD
GET  /api/intel/recommendations?sector=자동차
POST /api/intel/signals/backfill
GET  /api/intel/signal-accuracy          # Signal 적중률 (Phase 1)
POST /api/intel/signal-outcomes/evaluate # 사후 검증 수동 실행
GET  /api/intel/lead-lag                 # Lead-Lag 집계 (Phase 2)
POST /api/intel/lead-lag/compute         # Lead-Lag 배치 실행
GET  /api/intel/calendar?from=&to=       # 캘린더 허브 (월/주 메타)
GET  /api/intel/calendar/day?date=       # 일 뷰 타임라인
GET  /api/intel/digest?from=&to=         # 일일 digest 목록
GET  /api/intel/digest/{date}            # digest 본문
POST /api/intel/digest/generate          # 단일일 AI 요약 생성
POST /api/intel/digest/backfill          # 기간 백필
```

### Phase 2.6 — 관심 종목 (Watchlist) ✅

모의투자 없이 **AI가 언급한 종목을 지켜보기**:
- `/watchlist` 페이지 — AI 추천 목록 + 내 관심 목록
- 섹터 허브에서 ★ **지켜보기** 클릭
- 등록 시 KRX 종목코드 자동 매칭 (pykrx)
- **차트**에서 보유 + 관심 종목 함께 선택 가능

```
GET    /api/watchlist
POST   /api/watchlist
DELETE /api/watchlist/{id}
```

### Phase 3 — 차트 AI 분석 ✅
- pykrx OHLCV + MA5/20/60, 볼린저, RSI
- 실전 가이드 기반 **차트 분석 모드** (눌림목·골든크로스 등)
- 급등·급락 탐지 + AI 이슈·섹터·매크로 마커
- 주가 급변 **AI 원인 검색** (뉴스 RSS + 신호 재사용)

---

## 🎭 데모 모드 (공개 시연)

실제 보유 종목·금액을 숨기고 **샘플 포트폴리오**만 보여줍니다. 차트·AI Signal·buy-score는 **같은 종목코드**로 분석된 데이터를 그대로 사용합니다.

1. `backend/data/demo_portfolio.json` — 약 10종목, `qty`·`avg_price` 수정
2. API `.env`: `DEMO_PIN=원하는숫자` (설정 화면 토글용)
3. **설정 → 데모 모드**에서 PIN 입력 후 켜기/끄기 (재시작 불필요)
4. 또는 초기값만 env: `DEMO_MODE=true` (DB에 저장 전까지)

자세한 설명: `backend/data/README.md`

> 개인용은 데모 끄기 + 로컬/Render 영구 DB. 공개 URL만 데모를 켜세요.

---

## 🗄️ 데이터 영속성

- SQLite `stockmind.db` — 분석 결과·신호·관심종목 영구 저장
- `IntelContent` 원본은 삭제하지 않음; Signal은 content_id 기준 재생성
- 백필: 인텔리전스 → **일별 브리핑 → 백필** (기존 분석 → Signal 변환)
- `.env`: `DB_PATH=./stockmind.db` (Render 등 배포 시 영구 볼륨 권장)

---

## 🕐 자동 갱신 (KST)

| 시간 | 동작 |
|------|------|
| 평일 08:50 | 미국 마감 확인 |
| 평일 15:35 | 국내 종가 + 5% 알림 |
| 평일 23:35 | 미국 장 오픈 |
| 화~토 07:05 | 미국 종가 동기화 |

---

## 🌐 배포

| 서비스 | URL |
|--------|-----|
| 프론트 | https://stockdashboard-two.vercel.app |
| API | https://stockmind-api.vercel.app |
| GitHub | https://github.com/peter-cho-70/stockdashboard |

---

## 📋 사용 팁

1. **YouTube 분석** → 인텔리전스 → 채널 구독 (분석 후 같은 탭에 결과 표시)
2. **백필 1회** → 일별 브리핑 → 백필 (기존 영상 → Signal)
3. **자동차 3사 공유** → 5/21 섹터 Signal이 현대차·기아·모비스 차트에 `섹터 공유` 배지
4. **관심 종목** → 섹터 탭 ★ 또는 `/watchlist` → 차트에서 추세 확인
5. **종목 현황** → 컬럼 헤더 클릭으로 정렬 (기본: 평가금액 내림차순)

---

## ⚠️ 면책 조항

본 플랫폼의 AI 분석·추천·연관 표시는 **참고용**이며 투자 결정의 근거가 될 수 없습니다.  
섹터/매크로 공유 신호는 **동일 원인을 단정하지 않고** 맥락 제공 목적입니다.
