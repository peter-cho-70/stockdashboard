/** 차트 분석 신호 계산 — 한국주식_차트분석_실전가이드.md 기반 */

export interface ChartBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  ma5: number;
  ma20: number;
  ma60: number;
}

export type Sentiment = "bullish" | "bearish" | "neutral" | "warning";
export type MarketRegime = "bull" | "sideways" | "bear";

export interface ChartSignal {
  id: string;
  step: number;
  category: string;
  title: string;
  method: string;
  result: string;
  sentiment: Sentiment;
  passed: boolean;
  applicable: boolean;
}

export interface CheckItem {
  label: string;
  passed: boolean;
  unavailable?: boolean;
}

export interface StageCheck {
  label: string;
  items: CheckItem[];
  passed: number;
  total: number;
  available: boolean;
}

export interface ChartAnnotation {
  id: string;
  signalId: string;
  type: "area" | "line" | "dot";
  label: string;
  color: string;
  fillOpacity?: number;
  date?: string;
  dateStart?: string;
  dateEnd?: string;
  y?: number;
  y2?: number;
  strokeDasharray?: string;
  /** 급등·급락 이벤트 — AI 이슈 연동 */
  description?: string;
  changePct?: number;
  sourceUrl?: string | null;
  sourceTitle?: string | null;
  issueSentiment?: string;
  issueId?: number;
  matchedIssue?: boolean;
}

export interface EnrichedChartBar extends ChartBar {
  vol_k: number;
  bbUpper: number;
  bbLower: number;
  bbMiddle: number;
  volSpike: boolean;
  crossMarker: "gc" | "dc" | null;
  pullback: boolean;
}

export interface ChartAnalysisResult {
  regime: MarketRegime;
  regimeLabel: string;
  regimeHint: string;
  signals: ChartSignal[];
  annotations: ChartAnnotation[];
  support: number;
  resistance: number;
  stopLoss: { ma60: number | null; pct7: number | null; text: string };
  threeStage: {
    stage1: StageCheck;
    stage2: StageCheck;
    stage3: StageCheck;
    verdict: string;
    summary: string;
  };
}

export const ANNOTATION_LAYERS = [
  { id: "sr", label: "지지·저항", defaultOn: true },
  { id: "stop", label: "손절선", defaultOn: true },
  { id: "cross", label: "MA교차", defaultOn: true },
  { id: "pullback", label: "눌림목", defaultOn: true },
  { id: "bollinger", label: "볼린저", defaultOn: true },
  { id: "volume", label: "거래량", defaultOn: true },
  { id: "events", label: "급등·급락", defaultOn: true },
] as const;

export type AnnotationLayerId = (typeof ANNOTATION_LAYERS)[number]["id"];

function fmt(n: number) {
  return n.toLocaleString("ko-KR");
}

function ema(values: number[], period: number): number[] {
  if (values.length === 0) return [];
  const k = 2 / (period + 1);
  const result = [values[0]];
  for (let i = 1; i < values.length; i++) {
    result.push(values[i] * k + result[i - 1] * (1 - k));
  }
  return result;
}

function computeRsi(closes: number[], period = 14): number[] {
  const rsi: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < period) {
      rsi.push(50);
      continue;
    }
    let gains = 0;
    let losses = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const diff = closes[j] - closes[j - 1];
      if (diff >= 0) gains += diff;
      else losses -= diff;
    }
    const avgGain = gains / period;
    const avgLoss = losses / period;
    if (avgLoss === 0) rsi.push(100);
    else rsi.push(100 - 100 / (1 + avgGain / avgLoss));
  }
  return rsi;
}

function computeMacd(closes: number[]) {
  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);
  const macdLine = ema12.map((v, i) => v - ema26[i]);
  const signal = ema(macdLine, 9);
  const histogram = macdLine.map((v, i) => v - signal[i]);
  return { macdLine, signal, histogram };
}

function computeBollinger(closes: number[], period = 20, mult = 2) {
  const upper: number[] = [];
  const lower: number[] = [];
  const middle: number[] = [];
  const pctB: number[] = [];
  const bandwidth: number[] = [];

  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) {
      middle.push(closes[i]);
      upper.push(closes[i]);
      lower.push(closes[i]);
      pctB.push(0.5);
      bandwidth.push(0);
      continue;
    }
    const slice = closes.slice(i - period + 1, i + 1);
    const mean = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / period;
    const std = Math.sqrt(variance);
    const up = mean + mult * std;
    const lo = mean - mult * std;
    middle.push(mean);
    upper.push(up);
    lower.push(lo);
    pctB.push(up === lo ? 0.5 : (closes[i] - lo) / (up - lo));
    bandwidth.push(mean > 0 ? ((up - lo) / mean) * 100 : 0);
  }
  return { upper, lower, middle, pctB, bandwidth };
}

function detectMarketRegime(data: ChartBar[]): { regime: MarketRegime; label: string; hint: string } {
  if (data.length < 10) {
    return { regime: "sideways", label: "데이터 부족", hint: "추세 판단에 데이터가 부족합니다." };
  }
  const last = data[data.length - 1];
  const ma60Now = last.ma60;
  const ma60Prev = data[Math.max(0, data.length - 6)]?.ma60 ?? ma60Now;
  const ret3m =
    data.length >= 60
      ? ((last.close - data[data.length - 60].close) / data[data.length - 60].close) * 100
      : 0;

  if (last.close > ma60Now && ma60Now > ma60Prev && ret3m > 0) {
    return {
      regime: "bull",
      label: "강세 추세",
      hint: "RSI 70 돌파는 매도 신호가 아닌 추세 지속 신호일 수 있습니다. 눌림목 매수를 우선 검토하세요.",
    };
  }
  if (last.close < ma60Now && ma60Now < ma60Prev && ret3m < 0) {
    return {
      regime: "bear",
      label: "약세 추세",
      hint: "신규 매수를 자제하고, 현금 비중 확대를 검토하세요.",
    };
  }
  return {
    regime: "sideways",
    label: "횡보 구간",
    hint: "박스권 매매 또는 수급 이탈 종목에 주목하세요.",
  };
}

