"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Loader2,
  Layers,
  ExternalLink,
  Newspaper,
  Video,
  FileText,
  TrendingUp,
  Wallet,
  Flame,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import {
  api,
  groupsApi,
  type StockGroup,
  type StockChartBar,
  type GroupContentItem,
  type GroupLiveNewsItem,
  type GroupRelatedEtf,
} from "@/lib/api";
import { krChangeClass } from "@/lib/krMarketColors";
import { ClientOnly } from "@/components/client-only";

type ComparePeriod = "1M" | "3M" | "6M" | "1Y";

const COMPARE_PERIODS: { id: ComparePeriod; label: string }[] = [
  { id: "1M", label: "1개월" },
  { id: "3M", label: "3개월" },
  { id: "6M", label: "6개월" },
  { id: "1Y", label: "1년" },
];

const COMPARE_LINE_COLORS = [
  "#8b5cf6", "#10b981", "#f59e0b", "#06b6d4",
  "#ec4899", "#84cc16", "#0f766e", "#64748b",
];

function compareDateTick(period: ComparePeriod, date: string): string {
  if (period === "6M" || period === "1Y") return date.slice(2, 7);
  return date.slice(5);
}

function CompareTooltip({
  active,
  payload,
  label,
  nameBySymbol,
}: {
  active?: boolean;
  payload?: { dataKey?: string; value?: number; color?: string }[];
  label?: string;
  nameBySymbol: Map<string, string>;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const items = payload.filter((p) => p.value != null);
  if (items.length === 0) return null;
  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] p-3 text-xs shadow-lg">
      <p className="mb-1.5 font-semibold text-neutral-700 dark:text-neutral-300">{label}</p>
      {items.map((p) => (
        <div key={p.dataKey} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-neutral-600 dark:text-neutral-400">
            <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ backgroundColor: p.color }} />
            {nameBySymbol.get(p.dataKey ?? "") ?? p.dataKey}
          </span>
          <span className={`font-medium tabular-nums ${krChangeClass(p.value ?? 0)}`}>
            {(p.value ?? 0) > 0 ? "+" : ""}
            {(p.value ?? 0).toFixed(2)}%
          </span>
        </div>
      ))}
    </div>
  );
}

function SourceIcon({ type }: { type: string }) {
  if (type === "YOUTUBE") return <Video size={14} className="text-red-500" />;
  if (type === "NEWS") return <Newspaper size={14} className="text-blue-500" />;
  return <FileText size={14} className="text-neutral-400" />;
}

function SentimentDot({ sentiment }: { sentiment: string | null }) {
  const cls =
    sentiment === "POSITIVE"
      ? "bg-red-500"
      : sentiment === "NEGATIVE"
        ? "bg-blue-500"
        : "bg-neutral-400";
  return <span className={`size-1.5 shrink-0 rounded-full ${cls}`} />;
}

function fmtDate(s: string | null): string {
  if (!s) return "";
  try {
    return new Date(s).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" });
  } catch {
    return "";
  }
}

