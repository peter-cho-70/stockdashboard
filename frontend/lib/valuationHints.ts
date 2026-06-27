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
  return { first: nums[0] ?? null, second: nums[1] ?? null };
}

function resolvePerEps(info: StockInvestmentInfo) {
  const pair = parsePair(info.per_eps);
  return {
    per: firstNumber(info.per) ?? pair.first,
    eps: firstNumber(info.eps) ?? pair.second,
  };
}

function resolveForwardPerEps(info: StockInvestmentInfo) {
  const pair = parsePair(info.forward_per_eps);
  return {
    forwardPer: firstNumber(info.forward_per) ?? pair.first,
    forwardEps: firstNumber(info.forward_eps) ?? pair.second,
  };
}

function resolvePbrBps(info: StockInvestmentInfo) {
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

// ── PER 구간 판정 ─────────────────────────────────────────────────────
function perLevel(per: number): "negative" | "very_low" | "low" | "fair" | "high" | "very_high" {
  if (per <= 0)   return "negative";
  if (per < 5)    return "very_low";
  if (per < 12)   return "low";
  if (per < 20)   return "fair";
  if (per < 35)   return "high";
  return "very_high";
}

function hintPerEps(info: StockInvestmentInfo): string | null {
  const { per, eps } = resolvePerEps(info);
  const industryPer = firstNumber(info.industry_per);
  const parts: string[] = [];

  // ① 적자 판정
  if (per != null && per <= 0) {
    parts.push("현재 적자 상태이거나 EPS가 음수여서 PER 계산이 의미 없습니다. 흑자 전환 시점과 추정 EPS를 먼저 확인하세요.");
    if (eps != null && eps < 0) parts.push(`EPS ${fmtNum(eps)}원으로 주당 손실 구간입니다.`);
    return parts.join(" ");
  }

  if (per == null) return null;

  // ② 이익 회수 기간 개념
  const level = perLevel(per);
  const recoveryDesc: Record<typeof level, string> = {
    negative:   "",
    very_low:   `PER ${fmtNum(per)}배 — 현재 이익이 지속된다면 약 ${fmtNum(per, 0)}년 만에 투자금 회수 가능한 수준으로 매우 낮습니다. 이익 지속성 점검이 필요합니다.`,
    low:        `PER ${fmtNum(per)}배 — 이익 대비 주가가 낮은 편입니다. 실적이 안정적이라면 저평가 구간일 수 있습니다.`,
    fair:       `PER ${fmtNum(per)}배 — 중간 수준으로 이익 대비 적정한 주가 수준입니다.`,
    high:       `PER ${fmtNum(per)}배 — 이익 대비 주가가 높은 편입니다. 성장 프리미엄이 반영됐을 가능성이 있습니다.`,
    very_high:  `PER ${fmtNum(per)}배 — 이익 대비 주가가 상당히 높습니다. 고성장 기대나 테마 프리미엄이 크게 반영된 상태로, 실적 실망 시 조정 폭이 클 수 있습니다.`,
  };
  if (recoveryDesc[level]) parts.push(recoveryDesc[level]);

  // ③ 업종 비교
  if (industryPer != null && industryPer > 0) {
    const ratio = per / industryPer;
    if (ratio >= 1.3) {
      parts.push(`동일업종 평균 PER(${fmtNum(industryPer)}배)보다 ${fmtNum((ratio - 1) * 100, 0)}% 높아 업종 내 프리미엄 종목 성격입니다.`);
    } else if (ratio <= 0.7) {
      parts.push(`동일업종 평균 PER(${fmtNum(industryPer)}배)보다 ${fmtNum((1 - ratio) * 100, 0)}% 낮아 업종 내 상대적으로 저평가 수준입니다.`);
    } else {
      parts.push(`동일업종 평균 PER(${fmtNum(industryPer)}배)과 비슷한 수준입니다.`);
    }
  }

  // ④ EPS 해석
  if (eps != null) {
    if (eps > 0) {
      parts.push(`EPS ${fmtNum(eps, 0)}원 — 1주당 이 금액의 이익을 내고 있습니다.`);
    } else {
      parts.push("EPS가 음수입니다. 수익성 회복 여부를 확인하세요.");
    }
  }

  // ⑤ 추정 PER과 비교 (개선 방향)
  const { forwardPer } = resolveForwardPerEps(info);
  if (forwardPer != null && forwardPer > 0 && per > 0) {
    if (forwardPer < per * 0.85) {
      parts.push(`추정 PER(${fmtNum(forwardPer)}배)이 현재 PER보다 낮아 이익 성장이 기대됩니다.`);
    } else if (forwardPer > per * 1.15) {
      parts.push(`추정 PER(${fmtNum(forwardPer)}배)이 현재보다 높아 향후 이익 감소 전망이 반영된 상태입니다.`);
    }
  }

  return parts.length ? parts.join("\n") : null;
}

function hintForwardPerEps(info: StockInvestmentInfo): string | null {
  const { forwardPer, forwardEps } = resolveForwardPerEps(info);
  const { per, eps } = resolvePerEps(info);
  const parts: string[] = [];

  if (forwardPer != null && per != null && per > 0 && forwardPer > 0) {
    const diff = ((per - forwardPer) / per * 100);
    if (diff >= 15) {
      parts.push(`추정 PER(${fmtNum(forwardPer)}배)이 현재 PER(${fmtNum(per)}배)보다 약 ${fmtNum(diff, 0)}% 낮습니다 — 향후 이익이 크게 늘어날 것으로 전망됩니다.`);
    } else if (diff <= -15) {
      parts.push(`추정 PER(${fmtNum(forwardPer)}배)이 현재 PER(${fmtNum(per)}배)보다 높습니다 — 이익 감소 우려가 반영된 것으로 볼 수 있습니다.`);
    } else {
      parts.push(`추정 PER(${fmtNum(forwardPer)}배)과 현재 PER(${fmtNum(per)}배)이 비슷합니다 — 이익 전망이 안정적인 수준입니다.`);
    }
  } else if (forwardPer != null) {
    parts.push(`컨센서스 추정 PER은 ${fmtNum(forwardPer)}배입니다.`);
  }

  if (forwardEps != null && eps != null && eps > 0 && forwardEps !== eps) {
    const growth = ((forwardEps - eps) / eps) * 100;
    if (Math.abs(growth) >= 5) {
      parts.push(`추정 EPS ${fmtNum(forwardEps, 0)}원으로 현재 EPS 대비 ${growth >= 0 ? "+" : ""}${fmtNum(growth, 0)}% 전망입니다.`);
    }
  }

  parts.push("컨센서스 전망치이므로 실제 실적 발표 시 달라질 수 있습니다.");
  return parts.join("\n");
}

function hintPbrBps(info: StockInvestmentInfo): string | null {
  const { pbr, bps } = resolvePbrBps(info);
  const { per } = resolvePerEps(info);
  if (pbr == null) return null;

  const parts: string[] = [];

  // ① 기본 해석
  if (pbr <= 0) {
    parts.push("PBR이 음수이거나 계산이 불가합니다. 자본 잠식 여부를 확인하세요.");
    return parts.join("\n");
  }

  if (pbr < 0.5) {
    parts.push(`PBR ${fmtNum(pbr)}배 — 순자산의 절반 이하 가격에 거래됩니다. 자산 대비 극히 낮은 주가로, 심각한 업황 우려 또는 심한 저평가 상태입니다.`);
  } else if (pbr < 0.85) {
    parts.push(`PBR ${fmtNum(pbr)}배 — 순자산(장부가치)보다 낮게 거래됩니다. 청산가치 이하 구간으로, 저평가 또는 수익성 우려가 반영된 상태입니다.`);
  } else if (pbr <= 1.2) {
    parts.push(`PBR ${fmtNum(pbr)}배 — 순자산과 비슷한 수준에서 거래됩니다. 자산가치 기준으로는 비교적 합리적인 구간입니다.`);
  } else if (pbr <= 2.5) {
    parts.push(`PBR ${fmtNum(pbr)}배 — 순자산보다 높은 가격입니다. 브랜드·기술력 등 무형자산 프리미엄이 반영된 것으로 봅니다.`);
  } else if (pbr <= 5) {
    parts.push(`PBR ${fmtNum(pbr)}배 — 순자산 대비 상당한 프리미엄입니다. 높은 ROE나 강력한 성장 기대가 반영됐을 때 나타납니다.`);
  } else {
    parts.push(`PBR ${fmtNum(pbr)}배 — 매우 높은 프리미엄입니다. 성장주·플랫폼 기업에서 나타나는 수준으로, 수익성 지속 여부가 핵심 변수입니다.`);
  }

  // ② BPS 설명
  if (bps != null && bps > 0) {
    parts.push(`BPS(주당 순자산) ${fmtNum(bps, 0)}원 — 지금 회사를 청산하면 주당 이 금액 수준의 자산이 돌아옵니다.`);
  }

  // ③ ROE 추정 (ROE ≈ PBR / PER)
  if (per != null && per > 0 && pbr > 0) {
    const impliedRoe = (pbr / per) * 100;
    if (impliedRoe > 0) {
      parts.push(`PBR/PER으로 추정한 ROE는 약 ${fmtNum(impliedRoe, 1)}% 수준입니다 (자본 효율성 참고치).`);
    }
  }

  return parts.join("\n");
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
    case "PER · EPS":        return hintPerEps(info);
    case "추정 PER · EPS":   return hintForwardPerEps(info);
    case "PBR · BPS":        return hintPbrBps(info);
    case "외국인 소진율":     return hintForeignRate(info.foreign_exhaustion_rate ?? info.foreign_holding_rate, true);
    case "외국인 보유율":     return hintForeignRate(info.foreign_holding_rate, false);
    case "동일업종 PER":      return info.industry_per
      ? `이 종목 PER과 비교할 때 업종 평균 ${info.industry_per} 입니다.`
      : null;
    default:                  return null;
  }
}

