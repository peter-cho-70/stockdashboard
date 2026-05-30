# PRD: StockMind — AI 주식 인텔리전스 플랫폼
**Version 2.0 | 2026.05.30 | 작성: 조충남**

---

## 1. 제품 개요

### 비전
한국투자증권 Open API로 보유 주식을 자동 연동하고,
유튜브·뉴스·텍스트를 Gemini AI가 분석해
내 종목 중심의 인텔리전스를 제공하는 개인 주식 플랫폼.

### 핵심 가치
| 기존 방식 | StockMind |
|-----------|-----------|
| HTS 매번 확인 | 자동 시세 갱신 + 알림 |
| 유튜브 직접 시청 | AI 요약 + 내 종목 연결 |
| 정보 파편화 | 종목·섹터별 이슈 타임라인 |
| 수동 포트폴리오 관리 | KIS API 자동 동기화 |

---

## 2. 기술 스택

### Backend
- **Python 3.11+** + FastAPI
- **python-kis** : 한국투자증권 Open API 연동
- **APScheduler** : 자동 갱신 스케줄러
- **SQLite** (개인용) / Supabase (멀티기기)

### Frontend
- **Next.js 14** + TailwindCSS
- **Recharts** / TradingView Widget (차트)

### AI / 외부 API
- **Gemini API** : YouTube 영상 분석, 뉴스 요약, 차트 분석
- **YouTube Data API v3** : 채널 신규 영상 감지
- **KIS Developers API** : 잔고·시세·체결 조회

### 알림
- Web Push (PWA) / 이메일 / 카카오 알림톡 (선택)

---

## 3. KIS Open API 연동 설계

### 3.1 신청 및 설정
```
1. https://apiportal.koreainvestment.com 접속
2. 한국투자증권 계좌로 로그인
3. API 신청 → App Key / App Secret 발급
4. 모의투자로 테스트 후 실전 전환
```

### 3.2 핵심 API 목록
| 기능 | API TR ID | 주기 |
|------|-----------|------|
| 국내주식 잔고조회 | TTTC8434R | 장마감 후 1회 |
| 해외주식 잔고조회 | TTTS3012R | 미국 마감 후 1회 |
| 국내 현재가 조회 | FHKST01010100 | 필요 시 |
| 해외 현재가 조회 | HHDFS00000300 | 필요 시 |
| 국내 일별 시세 | FHKST03010100 | 일 1회 |

### 3.3 자동 갱신 스케줄 (KST)
| 시점 | 시간 | 동작 |
|------|------|------|
| 국내 장 시작 전 | 08:50 | 전일 미국 종가 저장 + 오전 브리핑 생성 |
| 국내 장 마감 후 | 15:35 | 국내 잔고 + 종가 갱신, 5% 알림 체크 |
| 미국 장 시작 | 23:35 | 미국 시황 요약 |
| 미국 장 마감 | 07:05 | 미국 잔고 + 종가 갱신 |

---

## 4. 기능 모듈

### Module 1: 포트폴리오 트래커 (Phase 1)
- KIS API 자동 잔고 동기화 (국내 + 해외)
- 종목별 수익률 / 수익금액 / 전일 대비 등락
- ±5% 변동 감지 알림 (임계값 커스터마이징)
- 일별 포트폴리오 수익률 히스토리 차트
- 종목 메모 및 투자 thesis 기록

### Module 2: 인텔리전스 허브 (Phase 2)
- 유튜브 채널 등록 → Gemini API 자동 분석
- 뉴스 URL / 텍스트 직접 입력 분석
- 섹터별·종목별 이슈 타임라인
- 월별/일별 아카이브 + 검색
- 주요 경제 일정 캘린더

### Module 3: 차트 AI 분석기 (Phase 3)
- 캔들차트 + 보조지표 (MA, 볼린저, MACD, RSI)
- Gemini Vision 차트 패턴 분석
- 이슈 발생일 차트 마커 오버레이
- AI 향후 변동 코멘트

---

## 5. 프로젝트 구조

```
stockmind/
├── config/
│   ├── settings.py          # 환경변수 및 설정
│   └── database.py          # DB 연결 및 모델
├── core/
│   ├── kis_client.py        # KIS API 클라이언트 (핵심)
│   ├── portfolio.py         # 포트폴리오 관리 로직
│   ├── alert.py             # 알림 시스템
│   └── ai_analyzer.py       # Gemini AI 분석 엔진
├── scheduler/
│   └── jobs.py              # APScheduler 자동 갱신 작업
├── api/
│   └── routes.py            # FastAPI 라우터
├── utils/
│   └── helpers.py           # 유틸리티 함수
├── frontend/                # Next.js 앱 (별도)
├── .env.example             # 환경변수 샘플
├── requirements.txt
└── main.py                  # 앱 진입점
```

---

## 6. 개발 로드맵

### Phase 1 (4~6주): 포트폴리오 트래커
| 주차 | 작업 |
|------|------|
| 1~2주 | KIS API 연동, 잔고 자동 동기화, DB 설계 |
| 3~4주 | 대시보드 UI, 수익률 차트, 5% 알림 |
| 5~6주 | 스케줄러 완성, 알림 시스템, UI polish |

### Phase 2 (6~8주): 인텔리전스 허브
| 주차 | 작업 |
|------|------|
| 7~8주 | Gemini API 연동, YouTube 분석 파이프라인 |
| 9~10주 | 채널 등록, 자동 영상 감지, 분석 결과 저장 |
| 11~12주 | 섹터/종목 이슈 UI, 아카이브, 검색 |

### Phase 3 (4~5주): 차트 AI 분석기
| 주차 | 작업 |
|------|------|
| 13~14주 | TradingView 연동, 보조지표 |
| 15~16주 | Gemini Vision 차트 분석, 이슈 마커 |
| 17주 | 전체 통합 테스트 및 배포 |

---

## 7. 보안 원칙
- App Key / Secret → `.env` 로컬 저장, 절대 코드에 하드코딩 금지
- 포트폴리오 데이터 외부 서버 전송 없음
- AI 분석 시 종목명/티커만 전송, 계좌번호/수량 미전송
- Access Token 자동 갱신 (24시간 만료)

---

## 8. 필요 API 키 목록
```
KIS_APP_KEY=           # KIS Developers 발급
KIS_APP_SECRET=        # KIS Developers 발급
KIS_ACCOUNT_NO=        # 계좌번호 (XXXXXXXX-XX)
GEMINI_API_KEY=        # Google AI Studio 발급
YOUTUBE_API_KEY=       # Google Cloud Console 발급
SMTP_EMAIL=            # 알림 이메일 (선택)
SMTP_PASSWORD=         # 이메일 앱 비밀번호 (선택)
```

---

*StockMind PRD v2.0 — KIS Open API 기반 개인 주식 인텔리전스 플랫폼*