function AnalyzedContentCard({ item }: { item: GroupContentItem }) {
  return (
    <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--surface)] p-3 space-y-1.5">
      <div className="flex items-center gap-2">
        <SourceIcon type={item.source_type} />
        {item.channel_name && (
          <span className="text-[11px] font-medium text-neutral-500">{item.channel_name}</span>
        )}
        <SentimentDot sentiment={item.sentiment} />
        <span className="ml-auto text-[10px] text-neutral-400">
          {fmtDate(item.analyzed_at ?? item.published_at)}
        </span>
      </div>
      {item.source_title && (
        item.source_url ? (
          <a
            href={item.source_url}
            target="_blank"
            rel="noopener noreferrer"
            className="block text-sm font-medium text-neutral-800 hover:text-violet-600 dark:text-neutral-200 dark:hover:text-violet-400"
          >
            {item.source_title}
          </a>
        ) : (
          <p className="text-sm font-medium text-neutral-800 dark:text-neutral-200">{item.source_title}</p>
        )
      )}
      {item.summary && (
        <p className="text-xs text-neutral-600 dark:text-neutral-400 line-clamp-2">{item.summary}</p>
      )}
      {item.matched_members.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {item.matched_members.map((m) => (
            <span
              key={m}
              className="rounded-full border border-[var(--border-subtle)] px-2 py-0.5 text-[10px] text-neutral-500"
            >
              {m}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function EtfRow({ etf, onSelect }: { etf: GroupRelatedEtf; onSelect: (code: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(etf.code)}
      className="flex w-full items-center justify-between gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] px-3 py-2.5 text-left transition-colors hover:border-violet-300 dark:hover:border-violet-700"
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="truncate text-sm font-medium text-neutral-800 dark:text-neutral-200">
            {etf.name}
          </span>
          {etf.held && (
            <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[9px] font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
              보유
            </span>
          )}
          <span className="rounded-full border border-[var(--border-subtle)] px-1.5 py-0.5 text-[9px] text-neutral-400">
            {etf.category_label}
          </span>
        </div>
        <p className="mt-0.5 text-[11px] text-neutral-400">
          {etf.matched_symbols.length}종목 겹침
          {etf.held && etf.qty != null && ` · 보유 ${etf.qty.toLocaleString("ko-KR")}주`}
          {etf.held && etf.profit_rate != null && (
            <span className={krChangeClass(etf.profit_rate)}>
              {" "}
              (평가 {etf.profit_rate > 0 ? "+" : ""}
              {etf.profit_rate.toFixed(1)}%)
            </span>
          )}
        </p>
      </div>
      <div className="shrink-0 text-right">
        {etf.current_price != null && (
          <p className="text-sm tabular-nums text-neutral-700 dark:text-neutral-300">
            {etf.current_price.toLocaleString("ko-KR")}
          </p>
        )}
        <div className="flex items-center justify-end gap-1.5">
          {etf.change_rate != null && (
            <span className={`text-[11px] tabular-nums ${krChangeClass(etf.change_rate)}`}>
              {etf.change_rate > 0 ? "+" : ""}
              {etf.change_rate.toFixed(2)}%
            </span>
          )}
          {etf.return_3m != null && (
            <span
              className={`rounded-full border border-current/30 px-1.5 py-0.5 text-[10px] tabular-nums ${krChangeClass(etf.return_3m)}`}
            >
              3개월 {etf.return_3m > 0 ? "+" : ""}
              {etf.return_3m.toFixed(1)}%
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

function LiveNewsRow({ item }: { item: GroupLiveNewsItem }) {
  return (
    <a
      href={item.url || undefined}
      target="_blank"
      rel="noopener noreferrer"
      className="block rounded-md border border-[var(--border-subtle)] bg-[var(--surface)] px-3 py-2 hover:border-sky-300 dark:hover:border-sky-700"
    >
      <p className="flex items-start gap-1.5 text-sm text-neutral-800 dark:text-neutral-200">
        <ExternalLink size={12} className="mt-0.5 shrink-0 text-sky-500" />
        <span className="line-clamp-2">{item.title}</span>
      </p>
      {item.snippet && (
        <p className="mt-1 text-xs text-neutral-500 line-clamp-2">{item.snippet}</p>
      )}
    </a>
  );
}

export default function GroupDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const groupId = Number(params.id);

  const [group, setGroup] = useState<StockGroup | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [analyzed, setAnalyzed] = useState<GroupContentItem[]>([]);
  const [liveNews, setLiveNews] = useState<GroupLiveNewsItem[]>([]);
  const [contentLoading, setContentLoading] = useState(true);
  const [contentError, setContentError] = useState<string | null>(null);

  const [etfHeld, setEtfHeld] = useState<GroupRelatedEtf[]>([]);
  const [etfHot, setEtfHot] = useState<GroupRelatedEtf[]>([]);
  const [etfAll, setEtfAll] = useState<GroupRelatedEtf[]>([]);
  const [etfLoading, setEtfLoading] = useState(true);
  const [etfError, setEtfError] = useState<string | null>(null);
  const [showAllEtfs, setShowAllEtfs] = useState(false);

  const [comparePeriod, setComparePeriod] = useState<ComparePeriod>("3M");
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareBars, setCompareBars] = useState<Record<string, StockChartBar[]>>({});
  const [compareFailed, setCompareFailed] = useState<Set<string>>(new Set());
  const [enabledSymbols, setEnabledSymbols] = useState<Set<string>>(new Set());

  const memberSymbolsKey = group?.members.map((m) => m.symbol).join(",") ?? "";

  useEffect(() => {
    if (!group) return;
    setEnabledSymbols(new Set(group.members.map((m) => m.symbol)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group?.id, memberSymbolsKey]);

  const memberColorMap = useMemo(() => {
    const map = new Map<string, string>();
    (group?.members ?? []).forEach((m, idx) => {
      map.set(m.symbol, COMPARE_LINE_COLORS[idx % COMPARE_LINE_COLORS.length]);
    });
    return map;
  }, [group]);

  const memberNameMap = useMemo(() => {
    const map = new Map<string, string>();
    (group?.members ?? []).forEach((m) => map.set(m.symbol, m.name));
    return map;
  }, [group]);

  const loadCompareCharts = useCallback(async () => {
    if (!group || group.members.length === 0) return;
    setCompareLoading(true);
    const members = group.members;
    const results = await Promise.allSettled(
      members.map((m) => api.getStockChart(m.symbol, comparePeriod)),
    );
    const bars: Record<string, StockChartBar[]> = {};
    const failed = new Set<string>();
    results.forEach((r, i) => {
      const symbol = members[i].symbol;
      if (r.status === "fulfilled" && Array.isArray(r.value.data) && r.value.data.length > 0) {
        bars[symbol] = r.value.data;
      } else {
        failed.add(symbol);
      }
    });
    setCompareBars(bars);
    setCompareFailed(failed);
    setCompareLoading(false);
  }, [group, comparePeriod]);

  useEffect(() => {
    loadCompareCharts();
  }, [loadCompareCharts]);

  const compareByDateMaps = useMemo(() => {
    const maps = new Map<string, Map<string, number>>();
    for (const [symbol, bars] of Object.entries(compareBars)) {
      maps.set(symbol, new Map(bars.map((b) => [b.date, b.close])));
    }
    return maps;
  }, [compareBars]);

  const activeCompareSymbols = useMemo(
    () =>
      (group?.members ?? [])
        .map((m) => m.symbol)
        .filter((s) => enabledSymbols.has(s) && (compareByDateMaps.get(s)?.size ?? 0) > 0),
    [group, enabledSymbols, compareByDateMaps],
  );

  const compareChartRows = useMemo(() => {
    if (activeCompareSymbols.length === 0) return [];
    const dateSet = new Set<string>();
    activeCompareSymbols.forEach((s) => {
      for (const d of compareByDateMaps.get(s)!.keys()) dateSet.add(d);
    });
    const dates = Array.from(dateSet).sort();
    const baseClose = new Map<string, number>();
    activeCompareSymbols.forEach((s) => {
      const byDate = compareByDateMaps.get(s)!;
      const firstDate = dates.find((d) => byDate.has(d));
      if (firstDate != null) baseClose.set(s, byDate.get(firstDate)!);
    });
    return dates.map((date) => {
      const row: Record<string, string | number | null> = { date };
      activeCompareSymbols.forEach((s) => {
        const byDate = compareByDateMaps.get(s)!;
        const close = byDate.get(date);
        const base = baseClose.get(s);
        row[s] = close != null && base ? ((close - base) / base) * 100 : null;
      });
      return row;
    });
  }, [activeCompareSymbols, compareByDateMaps]);

  function toggleCompareMember(symbol: string) {
    setEnabledSymbols((prev) => {
      const next = new Set(prev);
      if (next.has(symbol)) next.delete(symbol);
      else next.add(symbol);
      return next;
    });
  }

  const load = useCallback(async () => {
    if (!groupId) return;
    setLoading(true);
    setError(null);
    try {
      const g = await groupsApi.getById(groupId);
      setGroup(g);
    } catch (e) {
      setError(e instanceof Error ? e.message : "그룹을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  const loadContent = useCallback(async () => {
    if (!groupId) return;
    setContentLoading(true);
    setContentError(null);
    try {
      const res = await groupsApi.getContent(groupId);
      setAnalyzed(res.analyzed);
      setLiveNews(res.live_news);
    } catch (e) {
      setContentError(e instanceof Error ? e.message : "관련 기사·영상을 불러오지 못했습니다.");
    } finally {
      setContentLoading(false);
    }
  }, [groupId]);

  const loadEtfPanel = useCallback(async () => {
    if (!groupId) return;
    setEtfLoading(true);
    setEtfError(null);
    try {
      const res = await groupsApi.getEtfPanel(groupId);
      setEtfHeld(res.held);
      setEtfHot(res.hot);
      setEtfAll(res.related);
    } catch (e) {
      setEtfError(e instanceof Error ? e.message : "관련 ETF를 불러오지 못했습니다.");
    } finally {
      setEtfLoading(false);
    }
  }, [groupId]);

  useEffect(() => {
    load();
    loadContent();
    loadEtfPanel();
  }, [load, loadContent, loadEtfPanel]);

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-20 text-sm text-neutral-400">
        <Loader2 size={16} className="animate-spin" /> 불러오는 중...
      </div>
    );
  }

  if (error || !group) {
    return (
      <div className="space-y-3">
        <button
          type="button"
          onClick={() => router.push("/groups")}
          className="flex items-center gap-1 text-sm text-neutral-500 hover:text-violet-600"
        >
          <ArrowLeft size={14} /> 종목 그룹
        </button>
        <p className="text-sm text-red-500">{error ?? "그룹을 찾을 수 없습니다."}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <button
          type="button"
          onClick={() => router.push("/groups")}
          className="mb-2 flex items-center gap-1 text-xs text-neutral-400 hover:text-violet-600"
        >
          <ArrowLeft size={12} /> 종목 그룹
        </button>
        <div className="flex items-center gap-1.5">
          <Layers size={18} className="text-violet-500" />
          <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">{group.name}</h1>
          <span className="text-sm text-neutral-400">{group.members.length}종목</span>
        </div>
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-neutral-600 dark:text-neutral-400">시세</h2>
        {group.members.length === 0 ? (
          <p className="text-xs text-neutral-400">아직 등록된 종목이 없습니다.</p>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {group.members.map((m) => (
              <button
                key={m.symbol}
                type="button"
                onClick={() => router.push(`/chart?symbol=${m.symbol}`)}
                className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] px-3 py-2 text-left hover:border-violet-300 dark:hover:border-violet-700"
              >
                <p className="flex items-center gap-1 text-sm font-medium text-neutral-800 dark:text-neutral-200">
                  {m.name}
                  {m.is_holding && (
                    <span className="rounded bg-neutral-200 px-1 py-0.5 text-[9px] text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300">
                      보유
                    </span>
                  )}
                </p>
                <p className="text-sm tabular-nums text-neutral-700 dark:text-neutral-300">
                  {m.current_price != null ? m.current_price.toLocaleString("ko-KR") : "—"}
                </p>
                {m.change_rate != null && (
                  <p className={`text-xs tabular-nums ${krChangeClass(m.change_rate)}`}>
                    {m.change_rate > 0 ? "+" : ""}
                    {m.change_rate.toFixed(2)}%
                  </p>
                )}
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-neutral-600 dark:text-neutral-400">
            <TrendingUp size={14} className="text-violet-500" />
            가격 추이 비교
            {compareLoading && <Loader2 size={12} className="animate-spin text-neutral-400" />}
          </h2>
          <div className="flex gap-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-elevated)] p-1">
            {COMPARE_PERIODS.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                onClick={() => setComparePeriod(id)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  comparePeriod === id
                    ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                    : "text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {group.members.length < 2 ? (
          <p className="text-xs text-neutral-400">비교할 다른 종목이 없습니다.</p>
        ) : (
          <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] p-4">
            <div className="mb-3 flex flex-wrap gap-1.5">
              {group.members.map((m) => {
                const on = enabledSymbols.has(m.symbol);
                const failed = compareFailed.has(m.symbol);
                const color = memberColorMap.get(m.symbol) ?? "#94a3b8";
                return (
                  <button
                    key={m.symbol}
                    type="button"
                    disabled={failed}
                    onClick={() => toggleCompareMember(m.symbol)}
                    title={failed ? "차트 데이터 없음" : undefined}
                    className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                      on && !failed
                        ? "border-transparent text-white"
                        : "border-[var(--border-subtle)] text-neutral-400"
                    }`}
                    style={on && !failed ? { backgroundColor: color, borderColor: color } : {}}
                  >
                    <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
                    {m.name}
                  </button>
                );
              })}
            </div>

            {compareChartRows.length === 0 ? (
              <p className="py-10 text-center text-xs text-neutral-400">
                {compareLoading ? "차트를 불러오는 중..." : "표시할 비교 데이터가 없습니다."}
              </p>
            ) : (
              <ClientOnly fallback={<div style={{ height: 260 }} aria-hidden />}>
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={compareChartRows} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 11, fill: "var(--foreground)" }}
                      tickLine={false}
                      interval="preserveStartEnd"
                      tickFormatter={(v) => compareDateTick(comparePeriod, v)}
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: "var(--foreground)" }}
                      tickFormatter={(v) => `${v > 0 ? "+" : ""}${v}%`}
                      tickLine={false}
                      axisLine={false}
                      width={48}
                    />
                    <Tooltip content={<CompareTooltip nameBySymbol={memberNameMap} />} />
                    {activeCompareSymbols.map((symbol) => (
                      <Line
                        key={symbol}
                        type="monotone"
                        dataKey={symbol}
                        name={memberNameMap.get(symbol) ?? symbol}
                        stroke={memberColorMap.get(symbol) ?? "#94a3b8"}
                        strokeWidth={1.75}
                        dot={false}
                        connectNulls
                        activeDot={{ r: 3 }}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </ClientOnly>
            )}
            <p className="mt-2 text-[10px] text-neutral-400">
              구간 시작일 종가 대비 등락률(%) 기준 비교 · 종목명을 눌러 표시 여부를 전환하세요.
            </p>
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-neutral-600 dark:text-neutral-400">
          <Wallet size={14} className="text-violet-500" />
          관련 ETF
          {etfLoading && <Loader2 size={12} className="animate-spin text-neutral-400" />}
        </h2>
        <p className="text-[11px] text-neutral-400">
          그룹 종목을 2개 이상 담고 있는 순으로 주요 ETF를 찾아, 내가 보유 중인 것과 최근 3개월
          수익률이 좋은 것을 나눠 보여줍니다.
        </p>

        {etfError ? (
          <p className="text-xs text-red-500">{etfError}</p>
        ) : etfLoading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-neutral-400">
            <Loader2 size={14} className="animate-spin" /> 불러오는 중...
          </div>
        ) : etfAll.length === 0 ? (
          <p className="text-xs text-neutral-400">그룹 종목을 담고 있는 주요 ETF를 찾지 못했습니다.</p>
        ) : (
          <>
            <div className="grid gap-3 lg:grid-cols-2">
              <div className="space-y-2">
                <p className="flex items-center gap-1 text-xs font-medium text-neutral-500">
                  <Wallet size={12} /> 내가 보유 중인 관련 ETF
                </p>
                {etfHeld.length === 0 ? (
                  <p className="text-xs text-neutral-400">보유 중인 관련 ETF가 없습니다.</p>
                ) : (
                  <div className="space-y-1.5">
                    {etfHeld.map((etf) => (
                      <EtfRow key={etf.code} etf={etf} onSelect={(code) => router.push(`/etf/${code}`)} />
                    ))}
                  </div>
                )}
              </div>
              <div className="space-y-2">
                <p className="flex items-center gap-1 text-xs font-medium text-neutral-500">
                  <Flame size={12} className="text-orange-500" /> 요즘 핫한 관련 ETF (3개월 수익률)
                </p>
                {etfHot.length === 0 ? (
                  <p className="text-xs text-neutral-400">수익률 데이터가 있는 관련 ETF가 없습니다.</p>
                ) : (
                  <div className="space-y-1.5">
                    {etfHot.map((etf) => (
                      <EtfRow key={etf.code} etf={etf} onSelect={(code) => router.push(`/etf/${code}`)} />
                    ))}
                  </div>
                )}
              </div>
            </div>

            {etfAll.length > 0 && (
              <div className="pt-1">
                <button
                  type="button"
                  onClick={() => setShowAllEtfs((v) => !v)}
                  className="flex items-center gap-1 text-[11px] text-neutral-400 hover:text-violet-600"
                >
                  {showAllEtfs ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                  전체 관련 ETF {etfAll.length}개 {showAllEtfs ? "접기" : "보기"}
                </button>
                {showAllEtfs && (
                  <div className="mt-2 space-y-1.5">
                    {etfAll.map((etf) => (
                      <EtfRow key={etf.code} etf={etf} onSelect={(code) => router.push(`/etf/${code}`)} />
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-neutral-600 dark:text-neutral-400">
          관련 영상 · 기사 (AI 분석)
        </h2>
        {contentLoading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-neutral-400">
            <Loader2 size={14} className="animate-spin" /> 불러오는 중...
          </div>
        ) : contentError ? (
          <p className="text-xs text-red-500">{contentError}</p>
        ) : analyzed.length === 0 ? (
          <p className="text-xs text-neutral-400">
            아직 이 그룹 종목을 언급한 분석된 영상·뉴스가 없습니다.
          </p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {analyzed.map((item) => (
              <AnalyzedContentCard key={item.id} item={item} />
            ))}
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-neutral-600 dark:text-neutral-400">최신 뉴스 검색</h2>
        {contentLoading ? null : liveNews.length === 0 ? (
          <p className="text-xs text-neutral-400">최신 뉴스를 찾지 못했습니다.</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {liveNews.map((n, i) => (
              <LiveNewsRow key={i} item={n} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