function analyzeTrend(data: ChartBar[]): ChartSignal {
  const last = data[data.length - 1];
  const { ma5, ma20, ma60, close } = last;

  if (!ma5 || !ma20 || !ma60) {
    return {
      id: "trend",
      step: 1,
      category: "추세",
      title: "이동평균 추세 (MA5/20/60)",
      method: "5>20>60 정배열은 상승 추세, 역배열은 하락 추세입니다.",
      result: "이동평균 데이터 부족",
      sentiment: "neutral",
      passed: false,
      applicable: false,
    };
  }

  const aligned = ma5 > ma20 && ma20 > ma60;
  const reverse = ma5 < ma20 && ma20 < ma60;
  const aboveMa60 = close > ma60;
  const pctAboveMa60 = ((close - ma60) / ma60) * 100;

  let result: string;
  let sentiment: Sentiment;
  let passed: boolean;

  if (aligned && aboveMa60) {
    result = `정배열 (MA5 ${fmt(ma5)} > MA20 ${fmt(ma20)} > MA60 ${fmt(ma60)}), 60일선 위 +${pctAboveMa60.toFixed(1)}%`;
    sentiment = "bullish";
    passed = true;
  } else if (reverse) {
    result = `역배열 — MA5 ${fmt(ma5)} < MA20 ${fmt(ma20)} < MA60 ${fmt(ma60)}`;
    sentiment = "bearish";
    passed = false;
  } else if (aboveMa60) {
    result = `혼조 — 60일선 위 (${fmt(close)} > ${fmt(ma60)})`;
    sentiment = "neutral";
    passed = true;
  } else {
    result = `60일선 아래 — 중기 추세 훼손 (${fmt(close)} < ${fmt(ma60)})`;
    sentiment = "bearish";
    passed = false;
  }

  return {
    id: "trend",
    step: 1,
    category: "추세",
    title: "이동평균 추세 (MA5/20/60)",
    method: "정배열 + 60일선 위 = 추세 추종 매수 유효. 60일선 이탈 시 비중 축소 검토.",
    result,
    sentiment,
    passed,
    applicable: true,
  };
}

function analyzeDisparity(data: ChartBar[]): ChartSignal {
  const last = data[data.length - 1];
  const d20 = last.ma20 > 0 ? (last.close / last.ma20) * 100 : 100;
  const d60 = last.ma60 > 0 ? (last.close / last.ma60) * 100 : 100;

  let sentiment: Sentiment = "neutral";
  let passed = true;
  let result = `20일 이격도 ${d20.toFixed(1)}%, 60일 이격도 ${d60.toFixed(1)}%`;

  if (d20 >= 105) {
    result += " — 20일 과매수 구간(105%+)";
    sentiment = "warning";
    passed = false;
  } else if (d20 <= 95) {
    result += " — 20일 과매도 구간(95%-)";
    sentiment = "bullish";
  } else if (d20 >= 102) {
    result += " — 과열 근접";
    sentiment = "warning";
  }

  return {
    id: "disparity",
    step: 1,
    category: "추세",
    title: "이격도 (20/60일)",
    method: "20일 105%↑ 과매수, 95%↓ 과매도. 강세장에서는 기준을 높게 잡으세요.",
    result,
    sentiment,
    passed,
    applicable: last.ma20 > 0,
  };
}

function analyzeMaCross(data: ChartBar[]): ChartSignal {
  if (data.length < 6) {
    return {
      id: "ma_cross",
      step: 1,
      category: "추세",
      title: "MA 골든/데드크로스",
      method: "5×20 교차는 단기, 20×60 교차는 중기 추세 전환 신호입니다.",
      result: "데이터 부족",
      sentiment: "neutral",
      passed: false,
      applicable: false,
    };
  }

  const recent = data.slice(-5);
  let gc5_20 = false;
  let dc5_20 = false;
  for (let i = 1; i < recent.length; i++) {
    const prev = recent[i - 1];
    const curr = recent[i];
    if (prev.ma5 <= prev.ma20 && curr.ma5 > curr.ma20) gc5_20 = true;
    if (prev.ma5 >= prev.ma20 && curr.ma5 < curr.ma20) dc5_20 = true;
  }

  let result: string;
  let sentiment: Sentiment;
  let passed: boolean;

  if (gc5_20) {
    result = "최근 5일 내 MA5×MA20 골든크로스 발생 — 거래량 동반 확인 필요";
    sentiment = "bullish";
    passed = true;
  } else if (dc5_20) {
    result = "최근 5일 내 MA5×MA20 데드크로스 발생 — 추세 약화 신호";
    sentiment = "bearish";
    passed = false;
  } else {
    const last = data[data.length - 1];
    result =
      last.ma5 > last.ma20
        ? `MA5 > MA20 유지 (${fmt(last.ma5)} > ${fmt(last.ma20)})`
        : `MA5 < MA20 (${fmt(last.ma5)} < ${fmt(last.ma20)})`;
    sentiment = last.ma5 > last.ma20 ? "bullish" : "bearish";
    passed = last.ma5 > last.ma20;
  }

  return {
    id: "ma_cross",
    step: 1,
    category: "추세",
    title: "MA 골든/데드크로스",
    method: "20×60 골든크로스(★★★★)가 가장 많이 사용됩니다. 거래량 동반 필수.",
    result,
    sentiment,
    passed,
    applicable: true,
  };
}

