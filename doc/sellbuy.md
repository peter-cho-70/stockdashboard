# sellbuy — 매매 기록 · 시황 상관관계 분석 프로그램 설계

> **현황 (2026-07-11)**: 이 문서의 핵심 아이디어(매수 근거·확신도·감정·목표가·손절가 기록,
> 손절이행/조기익절 자동 판정) 상당 부분은 별도 sellbuy 프로그램이 아니라 이 저장소의
> **매매습관 기능**(앱의 `/portfolio/journal`, 코드는 `backend/core/trade_journal.py`)으로
> 구현됐다. 다만 시황·매크로 상관관계 분석(`macro_snapshots`/`stock_context` 테이블, 요인분석)은
> 아직 미구현 — 이 문서의 로드맵으로 남아있다. "검증된 매매·자산관리 방법론(문헌 조사)"과
> "수급·거래량 분석" 섹션은 [매매기법 문헌조사](guide/매매기법-문헌조사.md)로 따로 정리해뒀다.

## 목적

매수·매도 기록을 남기고, 각 거래를 **그 시점의 거시 환경(매크로)** 과 **종목 시황**에 연결해서
"어떤 조건에서 내 매매가 잘 되고 못 되는지"를 데이터로 밝힌다.

두 개의 목표를 계속 조준한다.

1. 손절을 못 하는 습관 — 손실 거래를 계획보다 오래 끌고 가는 패턴
2. 익절 타이밍 — 너무 일찍/늦게 파는 패턴

여기에 더해, 매매 결과를 매크로/시황 변수와 교차시켜
"이런 시장에서 산 종목은 성적이 나쁘다" 같은 규칙을 찾는다.

---

## 전체 구조

```
[수집기]                 [저장소]              [분석기]              [출력]
증권사 거래내역   ─┐
매매 당시 판단·감정 ─┼─▶  trades          ─┐
지수/환율/금리     ─┤    macro_snapshots  ─┼─▶ 상관관계·요인분석 ─▶ 대시보드/리포트
종목 수급/뉴스     ─┘    stock_context    ─┘
```

핵심 원칙: **거래가 일어난 "그 시점"의 매크로·시황을 스냅샷으로 함께 저장**한다.
사후에 조회하면 이미 결과를 아는 상태라 편향이 생긴다. 매수/매도 순간의 값을 박제한다.

---

## 데이터 모델

### 1) trades — 거래 기록 (분석의 중심)

| 필드 | 타입 | 설명 | 수집 방식 |
|---|---|---|---|
| trade_id | str | 거래 고유 ID | 자동 |
| ticker | str | 종목코드 (예: 005930) | 증권사 |
| name | str | 종목명 | 증권사 |
| asset_type | enum | 주식/ETF/코인 | 입력 |
| side | enum | buy / sell | 증권사 |
| datetime | datetime | 체결 일시 | 증권사 |
| price | float | 체결 단가 | 증권사 |
| qty | float | 수량 | 증권사 |
| fee_tax | float | 수수료+세금 | 증권사 |
| reason | enum | 매수/매도 사유 | 입력 |
| conviction | int | 확신도 1~5 | 입력 |
| emotion | enum | 냉정/기대/불안/조급·FOMO | 입력 |
| plan_target | float | 계획 목표가(익절) | 입력 (매수 전) |
| plan_stop | float | 계획 손절가 | 입력 (매수 전) |
| note | str | 복기 메모 | 입력 |

> `reason`, `conviction`, `emotion`, `plan_target`, `plan_stop` 은
> **매매 직후 30초 안에** 기록해야 의미가 있다. 사후 회상은 결과에 맞춰 왜곡된다.

### 2) trade_roundtrips — 완결 거래 (매수↔매도 매칭, 파생 테이블)

buy/sell 을 FIFO 등으로 묶어 하나의 완결 거래로 만든다. 성과 지표는 여기서 계산.

| 필드 | 설명 |
|---|---|
| holding_days | 보유일수 = sell.datetime − buy.datetime |
| pnl | 실현손익 = (매도가 − 매수가) × 수량 − 비용 |
| return_pct | 수익률 = (매도가 − 매수가) / 매수가 |
| win | 승/패 = return_pct > 0 |
| stop_discipline | 손절이행/손절지연/미설정 (손실 & 매도가<계획손절가 → 지연) |
| exit_timing | 목표달성/조기익절/해당없음 (이익 & 매도가<목표가 → 조기익절) |

### 3) macro_snapshots — 거래 시점 거시 환경

거래 시각(또는 그날 종가) 기준으로 함께 저장.

| 필드 | 설명 | 소스(예) |
|---|---|---|
| kospi / kosdaq | 코스피·코스닥 지수 | pykrx, FinanceDataReader |
| kospi_ret_5d / 20d | 5·20일 지수 수익률 (추세) | 계산 |
| usdkrw | 원/달러 환율 | ECOS, FDR |
| kr_rate_3y / base_rate | 국고채 3년·기준금리 | 한국은행 ECOS |
| us_10y | 미국 10년물 금리 | FRED |
| sp500 / nasdaq | 미국 지수 (전일 종가) | FRED, yfinance |
| vix | 변동성 지수 (공포지수) | FRED, yfinance |
| market_regime | 상승/횡보/하락 국면 라벨 (지수 20/60일선 기준) | 계산 |

### 4) stock_context — 거래 시점 종목 시황

| 필드 | 설명 | 소스(예) |
|---|---|---|
| sector | 업종 | KRX, FDR |
| per / pbr | 밸류에이션 | pykrx, 네이버금융 |
| foreign_net_5d | 외국인 순매수(5일 누적) | pykrx |
| inst_net_5d | 기관 순매수(5일 누적) | pykrx |
| volume_ratio | 거래량 / 20일 평균 (관심도 급등 여부) | 계산 |
| price_vs_ma20 / ma60 | 이동평균 대비 위치 (추격매수 여부) | 계산 |
| rsi_14 | 과열/과매도 | 계산 |
| news_count_3d | 최근 3일 뉴스 건수 | 네이버금융 크롤 |
| has_disclosure | 최근 공시 여부 | DART OpenAPI |