// ── 종합 밸류에이션 판정 (외부 컴포넌트용) ───────────────────────────
export type ValuationGrade = "저평가" | "적정" | "고평가" | "판단불가";

export interface ValuationSummary {
  grade: ValuationGrade;
  gradeColor: string;
  bullets: string[];
}

export function buildValuationSummary(info: StockInvestmentInfo): ValuationSummary | null {
  const { per }        = resolvePerEps(info);
  const { forwardPer } = resolveForwardPerEps(info);
  const { pbr }        = resolvePbrBps(info);
  const industryPer    = firstNumber(info.industry_per);
  const consensusTarget = parseMetricNumber(info.consensus_target_price_numeric ?? info.consensus_target_price);

  const bullets: string[] = [];
  let scoreSum = 0;
  let scoreCount = 0;

  // PER 점수 (-2 ~ +2)
  if (per != null && per > 0) {
    const industryRatio = industryPer && industryPer > 0 ? per / industryPer : null;
    if (industryRatio != null) {
      if (industryRatio < 0.7) {
        bullets.push(`PER이 업종 평균보다 ${fmtNum((1 - industryRatio) * 100, 0)}% 낮아 상대적으로 저평가 구간입니다.`);
        scoreSum += 1; scoreCount++;
      } else if (industryRatio > 1.4) {
        bullets.push(`PER이 업종 평균보다 ${fmtNum((industryRatio - 1) * 100, 0)}% 높아 프리미엄이 큰 상태입니다.`);
        scoreSum -= 1; scoreCount++;
      } else {
        bullets.push(`PER이 업종 평균(${fmtNum(industryPer!)}배)과 비슷한 수준입니다.`);
        scoreSum += 0; scoreCount++;
      }
    } else {
      const level = perLevel(per);
      if (level === "very_low" || level === "low") {
        bullets.push(`PER ${fmtNum(per)}배로 이익 대비 주가가 낮은 편입니다.`);
        scoreSum += 1; scoreCount++;
      } else if (level === "high" || level === "very_high") {
        bullets.push(`PER ${fmtNum(per)}배로 이익 대비 주가가 높습니다.`);
        scoreSum -= 1; scoreCount++;
      }
    }
  }

  // 추정 PER (이익 방향)
  if (forwardPer != null && per != null && per > 0 && forwardPer > 0) {
    if (forwardPer < per * 0.85) {
      bullets.push(`추정 PER(${fmtNum(forwardPer)}배)이 현재보다 낮아 이익 증가 전망이 우세합니다.`);
      scoreSum += 1; scoreCount++;
    } else if (forwardPer > per * 1.15) {
      bullets.push(`추정 PER(${fmtNum(forwardPer)}배)이 현재보다 높아 이익 감소 우려가 있습니다.`);
      scoreSum -= 1; scoreCount++;
    }
  }

  // PBR 점수
  if (pbr != null && pbr > 0) {
    if (pbr < 0.8) {
      bullets.push(`PBR ${fmtNum(pbr)}배로 순자산 이하 거래 중입니다.`);
      scoreSum += 1; scoreCount++;
    } else if (pbr > 4) {
      bullets.push(`PBR ${fmtNum(pbr)}배로 순자산 대비 프리미엄이 높습니다.`);
      scoreSum -= 1; scoreCount++;
    }
  }

  // 목표주가 대비 괴리
  if (consensusTarget != null && consensusTarget > 0 && info.consensus_rating) {
    bullets.push(`컨센서스 의견: ${info.consensus_rating}${info.consensus_target_price ? `, 목표가 ${info.consensus_target_price}` : ""}`);
    if (info.consensus_rating.includes("강력매수") || info.consensus_rating.includes("매수")) {
      scoreSum += 1; scoreCount++;
    } else if (info.consensus_rating.includes("중립") || info.consensus_rating.includes("매도")) {
      scoreSum -= 0.5; scoreCount++;
    }
  }

  if (!bullets.length) return null;

  const avgScore = scoreCount > 0 ? scoreSum / scoreCount : 0;
  let grade: ValuationGrade;
  let gradeColor: string;
  if (avgScore >= 0.6) {
    grade = "저평가"; gradeColor = "text-red-600 dark:text-red-400";
  } else if (avgScore <= -0.6) {
    grade = "고평가"; gradeColor = "text-blue-600 dark:text-blue-400";
  } else if (scoreCount >= 2) {
    grade = "적정"; gradeColor = "text-neutral-600 dark:text-neutral-400";
  } else {
    grade = "판단불가"; gradeColor = "text-neutral-400";
  }

  return { grade, gradeColor, bullets };
}