function analyzeMacd(data: ChartBar[]): ChartSignal {
  const closes = data.map((d) => d.close);
  if (closes.length < 30) {
    return {
      id: "macd",
      step: 3,
      category: "모멘텀",
      title: "MACD",
      method: "히스토그램 방향 전환이 MACD 크로스보다 빠른 선행 신호입니다.",
      result: "MACD 계산에 데이터 부족",
      sentiment: "neutral",
      passed: false,
      applicable: false,
    };
  }

  const { macdLine, histogram } = computeMacd(closes);
  const last = histogram.length - 1;
  const h0 = histogram[last];
  const h1 = histogram[last - 1];
  const h2 = histogram[last - 2];
  const macd0 = macdLine[last];

  let result: string;
  let sentiment: Sentiment;
  let passed: boolean;

  if (h0 > 0 && h0 > h1) {
    result = `히스토그램 양수 확대 (${h0.toFixed(0)}) — 상승 모멘텀 강화`;
    sentiment = "bullish";
    passed = true;
  } else if (h1 < 0 && h0 > h1 && h0 < 0) {
    result = "히스토그램 음수→줄어드는 중 — 하락 모멘텀 약화, 반등 준비";
    sentiment = "bullish";
    passed = true;
  } else if (h0 < 0 && h0 < h1) {
    result = `히스토그램 음수 확대 (${h0.toFixed(0)}) — 하락 모멘텀`;
    sentiment = "bearish";
    passed = false;
  } else if (h0 > 0 && h0 < h1) {
    result = "히스토그램 양수→줄어드는 중 — 상승 모멘텀 약화, 이익실현 준비";
    sentiment = "warning";
    passed = false;
  } else if (macd0 > 0) {
    result = `MACD 제로선 위 (${macd0.toFixed(0)}) — 상승 추세 유지`;
    sentiment = "bullish";
    passed = true;
  } else {
    result = `MACD 제로선 아래 (${macd0.toFixed(0)})`;
    sentiment = "bearish";
    passed = false;
  }

  return {
    id: "macd",
    step: 3,
    category: "모멘텀",
    title: "MACD",
    method: "제로선 위 골든크로스(★★★★★). 히스토그램 방향에 집중하세요.",
    result,
    sentiment,
    passed,
    applicable: true,
  };
}

function analyzeRsi(data: ChartBar[], regime: MarketRegime): ChartSignal {
  const closes = data.map((d) => d.close);
  const rsiArr = computeRsi(closes);
  const rsi = rsiArr[rsiArr.length - 1];

  let result: string;
  let sentiment: Sentiment;
  let passed: boolean;

  if (regime === "bull") {
    if (rsi >= 50 && rsi <= 75) {
      result = `RSI ${rsi.toFixed(1)} — 강세장 모멘텀 구간 (50~75)`;
      sentiment = "bullish";
      passed = true;
    } else if (rsi > 75) {
      result = `RSI ${rsi.toFixed(1)} — 강세장 과열 (80+), 추세 지속 가능 — 섣부른 매도 주의`;
      sentiment = "warning";
      passed = true;
    } else if (rsi >= 40 && rsi < 50) {
      result = `RSI ${rsi.toFixed(1)} — 적정 조정 구간, 눌림목 후보`;
      sentiment = "bullish";
      passed = true;
    } else {
      result = `RSI ${rsi.toFixed(1)} — 약세 신호`;
      sentiment = "bearish";
      passed = false;
    }
  } else if (regime === "bear") {
    if (rsi < 30) {
      result = `RSI ${rsi.toFixed(1)} — 약세장 과매도, 추가 하락 가능`;
      sentiment = "warning";
      passed = false;
    } else if (rsi > 60) {
      result = `RSI ${rsi.toFixed(1)} — 약세장 반등, 추가 하락 가능`;
      sentiment = "warning";
      passed = false;
    } else {
      result = `RSI ${rsi.toFixed(1)} — 약세장 중립`;
      sentiment = "neutral";
      passed = false;
    }
  } else {
    if (rsi >= 70) {
      result = `RSI ${rsi.toFixed(1)} — 횡보장 과매수, 차익실현 고려`;
      sentiment = "warning";
      passed = false;
    } else if (rsi <= 30) {
      result = `RSI ${rsi.toFixed(1)} — 횡보장 과매도, 분할 매수 고려`;
      sentiment = "bullish";
      passed = true;
    } else {
      result = `RSI ${rsi.toFixed(1)} — 중립 구간 (40~70)`;
      sentiment = "neutral";
      passed = rsi >= 45 && rsi <= 65;
    }
  }

  return {
    id: "rsi",
    step: 4,
    category: "과열",
    title: "RSI(14)",
    method: "70=매도, 30=매수는 위험한 오해. 시장 국면에 따라 해석이 달라집니다.",
    result,
    sentiment,
    passed,
    applicable: closes.length >= 15,
  };
}

function analyzeBollinger(data: ChartBar[]): ChartSignal {
  const closes = data.map((d) => d.close);
  if (closes.length < 25) {
    return {
      id: "bollinger",
      step: 5,
      category: "변동성",
      title: "볼린저밴드 (20/2σ)",
      method: "스퀴즈→방향 돌파, 밴드워크→추세 지속. %B로 위치 확인.",
      result: "데이터 부족",
      sentiment: "neutral",
      passed: false,
      applicable: false,
    };
  }

  const { upper, lower, middle, pctB, bandwidth } = computeBollinger(closes);
  const i = closes.length - 1;
  const close = closes[i];
  const mid = middle[i];
  const pb = pctB[i];
  const bw = bandwidth[i];
  const avgBw =
    bandwidth.slice(-20).reduce((a, b) => a + b, 0) / Math.min(20, bandwidth.length);
  const squeeze = bw < avgBw * 0.75;

  let result: string;
  let sentiment: Sentiment;
  let passed: boolean;

  if (squeeze) {
    result = `밴드 스퀴즈 (폭 ${bw.toFixed(1)}%) — 큰 움직임 예고, 방향은 MACD·RSI로 확인`;
    sentiment = "warning";
    passed = false;
  } else if (close > mid && pb > 0.8) {
    result = `%B ${(pb * 100).toFixed(0)}% — 상단밴드 근처, 밴드워크(강한 상승 추세)`;
    sentiment = "bullish";
    passed = true;
  } else if (close > mid) {
    result = `중심선(${fmt(mid)}) 위 — 상승 편향`;
    sentiment = "bullish";
    passed = true;
  } else if (close < lower[i]) {
    result = `%B ${(pb * 100).toFixed(0)}% — 하단밴드 이탈, 추세 훼손`;
    sentiment = "bearish";
    passed = false;
  } else {
    result = `중심선(${fmt(mid)}) 아래 — 하락 편향`;
    sentiment = "bearish";
    passed = false;
  }

  return {
    id: "bollinger",
    step: 5,
    category: "변동성",
    title: "볼린저밴드 (20/2σ)",
    method: "스퀴즈 단독으로는 방향 알 수 없음. 중심선(20일MA) 위/아래로 편향 판단.",
    result,
    sentiment,
    passed,
    applicable: true,
  };
}