### 5) holdings — 현재 보유 종목 스냅샷 (미실현 손익 분석의 핵심)

완결 거래(roundtrip)만 보면 "아직 안 판 손실 종목"이 분석에서 빠진다.
실제 문제(−50% 종목 방치, 40종목 보유)는 여기서 드러난다. 일 단위로 스냅샷.

| 필드 | 설명 |
|---|---|
| ticker / name / asset_type | 종목 |
| qty / avg_cost | 보유수량 / 평균단가 |
| price | 현재가 |
| market_value | 평가금액 = qty × price |
| weight | 포트폴리오 내 비중 = market_value / 총평가금액 |
| unrealized_pnl / unrealized_ret | 평가손익 / 평가수익률 |
| breakeven_ret | 본전까지 필요한 상승률 = 1/(1+수익률) − 1 |
| holding_days | 보유일수 |
| first_buy_reason / conviction | 최초 매수 사유·확신도 (trades에서 연결) |
| thesis_valid | 매수 근거 유효 여부 (수동 재평가, Y/N/보류) |
| max_drawdown | 보유 중 최대 낙폭 |

### 6) portfolio_metrics — 포트폴리오 전체 지표 (일 단위)

| 필드 | 설명 |
|---|---|
| n_holdings | 보유 종목 수 |
| hhi | 집중도 지수 = Σ(weight²), 낮을수록 분산·과분산 판단 |
| top5_weight | 상위 5종목 비중 |
| loser_weight | 평가손실 종목이 차지하는 비중 |
| deep_loser_count | −30%/−50% 이하 종목 수 |
| avg_breakeven_ret | 손실 종목 평균 회복필요수익률 |
| total_unrealized_ret | 전체 평가수익률 |
| mdd | 계좌 최대낙폭 |
| sector_concentration | 업종별 비중 (진짜 분산됐는지) |

---

## 분석: 무엇과 무엇의 상관관계를 볼 것인가

각 완결 거래를 하나의 표본으로 보고, **결과 변수**(수익률, 승패, 손절이행, 조기익절 여부)를
**설명 변수**(매크로 + 시황 + 나의 판단·감정)에 회귀/그룹비교한다.

핵심 가설 예시:

- 매크로 국면(`market_regime`)별 승률·손익비 → 하락장에서 산 종목이 유독 나쁜가?
- `vix` 높을 때(변동성 장세) 진입한 거래의 손절 지연율이 더 높은가?
- `volume_ratio`·`news_count_3d` 급등(테마 과열) 시 매수 → 조기 손절/추격매수 실패 패턴?
- `price_vs_ma20` 가 크게 양수일 때(고점 추격) 매수 → 수익률 저하?
- 외국인/기관 순매수(`foreign_net_5d`, `inst_net_5d`)와 같은 방향으로 산 거래의 성과?
- `emotion=조급/FOMO` × `vix 높음` 조합에서 최악의 성적이 나오는가? (감정×매크로 교차)
- `conviction` 낮은데 큰 금액 투입한 거래의 손실 규모?

산출물:

- 요인별 승률/평균수익률/손익비 테이블
- 상관계수·중요도(예: 로지스틱 회귀 계수, 트리 기반 feature importance)
- "위험 조합" 경고 규칙 (예: 조급 + 고점추격 + 하락장 → 진입 자제)

---

## 방법론 (핵심): 정리 → 규칙화 → 재구성

> 나는 투자자문가가 아니며, 아래는 특정 종목의 매수·매도 지시가 아니라
> 판단을 돕는 **의사결정 프레임워크**다. 최종 결정과 책임은 본인에게 있다.

현재 상태를 전제로 한다: 약 40개 종목·ETF 보유, 일부 −50% 이상 손실 방치,
손절을 못 하고 익절 타이밍이 흔들림. 목표는 **꾸준하고 안정적인 수익이 나는 포트폴리오**.
이를 위해 세 트랙을 순서대로 돌린다.

### 트랙 1 — 기존 포트폴리오 진단·정리 (지금 한 번, 40종목 대상)

가장 먼저 할 일은 새 매매가 아니라 **지금 들고 있는 것을 객관적으로 재판단**하는 것이다.
손절을 못 하는 이유는 대부분 "매수가 대비 손실"이라는 기준점(anchor) 때문이다.
이 방법론의 제1규칙: **평균단가·물타기 이력은 판단에서 제외한다(매몰비용).**
오직 "지금 이 돈을, 이 종목에, 이 가격에 새로 넣을 것인가"만 묻는다.

**손실의 비대칭성 (왜 방치가 위험한가 — 계산)**

| 현재 손실 | 본전까지 필요한 상승률 |
|---|---|
| −10% | +11% |
| −20% | +25% |
| −30% | +43% |
| −50% | +100% |
| −70% | +233% |

−50% 종목은 두 배가 올라야 본전이다. 회복 가능성이 낮은 종목을 붙들면
그 자금이 묶여 더 나은 기회를 놓치는 **기회비용**이 진짜 손실이다.

**종목 트리아지 — 40개를 4분면으로 분류**

각 종목을 두 축으로 점수화한다.

- 축 A. 근거 유효성: 원래 산 이유(실적·성장·테마)가 지금도 유효한가? (thesis_valid)
- 축 B. 추세·모멘텀: 현재가가 20/60일선 위인가, 하락 추세인가? (price_vs_ma)

| | 근거 유효 | 근거 깨짐 |
|---|---|---|
| **추세 양호** | ① 핵심 보유 / 비중 확대 검토 | ③ 관망 (반등 시 정리) |
| **추세 악화** | ② 유지하되 손절선 재설정 | ④ 청산 1순위 |

