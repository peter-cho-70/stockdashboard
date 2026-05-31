"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Star, Trash2, Loader2, BarChart, RefreshCw, Sparkles } from "lucide-react";
import { watchlistApi, signalApi, type WatchlistItem, type StockRecommendation } from "@/lib/api";

function SentBadge({ s }: { s: string | null }) {
  if (s === "POSITIVE") return <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">긍정</span>;
  if (s === "NEGATIVE") return <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] text-red-700 dark:bg-red-900/30 dark:text-red-400">부정</span>;
  return <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] text-neutral-500 dark:bg-neutral-800">중립</span>;
}

export default function WatchlistPage() {
  const router = useRouter();
  const [items, setItems] = useState<WatchlistItem[]>([]);
  const [recommendations, setRecommendations] = useState<StockRecommendation[]>([]);
  const [loading, setLoading] = useState(true);
  const [sectorFilter, setSectorFilter] = useState<string>("");
  const [adding, setAdding] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [wl, rec] = await Promise.all([
        watchlistApi.getAll(),
        signalApi.getRecommendations(30, sectorFilter || undefined),
      ]);
      setItems(wl.items);
      setRecommendations(rec.recommendations);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [sectorFilter]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  async function handleAdd(rec: StockRecommendation) {
    setAdding(rec.stock_name);
    try {
      await watchlistApi.add({
        stock_name: rec.stock_name,
        symbol: rec.symbol ?? undefined,
        sector: rec.sector || undefined,
        source_type: "sector",
      });
      await load();
    } catch {
      /* ignore */
    } finally {
      setAdding(null);
    }
  }

  async function handleRemove(id: number) {
    await watchlistApi.remove(id);
    setItems((prev) => prev.filter((i) => i.id !== id));
  }

  const watchedNames = useMemo(() => new Set(items.map((i) => i.stock_name)), [items]);

  const SECTORS = ["", "반도체", "AI·빅테크", "2차전지", "자동차", "바이오·헬스케어", "금융", "에너지"];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">관심 종목</h1>
        <p className="mt-0.5 text-xs text-neutral-400">
          AI 섹터·매크로 분석에서 언급된 종목을 지켜보고, 차트·분석 데이터를 확인합니다 (모의투자 아님)
        </p>
      </div>

      {/* AI 추천 종목 */}
      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-4 py-3">
          <div className="flex items-center gap-2">
            <Sparkles size={14} className="text-amber-500" />
            <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">AI 추천 · 언급 종목</h2>
            <span className="text-xs text-neutral-400">({recommendations.length}건)</span>
          </div>
          <select
            value={sectorFilter}
            onChange={(e) => setSectorFilter(e.target.value)}
            className="rounded-md border border-[var(--border-subtle)] bg-[var(--background)] px-2 py-1 text-xs"
          >
            <option value="">전체 섹터</option>
            {SECTORS.filter(Boolean).map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-neutral-400">
            <Loader2 size={14} className="animate-spin" /> 불러오는 중...
          </div>
        ) : recommendations.length === 0 ? (
          <div className="py-10 text-center text-sm text-neutral-400">
            추천 종목이 없습니다. AI 인텔리전스에서 영상을 분석하고 백필을 실행하세요.
          </div>
        ) : (
          <div className="divide-y divide-[var(--border-subtle)]">
            {recommendations.map((rec) => (
              <div
                key={rec.stock_name}
                role={rec.symbol ? "button" : undefined}
                tabIndex={rec.symbol ? 0 : undefined}
                onClick={() => {
                  if (rec.symbol) router.push(`/chart?symbol=${rec.symbol}`);
                }}
                onKeyDown={(e) => {
                  if (rec.symbol && (e.key === "Enter" || e.key === " ")) {
                    e.preventDefault();
                    router.push(`/chart?symbol=${rec.symbol}`);
                  }
                }}
                className={`flex items-start gap-3 px-4 py-3 hover:bg-[var(--surface-elevated)] ${
                  rec.symbol ? "cursor-pointer" : ""
                }`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">{rec.stock_name}</span>
                    {rec.symbol && <span className="text-xs text-neutral-400">{rec.symbol}</span>}
                    {rec.sector && (
                      <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-500 dark:bg-neutral-800">{rec.sector}</span>
                    )}
                    <SentBadge s={rec.latest_sentiment} />
                    <span className="text-[10px] text-neutral-400">언급 {rec.mention_count}회 · {rec.latest_date}</span>
                  </div>
                  <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-400 line-clamp-2">{rec.latest_summary}</p>
                </div>
                <div className="flex shrink-0 gap-1" onClick={(e) => e.stopPropagation()}>
                  {rec.symbol && (
                    <Link
                      href={`/chart?symbol=${rec.symbol}`}
                      className="rounded-md border border-[var(--border-subtle)] p-1.5 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                      title="차트"
                    >
                      <BarChart size={14} />
                    </Link>
                  )}
                  {watchedNames.has(rec.stock_name) ? (
                    <span className="rounded-md bg-amber-100 px-2 py-1.5 text-[10px] text-amber-800 dark:bg-amber-900/30 dark:text-amber-400">등록됨</span>
                  ) : (
                    <button
                      type="button"
                      disabled={adding === rec.stock_name}
                      onClick={() => handleAdd(rec)}
                      className="flex items-center gap-1 rounded-md bg-neutral-900 px-2 py-1.5 text-[10px] font-medium text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
                    >
                      {adding === rec.stock_name ? <Loader2 size={12} className="animate-spin" /> : <Star size={12} />}
                      지켜보기
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 내 관심 목록 */}
      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] overflow-hidden">
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-4 py-3">
          <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">
            내 관심 목록 <span className="text-xs font-normal text-neutral-400">({items.length})</span>
          </h2>
          <button onClick={load} className="flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-700">
            <RefreshCw size={11} /> 새로고침
          </button>
        </div>
        {items.length === 0 ? (
          <div className="py-10 text-center text-sm text-neutral-400">
            위 AI 추천에서 「지켜보기」를 눌러 추가하세요.
          </div>
        ) : (
          <div className="divide-y divide-[var(--border-subtle)]">
            {items.map((item) => (
              <div
                key={item.id}
                role={item.symbol ? "button" : undefined}
                tabIndex={item.symbol ? 0 : undefined}
                onClick={() => {
                  if (item.symbol) router.push(`/chart?symbol=${item.symbol}`);
                }}
                onKeyDown={(e) => {
                  if (item.symbol && (e.key === "Enter" || e.key === " ")) {
                    e.preventDefault();
                    router.push(`/chart?symbol=${item.symbol}`);
                  }
                }}
                className={`flex items-center gap-3 px-4 py-3 ${
                  item.symbol ? "cursor-pointer hover:bg-[var(--surface-elevated)]" : ""
                }`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">
                      {item.stock_name}
                    </span>
                    {item.symbol && <span className="text-xs text-neutral-400">{item.symbol}</span>}
                    {item.sector && <span className="text-[10px] text-neutral-400">{item.sector}</span>}
                  </div>
                  {item.current_price != null && (
                    <p className="text-xs text-neutral-500 mt-0.5">
                      {item.current_price.toLocaleString()}원
                      {item.change_rate != null && (
                        <span className={item.change_rate >= 0 ? " text-emerald-600 ml-1" : " text-red-500 ml-1"}>
                          {item.change_rate >= 0 ? "+" : ""}{item.change_rate.toFixed(2)}%
                        </span>
                      )}
                    </p>
                  )}
                </div>
                <div className="flex gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                  {item.symbol && (
                    <Link href={`/intelligence?page=remind`} className="text-[10px] text-neutral-400 hover:text-neutral-600 px-2 py-1">
                      AI 분석
                    </Link>
                  )}
                  <button
                    type="button"
                    onClick={() => handleRemove(item.id)}
                    className="rounded p-1.5 text-neutral-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
