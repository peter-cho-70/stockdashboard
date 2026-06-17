import type { StockInvestmentInfo } from "@/lib/api";

/** "28.01배", "12,372원", "47.60%" 등에서 숫자 추출 */
export function parseMetricNumber(raw?: string | null): number | null {
  if (!raw?.trim()) return null;
  const match = raw.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const n = parseFloat(match[0]);
  return Number.isFinite(n) ? n : null;
}

export const VALUATION_DEFINITIONS: Record<string, string> = {
  "PER · EPS":
    "PER(주가수익비율)은 주가를 EPS로 나눈 값으로, 이익 대비 주가가 몇 배인지 보여줍니다. EPS는 1주당 순이익(원)입니다.",
  "추정 PER · EPS":
    "애널리스트 컨센서스 기준으로 앞으로 예상되는 PER·EPS입니다. 실적 전망이 반영된 참고치입니다.",
  "PBR · BPS":
    "PBR(주가순자산비율)은 주가를 BPS로 나눈 값입니다. BPS는 1주당 순자산(원)으로 자산 대비 주가 수준을 봅니다.",
  "외국인 소진율":
    "외국인 보유 한도 대비 실제 보유 비율입니다. 한도에 가까울수록 추가 외국인 매수 여력이 줄 수 있습니다.",
  "외국인 보유율":
    "상장주식 중 외국인이 보유한 비중(%)입니다. 글로벌 자금 관심도·지분 구조를 참고할 때 씁니다.",
  "동일업종 PER":
    "네이버 금융 기준 동일 업종 평균 PER입니다. 아래 종목 PER과 비교하는 업종 참고치입니다.",
};

function firstNumber(...values: (string | null | undefined)[]): number | null {
  for (const v of values) {
    const n = parseMetricNumber(v);
    if (n != null) return n;
  }
  return null;
}

function parsePair(raw?: string | null): { first: number | null; second: number | null } {
  if (!raw?.trim()) return { first: null, second: null };
  const nums = [...raw.replace(/,/g, "").matchAll(/-?\d+(?:\.\d+)?/g)].map((m) =>
    parseFloat(m[0]),
  );
  return {
    first: nums[0] ?? null,
    second: nums[1] ?? null,
  };
}

function resolvePerEps(info: StockInvestmentInfo): { per: number | null; eps: number | null } {
  const pair = parsePair(info.per_eps);
  return {
    per: firstNumber(info.per) ?? pair.first,
    eps: firstNumber(info.eps) ?? pair.second,
  };
}

function resolveForwardPerEps(info: StockInvestmentInfo): {
  forwardPer: number | null;
  forwardEps: number | null;
} {
  const pair = parsePair(info.forward_per_eps);
  return {
    forwardPer: firstNumber(info.forward_per) ?? pair.first,
    forwardEps: firstNumber(info.forward_eps) ?? pair.second,
  };
}

function resolvePbrBps(info: StockInvestmentInfo): { pbr: number | null; bps: number | null } {
  const pair = parsePair(info.pbr_bps);
  return {
    pbr: firstNumber(info.pbr) ?? pair.first,
    bps: firstNumber(info.bps) ?? pair.second,
  };
}

function fmtNum(n: number, digits = 1): string {
  return n.toLocaleString("ko-KR", {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  });
}

function hintPerEps(info: StockInvestmentInfo): string | null {
  const { per, eps } = resolvePerEps(info);
  const industryPer = firstNumber(info.industry_per);

  if (per == null && eps == null) return null;

  const parts: string[] = [];

  if (per != null && per <= 0) {
    parts.push("적자 등으로 PER 해석이 제한될 수 있습니다.");
  } else if (per != null && industryPer != null && industryPer > 0) {
    const ratio = per / industryPer;
    if (ratio >= 1.2) {
      parts.push(
        `동일업종 PER(${fmtNum(industryPer)}배) 대비 높은 편 — 성장·프리미엄 반영 가능성을 함께 봅니다.`,
      );
    } else if (ratio <= 0.8) {
      parts.push(
        `동일업종 PER(${fmtNum(industryPer)}배) 대비 낮은 편 — 상대적으로 이익 대비 주가가 낮게 형성된 상태입니다.`,
      );
    } else {
      parts.push(`동일업종 PER(${fmtNum(industryPer)}배)와 비슷한 수준입니다.`);
    }
  } else if (per != null) {
    if (per >= 25) parts.push("PER이 높은 편 — 성장 기대가 반영됐을 수 있어 업종 비교가 필요합니다.");
    else if (per <= 10) parts.push("PER이 낮은 편 — 이익 대비 주가가 낮게 보일 수 있습니다.");
    else parts.push("PER 절대값만으로는 판단하기 어렵습니다. 동일업종 PER과 함께 보세요.");
  }

  if (eps != null && eps <= 0) {
    parts.push("EPS가 음수이면 수익성 점검이 필요합니다.");
  }

  return parts.length ? parts.join(" ") : null;
}