**재매수 테스트(가장 강력한 질문)**: "이 종목을 오늘 신규 자금으로 이 가격에 사겠는가?"
→ 아니오면, 논리적으로는 파는 것과 같다(안 팔고 버티는 것 = 매일 다시 사는 셈).

정리는 한 번에 몰아서 하지 않는다. ④분면부터 **분할 정리**(예: 2~3회 나눠서)로
심리적 충격과 타이밍 리스크를 줄인다.

### 트랙 2 — 매매 규칙화 (재발 방지, 앞으로 모든 거래)

감정이 아니라 **미리 정한 규칙**이 매매를 결정하게 만든다. 규칙은 기록·측정되어야 한다.

**손절 규칙 (손절 못 하는 습관 교정)**

- 진입 전 손절가 명시(`plan_stop`): 없으면 매수 금지 규칙.
- 종목당 리스크 상한: 한 종목 손실이 계좌의 X%(예: 1~2%)를 넘지 않게 **손절폭으로 수량을 역산**.
  → 수량 = (계좌 × 허용리스크%) / (매수가 − 손절가)
- 시간 손절(time stop): 매수 근거가 N개월 내 작동하지 않으면 손익과 무관하게 정리.
- 물타기 금지 기본값: 하락 시 추가매수는 "사전에 계획된 분할매수"일 때만 허용.

**익절 규칙 (너무 일찍/늦게 파는 습관 교정)**

- 추격손절(trailing stop): 고점 대비 Y% 하락 시 청산 → 수익은 달리게 두고, 조기익절 방지.
- 분할 익절: 목표가 도달 시 일부(예: 1/3) 실현, 나머지는 트레일링으로 추세 추종.
- 목표가·손절가를 함께 두어 **손익비(target−entry)/(entry−stop) ≥ 2** 인 거래만 진입.

### 트랙 3 — 목표 포트폴리오 재구성

**과분산 진단**: 40종목은 분산이 아니라 "관리 못 하는 방치"일 수 있다(diworsification).
`hhi`·`sector_concentration` 으로 실제 분산 효과를 확인한다. 40개가 같은 테마로 몰려 있으면
숫자만 많을 뿐 리스크는 집중돼 있다. **핵심 종목 수를 관리 가능한 범위로 압축**하는 것을 목표로 둔다.

**코어–새틀라이트 구조(예시 틀)**

- 코어: 지수·자산배분 ETF 중심 → 안정적 베이스, 변동성·MDD 완충.
- 새틀라이트: 확신도 높은 소수 개별주 → 초과수익 추구, 비중 상한 설정.
- 종목당 비중 상한(예: 5~10%)과 현금 비중 규칙으로 한 종목 사고가 계좌를 흔들지 못하게 한다.
- 정기 리밸런싱 주기(예: 분기)를 정해, 비중이 틀어지면 기계적으로 조정.

### 개선을 어떻게 "측정"할 것인가 (프로그램이 계산)

방법론이 작동하는지는 **추세**로 확인한다. before/after 비교 대상:

| 성향 지표 (행동) | 포트폴리오 지표 (결과) |
|---|---|
| 손절 준수율 ↑ | 계좌 MDD(최대낙폭) ↓ |
| 조기익절 비율 ↓ | 변동성 대비 수익(샤프) ↑ |
| 손익비 ↑ (≥2 지향) | 손실 종목 비중(loser_weight) ↓ |
| 진 거래 평균 보유일 ↓ | 집중도(hhi)·과분산 정상화 |
| 규칙 위반 매매 건수 ↓ | 평균 회복필요수익률 ↓ |

목표는 승률을 올리는 것이 아니라 **손익비와 낙폭을 개선**하는 것이다.
승률 40%라도 손익비가 3이면 꾸준히 우상향한다. "안정적 수익"의 정의를 여기에 둔다.

### 실행 순서 (첫 분기)

1. 40종목을 `holdings` 에 입력 → 평가손익·비중·회복필요수익률·집중도 자동 산출.
2. 트리아지 4분면 분류 + 재매수 테스트 → ④분면 분할 정리 계획 수립.
3. 남길 종목마다 손절가·목표가 소급 설정(트랙 2 규칙 적용).
4. 코어(ETF)–새틀라이트 목표 비중 초안 → 리밸런싱으로 단계 이행.
5. 매월 성향·포트폴리오 지표 리포트로 개선 추세 점검.

---

## 검증된 매매·자산관리 방법론 (문헌 조사)

> **참고하되 추종하지 않는다.** 아래는 널리 연구된 방법론과 그 근거·반증을 균형 있게 정리한 것이다.
> 어떤 방법도 모든 시장·기질에서 통하지 않으며, 상당수는 증거가 엇갈린다.
> 결론은 "정답 채택"이 아니라, 이 아이디어들을 **내 데이터로 백테스트해 취사선택**하는 것이다.
> (나는 투자자문가가 아니며 이는 매매 지시가 아니다.)

### 1) 내 문제의 학술적 이름 — 처분효과(Disposition Effect)