function analyzeSupportResistance(data: ChartBar[], avgPrice: number): ChartSignal {
  const monthData = data.slice(-22);
  const support = Math.min(...monthData.map((d) => d.low));
  const resistance = Math.max(...monthData.map((d) => d.high));
  const close = data[data.length - 1].close;
  const range = resistance - support;
  const pos = range > 0 ? ((close - support) / range) * 100 : 50;

  let result = `1M 지지 ${fmt(support)}원 · 저항 ${fmt(resistance)}원 · 현재 ${pos.toFixed(0)}% 구간`;
  let sentiment: Sentiment = "neutral";
  let passed = true;

  if (avgPrice > 0) {
    if (close > avgPrice) {
      result += ` · 평균단가(${fmt(avgPrice)}) 위 — 수익 구간`;
    } else {
      result += ` · 평균단가(${fmt(avgPrice)}) 아래 — 손실 구간`;
      sentiment = "warning";
      passed = false;
    }
  }

  if (pos > 85) {
    result += " — 저항선 근접";
    sentiment = "warning";
  } else if (pos < 15) {
    result += " — 지지선 근접";
    sentiment = "bullish";
  }

  return {
    id: "sr",
    step: 6,
    category: "지지/저항",
    title: "지지·저항 (1M)",
    method: "52주 고저·라운드피겨·이전 고저점이 심리적 기준선입니다.",
    result,
    sentiment,
    passed,
    applicable: monthData.length > 0,
  };
}

function analyzeVolume(data: ChartBar[]): ChartSignal {
  if (data.length < 21) {
    return {
      id: "volume",
      step: 7,
      category: "거래량",
      title: "거래량 분석",
      method: "가격 방향과 거래량 변화를 함께 봅니다. 거래량은 추세의 신뢰도를 확인합니다.",
      result: "데이터 부족",
      sentiment: "neutral",
      passed: false,
      applicable: false,
    };
  }

  const last = data[data.length - 1];
  const prev = data[data.length - 2];
  const avg20 = data.slice(-21, -1).reduce((a, d) => a + d.volume, 0) / 20;
  const recent3 = data.slice(-3).reduce((a, d) => a + d.volume, 0) / 3;
  const priceUp = last.close > prev.close;
  const volUp = last.volume > prev.volume;
  const volRatio = avg20 > 0 ? last.volume / avg20 : 1;
  const recentRatio = avg20 > 0 ? recent3 / avg20 : 1;

  let result: string;
  let sentiment: Sentiment;
  let passed: boolean;

  if (priceUp && volUp && volRatio >= 1) {
    result = `상승 + 거래량 증가 (${(volRatio * 100).toFixed(0)}% of 20일 평균) — 신뢰 높은 상승`;
    sentiment = "bullish";
    passed = true;
  } else if (priceUp && !volUp) {
    result = "상승 + 거래량 감소 — 힘이 빠진 상승, 조정 가능";
    sentiment = "warning";
    passed = false;
  } else if (!priceUp && volUp && volRatio >= 1.5) {
    result = `하락 + 거래량 급증 (${(volRatio * 100).toFixed(0)}%) — 강한 매도세`;
    sentiment = "bearish";
    passed = false;
  } else if (!priceUp && !volUp) {
    result = "하락 + 거래량 감소 — 약한 조정, 반등 가능";
    sentiment = "neutral";
    passed = true;
  } else if (recentRatio >= 1.5) {
    result = `최근 3일 거래량 평균 ${(recentRatio * 100).toFixed(0)}% of 20일 — 관심 증가`;
    sentiment = "bullish";
    passed = true;
  } else {
    result = `거래량 ${(volRatio * 100).toFixed(0)}% of 20일 평균 — 보통`;
    sentiment = "neutral";
    passed = volRatio >= 0.8;
  }

  return {
    id: "volume",
    step: 7,
    category: "거래량",
    title: "거래량 분석",
    method: "20일 평균 2배↑ 급증은 특이 신호. 상승+거래량↑ = 정상적 상승 추세.",
    result,
    sentiment,
    passed,
    applicable: true,
  };
}

function analyzePullback(data: ChartBar[], regime: MarketRegime): ChartSignal {
  const last = data[data.length - 1];
  const closes = data.map((d) => d.close);
  const rsiArr = computeRsi(closes);
  const rsi = rsiArr[rsiArr.length - 1];
  const { histogram } = computeMacd(closes);
  const h0 = histogram[histogram.length - 1];
  const h1 = histogram[histogram.length - 2];

  const nearMa20 =
    last.ma20 > 0 && Math.abs(last.close - last.ma20) / last.ma20 < 0.02;
  const aboveMa60 = last.close > last.ma60;
  const volDeclining =
    data.length >= 4 &&
    data[data.length - 1].volume < data[data.length - 3].volume;
  const rsiOk = rsi >= 40 && rsi <= 55;
  const macdRecover = h1 < 0 && h0 > h1;

  const checks = [
    regime === "bull" || aboveMa60,
    nearMa20,
    volDeclining,
    rsiOk,
    macdRecover,
  ];
  const count = checks.filter(Boolean).length;

  return {
    id: "pullback",
    step: 1,
    category: "전략",
    title: "눌림목 매수 조건",
    method: "상승 추세 중 20일선 눌림 + 거래량 감소 + RSI 40~50 = 안정적 매수법.",
    result:
      count >= 4
        ? `눌림목 조건 ${count}/5 충족 — 20일선 지지 확인 후 소량 매수 검토`
        : count >= 3
          ? `눌림목 조건 ${count}/5 — 일부 충족, 추가 확인 필요`
          : `눌림목 조건 ${count}/5 — 해당 없음`,
    sentiment: count >= 4 ? "bullish" : count >= 3 ? "neutral" : "neutral",
    passed: count >= 4,
    applicable: data.length >= 30,
  };
}

