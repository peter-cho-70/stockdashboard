/** 한국주식_차트분석_실전가이드.md 요약 — 분석 패널 정적 가이드 */

export const CHART_DISCLAIMER =
  "본 분석은 참고용 정보이며 투자 결정의 근거가 될 수 없습니다. 모든 투자 손익의 책임은 투자자 본인에게 있습니다.";

export const GUIDE_SECTIONS: Record<
  string,
  { title: string; body: string; source: string }
> = {
  trend: {
    title: "1단계: 추세 — 이동평균선",
    source: "§3",
    body:
      "5>20>60>120 정배열 = 상승 추세. 20일선 눌림 = 매수 타이밍. 60일선 이탈 = 비중 축소. 20×60 골든크로스는 중기 추세 전환 신호(★★★★).",
  },
  supply: {
    title: "2단계: 수급 — 한국 시장 핵심",
    source: "§4",
    body:
      "외국인+기관 동반 순매수 = 최강 신호. 3일 이상 연속 순매수 = 추세적 매수. 개인만 순매수 = 단기 고점 경계. 기술 지표가 좋아도 수급 미통과 시 진입 보류.",
  },
  macd: {
    title: "3단계: 모멘텀 — MACD",
    source: "§5",
    body:
      "히스토그램 방향 전환이 MACD 크로스보다 빠릅니다. 제로선 위 골든크로스(★★★★★). 음수→줄어듦 = 반등 준비, 양수→줄어듦 = 이익실현 준비.",
  },
  rsi: {
    title: "4단계: 과열 — RSI",
    source: "§6",
    body:
      "RSI 70=매도, 30=매수는 위험한 오해. 강세장: RSI 70+ = 추세 지속. 횡보: 70=차익실현, 30=분할매수. 약세: 30- = 추가 하락 가능.",
  },
  bollinger: {
    title: "5단계: 변동성 — 볼린저밴드",
    source: "§7",
    body:
      "스퀴즈(밴드 수축) = 큰 움직임 예고(방향은 다른 지표로). 밴드워크 = 강한 추세 지속. %B>1 = 상단 돌파, 중심선(20일MA) 위/아래로 편향 판단.",
  },
  sr: {
    title: "6단계: 지지·저항",
    source: "§8",
    body:
      "52주 고저·라운드피겨·이전 고저점 = 심리적 기준선. 지지선 이탈 → 저항으로 전환. 평균단가 = 내 매수 기준선.",
  },
  volume: {
    title: "7단계: 거래량",
    source: "§9",
    body:
      "상승+거래량↑ = 신뢰 높은 상승. 상승+거래량↓ = 조정 가능. 20일 평균 2배↑ = 특이 신호. 거래량은 추세의 신뢰도를 확인합니다.",
  },
  three_stage: {
    title: "3단계 확인법",
    source: "§10",
    body:
      "① 시장·섹터 ② 수급(최중요) ③ 기술 — 3단계 모두 통과 시 적극 검토. 2단계 미통과 = 진입 보류(기술 좋아도).",
  },
};

export const ANALYSIS_STEPS = [
  { step: 1, key: "trend", label: "추세 (MA·이격도)" },
  { step: 2, key: "supply", label: "수급 (KIS 연동)" },
  { step: 3, key: "macd", label: "MACD" },
  { step: 4, key: "rsi", label: "RSI" },
  { step: 5, key: "bollinger", label: "볼린저밴드" },
  { step: 6, key: "sr", label: "지지·저항" },
  { step: 7, key: "volume", label: "거래량" },
] as const;
