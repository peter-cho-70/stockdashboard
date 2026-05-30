# StockMind — AI 주식 인텔리전스 플랫폼

> 한국투자증권 계좌 자동 연동 + Gemini AI로 유튜브·뉴스를 분석해 **내 종목 중심** 인텔리전스를 제공하는 개인용 주식 대시보드

---

## 📁 프로젝트 구조

```
stockdashboard/
├── backend/          ← Python FastAPI 백엔드
│   ├── config/
│   │   ├── settings.py     환경변수 관리
│   │   └── database.py     SQLAlchemy DB 모델
│   ├── core/
│   │   ├── kis_client.py   KIS Open API 클라이언트
│   │   ├── portfolio.py    포트폴리오 동기화/수익률
│   │   └── ai_analyzer.py  Gemini AI 분석 엔진
│   ├── scheduler/
│   │   └── jobs.py         자동 갱신 스케줄러
│   ├── api/
│   │   └── routes.py       FastAPI REST 엔드포인트
│   ├── main.py
│   ├── requirements.txt
│   └── .env.example
└── frontend/         ← Next.js 14 프론트엔드
    ├── app/
    │   ├── page.tsx           대시보드 홈
    │   ├── portfolio/         종목 현황 테이블
    │   ├── intelligence/      AI 분석 허브
    │   ├── alerts/            알림 목록
    │   └── settings/          설정 및 API 키 안내
    ├── components/
    │   ├── app-shell.tsx      네비게이션 쉘
    │   └── theme-toggle.tsx   라이트/딤/다크 테마
    └── lib/
        └── api.ts             백엔드 API 클라이언트
```

---

## 🚀 빠른 시작

### 1. 백엔드 실행

```bash
cd stockdashboard/backend

# 가상환경 생성
python -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate

# 패키지 설치
pip install -r requirements.txt

# 환경변수 설정
cp .env.example .env
# .env 파일 편집 → KIS, Gemini API 키 입력

# 서버 시작
python main.py
# → http://localhost:8000
# → API 문서: http://localhost:8000/docs
```

### 2. 프론트엔드 실행

```bash
cd stockdashboard/frontend

npm install
npm run dev
# → http://localhost:3000
```

---

## 🔑 필요한 API 키

| 키 | 발급처 | 필수 |
|----|--------|------|
| `KIS_APP_KEY` / `KIS_APP_SECRET` | [KIS Developers](https://apiportal.koreainvestment.com) | ✅ |
| `KIS_ACCOUNT_NO` | 한국투자증권 계좌번호 (XXXXXXXX-XX) | ✅ |
| `GEMINI_API_KEY` | [Google AI Studio](https://aistudio.google.com) (무료) | ✅ (YouTube 문서 추출) |
| `OPENAI_API_KEY` | [OpenAI Platform](https://platform.openai.com) | ✅ (종목·매크로·섹터 분석) |
| `OPENAI_MODEL` | GPT 모델명 (기본: `gpt-4o-mini`) | 선택 |
| `YOUTUBE_API_KEY` | [Google Cloud Console](https://console.cloud.google.com) | 선택 |

---

## 📋 주요 기능 (3 Phases)

### Phase 1 — 포트폴리오 트래커 ✅
- KIS API 잔고 자동 동기화 (국내 + 해외)
- 종목별 수익률·수익금액·전일대비 등락 표시
- ±5% 변동 감지 알림
- 자동 갱신 스케줄러 (08:50 / 15:35 / 23:35 / 07:05 KST)

### Phase 2 — 인텔리전스 허브 🔄
- YouTube URL → Gemini AI 자동 분석
- 뉴스 기사 URL 크롤링 → AI 분석
- 텍스트 직접 입력 분석
- 섹터별·종목별 이슈 타임라인

### Phase 3 — 차트 AI 분석기 📈 (예정)
- TradingView 위젯 연동
- Gemini Vision 차트 패턴 분석
- 이슈-차트 오버레이 뷰

---

## 🕐 자동 갱신 스케줄 (KST)

| 시간 | 동작 |
|------|------|
| 평일 08:50 | 전일 미국 마감가 확인 + 오전 브리핑 |
| 평일 15:35 | 국내 종가 동기화 + 5% 알림 체크 |
| 평일 23:35 | 미국 장 오픈 확인 |
| 화~토 07:05 | 미국 장 마감 → 미국 종가 동기화 |

---

## ⚠️ 면책 조항

본 플랫폼의 모든 분석 결과는 참고용이며 투자 결정의 근거가 될 수 없습니다.