function buildThreeStage(
  technicalSignals: ChartSignal[],
  regime: MarketRegime
): ChartAnalysisResult["threeStage"] {
  const techApplicable = technicalSignals.filter((s) => s.applicable);
  const techPassed = techApplicable.filter((s) => s.passed);

  const stage3Items: CheckItem[] = [
    { label: "이동평균 정배열 (5>20>60)", passed: technicalSignals.find((s) => s.id === "trend")?.passed ?? false },
    { label: "60일선 위", passed: (() => {
      const t = technicalSignals.find((s) => s.id === "trend");
      return t?.result.includes("60일선 위") || t?.result.includes("정배열") || false;
    })() },
    { label: "MACD 히스토그램 양수 방향", passed: technicalSignals.find((s) => s.id === "macd")?.passed ?? false },
    { label: "RSI 모멘텀 구간", passed: technicalSignals.find((s) => s.id === "rsi")?.passed ?? false },
    { label: "볼린저 중심선 위", passed: technicalSignals.find((s) => s.id === "bollinger")?.passed ?? false },
    { label: "거래량 20일 평균 이상", passed: technicalSignals.find((s) => s.id === "volume")?.passed ?? false },
  ];

  const stage3Passed = stage3Items.filter((i) => i.passed).length;

  const stage1: StageCheck = {
    label: "시장·섹터 확인",
    available: false,
    passed: 0,
    total: 3,
    items: [
      { label: "코스피/코스닥 주봉 상승 추세", passed: false, unavailable: true },
      { label: "해당 섹터 최근 강세", passed: false, unavailable: true },
      { label: "미국 시장(나스닥) 상승 추세", passed: false, unavailable: true },
    ],
  };

  const stage2: StageCheck = {
    label: "수급 확인 (가장 중요)",
    available: false,
    passed: 0,
    total: 3,
    items: [
      { label: "외국인 3일 이상 연속 순매수", passed: false, unavailable: true },
      { label: "기관 동반 순매수", passed: false, unavailable: true },
      { label: "공매도 비중 5% 이하", passed: false, unavailable: true },
    ],
  };

  const stage3: StageCheck = {
    label: "기술적 확인",
    available: true,
    passed: stage3Passed,
    total: stage3Items.length,
    items: stage3Items,
  };

  let verdict: string;
  let summary: string;

  if (stage3Passed >= 5) {
    verdict = "기술 양호 — 수급 확인 후 검토";
    summary = `기술 ${stage3Passed}/${stage3Items.length} 통과. 수급(KIS API) 미연동 — 실매매 전 외국인·기관 순매수를 반드시 확인하세요.`;
  } else if (stage3Passed >= 3) {
    verdict = "기술 일부 충족 — 관망";
    summary = `기술 ${stage3Passed}/${stage3Items.length} 통과. 추가 확인 후 소량 검토 가능.`;
  } else {
    verdict = "기술 미충족 — 진입 보류";
    summary = `기술 ${stage3Passed}/${stage3Items.length} 통과. 현재 차트만으로는 매수 근거 부족.`;
  }

  if (regime === "bear") {
    summary += " 약세 추세 — 신규 매수 자제 권장.";
  }

  return { stage1, stage2, stage3, verdict, summary };
}

function findMaCrossEvents(data: ChartBar[]): { date: string; type: "gc" | "dc"; y: number; label: string }[] {
  const events: { date: string; type: "gc" | "dc"; y: number; label: string }[] = [];
  for (let i = 1; i < data.length; i++) {
    const prev = data[i - 1];
    const curr = data[i];
    if (prev.ma5 <= prev.ma20 && curr.ma5 > curr.ma20) {
      events.push({ date: curr.date, type: "gc", y: curr.close, label: "GC" });
    }
    if (prev.ma5 >= prev.ma20 && curr.ma5 < curr.ma20) {
      events.push({ date: curr.date, type: "dc", y: curr.close, label: "DC" });
    }
    if (prev.ma20 <= prev.ma60 && curr.ma20 > curr.ma60) {
      events.push({ date: curr.date, type: "gc", y: curr.close, label: "GC20×60" });
    }
  }
  return events;
}

function findPullbackRanges(
  data: ChartBar[],
  visibleDates: Set<string>
): { dateStart: string; dateEnd: string; y: number; y2: number }[] {
  const ranges: { dateStart: string; dateEnd: string; y: number; y2: number }[] = [];
  let start: string | null = null;
  let end: string | null = null;
  let bandLow = 0;
  let bandHigh = 0;

  const flush = () => {
    if (start && end && visibleDates.has(start)) {
      ranges.push({ dateStart: start, dateEnd: end, y: bandLow, y2: bandHigh });
    }
    start = null;
    end = null;
  };

  for (const d of data) {
    if (!visibleDates.has(d.date) || d.ma20 <= 0) continue;
    const nearMa20 = Math.abs(d.close - d.ma20) / d.ma20 < 0.025;
    const uptrend = d.ma5 > d.ma20 && d.close > d.ma60;
    if (nearMa20 && uptrend) {
      const lo = d.ma20 * 0.98;
      const hi = d.ma20 * 1.02;
      if (!start) {
        start = d.date;
        bandLow = lo;
        bandHigh = hi;
      } else {
        bandLow = Math.min(bandLow, lo);
        bandHigh = Math.max(bandHigh, hi);
      }
      end = d.date;
    } else if (start) {
      flush();
    }
  }
  flush();
  return ranges;
}

