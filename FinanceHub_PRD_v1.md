# 통합 재무관리 모듈 (FinanceHub) — PRD
**Version 1.0 | 2026.06.17 | 바이브 코딩 기획 문서**
**상위 시스템: StockMind + AuctionFlow Pro 통합 플랫폼의 재무관리 모듈**

---

## 목차
1. [개요](#1-개요)
2. [문제 정의](#2-문제-정의)
3. [핵심 컨셉](#3-핵심-컨셉)
4. [시스템 통합 아키텍처](#4-시스템-통합-아키텍처)
5. [기능 요구사항 — 1단계 현황관리](#5-기능-요구사항--1단계-현황관리)
6. [기능 요구사항 — 2단계 자금조달 계획](#6-기능-요구사항--2단계-자금조달-계획)
7. [데이터 모델](#7-데이터-모델)
8. [연동 설계 — StockMind / AuctionFlow Pro](#8-연동-설계--stockmind--auctionflow-pro)
9. [화면별 상세 설계](#9-화면별-상세-설계)
10. [기술 스택](#10-기술-스택)
11. [상태관리 구조](#11-상태관리-구조)
12. [개발 로드맵](#12-개발-로드맵)
13. [성공 지표](#13-성공-지표)
14. [미결 사항](#14-미결-사항)

---

## 1. 개요

### 1.1 한 줄 정의
> **"주식·경매 두 영역에서 발생하는 모든 자산·부채·현금흐름을 한곳에서 보고, 앞으로 필요한 큰 돈을 언제까지 어떻게 마련할지 계획하는 통합 재무관리 모듈"**

### 1.2 위치
이 모듈은 독립된 앱이 아니라, **이미 존재하는 StockMind(주식)와 AuctionFlow Pro(경매)를 가로로 잇는 재무 레이어**입니다.

```
┌─────────────────────────────────────────────────┐
│              통합 플랫폼 (가칭: PeterOps)            │
│                                                   │
│  ┌──────────────┐  ┌──────────────┐  ┌────────┐ │
│  │  StockMind    │  │ AuctionFlow  │  │Finance │ │
│  │  (주식)        │  │ Pro (경매)    │  │ Hub    │ │
│  │              │  │              │  │(재무) ★│ │
│  └──────┬───────┘  └──────┬───────┘  └────┬───┘ │
│         │                 │                │     │
│         └────────data─────┴────────data────┘     │
│                  FinanceHub가 양쪽에서             │
│                  데이터를 읽어와 통합 표시           │
└─────────────────────────────────────────────────┘
```

### 1.3 기존 구글 스프레드시트 대비 핵심 가치

| 기존 (구글 시트) | FinanceHub |
|-----------------|-----------|
| 주식 잔고를 손으로 매번 입력 | StockMind에서 자동 연동 |
| 경매 자금 필요 시점을 별도로 메모 | AuctionFlow Pro 물건 단계와 자동 연결 |
| "이번 달 얼마 필요한지" 매번 재계산 | 자금조달 캘린더로 자동 합산 |
| 부족분 마련 방법을 즉흥적으로 고민 | 시나리오 기반 조달 계획 수립 |
| 시트가 여러 개로 분산 | 자산·부채·계획이 한 화면에서 연결 |

---

## 2. 문제 정의

### 2.1 현재 상황
- 주식 자산(StockMind), 경매 물건(AuctionFlow Pro)은 각각 시스템이 있지만, **돈이라는 관점에서 둘을 합쳐 보는 화면이 없음**
- 구글 스프레드시트로 현금·부채·이자·수입을 관리하지만, 수동 갱신이라 최신 상태 유지가 번거로움
- "다음 경매에 입찰보증금이 필요한데 지금 현금으로 충분한가?" 같은 질문에 즉시 답하기 어려움
- 카드값, 대출이자 같은 고정지출과 경매 자금 같은 비정기 대형지출이 한 시야에 들어오지 않아 **자금 충돌(같은 시기에 돈이 몰리는 상황)을 사전에 발견하기 어려움**

### 2.2 이 모듈이 푸는 문제
1. **현황 통합**: 주식(StockMind 연동) + 현금 + 부채 + 이자 + 수입을 한 화면에서 확인
2. **자금 수요 예측**: 경매 단계(AuctionFlow Pro 연동) + 카드결제 + 큰 비용지출을 "언제까지 얼마 필요한가"로 정리
3. **조달 계획 수립**: 부족분을 어떻게 마련할지(주식 매도, 대출, 적금 해지 등) 시나리오로 계획
4. **충돌 조기 발견**: 여러 자금 수요가 같은 시기에 겹치는 것을 미리 경고

---

## 3. 핵심 컨셉

### 3.1 두 단계 구조

```
┌───────────────────────────┐      ┌───────────────────────────┐
│   1단계: 현황 관리            │      │   2단계: 자금조달 계획        │
│  ─────────────────────    │      │  ─────────────────────    │
│  "지금 내 돈은 어떤 상태인가"  │ ───▶ │  "앞으로 필요한 돈을         │
│                            │      │   어떻게 마련할 것인가"       │
│  · 주식 자산 (StockMind 연동) │      │  · 자금 수요 항목 등록        │
│  · 현금성 자산               │      │    (경매·카드·큰지출)         │
│  · 부채 현황                 │      │  · 필요 시점·금액 정리        │
│  · 고정지출 (이자 등)         │      │  · 조달 방법별 시나리오        │
│  · 월 수입                  │      │  · 자금 캘린더로 충돌 확인     │
└───────────────────────────┘      └───────────────────────────┘
```

### 3.2 핵심 사용자 흐름

```
① 대시보드 진입
   → 1단계 현황판: 순자산, 보유주식(StockMind 연동값), 현금, 부채 한눈에 확인
        ↓
② AuctionFlow Pro에서 새 경매 물건이 "입찰 예정" 단계로 전환됨
   → FinanceHub가 자동으로 감지: "입찰보증금 약 4,770만원 필요 (D-5)" 항목 자동 생성
        ↓
③ 자금조달 계획 화면에서 확인
   → 현재 현금 3,000만원 + 부족분 1,770만원
   → 조달 방법 선택: "보유 주식 일부 매도" or "단기 대출" or "적금 해지"
        ↓
④ 자금 캘린더에서 확인
   → 같은 주에 카드값 250만원도 빠져나가는 걸 미리 확인
   → 충돌 경고 → 조달 계획 조정
        ↓
⑤ 실제 집행 후 결과 기록
   → 다음 현황에 반영
```

---

## 4. 시스템 통합 아키텍처

### 4.1 데이터 흐름

```
┌─────────────┐         읽기 전용          ┌─────────────┐
│  StockMind   │ ───────────────────────▶  │             │
│  (주식)      │  보유종목, 평가금액, 현금성   │             │
└─────────────┘  자산(예수금)               │             │
                                            │ FinanceHub  │
┌─────────────┐         읽기 전용          │  (재무관리)   │
│ AuctionFlow  │ ───────────────────────▶  │             │
│ Pro (경매)   │  물건 단계, 입찰보증금,       │             │
└─────────────┘  잔금일정, 명도비용 추정      │             │
                                            └──────┬──────┘
                                                   │
                                          자체 데이터(쓰기)
                                                   ▼
                                   현금, 부채, 고정지출, 수입,
                                   자금조달계획, 캘린더
```

### 4.2 핵심 원칙
- FinanceHub는 StockMind·AuctionFlow Pro의 데이터를 **읽기만** 하고 수정하지 않음 (단방향 연동)
- 각 시스템은 독립적으로도 동작 가능 (FinanceHub가 죽어도 StockMind·AuctionFlow Pro는 정상 작동)
- 연동 실패 시 수동 입력으로 보완 가능 (질문 답변에서 확정된 방향)

---

## 5. 기능 요구사항 — 1단계 현황관리

### 5.1 자산 현황

| ID | 요구사항 | 우선순위 |
|----|----------|----------|
| AS-01 | StockMind 연동 — 보유 종목 평가금액 합계 자동 표시 | P0 |
| AS-02 | StockMind 연동 — 예수금(현금성 자산) 자동 표시 | P0 |
| AS-03 | 현금 자산 직접 입력 (입출금 통장, 비상금 등) | P0 |
| AS-04 | 부동산 자산 입력 (AuctionFlow Pro 보유 물건 시세 연동, 선택) | P1 |
| AS-05 | 자산 카테고리별 합계 및 비중 시각화 (도넛차트 등) | P1 |
| AS-06 | 자산 변동 히스토리 (월별 추이) | P2 |

### 5.2 부채 현황

| ID | 요구사항 | 우선순위 |
|----|----------|----------|
| LB-01 | 부채 항목 등록 (대출명, 대출기관, 원금, 금리, 만기) | P0 |
| LB-02 | 부채별 월 이자 자동 계산 | P0 |
| LB-03 | 경락잔금대출 등 AuctionFlow Pro 연동 부채 자동 등록 | P1 |
| LB-04 | 부채 상환 일정 (원금 상환 스케줄) | P1 |
| LB-05 | 전체 부채 합계 및 DSR(소득 대비 부채상환비율) 참고 계산 | P2 |

### 5.3 고정지출 관리

| ID | 요구사항 | 우선순위 |
|----|----------|----------|
| FX-01 | 고정지출 항목 등록 (이자, 관리비, 보험료, 구독료 등) | P0 |
| FX-02 | 지출 주기 설정 (매월/매분기/매년) | P0 |
| FX-03 | 다음 결제일 자동 계산 및 알림 | P1 |
| FX-04 | 고정지출 합계와 월 수입 대비 비율 표시 | P1 |

### 5.4 수입 관리

| ID | 요구사항 | 우선순위 |
|----|----------|----------|
| IN-01 | 수입 항목 등록 (근로소득, 임대수익, 배당 등) | P0 |
| IN-02 | AuctionFlow Pro 임대 물건의 월세 수익 자동 연동 | P1 |
| IN-03 | StockMind 배당 내역 자동 연동 (선택) | P2 |
| IN-04 | 월별 수입 합계 및 전월 대비 비교 | P1 |

### 5.5 현황 대시보드

| ID | 요구사항 | 우선순위 |
|----|----------|----------|
| DB-01 | 순자산(자산-부채) 요약 카드 | P0 |
| DB-02 | 자산 구성 비중 (주식/현금/부동산) 시각화 | P0 |
| DB-03 | 월 현금흐름 요약 (수입-고정지출) | P0 |
| DB-04 | 최근 StockMind·AuctionFlow Pro 동기화 시각 표시 | P1 |
| DB-05 | 연동 실패 시 경고 배너 + 수동 입력 유도 | P0 |

---

## 6. 기능 요구사항 — 2단계 자금조달 계획

### 6.1 자금 수요 항목 관리 ★ 핵심

| ID | 요구사항 | 우선순위 |
|----|----------|----------|
| FN-01 | 자금 수요 항목 수동 등록 (제목, 필요금액, 필요시점, 카테고리) | P0 |
| FN-02 | 카테고리 분류: 카드결제 / 큰비용지출 / 경매-입찰보증금 / 경매-매매비용 / 경매-명도비용 / 기타 | P0 |
| FN-03 | AuctionFlow Pro 연동 — 물건이 "입찰예정" 단계 진입 시 입찰보증금 항목 자동 생성 | P0 |
| FN-04 | AuctionFlow Pro 연동 — 낙찰 후 잔금기한·취득세 항목 자동 생성 | P1 |
| FN-05 | AuctionFlow Pro 연동 — 명도 진행 시 명도비용(이사비 등) 추정 항목 자동 생성 | P1 |
| FN-06 | 자동 생성된 항목의 금액·시점 수동 수정 가능 (추정치 보완) | P0 |
| FN-07 | 카드결제 항목은 카드사 연동 또는 수동 입력 (Phase별 결정) | P2 |
| FN-08 | 항목별 상태 관리 (계획중/조달중/완료) | P1 |

### 6.2 자금조달 시나리오

| ID | 요구사항 | 우선순위 |
|----|----------|----------|
| SC-01 | 자금 수요 항목별 조달 방법 선택 (보유현금/주식매도/대출/적금해지/기타) | P0 |
| SC-02 | "주식매도" 선택 시 StockMind 연동 — 매도 가능 종목·예상 금액 표시 | P1 |
| SC-03 | "대출" 선택 시 예상 금리·한도 메모 입력 | P1 |
| SC-04 | 조달 방법별 금액 분배 (예: 현금 60% + 주식매도 40%) | P0 |
| SC-05 | 조달 계획 확정 시 현황(1단계)에 가상 반영하여 시뮬레이션 | P2 |

### 6.3 자금 캘린더 — 충돌 발견 ★ 핵심

| ID | 요구사항 | 우선순위 |
|----|----------|----------|
| CL-01 | 월별/주별 캘린더에 모든 자금 수요 항목 표시 | P0 |
| CL-02 | 같은 기간(예: 동일 주) 내 자금 수요 합산 표시 | P0 |
| CL-03 | 가용 현금 대비 부족 시 충돌 경고 (색상 강조) | P0 |
| CL-04 | 고정지출(1단계 FX) 항목도 캘린더에 함께 표시 | P1 |
| CL-05 | 캘린더에서 항목 클릭 시 상세·조달 계획으로 바로 이동 | P1 |

### 6.4 시뮬레이션 및 알림

| ID | 요구사항 | 우선순위 |
|----|----------|----------|
| SM-01 | "이 경매에 입찰하면 한 달 후 자금 상태는?" 가상 시뮬레이션 | P2 |
| SM-02 | 자금 부족 예상 시 사전 알림 (D-7, D-3 등) | P1 |
| SM-03 | 여러 경매 물건 동시 진행 시 자금 총수요 합산 경고 | P1 |

---

## 7. 데이터 모델

```typescript
// ═══════════════════════════════════
// 1단계: 현황 관리
// ═══════════════════════════════════

// 자산 — 주식 부분은 StockMind에서 읽어온 캐시
interface AssetSnapshot {
  id: string;
  snapshotDate: string;

  // StockMind 연동 (자동, 읽기 전용)
  stockValue: number;          // 보유 종목 평가금액 합계
  stockCash: number;           // 예수금
  stockSyncedAt: string | null;
  stockSyncStatus: "synced" | "failed" | "manual_override";

  // 직접 입력
  cashAssets: CashAsset[];     // 입출금 통장, 비상금 등
  realEstateAssets: RealEstateAsset[];  // AuctionFlow Pro 연동 또는 수동

  totalAssets: number;          // 계산값
}

interface CashAsset {
  id: string;
  name: string;                 // "국민은행 입출금"
  amount: number;
  updatedAt: string;
}

interface RealEstateAsset {
  id: string;
  name: string;
  source: "auctionflow" | "manual";
  auctionCaseId?: string;       // AuctionFlow Pro 물건 ID (연동 시)
  estimatedValue: number;
  acquisitionCost: number;
}

// 부채
interface Liability {
  id: string;
  name: string;                 // "경락잔금대출 - 나경빌라"
  source: "auctionflow" | "manual";
  auctionCaseId?: string;
  lender: string;               // 대출기관
  principal: number;             // 원금
  interestRate: number;          // 연 이자율 (%)
  monthlyInterest: number;       // 계산값
  maturityDate: string | null;
  repaymentSchedule: RepaymentItem[];
}

interface RepaymentItem {
  date: string;
  principalAmount: number;
  interestAmount: number;
  status: "scheduled" | "paid";
}

// 고정지출
interface FixedExpense {
  id: string;
  name: string;                 // "마이너스통장 이자"
  category: "interest" | "insurance" | "subscription" | "management_fee" | "other";
  amount: number;
  cycle: "monthly" | "quarterly" | "yearly";
  nextDueDate: string;
  linkedLiabilityId?: string;   // 부채 이자인 경우 연결
}

// 수입
interface Income {
  id: string;
  name: string;                 // "월급", "괴정동 임대수익"
  source: "manual" | "auctionflow_rent" | "stockmind_dividend";
  auctionCaseId?: string;       // 임대수익 연동 시
  amount: number;
  cycle: "monthly" | "irregular";
  receivedDate?: string;
}

// ═══════════════════════════════════
// 2단계: 자금조달 계획
// ═══════════════════════════════════

interface FundingNeed {
  id: string;
  title: string;                 // "나경빌라 입찰보증금"
  category: FundingCategory;
  amount: number;
  neededByDate: string;          // 필요 시점
  status: "planned" | "fundraising" | "completed" | "cancelled";

  // 자동 연동 정보
  source: "auctionflow" | "manual";
  auctionCaseId?: string;
  autoGenerated: boolean;
  autoGeneratedReason?: string;  // "입찰예정 단계 진입"

  // 조달 계획
  fundingPlan: FundingPlanItem[];

  createdAt: string;
  updatedAt: string;
}

type FundingCategory =
  | "card_payment"           // 카드결제
  | "large_expense"          // 큰 비용지출
  | "auction_deposit"        // 경매-입찰보증금
  | "auction_settlement"     // 경매-매매비용(잔금·취득세 등)
  | "auction_eviction"       // 경매-명도비용
  | "other";

interface FundingPlanItem {
  method: "cash" | "stock_sale" | "loan" | "savings_withdrawal" | "other";
  amount: number;
  detail?: string;             // "SK하이닉스 10주 매도 예정" 등
  estimatedRate?: number;      // 대출일 경우 예상 금리
}

// 자금 캘린더 (런타임 집계, 별도 저장 안 함)
interface FundingCalendarDay {
  date: string;
  fundingNeeds: FundingNeed[];
  fixedExpenses: FixedExpense[];
  totalOutflow: number;
  availableCash: number;        // 그 시점까지의 가용 현금 추정
  isConflict: boolean;          // 부족 여부
}
```

---

## 8. 연동 설계 — StockMind / AuctionFlow Pro

### 8.1 StockMind 연동 (1단계 현황관리)

```typescript
// FinanceHub → StockMind 데이터 조회 (읽기 전용 API)
GET /api/stockmind/portfolio-summary

Response:
{
  "totalStockValue": 45230000,      // 보유 종목 평가금액 합계
  "cashBalance": 3200000,           // 예수금
  "asOf": "2026-06-17T09:00:00Z",
  "holdings": [
    { "ticker": "000660", "name": "SK하이닉스", "quantity": 10,
      "currentPrice": 186000, "evalAmount": 1860000 }
    // ...
  ]
}
```

연동 실패 시:
```typescript
// 마지막 성공 동기화 값을 캐시로 표시 + 경고 배너
{
  "stockSyncStatus": "failed",
  "lastSyncedValue": 45230000,
  "lastSyncedAt": "2026-06-16T09:00:00Z",
  "message": "StockMind 연동 실패 — 마지막 동기화 데이터 표시 중"
}
```

### 8.2 AuctionFlow Pro 연동 (2단계 자금조달)

```typescript
// AuctionFlow Pro → FinanceHub 이벤트 트리거 (웹훅 또는 폴링)

// 이벤트 1: 물건이 "입찰예정" 단계 진입
{
  "event": "case_stage_changed",
  "caseId": "2025타경503625",
  "newStage": "bidding_scheduled",
  "biddingDate": "2026-06-11",
  "minBidPrice": 477000000,
  "estimatedDeposit": 47700000    // 최저가의 10%
}
→ FinanceHub가 FundingNeed 자동 생성
  title: "나경빌라 입찰보증금"
  category: "auction_deposit"
  amount: 47700000
  neededByDate: "2026-06-11"
  autoGenerated: true

// 이벤트 2: 낙찰 확정
{
  "event": "case_won",
  "caseId": "2025타경503625",
  "winningBid": 510000000,
  "paymentDeadline": "2026-07-25"
}
→ FundingNeed 자동 생성
  title: "나경빌라 잔금 + 취득세"
  category: "auction_settlement"
  amount: 462300000 (잔금) + 약 15300000 (취득세 추정)
  neededByDate: "2026-07-25"

// 이벤트 3: 명도 진행 단계
{
  "event": "eviction_in_progress",
  "caseId": "2025타경503625",
  "tenantCount": 19,
  "estimatedEvictionCost": 5000000  // 이사비 추정 합계
}
→ FundingNeed 자동 생성 (category: "auction_eviction")
```

### 8.3 연동 실패 시 수동 보완 (확정된 방향)

```
자동 생성 실패 또는 AuctionFlow Pro 미사용 물건의 경우:
→ "자금 수요 직접 추가" 버튼으로 동일한 폼 수동 입력 가능
→ source: "manual"로 저장, auctionCaseId 없음
```

---

## 9. 화면별 상세 설계

### 9.1 통합 현황 대시보드 (1단계)

```
┌─────────────────────────────────────────────┐
│  💰 FinanceHub                  마지막 동기화 5분전│
├─────────────────────────────────────────────┤
│  순자산                                       │
│  ₩ 187,450,000          전월대비 ▲ 2,300,000  │
├─────────────────────────────────────────────┤
│  자산 구성                                     │
│  📈 주식(StockMind)  ₩45,230,000   24%        │
│  💵 현금            ₩32,000,000   17%        │
│  🏢 부동산(경매)     ₩110,220,000  59%        │
├─────────────────────────────────────────────┤
│  부채                                         │
│  경락잔금대출(나경빌라)  ₩320,000,000          │
│  월 이자 부담           ₩1,330,000            │
├─────────────────────────────────────────────┤
│  이번 달 현금흐름                              │
│  수입 ₩4,200,000  -  고정지출 ₩1,850,000      │
│  = 순현금흐름 ₩2,350,000                      │
└─────────────────────────────────────────────┘
```

### 9.2 자금조달 계획 화면 (2단계) ★

```
┌─────────────────────────────────────────────┐
│  📅 자금조달 계획            [+ 자금수요 추가]  │
├─────────────────────────────────────────────┤
│  🔴 나경빌라 입찰보증금     D-5               │
│  필요: ₩47,700,000                            │
│  [AuctionFlow Pro 연동 — 입찰예정 단계]        │
│  조달계획: 현금 30,000,000 + 주식매도 17,700,000│
│  [조달 방법 수정]                              │
├─────────────────────────────────────────────┤
│  🟡 신용카드 결제           D-12              │
│  필요: ₩2,500,000                             │
│  조달계획: 현금                                │
├─────────────────────────────────────────────┤
│  ⚪ 노트북 구매             D-30              │
│  필요: ₩2,000,000                             │
│  조달계획: 미정                                │
└─────────────────────────────────────────────┘
```

### 9.3 자금 캘린더 — 충돌 발견 화면 ★

```
┌─────────────────────────────────────────────┐
│  📆 자금 캘린더                2026년 6월     │
├─────────────────────────────────────────────┤
│  6/11 (목)                    ⚠️ 자금 부족    │
│   · 입찰보증금        -47,700,000             │
│   · 마이너스통장 이자  -130,000              │
│   합계 outflow: 47,830,000                   │
│   가용 현금: 32,000,000                       │
│   부족: -15,830,000 → 조달계획 확인 필요       │
├─────────────────────────────────────────────┤
│  6/23 (화)                    ✅ 충분         │
│   · 신용카드 결제      -2,500,000             │
│   가용 현금: 충분                              │
└─────────────────────────────────────────────┘
```

### 9.4 자금 수요 등록 화면 (수동 입력)

```
┌─────────────────────────────────────────────┐
│  자금 수요 추가                                │
│  제목: [____________________]                │
│  카테고리: [경매-입찰보증금 ▾]                  │
│  필요 금액: [____________] 원                 │
│  필요 시점: [2026-06-11] 📅                   │
│  관련 경매물건: [나경빌라 2025타경503625 ▾]     │
│                (AuctionFlow Pro 연동, 선택)    │
├─────────────────────────────────────────────┤
│  조달 계획 (선택)                              │
│  [+ 조달 방법 추가]                            │
│  현금        [30,000,000] 원                  │
│  주식매도    [17,700,000] 원  메모:[___]       │
├─────────────────────────────────────────────┤
│         [저장]                                │
└─────────────────────────────────────────────┘
```

---

## 10. 기술 스택

기존 StockMind / AuctionFlow Pro와 완전히 동일한 스택으로 구성해 통합 플랫폼 내 일관성을 유지합니다.

```
프레임워크   : Next.js 16 (App Router) + React 19 + TypeScript
스타일       : Tailwind CSS v4
상태관리     : Zustand (persist → localStorage, 이후 Supabase)
데이터베이스 : Supabase (StockMind·AuctionFlow Pro와 동일 인스턴스 공유 권장)
연동 방식    : 내부 API 호출 (같은 Supabase 인스턴스면 직접 쿼리도 가능)
배포         : Vercel (기존 프로젝트와 같은 팀/계정)
```

### 10.1 통합 플랫폼 전제 — 같은 Supabase 프로젝트 공유

질문 답변에서 "통합된 큰 시스템의 일부"로 확정되었으므로, **별도 데이터베이스보다 기존 Supabase 프로젝트 내에 새 테이블로 추가**하는 것을 권장합니다.

```
기존 Supabase 프로젝트
├── stockmind 관련 테이블 (기존)
├── auctionflow 관련 테이블 (기존)
└── financehub 관련 테이블 (신규 추가)
    ├── asset_snapshots
    ├── liabilities
    ├── fixed_expenses
    ├── incomes
    └── funding_needs
```

이렇게 하면 FinanceHub가 StockMind·AuctionFlow Pro 테이블을 **직접 SQL JOIN으로 조회**할 수 있어 별도 API 레이어 없이도 빠르게 연동 가능합니다.

---

## 11. 상태관리 구조

```typescript
// store/finance-store.ts
interface FinanceStore {
  // 1단계 현황
  assetSnapshot: AssetSnapshot;
  liabilities: Liability[];
  fixedExpenses: FixedExpense[];
  incomes: Income[];

  // 2단계 자금조달
  fundingNeeds: FundingNeed[];

  // 액션 — 1단계
  syncStockMindData: () => Promise<void>;
  syncAuctionFlowAssets: () => Promise<void>;
  addCashAsset: (asset: CashAsset) => void;
  addLiability: (liability: Liability) => void;
  addFixedExpense: (expense: FixedExpense) => void;
  addIncome: (income: Income) => void;

  // 액션 — 2단계
  addFundingNeed: (need: FundingNeed) => void;
  updateFundingPlan: (needId: string, plan: FundingPlanItem[]) => void;
  syncAuctionFlowFundingNeeds: () => Promise<void>;  // 경매 이벤트 기반 자동 생성

  // 계산 (selector)
  getNetWorth: () => number;
  getMonthlyNetCashflow: () => number;
  getFundingCalendar: (month: string) => FundingCalendarDay[];
  getConflictDates: () => string[];
}
```

### 11.1 자동 동기화 트리거

```typescript
// lib/sync-scheduler.ts

// StockMind 데이터: 페이지 진입 시 + 1시간마다
function scheduleStockMindSync() {
  syncStockMindData();
  setInterval(syncStockMindData, 60 * 60 * 1000);
}

// AuctionFlow Pro 이벤트: Supabase Realtime 구독 (같은 DB 공유 시)
function subscribeAuctionFlowEvents() {
  supabase
    .channel('auction_case_changes')
    .on('UPDATE', { table: 'auction_cases' }, (payload) => {
      if (payload.new.stage !== payload.old.stage) {
        handleStageChange(payload.new);  // FundingNeed 자동 생성 로직
      }
    })
    .subscribe();
}
```

---

## 12. 개발 로드맵

### Phase 0 — 기반 설정 (1일)
- [ ] Supabase 기존 프로젝트에 financehub 테이블 추가
- [ ] 데이터 타입 정의 (`types/finance.ts`)
- [ ] Zustand 스토어 골격
- [ ] 기존 플랫폼 네비게이션에 "재무관리" 메뉴 추가

### Phase 1 — MVP: 1단계 현황관리 (3~4일) ★최우선
- [ ] StockMind 연동 — 보유종목·예수금 조회 API 연결
- [ ] 현금·부채·고정지출·수입 CRUD 화면
- [ ] 통합 현황 대시보드 (순자산, 자산구성, 현금흐름)
- [ ] 연동 실패 시 캐시 표시 + 경고 배너

### Phase 2 — 2단계 자금조달 계획 MVP (3~4일) ★핵심
- [ ] 자금 수요 항목 수동 등록 화면
- [ ] AuctionFlow Pro 연동 — 물건 단계 변경 감지 → 자동 생성
- [ ] 자금조달 계획(조달 방법별 분배) 입력
- [ ] 자금 캘린더 — 월별 뷰 + 충돌 경고

### Phase 3 — 연동 고도화 (2~3일)
- [ ] AuctionFlow Pro Realtime 구독 (자동 갱신)
- [ ] StockMind 연동 — "주식매도" 조달 방법 선택 시 매도 가능 종목 표시
- [ ] 명도비용·취득세 등 추정 로직 정교화
- [ ] 부채 상환 스케줄 자동 생성

### Phase 4 — 고도화 (선택)
- [ ] 시뮬레이션 기능 (가상 입찰 시 자금 상태 미리보기)
- [ ] D-7/D-3 자금부족 사전 알림
- [ ] 카드사 API 연동 (카드결제 자동 수집)
- [ ] 월간 재무 리포트 자동 생성 (Gemini AI 보조)

---

## 13. 성공 지표

| 지표 | 목표 | 측정 방법 |
|------|------|-----------|
| 구글 스프레드시트 의존도 감소 | 100% 전환 (시트 사용 중단) | 사용자 체감 |
| 자금 충돌 사전 발견 | 발생 7일 전 이상 미리 인지 | 캘린더 경고 로그 |
| 데이터 최신성 | StockMind 연동 1시간 이내 최신값 유지 | syncedAt 타임스탬프 |
| 자금조달 계획 수립률 | 모든 FundingNeed 항목에 조달계획 존재 | fundingPlan 존재 여부 |

---

## 14. 미결 사항

| 항목 | 선택지 | 권장 |
|------|--------|------|
| DB 공유 방식 | 같은 Supabase 프로젝트 vs 별도 프로젝트+API | 같은 프로젝트 (질문 답변 기준 통합 시스템 일부이므로) |
| AuctionFlow Pro 이벤트 감지 | Realtime 구독 vs 주기적 폴링 | MVP는 폴링(간단), Phase 3에서 Realtime 전환 |
| 명도비용 추정 로직 | 임차인 수 × 고정금액 vs 보증금 비례 | 초기엔 임차인 수 × 50만원 고정치, 추후 조정 |
| 카드결제 자동 수집 | 카드사 API vs 수동 입력 | Phase 4 이후 검토 (개인정보 처리 복잡도 높음) |
| 취득세 등 세금 자동 계산 | 정확한 세율 적용 vs 추정치 | 초기엔 낙찰가의 약 3% 추정치, 법무사 확인 후 수동 보정 |

---

## 부록: 나경빌라 사례로 보는 전체 흐름 (시나리오)

```
[AuctionFlow Pro]
  나경빌라 2025타경503625 → "입찰예정" 단계 전환 (6/11 입찰일)
        ↓ 자동 트리거
[FinanceHub 2단계]
  FundingNeed 자동 생성
    "나경빌라 입찰보증금" / ₩47,700,000 / D-day: 6/11
        ↓
[FinanceHub 1단계 현황 확인]
  현재 현금: ₩32,000,000
  StockMind 보유종목 평가금액: ₩45,230,000
        ↓
[FinanceHub 2단계 조달 계획 수립]
  현금 ₩30,000,000 + 주식매도 ₩17,700,000 (SK하이닉스 일부)
        ↓
[FinanceHub 캘린더 확인]
  6/11 같은 주에 고정지출(이자 ₩130,000) 있음 → 충돌 없음 확인
        ↓
[입찰 성공 — AuctionFlow Pro에서 "낙찰" 단계로 전환]
        ↓ 자동 트리거
[FinanceHub 2단계]
  FundingNeed 자동 생성
    "나경빌라 잔금+취득세" / 약 ₩477,300,000 / D-day: 7/25 (잔금기한)
    "나경빌라 명도비용" / 추정 ₩9,500,000 (19명×50만원) / D-day: 8월 중
        ↓
[조달 계획 수립]
  잔금: 경락잔금대출 신청 (FinanceHub에 부채로 자동 등록)
  명도비용: 현금 + 일부 주식매도
        ↓
[1단계 현황에 반영]
  새 부채(경락잔금대출) 등록 → 월 이자 자동 계산 → 고정지출에 추가
  부동산 자산(나경빌라) 등록 → 순자산 재계산
```

이 흐름이 FinanceHub가 StockMind·AuctionFlow Pro와 함께 동작하는 핵심 시나리오입니다.

---

*통합 재무관리 모듈(FinanceHub) PRD v1.0 — 2026.06.17*
*바이브 코딩 시작: Phase 0 → Phase 1(현황관리) → Phase 2(자금조달계획) 순서 권장*
*⚠️ 본 모듈은 개인 재무관리 참고 도구이며, 실제 대출·투자 의사결정의 책임은 사용자 본인에게 있습니다.*