function hintForwardPerEps(info: StockInvestmentInfo): string | null {
  const { forwardPer, forwardEps } = resolveForwardPerEps(info);
  const { per, eps } = resolvePerEps(info);

  const parts: string[] = [];

  if (forwardPer != null && per != null && per > 0 && forwardPer > 0) {
    if (forwardPer < per * 0.9) {
      parts.push("추정 PER이 현재 PER보다 낮습니다 — 이익 개선 전망이 반영된 경우가 많습니다.");
    } else if (forwardPer > per * 1.1) {
      parts.push("추정 PER이 현재 PER보다 높습니다 — 이익 감소 전망이 반영됐을 수 있습니다.");
    } else {
      parts.push("추정 PER이 현재 PER과 비슷합니다 — 이익 전망이 크게 변하지 않는 수준입니다.");
    }
  }

  if (forwardEps != null && eps != null && eps > 0 && forwardEps > 0) {
    const growth = ((forwardEps - eps) / eps) * 100;
    if (growth >= 10) {
      parts.push(`추정 EPS가 현재 대비 약 +${fmtNum(growth, 0)}% 수준입니다.`);
    } else if (growth <= -10) {
      parts.push(`추정 EPS가 현재 대비 약 ${fmtNum(growth, 0)}% 수준입니다.`);
    }
  }

  if (!parts.length && forwardPer != null) {
    parts.push("컨센서스 전망치이므로 실제 실적과 다를 수 있습니다.");
  }

  return parts.length ? parts.join(" ") : null;
}

function hintPbrBps(info: StockInvestmentInfo): string | null {
  const { pbr } = resolvePbrBps(info);
  if (pbr == null) return null;

  if (pbr <= 0) return "PBR 해석이 제한될 수 있습니다. BPS·재무 상태를 함께 확인하세요.";

  if (pbr >= 3) {
    return `PBR ${fmtNum(pbr)}배 — 순자산 대비 주가가 높은 편입니다. 브랜드·성장·무형자산 프리미엄 가능성을 봅니다.`;
  }
  if (pbr >= 1.5) {
    return `PBR ${fmtNum(pbr)}배 — 순자산 대비 다소 높은 수준입니다. 업종 특성과 함께 비교하세요.`;
  }
  if (pbr >= 0.85 && pbr <= 1.15) {
    return `PBR ${fmtNum(pbr)}배 — 순자산(1배) 근처로, 자산가치 대비 비교적 중립적인 구간입니다.`;
  }
  if (pbr < 0.85) {
    return `PBR ${fmtNum(pbr)}배 — 순자산 대비 낮게 거래됩니다. 저평가 또는 업황·리스크 반영 가능성을 봅니다.`;
  }
  return `PBR ${fmtNum(pbr)}배 — 자산 대비 주가 수준 참고치입니다.`;
}

function hintForeignRate(raw?: string | null, isExhaustion = false): string | null {
  const rate = parseMetricNumber(raw);
  if (rate == null) return null;

  if (isExhaustion) {
    if (rate >= 95) return `외국인 소진율 ${fmtNum(rate, 1)}% — 한도에 거의 찼습니다. 추가 외국인 매수 여력이 제한될 수 있습니다.`;
    if (rate >= 80) return `외국인 소진율 ${fmtNum(rate, 1)}% — 한도 대비 높은 편입니다.`;
    if (rate >= 50) return `외국인 소진율 ${fmtNum(rate, 1)}% — 중간 수준입니다.`;
    return `외국인 소진율 ${fmtNum(rate, 1)}% — 한도 대비 여유가 있는 편입니다.`;
  }

  if (rate >= 50) return `외국인 보유 ${fmtNum(rate, 1)}% — 지분 비중이 높은 편입니다.`;
  if (rate >= 30) return `외국인 보유 ${fmtNum(rate, 1)}% — 보통~높은 관심 수준입니다.`;
  if (rate >= 15) return `외국인 보유 ${fmtNum(rate, 1)}% — 중간 수준입니다.`;
  return `외국인 보유 ${fmtNum(rate, 1)}% — 비중이 낮은 편입니다.`;
}

export function getValuationDefinition(label: string): string | null {
  return VALUATION_DEFINITIONS[label] ?? null;
}

export function getValuationHint(label: string, info: StockInvestmentInfo): string | null {
  switch (label) {
    case "PER · EPS":
      return hintPerEps(info);
    case "추정 PER · EPS":
      return hintForwardPerEps(info);
    case "PBR · BPS":
      return hintPbrBps(info);
    case "외국인 소진율":
      return hintForeignRate(info.foreign_exhaustion_rate ?? info.foreign_holding_rate, true);
    case "외국인 보유율":
      return hintForeignRate(info.foreign_holding_rate, false);
    case "동일업종 PER":
      return info.industry_per
        ? `이 종목 PER과 비교할 때 업종 평균 ${info.industry_per} 입니다.`
        : null;
    default:
      return null;
  }
}
