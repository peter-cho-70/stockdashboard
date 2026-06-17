"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Loader2, RefreshCw, TrendingUp } from "lucide-react";
import {
  marketApi,
  type KrMarketMover,
  type KrMarketSnapshot,
  type UsMarketQuote,
} from "@/lib/api";
import { loadKrSnapshotCache, saveKrSnapshotCache } from "@/lib/marketCache";
import { todayKst } from "@/lib/marketDisplay";
import { krChangeClass, krChangeBgClass } from "@/lib/krMarketColors";
import { MoverRow, SectionTitle } from "@/components/market-view-parts";
import { KrIntradayChart } from "@/components/kr-intraday-chart";
import { StockPreviewModal, type StockPreviewItem } from "@/components/stock-preview-modal";
import {
  GroupStocksModal,
  type GroupPreviewTarget,
} from "@/components/group-stocks-modal";

function formatClose(item: UsMarketQuote): string {
  if (item.error || item.close == null) return "—";
  if (item.unit === "fx") {
    return `${item.close.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}원`;
  }
  return item.close.toLocaleString("ko-KR", { maximumFractionDigits: 2 });
}

function ChangePct({ value }: { value?: number }) {
  const v = value ?? 0;
  return (
    <p className={`text-xs font-medium tabular-nums ${krChangeClass(v)}`}>
      {v >= 0 ? "+" : ""}
      {v.toFixed(2)}%
    </p>
  );
}

function IndexCard({ item }: { item: UsMarketQuote }) {
  const asOf = item.as_of_label ?? item.date ?? null;
  const extra = item as UsMarketQuote & { trading_value_억?: number };
  return (
    <div className="rounded-md border border-[var(--border-subtle)] px-3 py-2">
      <p className="text-[10px] text-neutral-400 leading-tight">{item.name}</p>
      {item.error ? (
        <p className="text-xs text-neutral-500">—</p>
      ) : (
        <>
          <p className="text-sm font-semibold tabular-nums">{formatClose(item)}</p>
          <ChangePct value={item.change_pct} />
          {extra.trading_value_억 != null && (
            <p className="text-[9px] text-neutral-400 mt-0.5">
              거래대금 {extra.trading_value_억.toLocaleString("ko-KR")}억
            </p>
          )}
          {asOf && (
            <p className="text-[9px] text-neutral-400 mt-0.5 tabular-nums leading-tight">{asOf}</p>
          )}
        </>
      )}
    </div>
  );
}

function BreadthBar({
  label,
  stats,
}: {
  label: string;
  stats?: {
    advancers?: number;
    decliners?: number;
    foreign_net_억?: number;
    institution_net_억?: number;
    individual_net_억?: number;
  };
}) {
  if (!stats) return null;
  const total = (stats.advancers ?? 0) + (stats.decliners ?? 0);
  const upPct = total > 0 ? ((stats.advancers ?? 0) / total) * 100 : 50;
  return (
    <div className="rounded-md border border-[var(--border-subtle)] px-3 py-2 space-y-2">
      <p className="text-[10px] font-medium text-neutral-500">{label}</p>
      <div className="flex h-1.5 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-700">
        <div className={krChangeBgClass(1)} style={{ width: `${upPct}%` }} />
        <div className={`flex-1 ${krChangeBgClass(-1)}`} />
      </div>
      <div className="flex justify-between text-[10px] text-neutral-500">
        <span className="text-red-600 dark:text-red-400">상승 {stats.advancers ?? "—"}</span>
        <span className="text-blue-600 dark:text-blue-400">하락 {stats.decliners ?? "—"}</span>
      </div>
      <div className="grid grid-cols-3 gap-1 text-[9px] text-neutral-400">
        <span>외국인 {fmtNet(stats.foreign_net_억)}</span>
        <span>기관 {fmtNet(stats.institution_net_억)}</span>
        <span>개인 {fmtNet(stats.individual_net_억)}</span>
      </div>
    </div>
  );
}

function fmtNet(v?: number) {
  if (v == null) return "—";
  return `${v > 0 ? "+" : ""}${v.toLocaleString("ko-KR")}억`;
}

function SectorChip({
  name,
  change_pct,
  onSelect,
}: {
  name: string;
  change_pct: number;
  onSelect?: () => void;
}) {
  const inner = (
    <>
      <p className="text-[10px] text-neutral-500 line-clamp-2 leading-tight min-h-[2rem]">{name}</p>
      <ChangePct value={change_pct} />
    </>
  );
  if (onSelect) {
    return (
      <button
        type="button"
        onClick={onSelect}
        className="rounded-md border border-[var(--border-subtle)] px-2.5 py-2 text-left transition-colors hover:bg-[var(--surface-elevated)] hover:border-neutral-300 dark:hover:border-neutral-600"
      >
        {inner}
      </button>
    );
  }
  return (
    <div className="rounded-md border border-[var(--border-subtle)] px-2.5 py-2">{inner}</div>
  );
}

type RankTab =
  | "upper"
  | "volume"
  | "gainers"
  | "foreign"
  | "institution";

