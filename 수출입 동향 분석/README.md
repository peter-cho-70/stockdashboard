# 한국 수출입통계 자동 수집·분석 프로그램

공공데이터(관세청/한국무역협회)에서 월별 수출입 통계를 자동 수집하고
Gemini AI로 투자 관점 + 거시경제 관점 분석 리포트를 생성합니다.

---

## 파일 구조

```
trade_analyzer/
├── trade_analyzer.py    ← 핵심 수집·분석 엔진
├── trade_scheduler.py   ← 월별 자동 실행 스케줄러
├── requirements.txt     ← 패키지 목록
├── .env.example         ← 환경변수 샘플
├── data/                ← 수집 데이터 캐시 (자동 생성)
└── output/              ← 분석 리포트 저장 (자동 생성)
    ├── trade_report_*.md
    └── trade_data_*.xlsx
```

---

## 설치

```bash
pip install -r requirements.txt
cp .env.example .env
# .env 파일에 API 키 입력
```

---

## API 키 발급

### Gemini API (AI 분석용, 필수)
1. https://aistudio.google.com 접속
2. [Get API Key] → 무료 발급
3. `.env` 파일에 `GEMINI_API_KEY=AIzaSy...` 입력

### 공공데이터포털 API (선택, 없으면 KITA 대체)
1. https://www.data.go.kr 회원가입
2. 검색창에 "관세청 수출입실적" 검색
3. [활용신청] → 1~2일 후 승인
4. `.env` 파일에 `PUBLIC_DATA_API_KEY=...` 입력

---

## 실행 방법

### 기본 실행 (12개월 수집 + AI 분석)
```bash
python trade_analyzer.py
```

### 옵션 지정
```bash
# 최근 6개월만 수집
python trade_analyzer.py --months 6

# API 키 직접 지정
python trade_analyzer.py --gemini-key AIzaSy... --months 12

# 데이터 수집만 (AI 분석 건너뜀)
python trade_analyzer.py --no-analyze

# 캐시 무시하고 새로 수집
python trade_analyzer.py --no-cache
```

### 월별 자동 실행 (서버 상시 실행)
```bash
# 스케줄러 시작 (매월 1일, 20일 자동 실행)
python trade_scheduler.py

# 즉시 1회 실행 테스트
python trade_scheduler.py --now
```

---

## 출력 결과

### 1. Markdown 분석 리포트 (`output/trade_report_*.md`)
- 수출입 총괄 트렌드 분석
- 국가별 무역 현황 (대중국·대미 등 주요국)
- 품목별·섹터별 분석 (반도체, 자동차, 2차전지 등)
- 통합 분석: 투자 시사점 + 거시경제 시그널

### 2. Excel 데이터 (`output/trade_data_*.xlsx`)
- 월별총괄 시트
- 국가별 시트
- 품목별 시트

---

## 데이터 소스

| 소스 | 내용 | API 키 |
|------|------|--------|
| 공공데이터포털 (관세청) | 국가별·품목별 확정 통계 | 필요 |
| 한국무역협회 K-stat | 월별 총괄·국가별·품목별 | 불필요 |

---

## 주의사항

- 본 프로그램은 공개된 공공데이터를 활용합니다
- AI 분석 결과는 참고용이며, 투자 결정의 근거로 사용하지 마세요
- 공공데이터포털 API는 국내 IP에서만 정상 동작합니다