"이익은 너무 일찍 팔고, 손실은 너무 오래 들고 있는" 성향은 1985년부터 문서화된
대표적 행동편향이다. 연구는 이 편향이 평균 투자자에게 **연 3.2~5.7%의 수익을 갉아먹는다**고
추정한다. 즉 peter님의 두 고민(손절 못함·조기익절)은 개인의 의지 문제가 아니라
인간 공통의 편향이며, **자동화·규칙화로 억제**하는 것이 정석이라는 뜻이다.
실험에서 매 기간 자동 매도되게 하자 처분효과가 크게 줄었다.
([정의·비용](https://en.wikipedia.org/wiki/Disposition_effect),
[원논문 Shefrin&Statman](https://www.researchgate.net/publication/313248569_The_Disposition_to_Sell_Winners_too_Early_and_Ride_Losers_too_Long),
[스톱로스·교육 효과](https://www.sciencedirect.com/science/article/abs/pii/S2214635019300863))

### 2) "손실은 짧게, 이익은 길게" / 추세추종 — 근거와 반증

- **지지**: 시계열 모멘텀(추세추종)은 Moskowitz et al.(2012)이 원자재·채권·통화·주식 전반에서
  초과수익을 학술적으로 입증했고, 성공한 트레이더의 수익은 높은 승률이 아니라
  **비대칭 손익비**(작은 손실 + 큰 이익)에서 나온다는 연구가 많다.
- **모멘텀 프리미엄**은 46개국·150년 데이터에서 견고했고, 4,000개 변형 포트폴리오가
  모두 양(+)의 샤프를 냈으며, 학계 공개 후에도 잘 소멸하지 않았다. 다만 변동성이 커
  추세 급반전(예: 2009) 때 큰 낙폭 → **변동성 스케일링**으로 낙폭을 절반가량 줄일 수 있다.
- **반증**: Baur & Dimpfl(2022)은 "'손실을 잘라라'가 좋은 전략이라는 증거를 찾지 못했다"며,
  약한 손실주와 강한 승자주 특성상 **손실·이익을 둘 다 달리게 두는 편이 나을 수 있다**고 했다.
  → 교훈: 손절 규칙의 1차 목적은 "수익 극대화"가 아니라 **파산 방지와 편향 억제**로 봐야 한다.
  ([모멘텀 근거](https://alphaarchitect.com/momentum-factor-investing/),
  [CFA 모멘텀](https://rpc.cfainstitute.org/blogs/enterprising-investor/2025/momentum-investing-a-stronger-more-resilient-framework-for-long-term-allocators),
  [반증 논문](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=4233700),
  [Elm Wealth 해설](https://elmwealth.com/cut-losses-early-let-profits-run/))

### 3) 스톱로스의 실제 효과 — 만능 아님

스톱로스가 처분효과를 완화할 수 있지만, 변동성 큰 자산에선 **일시 하락에 털려 오히려
수익을 깎는다**는 시뮬레이션 결과도 있다. 즉 손절선은 "정확한 손절가 맞히기"가 아니라
**한 종목이 계좌를 파괴하지 못하게 하는 상한선**으로 설계하는 게 맞다.
→ 종목당 리스크 상한(계좌의 1~2%)과 결합할 때 의미가 커진다.
([스톱로스·처분효과 연구](https://www.sciencedirect.com/science/article/abs/pii/S2214635019300863))

### 4) 포지션 사이징 — 얼마를 걸 것인가 (안전한 자산관리의 핵심)

| 방법 | 요지 | 특징 |
|---|---|---|
| 고정비율(2% 룰) | 한 거래에서 계좌의 **최대 2%만 리스크**에 노출 | CFA가 권장, 단순·보수적, 파산 확률↓ |
| 켈리 공식 | f = W − (1−W)/R (W=승률, R=손익비) | 장기성장 최적화지만 변동성·낙폭 극심 |
| 하프켈리 | 켈리의 절반만 베팅 | 성장의 ~75% 확보 + 낙폭 ~50% 감소 → 실무 표준 |

핵심 함의: **수익률보다 "리스크 크기"를 먼저 정한다.** 손절폭으로 수량을 역산하는
트랙 2 규칙이 바로 고정비율(2% 룰)의 구현이다.
([위치사이징 개관](https://www.quantifiedstrategies.com/position-sizing-strategies/),
[켈리 vs 고정비율](https://medium.com/@tmapendembe_28659/kelly-criterion-vs-fixed-fractional-which-risk-model-maximizes-long-term-growth-972ecb606e6c))

### 5) 구체적 규칙 예시 — 오닐 CAN SLIM

성장주 매매의 대표 체계. **매수가 대비 7~8% 하락 시 예외 없이 손절**, 이익은 20~25%에서
분할 실현(추세 강하면 더 보유)을 제시한다. 이는 **손절 8% : 익절 24% ≈ 1:3 손익비**를
규칙으로 강제하는 구조다. peter님의 손익비 목표(≥2)와 같은 철학.
([CAN SLIM 개요](https://en.wikipedia.org/wiki/CAN_SLIM),
[7% 룰](https://www.shareindia.com/knowledge-center/online-share-trading/what-is-the-7-rule-in-stock-trading-a-guide-for-investors))

### 6) 안정적 자산관리 — 분산·리스크 균형

- **리스크 패리티 / 올웨더**(Bridgewater, 1996): 자본이 아니라 **리스크를 균등 배분**.
  전통적 60/40은 자본은 나눠도 리스크의 90%+가 주식에서 나온다. 올웨더 예시 배분은
  주식30·장기국채40·중기국채15·금7.5·원자재7.5. 장기수익은 S&P500(연 10~11%)보다
  낮은 8~9%지만 **변동성 절반·낙폭 훨씬 얕음**. "안정적 수익"을 원한다면 핵심 참고점.
- **영구 포트폴리오**(Harry Browne): 주식·채권·금·현금 25%씩 — 4개 경제국면 대비.
- **분산의 원리**: 상관 낮은 10~15개 수익원을 리스크 균등 결합하면 평균수익에 근접하면서
  변동성·낙폭이 크게 준다. → 40종목이라도 **같은 테마로 몰려 있으면 분산이 아니다**(트랙 3의 HHI·섹터집중도 점검).
  ([올웨더 리뷰](https://www.optimizedportfolio.com/all-weather-portfolio/),
  [리스크패리티 개요](https://kardinalfinancial.com/blog/what-is-risk-parity-investing))

### 7) 종합 — 이 조사가 내 방법론에 주는 결론

1. 내 핵심 문제는 **처분효과**라는 이름의 편향 → 의지가 아니라 **규칙·자동화**로 다룬다.
2. 손절 규칙의 목적은 정확한 손절가가 아니라 **파산 방지**(종목당 리스크 상한)다. 증거가 엇갈리므로 맹신 금지.
3. 성패는 승률이 아니라 **손익비와 최대낙폭**에서 갈린다(오닐 1:3, 켈리·2% 룰의 공통 함의).
4. "안정적 수익"의 벤치마크는 올웨더식 **리스크 균형·낮은 낙폭** 구조. 코어를 여기에 둔다.
5. 모든 방법은 **내 거래 데이터로 백테스트**해 검증하고 취사선택한다 — 참고하되 추종하지 않는다.

---

## 수급·거래량 분석 (국장: 매크로보다 수급이 지배하는 국면)

> 2025~2026년 국장은 외국인·기관 수급이 지수를 좌우했다. 코스피는 2025년 76% 상승,
> 2026년 들어선 외국인이 연초~5월 **약 85조원 순매도**하며 방향을 바꿨다. 이런 국면에선
> 밸류·매크로보다 **누가 사고파는가(수급)** 가 단기 주가를 더 강하게 설명한다.
> ([외국인 순매도 규모](https://en.sedaily.com/finance/2026/05/19/foreign-investors-dump-85-trillion-won-in-korean-stocks),
> [KRX CEO 리밸런싱 언급](https://www.cnbc.com/2026/06/11/south-korea-kospi-selloff-foreign-investors-krx.html))

### A. 의미 있는 수급 지표와 수집 방법

| 지표 | 무엇을 보나 | 해석 요지 | 소스/수집 |
|---|---|---|---|
| 투자자별 순매수 | 외국인·기관(연기금/금투/투신)·개인의 순매수 | **외국인+기관 동반 순매수**는 강한 실수급 신호. 개인 홀로 순매수는 약함 | `pykrx.stock.get_market_trading_value_by_date`, `get_market_net_purchases_of_equities`, KRX 데이터시스템 |
| 프로그램 매매 | 차익/비차익, 외국인 창구 유입 | 대량 비차익 순매수는 패시브·기관 유입 신호 | KRX MDC(프로그램매매) |
| 신용잔고(율) | 빚내서 산 물량 | 급증 시 **상승 탄력 둔화·반대매매(하락 시 강제청산) 위험** = 잠재 매도압력 | 금융투자협회 FreeSIS, 증권사 HTS |
| 공매도 잔고(시총 대비) | 하락 베팅 규모 | 시총 대비 **3~5% 초과** 시 '공매도 타깃'으로 수급이 꼬여 호재에도 잘 안 오름 | `pykrx` 공매도(`get_shorting_balance_by_date`), KRX 공매도종합 |
| 대차잔고 | 빌린 주식(공매도 대기 물량) | 체결>상환이면 잔고↑ = 하락압력. **급감하면 상환→반등 신호**로 해석 | SEIBRO, KOFIA, 증권사 |
| 거래대금·회전율 | 관심·유동성 | 저거래→급증은 세력 유입 초입일 수 있음 | `pykrx` OHLCV |

> 프로그램에 넣을 땐 `stock_context` 테이블에 `foreign_net_5d/inst_net_5d`(이미 설계됨)에 더해
> `credit_balance_ratio`, `short_balance_ratio`, `loan_balance` 컬럼을 추가하면 된다.
> ([공매도·대차잔고 확인법](https://thecheck.co.kr/%EA%B3%B5%EB%A7%A4%EB%8F%84-%EC%9E%94%EA%B3%A0-%EC%A1%B0%ED%9A%8C-%EB%B0%8F-krx-%EB%8C%80%EC%B0%A8%EC%9E%94%EA%B3%A0-%ED%99%95%EC%9D%B8-%EB%B0%A9%EB%B2%95%EC%A3%BC%EC%8B%9D%EA%BF%80%ED%8C%81/),
> [KRX 공매도 순보유잔고](https://data.krx.co.kr/contents/MMC/SRTS/srts/MMCSRTS004.cmd),
> [KOFIA 대차거래 추이](https://freesis.kofia.or.kr/stat/FreeSIS.do?parentDivId=MSIS10000000000000&serviceId=STATSCU0100000140))

**주의**: 수급 지표는 대체로 **후행·집계 지연**(공매도·대차는 T+1~T+2 공시)이며, 특정 창구가
의도적으로 물량을 숨기기도 한다. 상관은 참고하되 인과로 단정하지 않는다.

### B. 차트·거래량이 주가에 영향을 주는 이론

거래량 분석의 고전은 **와이코프(Wyckoff)** 다. 핵심 3법칙으로 요약된다.

1. **수요·공급의 법칙**: 가격은 결국 매수·매도 힘의 균형이 깨지는 방향으로 움직인다.
2. **원인과 결과**: 큰 움직임 전에는 횡보 구간에서 **매집(accumulation)** 또는 **분산(distribution)**
   이라는 '원인'이 쌓인다. 바닥 다지기(base)가 길고 클수록 이후 움직임도 크다.
3. **노력과 결과**: **거래량 = 노력, 가격 변화 = 결과.** 거래량이 크게 실렸는데(노력) 가격이
   안 오르면(결과 부족) → 위쪽 매물 저항(분산·소진) 신호. 반대로 적은 거래량에 크게 오르면 지속성 의심.

실전 함의(핵심):

- **돌파의 진위는 거래량이 가른다.** 진짜 돌파는 **거래량 급증**을 동반한다(기관이 더 높은 가격을
  기꺼이 지불). 거래량 없는 돌파는 가짜일 확률이 높고 되돌림으로 손절만 유발.
  ([Wyckoff 돌파·거래량](https://trendspider.com/learning-center/chart-patterns-wyckoff-accumulation/),
  [매집·분산 국면](https://www.litefinance.org/blog/for-professionals/wyckoff-method/))
- **매집**: 저점 횡보에서 거래량이 서서히 늘며 큰손이 물량을 모으는 구간 → 이후 상승 준비.
- **분산**: 고점에서 거래량이 터지는데 주가는 더 못 가는 구간 → 큰손이 개미에게 넘기는 구간, 하락 준비.
- 보조지표: **OBV**(거래량 누적으로 매집/분산 추적), **VWAP**(기관 평균단가 기준선),
  거래량 대비 가격(volume_ratio, price_vs_ma)은 이미 `stock_context` 에 설계돼 있다.

### C. 실제 사례 — 에코프로 2023 (거래량 폭발 → 주가 급등)

2차전지 대장주 에코프로는 2023년 한 해 **약 646% 급등**(에코프로비엠 약 220%)했다.
미국 IRA 세부안 발표 후 성장 기대에 투심이 몰렸고, **상승 내내 거래량이 꾸준히 증가**했다 —
개인 단독이 아니라 실수급 주체가 유입될 때 나타나는 전형적 매집 패턴. 4월 초엔 장 초반
거래량이 몰리며 하루 13%대 급등, 이후에도 하루 만에 시가총액이 수조 원씩 출렁였다.

이 사례의 교훈은 두 갈래다. (1) **거래량을 동반한 추세는 강력**하다 — 와이코프의 '노력=거래량'이
가격으로 실현된 국면. (2) 동시에 하나증권은 "위대한 기업이지만 좋은 주식은 아니다"라며 **매도**
의견을 냈고 증권가는 '과열'로 평가했다 — **거래량 폭발이 고점 분산의 신호일 수도** 있다는 양면성.
같은 대량거래도 저점 매집이면 상승 전조, 고점 분산이면 하락 전조다. 이 구분이 실전의 핵심이며,
그래서 **거래량은 반드시 위치(이평선 대비, 바닥/천장)와 수급 주체와 함께** 읽어야 한다.
([에코프로 7배 급등·매도의견](https://m.kr.investing.com/news/stock-market-news/article-898921?ampMode=1),
[하루 3조 변동](https://v.daum.net/v/H4fEHxGhip))

> 프로그램 적용: 매수/매도 시점의 `volume_ratio`, `price_vs_ma20/60`, 수급 주체(외국인·기관 순매수),
> 신용·공매도 잔고를 `stock_context` 에 스냅샷해 두면, 나중에 "내가 거래량 터진 고점(분산)에서
> 추격매수하는 습관이 있는가"를 상관분석으로 검증할 수 있다. 이것이 트랙 2(추격매수 억제)와 직결된다.

---

## 데이터 소스 (한국 시장 기준)

| 범주 | 후보 | 비고 |
|---|---|---|
| 거래내역 | 증권사 MTS/HTS 엑셀·CSV, 한국투자증권 KIS Developers API | 자동화하려면 KIS API 계좌 연동 |
| 시세·지수·수급 | FinanceDataReader, pykrx | 무료 파이썬 라이브러리, 개인 분석에 충분 |
| 금리·환율·경제지표 | 한국은행 ECOS OpenAPI | 인증키 발급 필요 |
| 미국 금리·지수·VIX | FRED API, yfinance | |
| 공시 | DART OpenAPI (금융감독원) | 인증키 발급 필요 |
| 뉴스·PER/PBR | 네이버 금융 크롤링 | robots·이용약관 확인 |

> 실시간 자동매매가 목적이 아니라 사후 복기·상관분석이 목적이므로,
> 일 단위(종가 기준) 배치 수집으로 충분하다. 무료 라이브러리(FDR/pykrx)만으로 시작 가능.

---

## 권장 기술 스택 (MVP)

- 언어: Python
- 저장소: 시작은 SQLite 또는 Parquet/CSV, 커지면 PostgreSQL
- 수집: `FinanceDataReader`, `pykrx`, `requests`(ECOS/DART), 스케줄러(cron / APScheduler)
- 분석: `pandas`, `scikit-learn`(로지스틱·트리), `statsmodels`(상관·회귀)
- 시각화: 노트북 + `matplotlib`/`plotly`, 또는 간단한 대시보드(Streamlit)

### 최소 스키마 (SQLite 예시)

```sql
CREATE TABLE trades (
  trade_id     TEXT PRIMARY KEY,
  ticker       TEXT, name TEXT, asset_type TEXT,
  side         TEXT,               -- 'buy' | 'sell'
  dt           TEXT,               -- ISO8601
  price        REAL, qty REAL, fee_tax REAL,
  reason       TEXT, conviction INTEGER, emotion TEXT,
  plan_target  REAL, plan_stop REAL, note TEXT
);

CREATE TABLE macro_snapshots (
  trade_id TEXT REFERENCES trades(trade_id),
  kospi REAL, kosdaq REAL, kospi_ret_20d REAL,
  usdkrw REAL, base_rate REAL, us_10y REAL,
  sp500 REAL, nasdaq REAL, vix REAL, market_regime TEXT
);

CREATE TABLE stock_context (
  trade_id TEXT REFERENCES trades(trade_id),
  sector TEXT, per REAL, pbr REAL,
  foreign_net_5d REAL, inst_net_5d REAL,
  volume_ratio REAL, price_vs_ma20 REAL, price_vs_ma60 REAL,
  rsi_14 REAL, news_count_3d INTEGER, has_disclosure INTEGER
);
```

`trade_roundtrips` 뷰는 buy/sell 을 FIFO 매칭해 파생 계산한다.

---

## 구현 로드맵

1. **1단계 — 기록**: `trades` 저장 + 매수/매도 매칭(roundtrip) + 손절이행·익절타이밍 지표.
   (엑셀 트래커에서 이미 검증한 로직을 코드로 이식)
2. **2단계 — 매크로 스냅샷**: 거래 시점의 지수/환율/금리/VIX 를 FDR·ECOS·FRED 로 채운다.
3. **3단계 — 종목 시황 스냅샷**: pykrx 로 수급·거래량·이동평균·PER/PBR, DART 로 공시.
4. **4단계 — 상관분석**: 요인별 성과 테이블 + 회귀/중요도 + 위험 조합 규칙.
5. **5단계 — 대시보드/알림**: 정기 리포트, "이 조건에선 매매 자제" 경고.

---

## 프로그램 구현 가이드 (단계별)

> 아래 코드는 골격(skeleton)이다. 라이브러리 버전에 따라 함수 시그니처가 조금씩 다르니
> (`pykrx`, `FinanceDataReader` 는 업데이트가 잦음) 설치 후 `help(함수)` 로 확인하며 맞춘다.

### 0) 프로젝트 구조

```
sellbuy/
├── data/                 # sqlite db, 원본 csv
│   └── sellbuy.db
├── ingest/
│   ├── trades.py         # 증권사 거래내역 → trades
│   ├── holdings.py       # 보유종목 → holdings
│   ├── macro.py          # 지수·환율·금리·VIX → macro_snapshots
│   └── context.py        # 수급·이평·PER 등 → stock_context
├── core/
│   ├── db.py             # 스키마 생성 / 커넥션
│   ├── roundtrip.py      # 매수·매도 FIFO 매칭 + 성과지표
│   ├── portfolio.py      # 보유 비중·HHI·회복필요수익률 등
│   └── triage.py         # 4분면 분류 + 재매수 테스트
├── analysis/
│   └── correlation.py    # 요인별 성과·회귀·중요도
├── app/
│   └── dashboard.py      # Streamlit 대시보드
├── config.py             # API 키, 상수(허용리스크% 등)
└── requirements.txt
```

`requirements.txt`: `pandas numpy scikit-learn statsmodels pykrx finance-datareader requests streamlit plotly APScheduler`

### 1) DB 스키마 (core/db.py)

앞의 SQL(`trades`, `macro_snapshots`, `stock_context`, `holdings`, `portfolio_metrics`)을
`sqlite3` 로 생성한다. 처음엔 SQLite 한 파일이면 충분하다.

```python
import sqlite3
def get_conn(path="data/sellbuy.db"):
    conn = sqlite3.connect(path)
    conn.execute("PRAGMA foreign_keys=ON")
    return conn
```

### 2) 거래내역 로딩 (ingest/trades.py)

증권사에서 받은 CSV의 컬럼명을 표준 스키마로 매핑한다. 증권사마다 헤더가 다르므로
매핑 딕셔너리만 갈아끼우면 되도록 만든다.

```python
import pandas as pd, hashlib
COLMAP = {  # 예: 키움/삼성 등 증권사 CSV 헤더 → 표준명
    "체결일자":"dt", "종목명":"name", "종목코드":"ticker",
    "구분":"side", "체결단가":"price", "체결수량":"qty", "수수료":"fee_tax",
}
def load_trades(csv_path):
    df = pd.read_csv(csv_path).rename(columns=COLMAP)
    df["side"] = df["side"].map({"매수":"buy","매도":"sell"}).fillna(df["side"])
    df["dt"] = pd.to_datetime(df["dt"])
    df["trade_id"] = df.apply(
        lambda r: hashlib.md5(f"{r.ticker}{r.dt}{r.side}{r.price}{r.qty}".encode()).hexdigest()[:12],
        axis=1)
    return df  # → to_sql("trades", conn, if_exists="append")
```

판단·감정(`reason/conviction/emotion/plan_target/plan_stop`)은 CSV에 없다.
간단한 입력 UI(Streamlit form)나 별도 시트로 그날 채워 `trades` 에 UPDATE 한다.

### 3) 매수·매도 FIFO 매칭 → 성과지표 (core/roundtrip.py)

```python
from collections import deque
def build_roundtrips(trades_df):
    rows, lots = [], {}          # lots[ticker] = deque of (dt, price, qty_remaining)
    for t in trades_df.sort_values("dt").itertuples():
        q = lots.setdefault(t.ticker, deque())
        if t.side == "buy":
            q.append([t.dt, t.price, t.qty])
        else:  # sell → 앞선 매수 lot과 매칭
            remain = t.qty
            while remain > 0 and q:
                lot = q[0]; use = min(remain, lot[2])
                ret = (t.price - lot[1]) / lot[1]
                rows.append(dict(ticker=t.ticker, buy_dt=lot[0], sell_dt=t.dt,
                    buy_px=lot[1], sell_px=t.price, qty=use,
                    holding_days=(t.dt-lot[0]).days,
                    pnl=(t.price-lot[1])*use, return_pct=ret,
                    win=ret>0))
                lot[2]-=use; remain-=use
                if lot[2]==0: q.popleft()
    return pd.DataFrame(rows)
```

여기에 `plan_stop/plan_target` 을 join 해 `stop_discipline`(손절이행/지연),
`exit_timing`(목표달성/조기익절)을 계산한다 — 엑셀 트래커와 동일 로직.

### 4) 포트폴리오 지표 (core/portfolio.py)

```python
import numpy as np
def portfolio_metrics(holdings):        # holdings: qty, avg_cost, price
    h = holdings.copy()
    h["market_value"]   = h.qty * h.price
    total = h.market_value.sum()
    h["weight"]         = h.market_value / total
    h["unrealized_ret"] = h.price/h.avg_cost - 1
    h["breakeven_ret"]  = 1/(1+h.unrealized_ret) - 1     # 본전까지 필요 상승률
    return dict(
        n_holdings   = len(h),
        hhi          = float((h.weight**2).sum()),       # 집중도
        top5_weight  = float(h.weight.nlargest(5).sum()),
        loser_weight = float(h.loc[h.unrealized_ret<0, "weight"].sum()),
        deep_loser   = int((h.unrealized_ret<=-0.30).sum()),
        avg_breakeven= float(h.loc[h.unrealized_ret<0,"breakeven_ret"].mean()),
        total_ret    = float((h.market_value.sum()/(h.qty*h.avg_cost).sum())-1),
    ), h
```

### 5) 매크로 수집 (ingest/macro.py)

```python
import FinanceDataReader as fdr
def macro_on(date):   # date: 'YYYY-MM-DD'
    def last(sym):
        s = fdr.DataReader(sym, date)      # 해당일 이후 첫 행
        return float(s["Close"].iloc[0])
    return dict(
        kospi = last("KS11"), kosdaq = last("KQ11"),
        usdkrw= last("USD/KRW"),
        sp500 = last("US500"), nasdaq = last("IXIC"),
        vix   = last("VIX"),                     # 심볼은 버전에 따라 확인
    )
# 금리·경제지표는 한국은행 ECOS OpenAPI(requests), 미국물은 FRED API로 보강
```

### 6) 종목 시황 수집 (ingest/context.py)

```python
from pykrx import stock
def stock_context(ticker, date):           # date: 'YYYYMMDD'
    start = (pd.to_datetime(date)-pd.Timedelta(days=40)).strftime("%Y%m%d")
    ohlcv = stock.get_market_ohlcv(start, date, ticker)          # 종가·거래량
    fund  = stock.get_market_fundamental(date, date, ticker)     # PER/PBR
    flow  = stock.get_market_trading_value_by_date(start, date, ticker)  # 투자자별
    close = ohlcv["종가"]
    return dict(
        per = float(fund["PER"].iloc[-1]), pbr = float(fund["PBR"].iloc[-1]),
        price_vs_ma20 = float(close.iloc[-1]/close.tail(20).mean()-1),
        price_vs_ma60 = float(close.iloc[-1]/close.tail(60).mean()-1),
        volume_ratio  = float(ohlcv["거래량"].iloc[-1]/ohlcv["거래량"].tail(20).mean()),
        foreign_net_5d= float(flow["외국인합계"].tail(5).sum()),
        inst_net_5d   = float(flow["기관합계"].tail(5).sum()),
    )
```

### 7) 트리아지 자동 분류 (core/triage.py)

방법론 트랙 1의 4분면을 규칙으로 코드화한다. 근거 유효성(thesis_valid)은
사람이 판단하는 값이라 입력받고, 추세는 시황에서 자동 계산한다.

```python
def triage(row):     # row: unrealized_ret, price_vs_ma60, thesis_valid(bool)
    trend_ok = row.price_vs_ma60 >= 0
    if row.thesis_valid and trend_ok:   return "① 핵심유지/확대검토"
    if row.thesis_valid and not trend_ok: return "② 유지·손절선 재설정"
    if not row.thesis_valid and trend_ok: return "③ 관망(반등시 정리)"
    return "④ 청산1순위"
# 재매수 테스트는 사람에게 묻는 질문으로 대시보드에 노출(Y/N 기록)
```

### 8) 상관분석 (analysis/correlation.py)

완결 거래에 macro·context 를 join 한 하나의 wide 테이블을 만들어 분석한다.

```python
import statsmodels.api as sm
from sklearn.ensemble import GradientBoostingClassifier
def factor_report(df):     # df: return_pct, win, vix, volume_ratio, price_vs_ma20, emotion...
    # (a) 요인 구간별 평균 성과
    tbl = df.groupby(pd.qcut(df.vix, 3))["return_pct"].agg(["mean","count"])
    # (b) 승패에 대한 변수 중요도
    X = df[["vix","volume_ratio","price_vs_ma20","conviction"]].fillna(0)
    m = GradientBoostingClassifier().fit(X, df.win.astype(int))
    importance = dict(zip(X.columns, m.feature_importances_))
    return tbl, importance
```

표본이 30~50건 미만이면 상관은 참고만. 발견한 규칙은 가설로 두고 이후 거래로 검증한다.

### 9) 대시보드 (app/dashboard.py)

Streamlit 로 4개 화면: ① 포트폴리오 지표·트리아지 표, ② 손절/익절 성향 추세,
③ 요인별 성과·중요도, ④ "이 조건에선 매매 자제" 경고 카드.
`streamlit run app/dashboard.py` 로 로컬 실행.

### 10) 자동화

일 1회 배치로 macro/context 스냅샷과 지표를 갱신한다.

```python
from apscheduler.schedulers.blocking import BlockingScheduler
sched = BlockingScheduler()
@sched.scheduled_job("cron", hour=16)   # 장 마감 후
def daily(): update_holdings(); snapshot_macro(); recompute_metrics()
sched.start()
```

### 만들기 순서 (권장)

1. `db.py` + `trades.py` + `roundtrip.py` → 거래 기록·성과가 먼저 돈다.
2. `holdings.py` + `portfolio.py` + `triage.py` → 40종목 진단이 나온다(가장 급한 것).
3. `macro.py` + `context.py` → 스냅샷 축적 시작(빠를수록 데이터가 쌓임).
4. 30건 이상 쌓이면 `correlation.py` 가동.
5. `dashboard.py` 로 묶고 `APScheduler` 로 매일 자동 갱신.

---

## 설계 원칙 (잊지 말 것)

- 시점 박제: 매크로·시황은 반드시 **거래 시점** 값으로 저장 (사후조회 편향 차단).
- 판단·감정은 즉시 기록: 이 데이터가 없으면 상관분석의 절반이 무의미해진다.
- 계획가(목표·손절)는 매수 전에 입력: 손절이행/조기익절 판정의 근거.
- 표본이 최소 30~50 완결 거래는 쌓여야 상관관계가 신뢰할 만해진다.
- 상관 ≠ 인과: 발견한 규칙은 가설로 두고, 이후 거래로 검증한다.
