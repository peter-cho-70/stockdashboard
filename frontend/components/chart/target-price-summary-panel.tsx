"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Target, TrendingUp } from "lucide-react";
import { marketApi, type PriceTarget } from "@/lib/api";
import { computeTargetAverage } from "@/lib/priceTargetUtils";

const WINDOW_OPTIONS = [15, 30, 45, 60] as const;
const TAKE_PROFIT_STEPS = [5, 10, 15, 20] as const;

function fmtWon(v: number) {
  return `${Math.round(v).toLocaleString("ko-KR")}원`;
}

export function TargetPriceSummaryPanel({
  symbol,
  targets,
  currentPrice,
}: {
  symbol: string;
  targets: PriceTarget[];
  currentPrice?: number;
}) {
  const [windowDays, setWindowDays] = useState<number>(30);
  const [weightPct, setWeightPct] = useState<number>(75);
  const [customProfitPct, setCustomProfitPct] = useState<number>(10);
  const [loading, setLoading] = useState(true);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestSettings = useRef({ avg_window_days: 30, weight_pct: 75, custom_profit_pct: 10 });

  useEffect(() => {
    if (!symbol) return;
    setLoading(true);
    marketApi
      .getTargetSetting(symbol)
      .then((s) => {
        setWindowDays(s.avg_window_days);
        setWeightPct(s.weight_pct);
        setCustomProfitPct(s.custom_profit_pct);
        latestSettings.current = {
          avg_window_days: s.avg_window_days,
          weight_pct: s.weight_pct,
          custom_profit_pct: s.custom_profit_pct,
        };
      })
      .catch(() => {
        /* 기본값 유지 */
      })
      .finally(() => setLoading(false));
  }, [symbol]);

  // 세 설정값이 같은 디바운스 타이머를 공유하므로, 직전 patch를 덮어쓰지 않도록 항상 최신 전체 상태를 합쳐서 저장한다.
  function scheduleSave(patch: Partial<{ avg_window_days: number; weight_pct: number; custom_profit_pct: number }>) {
    if (!symbol) return;
    latestSettings.current = { ...latestSettings.current, ...patch };
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      marketApi.saveTargetSetting(symbol, latestSettings.current).catch(() => {});
    }, 500);
  }

  const result = useMemo(() => computeTargetAverage(targets, windowDays), [targets, windowDays]);
  const buyPrice = result ? result.avg * (weightPct / 100) : null;

  const profitLevels = useMemo(() => {
    if (buyPrice == null) return [];
    const pcts = [...TAKE_PROFIT_STEPS, customProfitPct];
    return pcts.map((pct) => ({ pct, price: buyPrice * (1 + pct / 100) }));
  }, [buyPrice, customProfitPct]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Target size={13} className="text-violet-500" />
        <span className="font-medium text-neutral-600 dark:text-neutral-400">매수적절가 계산</span>
        {loading && <Loader2 size={12} className="animate-spin text-neutral-400" />}
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-neutral-500">평균 목표가 산정 기간</span>
          <div className="flex gap-1">
            {WINDOW_OPTIONS.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => {
                  setWindowDays(d);
                  scheduleSave({ avg_window_days: d });
                }}
                className={`rounded-md px-2 py-0.5 text-[11px] transition-colors ${
                  windowDays === d
                    ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                    : "border border-[var(--border-subtle)] text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                }`}
              >
                {d}일
              </button>
            ))}
          </div>
        </div>
        <div className="rounded-lg border border-[var(--border-subtle)] px-3 py-2">
          {result ? (
            <>
              <span className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">
                {fmtWon(result.avg)}
              </span>
              <span className="ml-2 text-[10px] text-neutral-400">
                최근 {windowDays}일 · 컨센서스 제외 {result.count}건 평균
              </span>
              {currentPrice != null && currentPrice > 0 && (
                <p className="mt-1 text-[11px] text-neutral-500">
                  현재가 {fmtWon(currentPrice)} · 목표가 대비{" "}
                  <span
                    className={
                      currentPrice >= result.avg
                        ? "font-medium text-red-500"
                        : "font-medium text-emerald-600 dark:text-emerald-400"
                    }
                  >
                    {((currentPrice / result.avg) * 100).toFixed(0)}%
                  </span>
                </p>
              )}
            </>
          ) : (
            <span className="text-[11px] text-neutral-400">최근 {windowDays}일 내 목표가가 없습니다.</span>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-neutral-500">가중치 (평균 목표가 × 가중치 = 매수적절가)</span>
        <div className="flex items-center gap-1">
          <input
            type="number"
            value={weightPct}
            onChange={(e) => {
              const v = Number(e.target.value);
              setWeightPct(v);
              scheduleSave({ weight_pct: v });
            }}
            className="w-16 rounded-md border border-[var(--border-subtle)] bg-transparent px-2 py-1 text-right text-xs"
          />
          <span className="text-[11px] text-neutral-400">%</span>
        </div>
      </div>

      <div className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 dark:border-violet-900 dark:bg-violet-950/30">
        <p className="text-[10px] text-violet-600 dark:text-violet-400">예상 매수적절가</p>
        <p className="text-lg font-bold text-violet-700 dark:text-violet-300">
          {buyPrice != null ? fmtWon(buyPrice) : "—"}
        </p>
        {buyPrice != null && currentPrice != null && currentPrice > 0 && (
          <p className="mt-0.5 text-[11px] text-violet-600/80 dark:text-violet-400/80">
            현재가 {fmtWon(currentPrice)} · 매수적절가 대비{" "}
            <span
              className={
                currentPrice >= buyPrice
                  ? "font-medium text-red-500"
                  : "font-medium text-emerald-600 dark:text-emerald-400"
              }
            >
              {((currentPrice / buyPrice) * 100).toFixed(0)}%
            </span>
          </p>
        )}
      </div>

      <div className="space-y-1.5 border-t border-[var(--border-subtle)] pt-2">
        <span className="flex items-center gap-1.5 text-[11px] text-neutral-500">
          <TrendingUp size={11} />
          익절 매도가 (매수적절가 기준)
        </span>
        {buyPrice == null ? (
          <p className="text-[11px] text-neutral-400">매수적절가가 계산되면 표시됩니다.</p>
        ) : (
          <ul className="space-y-1">
            {profitLevels.map(({ pct, price }, i) => {
              const isCustom = i === profitLevels.length - 1;
              return (
                <li
                  key={`${pct}-${i}`}
                  className="flex items-center justify-between rounded-md bg-[var(--surface-elevated)] px-2.5 py-1.5 text-xs"
                >
                  {isCustom ? (
                    <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                      목표치
                      <input
                        type="number"
                        value={customProfitPct}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          setCustomProfitPct(v);
                          scheduleSave({ custom_profit_pct: v });
                        }}
                        className="w-12 rounded border border-[var(--border-subtle)] bg-transparent px-1 text-right"
                      />
                      %
                    </span>
                  ) : (
                    <span className="text-neutral-500">+{pct}%</span>
                  )}
                  <span className="font-semibold text-neutral-800 dark:text-neutral-200">{fmtWon(price)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
