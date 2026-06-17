"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BarChart3, Loader2, Star, X } from "lucide-react";
import { watchlistApi } from "@/lib/api";
import { ensureStockForChart } from "@/lib/ensureStock";
import { krChangeClass } from "@/lib/krMarketColors";

export type StockPreviewItem = {
  symbol: string;
  name: string;
  close?: number | null;
  change_pct?: number;
  market?: string;
  sector?: string | null;
};

export function StockPreviewModal({
  item,
  onClose,
}: {
  item: StockPreviewItem | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [sector, setSector] = useState<string | null>(item?.sector ?? null);
  const [currentPrice, setCurrentPrice] = useState<number | null>(item?.close ?? null);
  const [changePct, setChangePct] = useState<number | null>(
    item?.change_pct != null ? item.change_pct : null,
  );
  const [loading, setLoading] = useState(false);
  const [ensuring, setEnsuring] = useState(false);
  const [watching, setWatching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [doneMsg, setDoneMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!item) return;
    setSector(item.sector ?? null);
    setCurrentPrice(item.close ?? null);
    setChangePct(item.change_pct ?? null);
    setError(null);
    setDoneMsg(null);
    setLoading(true);
    watchlistApi
      .lookupSymbol(item.symbol)
      .then((r) => {
        setSector(r.sector ?? null);
        if (r.current_price != null) setCurrentPrice(r.current_price);
      })
      .catch(() => {
        /* 스냅샷 데이터만 사용 */
      })
      .finally(() => setLoading(false));
  }, [item]);

  if (!item) return null;

  const change = changePct ?? 0;

  async function goChart() {
    setEnsuring(true);
    setError(null);
    try {
      const stock = await ensureStockForChart(item!.symbol, item!.name);
      setSector(stock.sector ?? sector);
      setCurrentPrice(stock.current_price);
      setChangePct(stock.change_rate);
      onClose();
      router.push(`/chart?symbol=${encodeURIComponent(item!.symbol)}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "종목 등록에 실패했습니다.");
    } finally {
      setEnsuring(false);
    }
  }

  async function addWatchlist() {
    setWatching(true);
    setError(null);
    try {
      await watchlistApi.addBySymbol({
        symbol: item!.symbol,
        stock_name: item!.name,
      });
      setDoneMsg("관심 종목에 추가했습니다.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "관심 종목 추가 실패");
    } finally {
      setWatching(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-full max-w-md rounded-xl border border-[var(--border-subtle)] bg-[var(--surface)] shadow-lg"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="stock-preview-title"
      >
        <div className="flex items-start justify-between border-b border-[var(--border-subtle)] px-4 py-3">
          <div className="min-w-0">
            <h2 id="stock-preview-title" className="truncate text-base font-semibold text-neutral-900 dark:text-neutral-100">
              {item.name}
            </h2>
            <p className="mt-0.5 text-xs text-neutral-400">
              {item.symbol}
              {item.market ? ` · ${item.market}` : ""}
              {sector ? ` · ${sector}` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-neutral-400 hover:bg-[var(--surface-elevated)] hover:text-neutral-600"
            aria-label="닫기"
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-4 py-4 space-y-4">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-neutral-400">
              <Loader2 size={14} className="animate-spin" />
              종목 정보 불러오는 중...
            </div>
          ) : (
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="text-[10px] text-neutral-400">현재가</p>
                <p className="text-2xl font-bold tabular-nums text-neutral-900 dark:text-neutral-100">
                  {currentPrice != null ? currentPrice.toLocaleString("ko-KR") : "—"}
                </p>
              </div>
              <div className="text-right">
                <p className="text-[10px] text-neutral-400">전일대비</p>
                <p className={`text-lg font-semibold tabular-nums ${krChangeClass(change)}`}>
                  {change > 0 ? "+" : ""}
                  {change.toFixed(2)}%
                </p>
              </div>
            </div>
          )}

          <p className="text-[11px] text-neutral-400 leading-relaxed">
            보유 종목이 아닌 경우 조회용으로만 등록됩니다 (수량 0). 포트폴리오·실현손익에는
            반영되지 않습니다.
          </p>

          {error && (
            <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-900/20 dark:text-red-300">
              {error}
            </p>
          )}
          {doneMsg && (
            <p className="rounded-md bg-blue-50 px-3 py-2 text-xs text-blue-700 dark:bg-blue-900/20 dark:text-blue-300">
              {doneMsg}
            </p>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={goChart}
              disabled={ensuring || loading}
              className="flex flex-1 items-center justify-center gap-2 rounded-md bg-neutral-900 px-3 py-2.5 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
            >
              {ensuring ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <BarChart3 size={14} />
              )}
              차트 보기
            </button>
            <button
              type="button"
              onClick={addWatchlist}
              disabled={watching || loading}
              className="flex items-center justify-center gap-1.5 rounded-md border border-[var(--border-subtle)] px-3 py-2.5 text-sm font-medium text-neutral-700 hover:bg-[var(--surface-elevated)] disabled:opacity-50 dark:text-neutral-300"
            >
              {watching ? <Loader2 size={14} className="animate-spin" /> : <Star size={14} />}
              관심
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