export function buildChartAnnotations(
  data: ChartBar[],
  visibleDates: string[],
  support: number,
  resistance: number,
  stopLoss: ChartAnalysisResult["stopLoss"]
): ChartAnnotation[] {
  if (data.length === 0 || visibleDates.length === 0) return [];

  const visibleSet = new Set(visibleDates);
  const dateStart = visibleDates[0];
  const dateEnd = visibleDates[visibleDates.length - 1];
  const annotations: ChartAnnotation[] = [];

  annotations.push({
    id: "sr-zone",
    signalId: "sr",
    type: "area",
    label: "지지·저항 구간",
    color: "#6366f1",
    fillOpacity: 0.06,
    dateStart,
    dateEnd,
    y: support,
    y2: resistance,
  });

  annotations.push({
    id: "sr-support",
    signalId: "sr",
    type: "line",
    label: "지지",
    color: "#10b981",
    y: support,
    strokeDasharray: "3 3",
  });

  annotations.push({
    id: "sr-resistance",
    signalId: "sr",
    type: "line",
    label: "저항",
    color: "#f97316",
    y: resistance,
    strokeDasharray: "3 3",
  });

  if (stopLoss.ma60) {
    annotations.push({
      id: "stop-ma60",
      signalId: "stop",
      type: "line",
      label: "손절(60일)",
      color: "#a855f7",
      y: stopLoss.ma60,
      strokeDasharray: "6 3",
    });
  }
  if (stopLoss.pct7) {
    annotations.push({
      id: "stop-pct7",
      signalId: "stop",
      type: "line",
      label: "손절(-7%)",
      color: "#dc2626",
      y: stopLoss.pct7,
      strokeDasharray: "6 3",
    });
  }

  for (const ev of findMaCrossEvents(data)) {
    if (!visibleSet.has(ev.date)) continue;
    annotations.push({
      id: `cross-${ev.date}-${ev.label}`,
      signalId: "ma_cross",
      type: "dot",
      label: ev.label,
      color: ev.type === "gc" ? "#10b981" : "#ef4444",
      date: ev.date,
      y: ev.y,
    });
  }

  for (const [i, range] of findPullbackRanges(data, visibleSet).entries()) {
    annotations.push({
      id: `pullback-${i}`,
      signalId: "pullback",
      type: "area",
      label: "눌림목",
      color: "#3b82f6",
      fillOpacity: 0.12,
      dateStart: range.dateStart,
      dateEnd: range.dateEnd,
      y: range.y,
      y2: range.y2,
    });
  }

  return annotations;
}

export function enrichChartBars(data: ChartBar[], displayCount = 22): EnrichedChartBar[] {
  const closes = data.map((d) => d.close);
  const bb = computeBollinger(closes);
  const displayStart = Math.max(0, data.length - displayCount);

  return data.slice(displayStart).map((d, sliceIdx) => {
    const i = displayStart + sliceIdx;
    const avg20 =
      i >= 20
        ? data.slice(i - 20, i).reduce((a, b) => a + b.volume, 0) / 20
        : d.volume;
    const volSpike = avg20 > 0 && d.volume >= avg20 * 1.5;

    let crossMarker: "gc" | "dc" | null = null;
    if (i >= 1) {
      const prev = data[i - 1];
      if (prev.ma5 <= prev.ma20 && d.ma5 > d.ma20) crossMarker = "gc";
      else if (prev.ma5 >= prev.ma20 && d.ma5 < d.ma20) crossMarker = "dc";
    }

    const pullback =
      d.ma20 > 0 &&
      Math.abs(d.close - d.ma20) / d.ma20 < 0.025 &&
      d.ma5 > d.ma20 &&
      d.close > d.ma60;

    return {
      ...d,
      vol_k: Math.round(d.volume / 1000),
      bbUpper: bb.upper[i],
      bbLower: bb.lower[i],
      bbMiddle: bb.middle[i],
      volSpike,
      crossMarker,
      pullback,
    };
  });
}

export function filterAnnotations(
  annotations: ChartAnnotation[],
  layers: Record<AnnotationLayerId, boolean>,
  activeSignalId: string | null
): ChartAnnotation[] {
  const layerForSignal: Record<string, AnnotationLayerId> = {
    sr: "sr",
    stop: "stop",
    ma_cross: "cross",
    pullback: "pullback",
    bollinger: "bollinger",
    volume: "volume",
    events: "events",
  };

  return annotations.filter((a) => {
    const layer = layerForSignal[a.signalId];
    if (layer && !layers[layer]) return false;
    if (activeSignalId && a.signalId !== activeSignalId) return false;
    return true;
  });
}

export function analyzeChart(
  data: ChartBar[],
  avgPrice: number,
  _currentPrice: number
): ChartAnalysisResult | null {
  if (!data || data.length < 5) return null;

  const { regime, label: regimeLabel, hint: regimeHint } = detectMarketRegime(data);

  const signals: ChartSignal[] = [
    analyzeTrend(data),
    analyzeDisparity(data),
    analyzeMaCross(data),
    analyzeMacd(data),
    analyzeRsi(data, regime),
    analyzeBollinger(data),
    analyzeSupportResistance(data, avgPrice),
    analyzeVolume(data),
    analyzePullback(data, regime),
  ];

  const monthData = data.slice(-22);
  const support = Math.min(...monthData.map((d) => d.low));
  const resistance = Math.max(...monthData.map((d) => d.high));
  const close = data[data.length - 1].close;
  const ma60 = data[data.length - 1].ma60;
  const pct7 = close * 0.93;

  const stopParts: string[] = [];
  if (ma60 > 0) stopParts.push(`60일선 ${fmt(ma60)}원`);
  stopParts.push(`매수가 -7% (${fmt(Math.round(pct7))}원)`);

  const threeStage = buildThreeStage(signals, regime);
  const stopLoss = {
    ma60: ma60 > 0 ? ma60 : null,
    pct7: Math.round(pct7),
    text: stopParts.join(" · "),
  };
  const visibleDates = monthData.map((d) => d.date);
  const annotations = buildChartAnnotations(data, visibleDates, support, resistance, stopLoss);

  return {
    regime,
    regimeLabel,
    regimeHint,
    signals,
    annotations,
    support,
    resistance,
    stopLoss,
    threeStage,
  };
}

// ── 급등·급락 탐지 + AI 이슈 매칭 ─────────────────

export interface IssueForMatch {
  id: number;
  issue_summary: string;
  sentiment: string;
  source_type: string | null;
  source_url: string | null;
  source_title: string | null;
  created_at: string;
  analyzed_at?: string | null;
  published_at?: string | null;
  event_date?: string | null;
  match_source?: string | null;
}

export interface SignificantMove {
  date: string;
  changePct: number;
  direction: "up" | "down";
  close: number;
  volumeRatio: number;
  reason: string;
  issueId?: number;
  sourceUrl?: string | null;
  sourceTitle?: string | null;
  sentiment?: string;
  matchedIssue: boolean;
  /** 차트에 Intel 이슈가 strong 날짜 매칭된 경우만 true */
  issueMatchQuality?: "strong" | null;
  causeSource?: "intel" | "sector" | "macro" | "ai_search" | "none";
  signalId?: string;
  relatedCount?: number;
  savedCauseId?: number;
  confidence?: string | null;
}

