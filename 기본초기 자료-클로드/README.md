# StockMind 빠른 시작 가이드

## 1. 프로젝트 구조
```
stockmind/
├── main.py                  ← 앱 진입점 (여기서 실행)
├── requirements.txt         ← 패키지 목록
├── .env.example             ← 환경변수 샘플 → .env 로 복사
├── config/
│   ├── settings.py          ← 환경변수 로드
│   └── database.py          ← DB 모델 (Stock, PriceHistory 등)
├── core/
│   ├── kis_client.py        ← 한국투자증권 API 클라이언트 ★
│   ├── portfolio.py         ← 잔고 동기화 + 수익률 계산 ★
│   └── ai_analyzer.py       ← Gemini AI 분석 엔진 ★
├── scheduler/
│   └── jobs.py              ← 자동 갱신 스케줄러 ★
└── api/
    └── routes.py            ← REST API 엔드포인트
```

---

## 2. 설치

```bash
# 가상환경 생성
python -m venv venv
source venv/bin/activate      # Mac/Linux
venv\Scripts\activate         # Windows

# 패키지 설치
pip install -r requirements.txt
```

---

## 3. 환경변수 설정

```bash
# .env.example 복사
cp .env.example .env

# .env 파일 수정
KIS_APP_KEY=실제_앱키
KIS_APP_SECRET=실제_시크릿
KIS_ACCOUNT_NO=12345678-01    # 본인 계좌번호
KIS_IS_MOCK=false             # 실전투자
GEMINI_API_KEY=실제_제미나이키
```

### KIS API 키 발급 방법
1. https://apiportal.koreainvestment.com 접속
2. 한국투자증권 계좌로 로그인
3. [API 신청] → App Key / App Secret 발급
4. (권장) 모의투자 계좌로 먼저 테스트

### Gemini API 키 발급
1. https://aistudio.google.com 접속
2. [Get API Key] → 무료 키 발급

---

## 4. 실행

```bash
# 서버 시작
python main.py

# 또는 개발 모드 (코드 변경 시 자동 재시작)
uvicorn main:app --reload --port 8000
```

서버 시작 후:
- API 문서: http://localhost:8000/docs
- 헬스 체크: http://localhost:8000/api/health

---

## 5. 첫 사용 - 잔고 동기화

```bash
# 즉시 동기화 (터미널에서)
curl -X POST http://localhost:8000/api/portfolio/sync/now

# 포트폴리오 요약 조회
curl http://localhost:8000/api/portfolio/summary

# 알림 조회
curl http://localhost:8000/api/alerts?unread_only=true
```

---

## 6. AI 분석 사용 (Phase 2)

```bash
# YouTube 영상 분석
curl -X POST http://localhost:8000/api/intel/analyze \
  -H "Content-Type: application/json" \
  -d '{"url": "https://www.youtube.com/watch?v=...", "channel_name": "채널명"}'

# 뉴스 기사 분석
curl -X POST http://localhost:8000/api/intel/analyze \
  -H "Content-Type: application/json" \
  -d '{"url": "https://news.example.com/article/..."}'

# 텍스트 직접 분석
curl -X POST http://localhost:8000/api/intel/analyze \
  -H "Content-Type: application/json" \
  -d '{"text": "오늘 반도체 섹터가 급등했습니다...", "title": "2026-05-30 시황"}'

# 특정 종목 이슈 타임라인
curl http://localhost:8000/api/intel/stocks/005930/issues
```

---

## 7. 자동 스케줄 (자동 실행됨)

| 시간 (KST) | 작업 |
|-----------|------|
| 평일 08:50 | 국내 장 시작 전 준비 |
| 평일 15:35 | 국내 종가 동기화 + 5% 알림 |
| 평일 23:35 | 미국 장 오픈 확인 |
| 화~토 07:05 | 미국 종가 동기화 |

---

## 8. 주요 API 엔드포인트

| Method | 경로 | 설명 |
|--------|------|------|
| GET | /api/portfolio/summary | 포트폴리오 요약 |
| GET | /api/portfolio/stocks | 보유 종목 목록 |
| POST | /api/portfolio/sync/now | 즉시 동기화 |
| PATCH | /api/portfolio/stocks/{symbol}/memo | 메모 수정 |
| GET | /api/alerts | 알림 목록 |
| PATCH | /api/alerts/read-all | 전체 읽음 처리 |
| POST | /api/intel/analyze | AI 분석 요청 |
| GET | /api/intel/contents | 분석 이력 |
| GET | /api/intel/stocks/{symbol}/issues | 종목별 이슈 |

---

## 9. 개발 순서 (권장)

```
Phase 1 완성 후 테스트:
1. python main.py 실행
2. /api/portfolio/sync/now 로 첫 동기화
3. /api/portfolio/summary 로 결과 확인
4. /docs 에서 Swagger UI로 API 탐색

Phase 2 진행 시:
5. GEMINI_API_KEY 설정
6. /api/intel/analyze 로 YouTube 분석 테스트
7. /api/intel/stocks/{symbol}/issues 로 이슈 확인

Phase 3 진행 시:
8. Next.js 프론트엔드 개발
9. TradingView 차트 위젯 연동
```

---

## 문의 / 이슈

- KIS API 오류: https://apiportal.koreainvestment.com/faq
- python-kis 문서: https://github.com/Soju06/python-kis
- Gemini API 문서: https://ai.google.dev/gemini-api/docs
