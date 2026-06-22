import type { PriceTarget } from "@/lib/api";

/** 차트에 표시할 목표가: 최근 1개월 */
export const CHART_TARGET_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export function targetEffectiveDate(t: PriceTarget): number {
  const raw = t.report_date || t.fetched_at;
  if (!raw) return Date.now();
  const ts = new Date(raw.includes("T") ? raw : `${raw}T12:00:00`).getTime();
  return Number.isNaN(ts) ? Date.now() : ts;
}

export function isTargetShownOnChart(t: PriceTarget): boolean {
  return Date.now() - targetEffectiveDate(t) <= CHART_TARGET_MAX_AGE_MS;
}

export function pickAllChartTargets(targets: PriceTarget[]): PriceTarget[] {
  return targets
    .filter(isTargetShownOnChart)
    .sort((a, b) => targetEffectiveDate(b) - targetEffectiveDate(a));
}

/** 컨센서스를 제외한 목표가를 최근 windowDays일 내로 평균낸다 (매수적정가 계산용). */
export function computeTargetAverage(
  targets: PriceTarget[],
  windowDays: number,
): { avg: number; count: number } | null {
  const cutoff = Date.now() - windowDays * 24 * 60 * 60 * 1000;
  const filtered = targets.filter((t) => !t.is_consensus && targetEffectiveDate(t) >= cutoff);
  if (filtered.length === 0) return null;
  const sum = filtered.reduce((s, t) => s + t.target_price, 0);
  return { avg: sum / filtered.length, count: filtered.length };
}
