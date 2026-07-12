# StockMind — AI 주식 인텔리전스 플랫폼

> 한국투자증권·키움증권 계좌 연동 + Gemini/Claude/GPT AI로 유튜브·뉴스를 분석하고,
> **매크로·섹터·종목 신호**를 포트폴리오·차트·예측 시스템에 연결하는 개인용 주식 대시보드.
> 포트폴리오 관리를 넘어 재무관리(FinanceHub)·매매습관 트래커·경매·자동매매까지 아우르는 개인용 올인원 대시보드로 확장됨.

---

## 📚 상세 문서

문서 전체 인덱스는 **[doc/index.html](doc/index.html)**(앱 내 "참고자료" 메뉴에서도 열람 가능) 참고. 주요 문서:

- [개발 현황 (STATUS)](doc/STATUS.md) — 완료 / 진행 중 / 알려진 이슈
- [개발 기록 (DEVLOG)](doc/DEVLOG.md) — Phase별 개발 변천사 + 외부 연동 키 현황
- [AI 분석 · 저장 · 차트 연동 가이드](doc/guide/AI-분석-저장-차트연동.md) — 분석 파이프라인, Signal 레이어, 차트 급변 연결
- [StockMind 예측시스템 아이디어](doc/spec/StockMind-예측시스템-아이디어.md) — Signal 적중률부터 투자 가설 추적까지 8단계 설계 + 구현 현황
- [4종목 심층 분석 리포트](https://claude.ai/code/artifact/bd59d8c2-968e-42d2-8683-b7fab2a12d55) — 삼성전자·현대차·현대모비스·기아 차트·수급·패턴 적중률 종합 분석(차트 구간 마커 실제 스크린샷 포함)

---

## 🕰️ 버전 히스토리

앱 우상단 `v버전` 배지(`frontend/lib/version.ts`)는 기능이 추가될 때마다 갱신됩니다. 주요 마일스톤:

| 시기 | 마일스톤 |
|---|---|
| 2026-05-31 | 최초 구축 — 포트폴리오·시세 기본 골격, Gemini AI 분석 파이프라인, Signal 추출, 워치리스트, 차트 연동, 매매내역·양도소득 보정 |
| 2026-06-01 ~ 06-02 | 워치리스트 허브, 데모 모드, 지식 허브(Knowledge Hub), 미국시장 리포트, 인텔 캘린더·매크로 지표 |
| 2026-06-16 ~ 06-19 | 인텔리전스 허브·지식 허브·거래 리포트, 아침 브리핑 + 국내 마켓 스냅샷, 스터디 허브, KIS 실시세·잔고 연동, 목표 매수/매도가 알림, **FinanceHub(통합 재무관리) 신설** |
| 2026-06-22 ~ 06-27 | 옥션허브·자동매매 모듈, `(stock)` 라우트 그룹 재편, ETF 즐겨찾기·메모, 키움증권 REST API 연동(KIS와 계좌 합산), SpaceX(SPCX) 종목 추가 |
| 2026-07-11 | 문서화 체계 정비(GitHub Pages 문서 사이트), **매매습관(Trade Journal)** 기능, KIS 넥스트레이드(NXT) 체결 누락 버그 수정(344건 복구), 급등락 알림 중복 재발송 버그 수정, 매크로/섹터 감성 파이프라인 프롬프트 버그 수정, **차트 기술적 패턴 적중률 백테스트**, **예측시스템 Phase 1~8 전체 완료**(Signal 적중률 · Lead-Lag · 변동성 스코어 · 패턴 라이브러리 · AI Provider 스코어카드 · 섹터 로테이션 감지 · 시나리오 시뮬레이터 · 투자 가설 추적), 오픈뱅킹(금융결제원) 연동 진행 중 |

상세 변경 이력은 [DEVLOG](doc/DEVLOG.md), 현재 완료/진행 항목 표는 [STATUS](doc/STATUS.md) 참고.

---

## ✨ 전체 기능

### 포트폴리오 · 시세
- KIS(한국투자증권) + 키움증권 계좌 동시 연동, 종목코드 기준 보유수량 합산
- 국내·해외(미국) 시세, 종목별 수익률·평가손익·전일대비, 종목 현황 컬럼 정렬(localStorage 저장)
- 목표 매수/매도가 알림, ±5% 급등락 알림(재알림 방지 엣지 트리거 패턴)
- KIS 넥스트레이드(NXT/SOR) 체결 포함 동기화, 시작 시 자동 캐치업 동기화(계정별 마지막 동기화일부터 재동기화)
- 장마감 스냅샷(`get_latest_trading_date()` 기준 저장), 실현 수익(`/gains`) 계산 및 양도소득 보정

### AI 인텔리전스 파이프라인
1. YouTube/뉴스/텍스트 → Gemini/GPT/Claude 중 선택한 provider로 매크로·섹터·종목 구조화 JSON 추출
2. 저장(`IntelContent`) → `MacroSignal`/`SectorSignal`/`StockSignal` 3단 Signal 자동 파생
3. 인텔리전스 허브(`/intelligence`)에서 캘린더·일별 브리핑·매크로·섹터·리마인드·예측·리스크·투자 가설 탭으로 소비

### 예측 시스템 (Signal → 확률적 판단, AI 재호출 없이 실측 데이터만 사용)
`doc/spec/StockMind-예측시스템-아이디어.md` 8단계 로드맵 전체 구현 완료:

| Phase | 기능 | 핵심 |
|---|---|---|
| 1 | Signal 적중률 추적 | Signal 발생 후 실제 주가 변화 사후 검증, 최적 관측 창 자동 탐색 |
| 2 | Lead-Lag 분석 | 매크로/섹터/종목 Signal이 실제 급변보다 며칠 선행/후행하는지 집계 |
| 3 | 변동성 스코어 매트릭스 | 매수스코어(A/B/C/D) × 변동성(LOW/MEDIUM/HIGH) 매트릭스 |
| 4 | 패턴 라이브러리 | "금리 인하 기대 Signal → 2차전지 반응" 같은 매크로×섹터 패턴을 실측 집계, 고신뢰 패턴 신규 발생 시 자동 알림 |
| 5 | AI Provider 스코어카드 | GPT/Claude/Gemini 중 어느 provider의 분석이 더 정확했는지 Signal 적중률로 비교, 표본 충분 시 자동 최적 provider 사용 |
| 6 | 투자 가설 추적 | "왜 이 종목을 매수했는가" 가설을 등록하면 최근 7일 Signal과 자동 대조해 confirmed/invalidated 전환 |
| 7 | 포트폴리오 시나리오 시뮬레이터 | 패턴 라이브러리 실측치를 보유 종목 비중으로 가중합산해 트리거별 추정 등락률/손익 계산 |
| 8 | 섹터 로테이션 감지 | 최근 구간 전·후반기 섹터별 감성 점수 변화로 상승/하락 섹터 및 보유 종목 편중 경고 |

모든 지표는 표본 부족 시 "데이터 부족"으로 정직하게 표시하며, 반직관적인 낮은 수치도 미화 없이 그대로 노출합니다.

### 차트 분석
- pykrx OHLCV 기반 MA5/20/60·볼린저·RSI, 기본 보기에서도 1/3/6개월·1년 기간 선택
- 실전 가이드 기반 분석 모드(눌림목·골든/데드크로스 등) + **기술적 패턴 적중률 백테스트**(MA 크로스·볼린저 스퀴즈·거래량 급증을 이 종목 과거 가격으로 사후 검증, 차트에 적중✓/실패✗ 마커)
- 급등·급락 탐지 시 원인 우선순위: 종목 이슈 → 섹터 공유 Signal → 매크로 Signal → AI 원인 검색(뉴스 RSS 재사용)
- 증권사 목표가 오버레이, 종목 그룹(관심 묶음)
- 실제 적용 사례: [4종목 심층 분석 리포트](https://claude.ai/code/artifact/bd59d8c2-968e-42d2-8683-b7fab2a12d55)(삼성전자·현대차·현대모비스·기아 — 차트 패턴 적중률 + 실제 수급 데이터 결합 분석)

### 매매습관 (Trade Journal)
- `/portfolio/journal` — KIS/키움 자동 동기화 체결내역에 매수 근거·확신도·감정·목표가·손절가(매수 시점), 매도 사유·복기(매도 시점) 기록
- 손절 준수율·익절 타이밍·감정별 승률 자동 계산, 아침 루틴에서 세운 종목별 계획과 자동 연동("가져오기" 제안)
- 체결일 전후 미니 차트(등락률·급등락 배지 포함) 표시

### FinanceHub (통합 재무관리)
- 자산(`/finance/assets`)·부채(`/finance/liabilities`)·현금흐름(`/finance/cashflow`)·장부(`/finance/ledger`) 통합 관리
- 결제 커버리지 분석, 레버리지 분석 패널 + 레버리지 계산기, DB 백업/복원
- 금융결제원 오픈뱅킹 연동으로 계좌 잔액 자동 동기화(진행 중 — 테스트 인증 이슈로 보류)

### 옥션허브 · 자동매매
- 경매 물건 PDF 파싱·낙찰가 분석(`core/auction_*`), 사건 관리 및 백업
- 조건 기반 자동매매 엔진(`autotrade_engine.py`), 대시보드 메인 계좌와 분리된 전용 계좌 사용 권장, 장중 1분마다 조건 체크

### 지식 허브 · 스터디 · 관심 종목 · 아침 루틴
- 지식 허브: 뉴스/영상 아카이브, digest, 리마인드
- 스터디 허브: 커리큘럼, 리슨/TTS, 카드 학습
- 관심 종목(Watchlist): 모의투자 없이 AI 언급 종목 지켜보기, 차트에서 보유+관심 종목 함께 비교
- 아침 루틴: 그날의 매매 계획 수립 → 매매습관과 연동
- ETF 허브: 즐겨찾기·메모·New 태그, 종목 그룹

---

## 📁 프로젝트 구조

```
stockdashboard/
├── backend/                         Python FastAPI 백엔드
│   ├── config/
│   │   ├── settings.py              환경변수 (KIS·키움·Gemini/GPT/Claude·오픈뱅킹 등)
│   │   └── database.py              SQLAlchemy 모델 (Stock·Signal 3종·PatternLibrary·InvestmentThesis 등)
│   ├── core/                        도메인 로직 (70+ 모듈)
│   │   ├── kis_client.py / kiwoom_client.py    증권사 API 연동
│   │   ├── portfolio.py             포트폴리오 동기화·알림
│   │   ├── ai_analyzer.py           하이브리드 AI 분석 (provider chain, fallback)
│   │   ├── signal_extractor.py      IntelContent → Macro/Sector/Stock Signal
│   │   ├── signal_tracker.py / lead_lag.py       Signal 적중률·Lead-Lag (Phase 1~2)
│   │   ├── volatility_forecast.py   변동성 스코어 (Phase 3)
│   │   ├── pattern_library.py       매크로×섹터 패턴 라이브러리 (Phase 4)
│   │   ├── provider_scorecard.py    AI Provider 적중률 (Phase 5)
│   │   ├── thesis_tracker.py        투자 가설 추적 (Phase 6)
│   │   ├── scenario_simulator.py    포트폴리오 시나리오 시뮬레이터 (Phase 7)
│   │   ├── sector_rotation.py       섹터 로테이션 감지 (Phase 8)
│   │   ├── trade_journal.py         매매습관 트래커
│   │   ├── finance_service.py       FinanceHub 자산/부채/현금흐름
│   │   ├── auction_service.py 등    옥션허브
│   │   └── autotrade_engine.py      자동매매
│   ├── api/                         routes_*.py — 포트폴리오·신호·재무·옥션·자동매매·유튜브·스터디 등
│   ├── scheduler/jobs.py            자동 갱신 (아래 "자동 갱신" 표 참고)
│   └── main.py
└── frontend/                        Next.js (App Router)
    ├── app/
    │   ├── (stock)/                 포트폴리오·차트·인텔리전스·관심종목·알림·매매습관·아침루틴 등
    │   ├── finance/                 FinanceHub (자산·부채·현금흐름·장부·레버리지)
    │   └── auction/                 옥션허브
    └── lib/
        ├── api.ts                   REST 클라이언트
        └── chartAnalysis.ts         차트 분석·패턴 적중률 백테스트
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
| `KIS_APP_KEY` / `KIS_APP_SECRET` / `KIS_ACCOUNT_NO` | 한국투자증권 잔고·시세·체결 동기화 (복수 계좌는 `KIS_ACCOUNTS`) | ✅ |
| `KIWOOM_APP_KEY` / `KIWOOM_APP_SECRET` / `KIWOOM_ACCOUNT_NO` | 키움증권 계좌 연동 (KIS와 종목코드 기준 합산) | 선택 |
| `GEMINI_API_KEY` | YouTube 문서 추출 + 구조화 분석 (기본 `gemini-3.1-flash-lite`) | ✅ |
| `OPENAI_API_KEY` | 구조화 분석 (기본 `gpt-4o-mini`) | 권장 |
| `ANTHROPIC_API_KEY` | Claude 분석 옵션 (`claude-3-5-haiku-latest`) | 선택 |
| `YOUTUBE_API_KEY` | 채널 영상 목록 조회 | 선택 |
| `PUBLIC_DATA_API_KEY` | 공공데이터포털 수출입 상세 API | 선택 |
| `OPENBANKING_CLIENT_ID` / `OPENBANKING_CLIENT_SECRET` | 금융결제원 오픈뱅킹(계좌 잔액 자동 동기화) | 선택 |
| `AUTOTRADE_ACCOUNT_NO` / `AUTOTRADE_KIWOOM_ACCOUNT_NO` | 자동매매 전용 계좌(메인 계좌와 분리 권장) | 선택 |

전체 옵션은 `backend/.env.example` 참고. AI 호출 절약 옵션(`AI_FALLBACK`, `AI_SKIP_IF_CACHED` 등)도 포함되어 있습니다.

---

## 🕐 자동 갱신 스케줄 (KST)

| 시간 | 동작 |
|------|------|
| 매일 00:30 | Signal 적중률 사후 검증 |
| 매일 00:45 | 일일 AI digest 생성 |
| 매일 01:00 | Signal Lead-Lag 분석 갱신 |
| 매일 06:30 | 경제 캘린더 동기화 |
| 평일 08:05 | 미국 마감 리포트 |
| 평일 08:50 | 국내 장 시작 전 확인 |
| 평일 15:35 | 국내 종가 동기화 + 급등락 알림 |
| 매일 16:00 | 투자 가설 검증 |
| 평일 16:10 | FinanceHub 자산 자동 동기화(예수금+오픈뱅킹) |
| 평일 23:35 | 미국 장 오픈 확인 |
| 화~토 07:05 | 미국 장 마감 동기화 |
| 매주 일 02:00 | 패턴 라이브러리 추출 |
| 매시 정각 | 시스템 헬스 체크 |
| 평일 09~15시, 매분 | 자동매매 조건 체크 |
| 매월 1·20일 09:00 | 매매 리포트 |

---

## 🗄️ 데이터 영속성

- SQLite `stockmind.db` — 분석 결과·Signal·관심종목·투자 가설 등 영구 저장
- `IntelContent` 원본은 삭제하지 않음; Signal은 content_id 기준 재생성
- 서버 시작 시 자동 백업(`backend/data/backups/`, 4시간 이내 백업 있으면 생략) + 설정 화면에서 수동 백업/복원
- `.env`: `DB_PATH=./stockmind.db` (배포 시 영구 볼륨 권장)

---

## 🎭 데모 모드 (공개 시연)

실제 보유 종목·금액을 숨기고 **샘플 포트폴리오**만 보여줍니다. 차트·AI Signal·buy-score는 **같은 종목코드**로 분석된 데이터를 그대로 사용합니다.

1. `backend/data/demo_portfolio.json` — 약 10종목, `qty`·`avg_price` 수정
2. API `.env`: `DEMO_PIN=원하는숫자` (설정 화면 토글용)
3. **설정 → 데모 모드**에서 PIN 입력 후 켜기/끄기 (재시작 불필요)
4. 또는 초기값만 env: `DEMO_MODE=true` (DB에 저장 전까지)

자세한 설명: `backend/data/README.md`

> 개인용은 데모 끄기 + 로컬/영구 DB. 공개 URL만 데모를 켜세요.

---

## 🌐 배포

| 서비스 | 설정 |
|--------|-----|
| 프론트 (Vercel) | `frontend/vercel.json` |
| API (Vercel serverless) | `backend/vercel.json` — `handler.py` 진입점, cron으로 미국 마감/국내 종가 리포트 트리거 |
| API (Render 대안) | `render.yaml` |
| GitHub | https://github.com/peter-cho-70/stockdashboard |

---

## ⚠️ 면책 조항

본 플랫폼의 AI 분석·예측·추천·연관 표시는 모두 **참고용**이며 투자 결정의 근거가 될 수 없습니다.
Signal 적중률·패턴 라이브러리·시나리오 시뮬레이터 등 예측 시스템의 모든 수치는 과거 데이터 기반 통계이며 미래 결과를 보장하지 않습니다.