export interface SavedMoveCause {
  id: number;
  event_date: string;
  change_pct: number;
  direction: "up" | "down";
  close_price: number | null;
  reason: string;
  sentiment: string;
  key_factors: string[];
  source_urls: string[];
  confidence: string | null;
  analysis_provider: string | null;
}

const MOVE_THRESHOLD_PCT = 5;
const MOVE_VOL_MIN_PCT = 3;
const MOVE_VOL_SPIKE_RATIO = 1.8;
/** 차트 급등락 ↔ Intel 이슈 연결 허용 일수 (분석 실행일 제외, 이벤트 날짜만) */
const ISSUE_CHART_DATE_WINDOW_DAYS = 3;
/** @deprecated 섹터/매크로 공유 신호용 */
const ISSUE_DATE_WINDOW_DAYS = 7;

function parseYmd(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function daysBetween(a: string, b: string): number {
  const ms = Math.abs(parseYmd(a).getTime() - parseYmd(b).getTime());
  return Math.round(ms / (1000 * 60 * 60 * 24));
}

function parseDatesFromText(text: string, refYear?: number): string[] {
  if (!text) return [];
  const year = refYear ?? new Date().getFullYear();
  const found = new Set<string>();

  for (const m of text.matchAll(/(20\d{2})[-./](\d{1,2})[-./](\d{1,2})/g)) {
    found.add(`${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`);
  }
  for (const m of text.matchAll(/(\d{1,2})월\s*(\d{1,2})일/g)) {
    found.add(`${year}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`);
  }
  return [...found];
}

function avgVolume(data: ChartBar[], endIndex: number, period = 20): number {
  const start = Math.max(0, endIndex - period);
  const slice = data.slice(start, endIndex);
  if (slice.length === 0) return 0;
  return slice.reduce((s, d) => s + d.volume, 0) / slice.length;
}

function defaultMoveReason(move: Omit<SignificantMove, "reason" | "matchedIssue">): string {
  const dir = move.direction === "up" ? "급등" : "급락";
  const vol = move.volumeRatio >= MOVE_VOL_SPIKE_RATIO ? " · 거래량 급증" : "";
  return `일간 ${move.changePct >= 0 ? "+" : ""}${move.changePct.toFixed(1)}% ${dir}${vol} (AI 이슈 미연결)`;
}

/** 차트 데이터에서 큰 폭 등락 구간 탐지 */
export function detectSignificantMoves(data: ChartBar[]): Omit<SignificantMove, "reason" | "matchedIssue">[] {
  if (data.length < 2) return [];

  const raw: Omit<SignificantMove, "reason" | "matchedIssue">[] = [];

  for (let i = 1; i < data.length; i++) {
    const prev = data[i - 1];
    const bar = data[i];
    if (prev.close <= 0) continue;

    const changePct = ((bar.close - prev.close) / prev.close) * 100;
    const avgVol = avgVolume(data, i);
    const volumeRatio = avgVol > 0 ? bar.volume / avgVol : 1;

    const isBig = Math.abs(changePct) >= MOVE_THRESHOLD_PCT;
    const isVolMove =
      Math.abs(changePct) >= MOVE_VOL_MIN_PCT && volumeRatio >= MOVE_VOL_SPIKE_RATIO;

    if (!isBig && !isVolMove) continue;

    raw.push({
      date: bar.date,
      changePct,
      direction: changePct >= 0 ? "up" : "down",
      close: bar.close,
      volumeRatio,
    });
  }

  // 인접 3일 이내 동일 방향 — 최대 변동폭만 유지
  const deduped: typeof raw = [];
  for (const m of raw) {
    const last = deduped[deduped.length - 1];
    if (
      last &&
      last.direction === m.direction &&
      daysBetween(last.date, m.date) <= 2 &&
      Math.abs(m.changePct) <= Math.abs(last.changePct)
    ) {
      continue;
    }
    if (
      last &&
      last.direction === m.direction &&
      daysBetween(last.date, m.date) <= 2 &&
      Math.abs(m.changePct) > Math.abs(last.changePct)
    ) {
      deduped.pop();
    }
    deduped.push(m);
  }

  return deduped;
}

export interface SharedSignalForMatch {
  type: "sector" | "macro";
  id: number;
  event_date: string | null;
  summary: string | null;
  sentiment: string | null;
  label: string;
  source_url?: string | null;
  source_title?: string | null;
  channel_name?: string | null;
}

/** 섹터·매크로 공유 신호를 급등·급락 날짜에 매칭 (종목 직접 이슈 다음 우선) */
export function enrichMovesWithSharedSignals(
  moves: SignificantMove[],
  sectorSignals: SharedSignalForMatch[],
  macroSignals: SharedSignalForMatch[],
  windowDays = ISSUE_DATE_WINDOW_DAYS,
): SignificantMove[] {
  return moves.map((move) => {
    if (move.matchedIssue || move.causeSource === "ai_search") return move;

    let best: SharedSignalForMatch | null = null;
    let bestDist = windowDays + 1;
    let bestType: "sector" | "macro" = "sector";

    for (const s of sectorSignals) {
      if (!s.event_date || !s.summary?.trim()) continue;
      const dist = daysBetween(s.event_date, move.date);
      if (dist <= windowDays && dist < bestDist) {
        bestDist = dist;
        best = s;
        bestType = "sector";
      }
    }

    if (!best) {
      for (const m of macroSignals) {
        if (!m.event_date || !m.summary?.trim()) continue;
        const dist = daysBetween(m.event_date, move.date);
        if (dist <= windowDays && dist < bestDist) {
          bestDist = dist;
          best = m;
          bestType = "macro";
        }
      }
    }

    if (!best) return move;

    const prefix = bestType === "sector" ? "섹터" : "매크로";
    const titleParts = [`[${prefix}] ${best.label}`];
    if (best.event_date) titleParts.push(best.event_date);
    if (best.channel_name) titleParts.push(best.channel_name);
    else if (best.source_title) titleParts.push(best.source_title);

    return {
      ...move,
      reason: best.summary!,
      sentiment: best.sentiment ?? move.sentiment,
      sourceUrl: best.source_url ?? move.sourceUrl,
      sourceTitle: titleParts.join(" · "),
      matchedIssue: false,
      causeSource: bestType,
      signalId: `${bestType}-${best.id}`,
    };
  });
}

/** 차트 연결용 날짜 후보 (분석 실행일·created_at 제외) */
export function issueChartDateCandidates(issue: IssueForMatch, refYear: number): string[] {
  const dates = new Set<string>();
  if (issue.event_date) {
    dates.add(issue.event_date.slice(0, 10));
    return [...dates];
  }
  if (issue.published_at) {
    dates.add(issue.published_at.slice(0, 10));
  }
  for (const d of parseDatesFromText(issue.issue_summary, refYear)) dates.add(d);
  for (const d of parseDatesFromText(issue.source_title ?? "", refYear)) dates.add(d);
  return [...dates];
}

/** Intel 이슈를 급등·급락 날짜에 매칭 (이벤트 날짜 있는 경우만 차트 표시) */
export function enrichMovesWithIssues(
  moves: Omit<SignificantMove, "reason" | "matchedIssue">[],
  issues: IssueForMatch[],
): SignificantMove[] {
  return moves.map((move) => {
    const refYear = parseInt(move.date.slice(0, 4), 10);
    let bestIssue: IssueForMatch | null = null;
    let bestDist = ISSUE_CHART_DATE_WINDOW_DAYS + 1;

    for (const issue of issues) {
      const candidates = issueChartDateCandidates(issue, refYear);
      if (candidates.length === 0) continue;

      for (const cd of candidates) {
        const dist = daysBetween(cd, move.date);
        if (dist <= ISSUE_CHART_DATE_WINDOW_DAYS && dist < bestDist) {
          bestDist = dist;
          bestIssue = issue;
        }
      }
    }

    if (bestIssue) {
      return {
        ...move,
        reason: bestIssue.issue_summary,
        issueId: bestIssue.id,
        sourceUrl: bestIssue.source_url,
        sourceTitle: bestIssue.source_title,
        sentiment: bestIssue.sentiment,
        matchedIssue: true,
        issueMatchQuality: "strong",
        causeSource: "intel" as const,
      };
    }

    return {
      ...move,
      reason: defaultMoveReason(move),
      matchedIssue: false,
      issueMatchQuality: null,
      causeSource: "none" as const,
    };
  });
}

/** 타임라인: 차트 strong 매칭 여부 */
export function isIssueChartLinked(
  issue: IssueForMatch,
  moves: SignificantMove[],
): boolean {
  const linked = moves.find((m) => m.issueId === issue.id && m.issueMatchQuality === "strong");
  return !!linked;
}

/** 저장된 AI 원인을 급변 구간에 반영 */
export function applySavedCauseToMove(move: SignificantMove, saved: SavedMoveCause): SignificantMove {
  const firstUrl = saved.source_urls?.[0] ?? null;
  const factorHint = saved.key_factors?.[0];
  const causeSource =
    saved.analysis_provider === "sector_reuse" ? ("sector" as const)
    : saved.analysis_provider === "macro_reuse" ? ("macro" as const)
    : ("ai_search" as const);
  return {
    ...move,
    reason: saved.reason,
    sentiment: saved.sentiment,
    sourceUrl: firstUrl,
    sourceTitle: factorHint ?? (saved.confidence ? `신뢰도 ${saved.confidence}` : "AI 원인 검색"),
    matchedIssue: false,
    causeSource,
    savedCauseId: saved.id,
    confidence: saved.confidence,
  };
}

/** 저장된 AI 원인 검색 결과를 미매칭 급변 구간에 연결 */
export function enrichMovesWithSavedCauses(
  moves: SignificantMove[],
  causes: SavedMoveCause[],
  aiOverrideDates?: Record<string, boolean>,
): SignificantMove[] {
  if (causes.length === 0) return moves;
  const byDate = Object.fromEntries(causes.map((c) => [c.event_date, c]));

  return moves.map((move) => {
    const saved = byDate[move.date];
    const forceAi = aiOverrideDates?.[move.date];
    if (!saved) return move;
    if (forceAi) return applySavedCauseToMove(move, saved);
    if (move.matchedIssue || move.causeSource === "sector" || move.causeSource === "macro") return move;
    return applySavedCauseToMove(move, saved);
  });
}

export function buildPriceEventAnnotations(
  moves: SignificantMove[],
  visibleDates: string[],
): ChartAnnotation[] {
  const visible = new Set(visibleDates);
  return moves
    .filter((m) => visible.has(m.date))
    .map((m) => ({
      id: `event-${m.date}-${m.direction}`,
      signalId: "events",
      type: "dot" as const,
      label: `${m.changePct >= 0 ? "+" : ""}${m.changePct.toFixed(1)}%`,
      color: m.direction === "up" ? "#059669" : "#dc2626",
      date: m.date,
      y: m.close,
      description: m.reason,
      changePct: m.changePct,
      sourceUrl: m.sourceUrl,
      sourceTitle: m.sourceTitle,
      issueSentiment: m.sentiment,
      issueId: m.issueId,
      matchedIssue: m.matchedIssue,
    }));
}

/** 급변 구간 — 최신 날짜 우선 */
export function sortMovesNewestFirst(moves: SignificantMove[]): SignificantMove[] {
  return [...moves].sort((a, b) => b.date.localeCompare(a.date));
}

/** 탐지 → 이슈 매칭 → 공유 신호 → 저장된 AI 원인 → 차트 annotation 일괄 처리 */
export function buildPriceEventsFromChart(
  data: ChartBar[],
  issues: IssueForMatch[],
  visibleDates?: string[],
  savedCauses: SavedMoveCause[] = [],
  sharedSectorSignals: SharedSignalForMatch[] = [],
  sharedMacroSignals: SharedSignalForMatch[] = [],
  aiOverrideDates?: Record<string, boolean>,
): { moves: SignificantMove[]; annotations: ChartAnnotation[] } {
  const dates = visibleDates ?? data.map((d) => d.date);
  const withIssues = enrichMovesWithIssues(detectSignificantMoves(data), issues);
  const withShared = enrichMovesWithSharedSignals(withIssues, sharedSectorSignals, sharedMacroSignals);
  const moves = sortMovesNewestFirst(enrichMovesWithSavedCauses(withShared, savedCauses, aiOverrideDates));
  const annotations = buildPriceEventAnnotations(moves, dates);
  return { moves, annotations };
}
