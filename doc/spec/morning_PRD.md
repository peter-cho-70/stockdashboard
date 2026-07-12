# 주식 투자자 아침 루틴 앱 (Morning Routine) — PRD
**Version 1.0 | 2026.06.16 | 바이브 코딩 기획 문서**

---

## 목차
1. [개요](#1-개요)
2. [문제 정의](#2-문제-정의)
3. [핵심 컨셉](#3-핵심-컨셉)
4. [사용자 시나리오](#4-사용자-시나리오)
5. [기능 요구사항](#5-기능-요구사항)
6. [화면별 상세 설계](#6-화면별-상세-설계)
7. [데이터 모델](#7-데이터-모델)
8. [API 연동 설계](#8-api-연동-설계)
9. [기술 스택](#9-기술-스택)
10. [상태관리 구조](#10-상태관리-구조)
11. [개발 로드맵](#11-개발-로드맵)
12. [성공 지표](#12-성공-지표)
13. [미결 사항](#13-미결-사항)

---

## 1. 개요

### 1.1 한 줄 정의
> **"주식 개장 전 2시간, 전문가처럼 시장을 준비하고 오늘의 매매 전략을 세우는 단계별 아침 루틴 앱"**

### 1.2 앱 이름 후보
- `MorningBell` — 개장 알림벨 의미
- `PreMarket` — 프리마켓 루틴
- `오전전략` — 직관적 한국어명

### 1.3 핵심 가치

| 기존 방식 | 이 앱 |
|----------|------|
| 여러 앱·사이트를 따로 확인 | 글로벌 → 국내 → 전략까지 한 흐름으로 |
| 개장 후 즉흥적 매매 | 개장 전 시나리오·진입가 사전 설정 |
| 루틴이 매일 달라짐 | 체크리스트 기반 일관된 루틴 유지 |
| 분석 기록이 사라짐 | 일지로 축적 → 패턴 인식 향상 |

---

## 2. 문제 정의

### 2.1 투자자가 겪는 문제
1. **정보 파편화**: 미국 증시, 환율, 뉴스, 차트를 각기 다른 앱에서 확인하느라 시간이 낭비됨
2. **즉흥 매매**: 개장 후 시장에 끌려다니며 계획 없이 매매 → 손실 반복
3. **루틴 미흡**: 어떤 날은 철저히 준비하고, 어떤 날은 대충 → 결과가 들쭉날쭉
4. **기록 부재**: 매일의 분석과 판단 근거가 남지 않아 실력 향상이 더딤

### 2.2 전문가가 하는 것과 일반 투자자의 차이
```
전문가                        일반 투자자
──────────────────────────   ──────────────────────────
개장 2시간 전 준비 시작        개장 후 확인 시작
시나리오 3가지 미리 작성       시장 보면서 즉흥 결정
진입가·손절가 사전 설정        감으로 매매
매일 분석 일지 기록            기록 없음
"모르는 날은 쉰다"             매일 무조건 매매
```

---

## 3. 핵심 컨셉

### 3.1 타임라인 기반 루틴

앱의 핵심 UX는 **시간대별 단계(Phase)**를 순서대로 완료해나가는 구조입니다.
체크리스트를 완료하면 다음 단계로 진행하고, 모든 단계를 마치면 "오늘 전략 완성" 상태가 됩니다.

```
Phase 1  05:30   미국 증시 마감 체크        [5분]
Phase 2  06:00   글로벌 매크로 분석          [30분]
Phase 3  06:30   국내 시장 분석              [60분]
Phase 4  07:30   오늘의 전략 수립            [30분]
Phase 5  08:00   최종 점검 + 멘탈 세팅       [30분]
Phase 6  09:00   개장 초반 관찰              [30분]
```

### 3.2 핵심 플로우

```
앱 실행
  │
  ▼
오늘 루틴 대시보드
  │ (현재 시간 기준 해당 Phase 자동 표시)
  ▼
Phase별 체크리스트 진행
  │ (각 항목 체크 → 완료 마킹)
  ▼
전략 수립 화면
  │ (시나리오 3가지 + 관심 종목 입력)
  ▼
오늘 루틴 완료 ✅
  │ (일지로 자동 저장)
  ▼
과거 일지 아카이브
  (패턴 분석·실력 향상)
```

---

## 4. 사용자 시나리오

### 페르소나
- **이름**: 피터 (조충남)
- **투자 스타일**: 다가구 경매 투자 + 주식 병행, StockMind 개발 중
- **고민**: 매일 아침 정보를 체계적으로 정리하고 싶지만 루틴이 없어 들쭉날쭉

### 시나리오 A — 평일 아침 (Happy Path)

```
05:30  알람 → 앱 실행 → Phase 1 자동 활성화
       나스닥 -1.2% / SOX -0.8% / VIX 22.3 입력
       "미국 하락, VIX 상승 → 오늘 방어적 접근" 메모
       Phase 1 완료 체크

06:00  Phase 2 진행
       10년물 금리 4.52% ↑ / 달러인덱스 104.2 확인
       "금리 상승 → 성장주 약세 우려" 판단 입력
       Phase 2 완료

07:30  Phase 4 (전략 수립)
       시나리오 A: 코스피 +0.3% 이상 → SK하이닉스 86,000원 진입
       시나리오 B: 코스피 보합 → 관망
       시나리오 C: 코스피 -0.5% 이하 → 보유 30% 현금화
       오늘 매매 금지사항: "테마주 추격 매수 금지"

09:00  개장 관찰 → 시나리오 B 진행 중 → 계획대로 관망
```

### 시나리오 B — 중요 이벤트 있는 날

FOMC 발표, 국내 기준금리 결정, 대형 기업 실적 발표일에는 앱이 "고변동성 경고"를 표시하고 해당 이벤트를 Phase 체크리스트에 자동 추가합니다.

---

## 5. 기능 요구사항

### 5.1 루틴 대시보드

| ID | 요구사항 | 우선순위 |
|----|----------|----------|
| DB-01 | 오늘 날짜·요일·시장 개장까지 남은 시간 표시 | P0 |
| DB-02 | 6개 Phase 진행 상태 한눈에 표시 (미완료/진행중/완료) | P0 |
| DB-03 | 현재 시간 기준 해당 Phase 자동 하이라이트 | P0 |
| DB-04 | 전체 루틴 완료율 % 표시 | P0 |
| DB-05 | 어제 전략 요약 한 줄 표시 ("어제는 시나리오 B 진행") | P1 |
| DB-06 | 연속 루틴 완료 스트릭(streak) 표시 | P2 |

### 5.2 Phase 1 — 미국 증시 마감 체크

| ID | 요구사항 | 우선순위 |
|----|----------|----------|
| P1-01 | 나스닥·S&P500·다우 등락률 입력 필드 (수동) | P0 |
| P1-02 | 필라델피아 반도체 지수(SOX) 등락률 입력 | P0 |
| P1-03 | VIX 수치 입력 + 경계값 자동 판정 (20 이상 = 경고) | P0 |
| P1-04 | API 자동 조회 (Yahoo Finance or Alpha Vantage) | P1 |
| P1-05 | 입력값 기반 "오늘 분위기" 자동 판정 문구 표시 | P1 |
|       | - 나스닥 +1% 이상 → "🟢 위험 선호 장세"            |  |
|       | - ±1% 이내 → "🟡 방향성 탐색"                      |  |
|       | - 나스닥 -1% 이하 → "🔴 위험 회피, 방어적 접근"     |  |
| P1-06 | Phase 완료 시 타임스탬프 기록 | P0 |

### 5.3 Phase 2 — 글로벌 매크로 분석

| ID | 요구사항 | 우선순위 |
|----|----------|----------|
| P2-01 | 미국 10년물 국채금리 입력 + 전일 대비 방향 표시 | P0 |
| P2-02 | 달러인덱스(DXY) 입력 | P0 |
| P2-03 | 달러/원 환율 입력 (1,400원 이상 = 경고 표시) | P0 |
| P2-04 | WTI 유가 입력 | P0 |
| P2-05 | 주요 뉴스 메모 필드 (자유 텍스트, 최대 500자) | P0 |
| P2-06 | 뉴스 유형 태그 선택 (FOMC/실적/지정학/경제지표/기타) | P1 |
| P2-07 | 매크로 판단 한 줄 메모 ("금리 상승 + 달러 강세 → 성장주 약세") | P0 |
| P2-08 | 선물 시장 (코스피200·코스닥150) 방향 선택 (상승/중립/하락) | P1 |

### 5.4 Phase 3 — 국내 시장 분석

| ID | 요구사항 | 우선순위 |
|----|----------|----------|
| P3-01 | 전일 코스피·코스닥 등락률 및 외국인·기관 순매수 입력 | P0 |
| P3-02 | 강세 섹터 3개·약세 섹터 3개 입력 필드 | P0 |
| P3-03 | 관심 종목 차트 점검 체크리스트 (종목별 완료 체크) | P0 |
| P3-04 | 종목별 기술적 위치 메모 (지지선·저항선·이평선 배열) | P0 |
| P3-05 | 오늘 국내 이벤트 입력 (실적발표·공시·경제지표) | P1 |
| P3-06 | 수급 분석 메모 (프로그램 매매·대차잔고 변화) | P1 |
| P3-07 | 외국인 연속 순매수/순매도 종목 메모 | P1 |

### 5.5 Phase 4 — 오늘의 전략 수립 ★ 핵심

| ID | 요구사항 | 우선순위 |
|----|----------|----------|
| P4-01 | 시나리오 A/B/C 입력 폼 | P0 |
|       | 각 시나리오: 조건(코스피 기준) + 대응 전략 텍스트 | |
| P4-02 | 관심 종목별 오늘 계획 입력 | P0 |
|       | 종목명 / 진입 조건 / 목표가 / 손절가 / 포지션 크기 | |
| P4-03 | 보유 종목 대응 계획 (추가매수/익절/손절 조건) | P0 |
| P4-04 | 오늘의 매매 금지사항 입력 (자유 텍스트) | P0 |
| P4-05 | 오늘 주목 테마·섹터 + 관련 종목 메모 | P1 |
| P4-06 | 전략 완성도 체크 (시나리오 3개 모두 입력해야 완료) | P1 |

### 5.6 Phase 5 — 최종 점검

| ID | 요구사항 | 우선순위 |
|----|----------|----------|
| P5-01 | 08:00 뉴스 변수 체크 메모 | P0 |
| P5-02 | 시나리오 재확인 체크박스 (A/B/C 각각 "확인 완료") | P0 |
| P5-03 | 오늘 멘탈 상태 셀프 체크 (5점 척도: 집중/보통/산만) | P1 |
| P5-04 | 매매 금지사항 최종 확인 체크박스 | P0 |
| P5-05 | "오늘 개장 준비 완료" 확정 버튼 | P0 |

### 5.7 Phase 6 — 개장 초반 관찰

| ID | 요구사항 | 우선순위 |
|----|----------|----------|
| P6-01 | 09:00~09:30 관찰 체크리스트 | P0 |
|       | ☐ 시가 위치 확인 (갭업/갭다운 규모) | |
|       | ☐ 외국인 선물 방향 확인 | |
|       | ☐ 섹터별 초반 강약 구도 파악 | |
|       | ☐ 시나리오와 실제 시장 일치 여부 판단 | |
| P6-02 | 실제 진행된 시나리오 선택 (A/B/C) | P0 |
| P6-03 | 개장 초반 판단 메모 (200자 이내) | P1 |
| P6-04 | 오늘 루틴 최종 완료 버튼 | P0 |

### 5.8 매매 일지 (자동 저장 + 조회)

| ID | 요구사항 | 우선순위 |
|----|----------|----------|
| JN-01 | 매일 루틴 완료 시 자동으로 일지 저장 | P0 |
| JN-02 | 날짜별 일지 목록 (달력 or 리스트뷰) | P0 |
| JN-03 | 일지 상세 조회 (전체 Phase 기록 확인) | P0 |
| JN-04 | 일지 검색 (날짜·키워드) | P1 |
| JN-05 | 주간·월간 요약 통계 | P2 |
|       | - 루틴 완료율, 시나리오 적중률 (A/B/C 중 맞춘 비율) | |
|       | - 연속 완료 스트릭 | |

### 5.9 관심 종목 관리

| ID | 요구사항 | 우선순위 |
|----|----------|----------|
| WL-01 | 관심 종목 등록·삭제 (종목코드·이름) | P0 |
| WL-02 | Phase 3 차트 점검 시 관심 종목 자동 불러오기 | P0 |
| WL-03 | 종목별 최근 메모 이력 조회 | P1 |
| WL-04 | 종목별 지지선·저항선 고정값 저장 | P2 |

### 5.10 알림·타이머

| ID | 요구사항 | 우선순위 |
|----|----------|----------|
| NT-01 | Phase별 시작 시간 알림 (05:30 / 06:00 / 07:30 / 08:00 / 09:00) | P1 |
| NT-02 | 개장 30분 전 (08:30) 알림 | P1 |
| NT-03 | 알림 시간 사용자 커스텀 설정 | P2 |

---

## 6. 화면별 상세 설계

### 6.1 메인 대시보드

```
┌─────────────────────────────────────────────┐
│  🔔 MorningBell          2026.06.16 화요일   │
│  개장까지: 01:23:45                          │
├─────────────────────────────────────────────┤
│  오늘 루틴 진행률  ████████░░░░  65%         │
├─────────────────────────────────────────────┤
│  Phase 1  미국 증시 마감 체크    ✅ 완료     │
│  Phase 2  글로벌 매크로 분석     ✅ 완료     │
│  Phase 3  국내 시장 분석         🔵 진행중   │
│  Phase 4  오늘의 전략 수립       ○ 대기     │
│  Phase 5  최종 점검              ○ 대기     │
│  Phase 6  개장 초반 관찰         ○ 대기     │
├─────────────────────────────────────────────┤
│  어제 결과: 시나리오 B 진행 → 관망            │
│  연속 완료: 🔥 7일 연속                       │
└─────────────────────────────────────────────┘
```

### 6.2 Phase 1 화면 — 미국 증시 마감 체크

```
┌─────────────────────────────────────────────┐
│ ← Phase 1  미국 증시 마감 체크      05:30    │
├─────────────────────────────────────────────┤
│  나스닥 (NASDAQ)    [    ] %   ▲▼           │
│  S&P 500            [    ] %   ▲▼           │
│  다우 (DJIA)        [    ] %   ▲▼           │
│  SOX (반도체)       [    ] %   ▲▼           │
├─────────────────────────────────────────────┤
│  VIX 공포지수       [    ]                   │
│                   ● 20 이상 = ⚠️ 경고         │
├─────────────────────────────────────────────┤
│  오늘 분위기 자동 판정:                       │
│  ┌─────────────────────────────────────┐   │
│  │ 🔴 위험 회피 장세                    │   │
│  │ 나스닥 -1.2%, VIX 22.3             │   │
│  │ → 오늘은 방어적 접근 권장            │   │
│  └─────────────────────────────────────┘   │
├─────────────────────────────────────────────┤
│  메모: [________________________]           │
├─────────────────────────────────────────────┤
│         [Phase 1 완료 →]                    │
└─────────────────────────────────────────────┘
```

### 6.3 Phase 4 화면 — 오늘의 전략 수립 ★

```
┌─────────────────────────────────────────────┐
│ ← Phase 4  오늘의 전략 수립         07:30   │
├─────────────────────────────────────────────┤
│  시나리오 3가지 (모두 작성해야 완료)          │
│                                              │
│  🟢 시나리오 A (강세)                         │
│  조건: 코스피 [+0.5]% 이상                   │
│  대응: [SK하이닉스 86,000원 진입__________] │
│                                              │
│  🟡 시나리오 B (중립·보합)                    │
│  조건: 코스피 [±0.5]% 이내                  │
│  대응: [관망, 신규 매수 없음_______________] │
│                                              │
│  🔴 시나리오 C (약세)                         │
│  조건: 코스피 [-0.5]% 이하                  │
│  대응: [보유 종목 30% 현금화________________] │
├─────────────────────────────────────────────┤
│  관심 종목 계획                  [+ 종목추가] │
│  ┌─────────────────────────────────────┐   │
│  │ SK하이닉스 │진입:86,000 │목표:92,000  │   │
│  │            │손절:83,000 │ 10%        │   │
│  └─────────────────────────────────────┘   │
├─────────────────────────────────────────────┤
│  오늘 절대 금지:                              │
│  [테마주 추격 매수, 손실 종목 추가 매수______]│
├─────────────────────────────────────────────┤
│         [전략 완성 ✅]                       │
└─────────────────────────────────────────────┘
```

### 6.4 매매 일지 화면

```
┌─────────────────────────────────────────────┐
│  매매 일지                         [검색 🔍] │
├─────────────────────────────────────────────┤
│  2026.06                                    │
│  16 화  ✅ 완료  시나리오B  관망             │
│  13 금  ✅ 완료  시나리오A  SK하이닉스 +2.1% │
│  12 목  ✅ 완료  시나리오C  현금화 30%       │
│  11 수  ✅ 완료  시나리오B  관망             │
│  10 화  ⚠️ 미완  Phase3까지만 완료           │
│  09 월  ✅ 완료  시나리오A  삼성전자 +1.3%   │
├─────────────────────────────────────────────┤
│  이번 달 요약                                │
│  완료율 83%  시나리오 적중 75%  스트릭 🔥7일  │
└─────────────────────────────────────────────┘
```

---

## 7. 데이터 모델

```typescript
// 하루 루틴 전체 기록
interface DailyRoutine {
  id: string;
  date: string;              // "2026-06-16"
  completedAt: string | null;
  overallStatus: "notStarted" | "inProgress" | "completed" | "skipped";
  currentPhase: 1 | 2 | 3 | 4 | 5 | 6;

  phase1: Phase1Data | null;
  phase2: Phase2Data | null;
  phase3: Phase3Data | null;
  phase4: Phase4Data | null;
  phase5: Phase5Data | null;
  phase6: Phase6Data | null;
}

// Phase 1 — 미국 증시 마감 체크
interface Phase1Data {
  completedAt: string;
  nasdaq: number;            // 등락률 (%)
  sp500: number;
  dow: number;
  sox: number;               // 필라델피아 반도체 지수
  vix: number;
  marketSentiment: "risk_on" | "neutral" | "risk_off";  // 자동 판정
  memo: string;
}

// Phase 2 — 글로벌 매크로
interface Phase2Data {
  completedAt: string;
  us10yYield: number;        // 미국 10년물 금리 (%)
  dxy: number;               // 달러인덱스
  usdKrw: number;            // 달러/원
  wti: number;               // WTI 유가
  newsType: NewsType[];      // 오늘 주요 뉴스 유형
  newsMemo: string;          // 뉴스 내용 메모
  macroJudgment: string;     // 한 줄 판단
  futuresDirection: "up" | "neutral" | "down";
}

type NewsType = "FOMC" | "earnings" | "geopolitics" | "economic_indicator" | "other";

// Phase 3 — 국내 시장 분석
interface Phase3Data {
  completedAt: string;
  kospiPrev: number;         // 전일 코스피 등락률
  kosdaqPrev: number;
  foreignerNet: number;      // 외국인 순매수 (억원)
  institutionNet: number;    // 기관 순매수
  strongSectors: string[];   // 강세 섹터 (최대 3개)
  weakSectors: string[];     // 약세 섹터 (최대 3개)
  stockChecks: StockCheck[]; // 종목별 차트 점검
  todayEvents: string[];     // 오늘 이벤트
  supplyDemandMemo: string;  // 수급 분석 메모
}

interface StockCheck {
  ticker: string;
  name: string;
  checked: boolean;          // 차트 점검 완료 여부
  technicalNote: string;     // 기술적 위치 메모
}

// Phase 4 — 오늘의 전략 ★
interface Phase4Data {
  completedAt: string;
  scenarios: {
    A: Scenario;             // 강세
    B: Scenario;             // 중립
    C: Scenario;             // 약세
  };
  stockPlans: StockPlan[];   // 종목별 계획
  holdingPlans: string;      // 보유 종목 대응 계획
  forbiddenActions: string;  // 오늘 금지 사항
  themeMemo: string;         // 오늘 주목 테마
}

interface Scenario {
  condition: string;         // 발동 조건 (예: "코스피 +0.5% 이상")
  action: string;            // 대응 전략
}

interface StockPlan {
  ticker: string;
  name: string;
  entryCondition: string;    // 진입 조건
  targetPrice: number;       // 목표가
  stopLossPrice: number;     // 손절가
  positionSizePct: number;   // 포지션 비중 (%)
  note: string;
}

// Phase 5 — 최종 점검
interface Phase5Data {
  completedAt: string;
  lateNewsMemo: string;      // 08:00 추가 뉴스
  scenarioAConfirmed: boolean;
  scenarioBConfirmed: boolean;
  scenarioCConfirmed: boolean;
  mentalScore: 1 | 2 | 3 | 4 | 5;  // 오늘 집중도
  forbiddenConfirmed: boolean;
}

// Phase 6 — 개장 초반 관찰
interface Phase6Data {
  completedAt: string;
  openingGap: "gapUp" | "flat" | "gapDown";
  foreignerFuturesDir: "buy" | "neutral" | "sell";
  sectorStrengthNoted: boolean;
  scenarioMatchChecked: boolean;
  executedScenario: "A" | "B" | "C" | "none";  // 실제 진행된 시나리오
  openingMemo: string;
}

// 관심 종목 마스터
interface WatchlistItem {
  ticker: string;
  name: string;
  addedAt: string;
  supportLevel?: number;     // 지지선
  resistanceLevel?: number;  // 저항선
  notes: WatchlistNote[];
}

interface WatchlistNote {
  date: string;
  content: string;
}

// 앱 설정
interface AppSettings {
  alertTimes: {
    phase1: string;          // "05:30"
    phase2: string;          // "06:00"
    phase4: string;          // "07:30"
    phase5: string;          // "08:00"
    phase6: string;          // "09:00"
    preMarket: string;       // "08:30"
  };
  vixWarningThreshold: number;   // 기본값 20
  usdKrwWarningThreshold: number; // 기본값 1400
}
```

---

## 8. API 연동 설계

### 8.1 Phase별 자동 데이터 조회 (선택, Phase 2 이후)

| 데이터 | API 소스 | 비고 |
|--------|---------|------|
| 나스닥·S&P·다우·SOX | Yahoo Finance API / Alpha Vantage | 무료 티어 사용 |
| VIX | CBOE 또는 Yahoo Finance (`^VIX`) | |
| 미국 10년물 금리 | FRED API (Federal Reserve) | 무료 |
| 달러인덱스 (DXY) | Yahoo Finance (`DX-Y.NYB`) | |
| 달러/원 환율 | 한국은행 Open API | 무료 |
| WTI 유가 | Yahoo Finance (`CL=F`) | |
| 코스피·코스닥 | 한국거래소(KRX) API or 네이버증권 | |

### 8.2 API 키 관리

```env
# .env.local
ALPHA_VANTAGE_API_KEY=your_key    # 미국 주가 지수
FRED_API_KEY=your_key             # 미국 금리
BOK_API_KEY=your_key              # 한국은행 환율
GEMINI_API_KEY=your_key           # AI 분석 보조 (Phase 3)
```

### 8.3 Phase 1 자동 조회 응답 예시

```typescript
// GET /api/us-market
{
  "timestamp": "2026-06-16T06:00:00Z",  // 미국 동부 기준 전날 밤
  "nasdaq": -1.23,
  "sp500": -0.87,
  "dow": -0.45,
  "sox": -0.92,
  "vix": 22.3,
  "sentiment": "risk_off"
}
```

### 8.4 Gemini AI 보조 (Phase 3, 선택)

```typescript
// 매크로 데이터 입력 → AI 한 줄 판단 자동 생성
POST /api/ai/macro-judgment
body: {
  nasdaq: -1.23,
  vix: 22.3,
  us10yYield: 4.52,
  dxy: 104.2,
  newsType: ["FOMC"]
}
response: {
  judgment: "금리 상승 + 달러 강세 + VIX 경고구간. 오늘 성장주 약세 우려, 방어주 및 현금 비중 확대 권장."
}
```

---

## 9. 기술 스택

기존 StockMind / AuctionFlow Pro 스택과 동일하게 통일합니다.

```
프레임워크   : Next.js 16 (App Router) + React 19 + TypeScript
스타일       : Tailwind CSS v4
상태관리     : Zustand (persist → localStorage)
데이터베이스 : Phase 1 — localStorage / Phase 2 — Supabase
AI           : Gemini API (매크로 판단 보조)
외부 API     : Alpha Vantage / FRED / 한국은행 Open API
알림         : Web Notifications API (PWA)
배포         : Vercel
```

### 9.1 Phase별 저장 전략

| Phase | 저장 방식 | 비고 |
|-------|----------|------|
| Phase 1 (MVP) | Zustand + localStorage | 빠른 시작 |
| Phase 2 | + Supabase | 다중 기기 동기화 + 일지 장기 보관 |
| Phase 3 | + 외부 API 자동 조회 | 수동 입력 부담 감소 |

---

## 10. 상태관리 구조

```typescript
// store/routine-store.ts
interface RoutineStore {
  // 오늘 루틴
  today: DailyRoutine;
  // 일지 아카이브
  archive: DailyRoutine[];
  // 관심 종목
  watchlist: WatchlistItem[];
  // 앱 설정
  settings: AppSettings;

  // 액션
  initToday: () => void;                    // 오늘 루틴 초기화
  updatePhase1: (data: Phase1Data) => void;
  updatePhase2: (data: Phase2Data) => void;
  updatePhase3: (data: Phase3Data) => void;
  updatePhase4: (data: Phase4Data) => void;
  updatePhase5: (data: Phase5Data) => void;
  updatePhase6: (data: Phase6Data) => void;
  completeToday: () => void;                // 오늘 완료 → 아카이브 저장
  addWatchlistItem: (item: WatchlistItem) => void;
  removeWatchlistItem: (ticker: string) => void;
  updateSettings: (settings: Partial<AppSettings>) => void;
}

// 자동 판정 유틸리티 함수
// lib/market-analysis.ts

function judgeMarketSentiment(
  nasdaq: number,
  vix: number
): "risk_on" | "neutral" | "risk_off" {
  if (nasdaq >= 1.0 && vix < 20) return "risk_on";
  if (nasdaq <= -1.0 || vix >= 20) return "risk_off";
  return "neutral";
}

function judgeVixAlert(vix: number): boolean {
  return vix >= 20;
}

function judgeUsdKrwAlert(rate: number): boolean {
  return rate >= 1400;
}
```

---

## 11. 개발 로드맵

### Phase 0 — 기반 설정 (1일)
- [ ] Next.js 프로젝트 생성 (TypeScript + Tailwind v4)
- [ ] 데이터 타입 정의 (`types/routine.ts`)
- [ ] Zustand 스토어 골격
- [ ] 기본 레이아웃 + 네비게이션

### Phase 1 — MVP: 루틴 CRUD + 일지 저장 (3~4일) ★최우선
- [ ] 메인 대시보드 (Phase 진행 상태)
- [ ] Phase 1~6 입력 화면 순차 구현
- [ ] 자동 시장 분위기 판정 로직 (`lib/market-analysis.ts`)
- [ ] 루틴 완료 → 로컬 일지 자동 저장
- [ ] 일지 목록·상세 조회 화면
- [ ] 관심 종목 CRUD

### Phase 2 — 편의 기능 (2~3일)
- [ ] Web Notifications API 알림 (Phase별 시간 알림)
- [ ] 주간·월간 통계 (완료율·시나리오 적중률)
- [ ] 연속 완료 스트릭
- [ ] Supabase 연동 (다중 기기 동기화)
- [ ] PWA 설정 (홈화면 추가, 오프라인 지원)

### Phase 3 — 자동화 (2~3일, 선택)
- [ ] Alpha Vantage API 연동 → Phase 1 자동 조회
- [ ] FRED API 연동 → 금리·달러인덱스 자동 조회
- [ ] 한국은행 API → 환율 자동 조회
- [ ] Gemini AI → 매크로 판단 한 줄 자동 생성

### Phase 4 — 고도화 (선택)
- [ ] 시나리오 적중률 통계 + 패턴 분석
- [ ] 종목별 판단 히스토리 타임라인
- [ ] 일지 내보내기 (PDF·CSV)
- [ ] StockMind와 데이터 연동

---

## 12. 성공 지표

| 지표 | 목표 | 측정 방법 |
|------|------|-----------|
| 루틴 완료율 | 주 5일 중 4일 이상 완료 | archive 필터 |
| Phase 4 완성율 | 전략 수립 Phase 완료 90% 이상 | phase4 완료 여부 |
| 시나리오 적중률 | 예측 시나리오와 실제 시장 일치 50% 이상 | phase6.executedScenario 통계 |
| 루틴 소요 시간 | 전체 2시간 이내 완료 | completedAt - initAt |
| 연속 완료 스트릭 | 30일 연속 달성 | streak 카운터 |

---

## 13. 미결 사항

| 항목 | 선택지 | 권장 |
|------|--------|------|
| 수동 입력 vs API 자동 조회 | 수동 우선 / API는 Phase 3 | 수동으로 MVP 먼저 (API 에러 부담 없음) |
| 알림 방식 | Web Push / 앱 내 알림 / PWA | Phase 2에서 Web Notifications API |
| AI 판단 보조 | Phase 1부터 / Phase 3에서 | Phase 3 (핵심 루틴 먼저 완성) |
| StockMind 연동 | 독립 앱 / StockMind 모듈로 편입 | 독립 앱 우선, 추후 StockMind 대시보드 위젯으로 연동 |
| VIX 경고 임계값 | 20 고정 / 사용자 설정 | 20 고정 (Phase 1), 설정 가능 (Phase 2) |

---

## 부록: Phase별 체크리스트 기본 템플릿

```
Phase 1 체크리스트 (05:30, 5분)
  ☐ 나스닥 등락률 확인
  ☐ 필라델피아 반도체 지수(SOX) 확인
  ☐ VIX 수치 확인 (20 이상이면 ⚠️)
  ☐ 오늘 분위기 판정 메모

Phase 2 체크리스트 (06:00, 30분)
  ☐ 미국 10년물 금리 방향 확인
  ☐ 달러인덱스(DXY) 확인
  ☐ 달러/원 환율 확인 (1,400 이상 ⚠️)
  ☐ WTI 유가 확인
  ☐ 전날 밤 주요 뉴스 이유 파악
  ☐ 코스피200·코스닥150 선물 방향 확인
  ☐ 매크로 판단 한 줄 메모 작성

Phase 3 체크리스트 (06:30, 60분)
  ☐ 전일 외국인·기관 순매수 확인
  ☐ 전일 강세·약세 섹터 정리
  ☐ 관심 종목 차트 전체 점검
  ☐ 오늘 국내 이벤트 확인 (실적·공시·경제지표)
  ☐ 수급 분석 메모 작성

Phase 4 체크리스트 (07:30, 30분)
  ☐ 시나리오 A 작성 (강세 조건 + 대응)
  ☐ 시나리오 B 작성 (중립 조건 + 대응)
  ☐ 시나리오 C 작성 (약세 조건 + 대응)
  ☐ 관심 종목별 진입가·목표가·손절가 설정
  ☐ 오늘 매매 금지 사항 작성

Phase 5 체크리스트 (08:00, 30분)
  ☐ 08:00 뉴스 새 변수 확인
  ☐ 시나리오 A/B/C 최종 재확인
  ☐ 오늘 멘탈 상태 셀프 체크
  ☐ 매매 금지 사항 재확인
  ☐ "개장 준비 완료" 확정

Phase 6 체크리스트 (09:00, 30분)
  ☐ 시가 갭업·갭다운 확인
  ☐ 외국인 선물 순매수 방향 확인
  ☐ 섹터별 초반 강약 파악
  ☐ 예상 시나리오와 실제 시장 일치 여부 판단
  ☐ 실제 진행된 시나리오 기록 (A / B / C)
```

---

*주식 투자자 아침 루틴 앱 PRD v1.0 — 2026.06.16*
*바이브 코딩 시작: Phase 0 → Phase 1 (루틴 CRUD + 일지 저장) 우선*
*⚠️ 본 앱은 투자 참고용 도구이며, 투자 손익의 책임은 투자자 본인에게 있습니다.*