const RANK_TABS: { id: RankTab; label: string }[] = [
  { id: "upper", label: "상한가" },
  { id: "volume", label: "거래량" },
  { id: "gainers", label: "급등" },
  { id: "foreign", label: "외국인" },
  { id: "institution", label: "기관" },
];

function RankList({
  items,
  onSelect,
}: {
  items: KrMarketMover[];
  onSelect?: (item: StockPreviewItem) => void;
}) {
  if (!items.length) {
    return <p className="text-xs text-neutral-400 py-4 text-center">데이터 없음</p>;
  }
  return (
    <div className="grid gap-1 sm:grid-cols-2">
      {items.map((item) => (
        <MoverRow
          key={`${item.symbol}-${item.market ?? ""}`}
          item={item}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

function InvestorList({
  buy,
  sell,
  onSelect,
}: {
  buy: KrMarketMover[];
  sell: KrMarketMover[];
  onSelect?: (item: StockPreviewItem) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div>
        <p className="text-[10px] font-medium text-red-600 dark:text-red-400 mb-1.5">순매수 상위</p>
        <RankList items={buy} onSelect={onSelect} />
      </div>
      <div>
        <p className="text-[10px] font-medium text-blue-600 dark:text-blue-400 mb-1.5">순매도 상위</p>
        <RankList items={sell} onSelect={onSelect} />
      </div>
    </div>
  );
}

export function KrMarketCard({ marketToggle }: { marketToggle?: ReactNode }) {
  const sessionDate = todayKst();
  const [snapshot, setSnapshot] = useState<KrMarketSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chartIndex, setChartIndex] = useState<"kospi" | "kosdaq">("kospi");
  const [rankTab, setRankTab] = useState<RankTab>("upper");
  const [previewItem, setPreviewItem] = useState<StockPreviewItem | null>(null);
  const [groupPreview, setGroupPreview] = useState<GroupPreviewTarget | null>(null);

  const openGroup = useCallback(
    (kind: "theme" | "industry", item: { name: string; change_pct: number; group_no?: string | null; theme_no?: string | null }) => {
      const no = item.group_no || item.theme_no;
      if (!no) return;
      setGroupPreview({
        kind,
        name: item.name,
        group_no: no,
        change_pct: item.change_pct,
      });
    },
    [],
  );

  const openPreview = useCallback((item: KrMarketMover) => {
    setPreviewItem({
      symbol: item.symbol,
      name: item.name,
      close: item.close,
      change_pct: item.change_pct,
      market: item.market,
    });
  }, []);

  const load = useCallback(async (force = false) => {
    if (!force && !snapshot) setLoading(true);
    setError(null);
    try {
      const { snapshot: data } = await marketApi.getKrMarketSnapshot(force);
      setSnapshot(data);
      saveKrSnapshotCache(data);
    } catch (e) {
      if (!snapshot) {
        setError(e instanceof Error ? e.message : "국내 지수 로드 실패");
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [snapshot]);

  useEffect(() => {
    if (snapshot?.session_date === sessionDate) return;
    const hit = loadKrSnapshotCache(sessionDate);
    if (hit) {
      setSnapshot(hit);
      setLoading(false);
      return;
    }
    load(false);
  }, [sessionDate, snapshot?.session_date, load]);

  const chartPoints =
    chartIndex === "kospi"
      ? snapshot?.index_chart?.kospi ?? []
      : snapshot?.index_chart?.kosdaq ?? [];

  const upperItems = [
    ...(snapshot?.rankings?.upper_limit?.kospi ?? []),
    ...(snapshot?.rankings?.upper_limit?.kosdaq ?? []),
  ];
  const volumeItems = [
    ...(snapshot?.rankings?.volume?.kospi ?? []),
    ...(snapshot?.rankings?.volume?.kosdaq ?? []),
  ].sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0));

  const rankContent = (() => {
    switch (rankTab) {
      case "upper":
        return <RankList items={upperItems} onSelect={openPreview} />;
      case "volume":
        return <RankList items={volumeItems.slice(0, 12)} onSelect={openPreview} />;
      case "gainers":
        return <RankList items={snapshot?.movers?.hot_gainers ?? []} onSelect={openPreview} />;
      case "foreign":
        return (
          <InvestorList
            buy={snapshot?.investor_flow?.foreign?.buy ?? []}
            sell={snapshot?.investor_flow?.foreign?.sell ?? []}
            onSelect={openPreview}
          />
        );
      case "institution":
        return (
          <InvestorList
            buy={snapshot?.investor_flow?.institution?.buy ?? []}
            sell={snapshot?.investor_flow?.institution?.sell ?? []}
            onSelect={openPreview}
          />
        );
      default:
        return null;
    }
  })();

  return (
    <>
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-subtle)] px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          {marketToggle}
          <TrendingUp size={16} className="text-red-500" />
          <h2 className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">
            오늘의 국내 증시
          </h2>
          {snapshot?.session_date && (
            <span className="text-xs text-neutral-400">{snapshot.session_date}</span>
          )}
        </div>
        <button
          type="button"
          onClick={() => {
            setRefreshing(true);
            load(true);
          }}
          disabled={refreshing}
          className="flex items-center gap-1.5 rounded-md border border-[var(--border-subtle)] px-2.5 py-1 text-xs font-medium hover:bg-[var(--surface-elevated)] disabled:opacity-50"
        >
          <RefreshCw size={12} className={refreshing ? "animate-spin" : ""} />
          {refreshing ? "갱신 중..." : "시세 갱신"}
        </button>
      </div>

      {loading && !snapshot ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-neutral-400">
          <Loader2 size={16} className="animate-spin" />
          로딩 중...
        </div>
      ) : error && !snapshot ? (
        <div className="px-4 py-6 text-sm text-red-500">{error}</div>
      ) : snapshot ? (
        <div className="p-4 space-y-4 max-h-[760px] overflow-y-auto">
          <div className="grid gap-4 lg:grid-cols-5">
            <div className="lg:col-span-2 space-y-2">
              <SectionTitle>주요 지수</SectionTitle>
              <div className="grid grid-cols-2 gap-2">
                {snapshot.indices.slice(0, 4).map((idx) => (
                  <IndexCard key={`${idx.ticker ?? idx.name}`} item={idx} />
                ))}
              </div>
              {snapshot.macro?.[0] && <IndexCard item={snapshot.macro[0]} />}
            </div>
            <div className="lg:col-span-3 space-y-2">
              <div className="flex gap-1">
                {(["kospi", "kosdaq"] as const).map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setChartIndex(key)}
                    className={`rounded px-2 py-0.5 text-[10px] font-medium ${
                      chartIndex === key
                        ? "bg-red-500 text-white"
                        : "text-neutral-500 hover:bg-[var(--surface-elevated)]"
                    }`}
                  >
                    {key === "kospi" ? "코스피" : "코스닥"}
                  </button>
                ))}
              </div>
              <KrIntradayChart
                title={chartIndex === "kospi" ? "코스피" : "코스닥"}
                points={chartPoints}
              />
            </div>
          </div>

          {snapshot.popular_search && snapshot.popular_search.length > 0 && (
            <section>
              <SectionTitle>인기 검색 종목</SectionTitle>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {snapshot.popular_search.map((item) => (
                  <button
                    key={item.symbol}
                    type="button"
                    onClick={() =>
                      openPreview({
                        symbol: item.symbol,
                        name: item.name,
                        close: item.close,
                        change_pct: 0,
                      })
                    }
                    className="shrink-0 rounded-md border border-[var(--border-subtle)] px-3 py-2 min-w-[120px] text-left hover:bg-[var(--surface-elevated)]"
                  >
                    <p className="text-[10px] text-neutral-400">#{item.rank}</p>
                    <p className="text-xs font-medium truncate">{item.name}</p>
                    {item.close != null && (
                      <p className="text-[11px] tabular-nums text-neutral-600 dark:text-neutral-300">
                        {item.close.toLocaleString("ko-KR")}
                      </p>
                    )}
                  </button>
                ))}
              </div>
            </section>
          )}

          {(snapshot.market_stats?.kospi || snapshot.market_stats?.kosdaq) && (
            <section>
              <SectionTitle>시장 수급 · 종목 현황</SectionTitle>
              <div className="grid gap-2 sm:grid-cols-2">
                <BreadthBar label="코스피" stats={snapshot.market_stats?.kospi} />
                <BreadthBar label="코스닥" stats={snapshot.market_stats?.kosdaq} />
              </div>
            </section>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            {snapshot.industries && snapshot.industries.length > 0 && (
              <section>
                <SectionTitle>업종별 (상승률 상위)</SectionTitle>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {snapshot.industries.map((s) => (
                    <SectorChip
                      key={s.name}
                      name={s.name}
                      change_pct={s.change_pct}
                      onSelect={() => openGroup("industry", s)}
                    />
                  ))}
                </div>
              </section>
            )}
            {snapshot.sectors && snapshot.sectors.length > 0 && (
              <section>
                <SectionTitle>테마별 (상승률 상위)</SectionTitle>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {snapshot.sectors.map((s) => (
                    <SectorChip
                      key={s.name}
                      name={s.name}
                      change_pct={s.change_pct}
                      onSelect={() => openGroup("theme", s)}
                    />
                  ))}
                </div>
              </section>
            )}
          </div>

          <section>
            <div className="flex flex-wrap gap-1 mb-2">
              {RANK_TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setRankTab(tab.id)}
                  className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
                    rankTab === tab.id
                      ? "bg-neutral-800 text-white dark:bg-neutral-200 dark:text-neutral-900"
                      : "text-neutral-500 hover:bg-[var(--surface-elevated)]"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            {rankContent}
          </section>

          {snapshot.fetched_at_label && (
            <p className="text-[10px] text-neutral-400 border-t border-[var(--border-subtle)] pt-3">
              기준 시각: {snapshot.fetched_at_label}
              {snapshot.source ? ` · ${snapshot.source}` : ""}
            </p>
          )}
        </div>
      ) : null}
    </div>
    <StockPreviewModal item={previewItem} onClose={() => setPreviewItem(null)} />
    <GroupStocksModal group={groupPreview} onClose={() => setGroupPreview(null)} />
    </>
  );
}
