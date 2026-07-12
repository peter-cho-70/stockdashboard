"use client";

import { useEffect, useMemo, useState } from "react";
import { X, Loader2 } from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api, marketApi, type StockChartBar, type UsMarketQuote, type UsTickerHistoryPoint } from "@/lib/api";
import { krChangeClass } from "@/lib/krMarketColors";

type RangeKey = "1w" | "1mo" | "3mo" | "6mo" | "1y";

const RANGE_LABEL: Record<RangeKey, string> = {
  "1w": "1주일",
  "1mo": "1개월",
  "3mo": "3개월",
  "6mo": "6개월",
  "1y": "1년",
};
const RANGE_DAYS: Record<RangeKey, number> = { "1w": 7, "1mo": 30, "3mo": 93, "6mo": 183, "1y": 365 };

function filterByRange<T extends { date: string }>(points: T[], range: RangeKey): T[] {
  if (points.length === 0) return points;
  const lastDate = new Date(`${points[points.length - 1].date}T00:00:00`);
  const cutoff = new Date(lastDate);
  cutoff.setDate(cutoff.getDate() - RANGE_DAYS[range]);
  return points.filter((p) => new Date(`${p.date}T00:00:00`) >= cutoff);
}

function formatValue(v: number, unit?: UsMarketQuote["unit"]): string {
  if (unit === "yield") return `${v.toFixed(2)}%`;
  if (unit === "fx") return v.toFixed(v > 100 ? 2 : 4);
  return v.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

// 서로 다른 통화(USD ADR vs KRW 원주)의 절대가를 그대로 겹쳐 그리면 의미가 없어서,
// 각자 조회 구간 첫 값 대비 등락률(%)로 정규화해 같은 축에 겹쳐 그린다.
function toPctSeries(points: { date: string; close: number }[]): { date: string; pct: number }[] {
  if (points.length === 0) return [];
  const base = points[0].close;
  if (!base) return [];
  return points.map((p) => ({ date: p.date, pct: ((p.close - base) / base) * 100 }));
}

function mergeCompareSeries(
  usPoints: { date: string; pct: number }[],
  krPoints: { date: string; pct: number }[],
): { date: string; us?: number; kr?: number }[] {
  const map = new Map<string, { date: string; us?: number; kr?: number }>();
  for (const p of usPoints) map.set(p.date, { date: p.date, us: p.pct });
  for (const p of krPoints) {
    const row = map.get(p.date);
    if (row) row.kr = p.pct;
    else map.set(p.date, { date: p.date, kr: p.pct });
  }
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function UsTickerChartModal({
  item,
  onClose,
}: {
  item: UsMarketQuote;
  onClose: () => void;
}) {
  const [points, setPoints] = useState<UsTickerHistoryPoint[] | null>(null);
  const [krBars, setKrBars] = useState<StockChartBar[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<RangeKey>("1mo");

  const compareSymbol = item.compare_krx_symbol;

  useEffect(() => {
    let cancelled = false;
    if (!item.ticker) {
      setError("차트를 지원하지 않는 항목입니다.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    Promise.all([
      marketApi.getUsTickerHistory(item.ticker, "1y"),
      compareSymbol ? api.getStockChart(compareSymbol, "1Y").catch(() => null) : Promise.resolve(null),
    ])
      .then(([usRes, krRes]) => {
        if (cancelled) return;
        if (usRes.error || usRes.points.length === 0) {
          setError("데이터를 불러오지 못했습니다.");
        } else {
          setPoints(usRes.points);
          setKrBars(krRes?.data ?? null);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "차트를 불러오지 못했습니다.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [item.ticker, compareSymbol]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const filtered = useMemo(() => (points ? filterByRange(points, range) : []), [points, range]);
  const filteredKr = useMemo(
    () => (krBars ? filterByRange(krBars, range) : []),
    [krBars, range],
  );

  const compareData = useMemo(() => {
    if (!compareSymbol || filteredKr.length === 0) return [];
    return mergeCompareSeries(toPctSeries(filtered), toPctSeries(filteredKr));
  }, [compareSymbol, filtered, filteredKr]);

  const { min, max, pad } = useMemo(() => {
    if (filtered.length === 0) return { min: 0, max: 0, pad: 0 };
    const closes = filtered.map((p) => p.close);
    const mn = Math.min(...closes);
    const mx = Math.max(...closes);
    return { min: mn, max: mx, pad: (mx - mn) * 0.08 || mx * 0.01 };
  }, [filtered]);

  const first = filtered[0]?.close;
  const last = filtered[filtered.length - 1]?.close;
  const periodChangePct = first != null && last != null ? ((last - first) / first) * 100 : null;
  const up = (periodChangePct ?? 0) >= 0;
  const lineColor = up ? "#dc2626" : "#2563eb";

  const krFirst = filteredKr[0]?.close;
  const krLast = filteredKr[filteredKr.length - 1]?.close;
  const krChangePct = krFirst != null && krLast != null ? ((krLast - krFirst) / krFirst) * 100 : null;

  const showCompare = Boolean(compareSymbol) && compareData.length > 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`${item.name} 차트`}
    >
      <div
        className="w-full max-w-lg rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">{item.name}</p>
            {item.ticker && <p className="text-[10px] text-neutral-400">{item.ticker}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="rounded p-1 text-neutral-400 hover:bg-[var(--surface-elevated)] hover:text-neutral-600 dark:hover:text-neutral-300"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex rounded-md border border-[var(--border-subtle)] p-0.5 gap-0.5">
              {(["1w", "1mo", "3mo", "6mo", "1y"] as RangeKey[]).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRange(r)}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                    range === r
                      ? "bg-blue-500 text-white"
                      : "text-neutral-500 hover:bg-[var(--surface-elevated)]"
                  }`}
                >
                  {RANGE_LABEL[r]}
                </button>
              ))}
            </div>
            {!showCompare && periodChangePct != null && (
              <span className={`text-xs font-medium tabular-nums ${krChangeClass(periodChangePct)}`}>
                {up ? "+" : ""}
                {periodChangePct.toFixed(2)}% ({RANGE_LABEL[range]})
              </span>
            )}
          </div>

          {showCompare && (
            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-2 w-2 rounded-full" style={{ background: "#dc2626" }} />
                {item.name}
                {periodChangePct != null && (
                  <span className={`font-medium tabular-nums ${krChangeClass(periodChangePct)}`}>
                    {periodChangePct >= 0 ? "+" : ""}
                    {periodChangePct.toFixed(2)}%
                  </span>
                )}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-2 w-2 rounded-full" style={{ background: "#2563eb" }} />
                SK하이닉스(국내)
                {krChangePct != null && (
                  <span className={`font-medium tabular-nums ${krChangeClass(krChangePct)}`}>
                    {krChangePct >= 0 ? "+" : ""}
                    {krChangePct.toFixed(2)}%
                  </span>
                )}
              </span>
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-neutral-400">
              <Loader2 size={16} className="animate-spin" />
              불러오는 중...
            </div>
          ) : error ? (
            <div className="py-16 text-center text-sm text-neutral-500">{error}</div>
          ) : showCompare ? (
            <div className="h-[220px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={compareData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 9, fill: "#a3a3a3" }}
                    tickFormatter={(v: string) => v.slice(5)}
                    interval="preserveStartEnd"
                    minTickGap={40}
                  />
                  <YAxis
                    tick={{ fontSize: 9, fill: "#a3a3a3" }}
                    width={44}
                    tickFormatter={(v) => `${Number(v).toFixed(0)}%`}
                  />
                  <Tooltip
                    contentStyle={{
                      fontSize: 11,
                      borderRadius: 8,
                      border: "1px solid var(--border-subtle)",
                    }}
                    formatter={(value, name) => [
                      `${Number(value ?? 0) >= 0 ? "+" : ""}${Number(value ?? 0).toFixed(2)}%`,
                      name === "us" ? item.name : "SK하이닉스(국내)",
                    ]}
                  />
                  <Legend
                    formatter={(name) => (name === "us" ? item.name : "SK하이닉스(국내)")}
                    wrapperStyle={{ fontSize: 11 }}
                  />
                  <Line type="monotone" dataKey="us" stroke="#dc2626" strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls />
                  <Line type="monotone" dataKey="kr" stroke="#2563eb" strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls />
                </LineChart>
              </ResponsiveContainer>
              <p className="mt-1 text-[10px] text-neutral-400">
                구간 시작일 대비 등락률(%) 비교 — ADR은 USD, 국내 주식은 KRW 기준이라 절대가 대신 등락률로 겹쳐 표시합니다.
              </p>
            </div>
          ) : (
            <div className="h-[220px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={filtered} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="usTickerFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={lineColor} stopOpacity={0.25} />
                      <stop offset="100%" stopColor={lineColor} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 9, fill: "#a3a3a3" }}
                    tickFormatter={(v: string) => v.slice(5)}
                    interval="preserveStartEnd"
                    minTickGap={40}
                  />
                  <YAxis
                    domain={[min - pad, max + pad]}
                    tick={{ fontSize: 9, fill: "#a3a3a3" }}
                    width={56}
                    tickFormatter={(v) => formatValue(Number(v), item.unit)}
                  />
                  <Tooltip
                    contentStyle={{
                      fontSize: 11,
                      borderRadius: 8,
                      border: "1px solid var(--border-subtle)",
                    }}
                    formatter={(value) => [formatValue(Number(value ?? 0), item.unit), item.name]}
                    labelFormatter={(label) => `${label}`}
                  />
                  <Area
                    type="monotone"
                    dataKey="close"
                    stroke={lineColor}
                    strokeWidth={1.5}
                    fill="url(#usTickerFill)"
                    dot={false}
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
