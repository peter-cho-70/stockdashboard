"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { ArrowUpRight, ArrowDownRight, RefreshCw, Calculator, TrendingUp, ChevronDown, ChevronUp, ExternalLink } from "lucide-react";
import { api, type AllTradeItem, type FinanceHubState } from "@/lib/api";
import type { Liability } from "@/lib/finance/types";
import { LeverageAnalysisPanel } from "@/components/finance/leverage-analysis-panel";

type SideFilter = "ALL" | "BUY" | "SELL";
type SourceFilter = "ALL" | "manual" | "kis";
type TradePeriod = "1D" | "1W" | "1M" | "3M" | "6M" | "1Y" | "2Y" | "ALL" | "CUSTOM";
type DisplayTradeItem = AllTradeItem & { trade_count: number };

const TRADE_PERIODS: { id: Exclude<TradePeriod, "CUSTOM">; label: string }[] = [
  { id: "1D", label: "오늘" },
  { id: "1W", label: "1주일" },
  { id: "1M", label: "1개월" },
  { id: "3M", label: "3개월" },
  { id: "6M", label: "6개월" },
  { id: "1Y", label: "1년" },
  { id: "2Y", label: "2년" },
  { id: "ALL", label: "전체" },
];

const TRADE_PERIOD_STORAGE = "stockmind-trades-period";

function syncRangeWhenAll(): { start: string; end: string } {
  const end = new Date();
  const start = new Date(end.getFullYear() - 2, 0, 1);
  return { start: formatYmd(start), end: formatYmd(end) };
}

function formatYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function rangeForPeriod(period: Exclude<TradePeriod, "CUSTOM" | "ALL">): { start: string; end: string } {
  const end = new Date();
  const start = new Date(end);
  if (period === "1D") {
    return { start: formatYmd(end), end: formatYmd(end) };
  }
  if (period === "1W") {
    start.setDate(start.getDate() - 7);
    return { start: formatYmd(start), end: formatYmd(end) };
  }
  const months = { "1M": 1, "3M": 3, "6M": 6, "1Y": 12, "2Y": 24 }[period];
  start.setMonth(start.getMonth() - months);
  return { start: formatYmd(start), end: formatYmd(end) };
}

function periodLabel(id: TradePeriod): string {
  if (id === "CUSTOM") return "사용자 지정";
  return TRADE_PERIODS.find((p) => p.id === id)?.label ?? id;
}

function fmt(n: number) {
  return Math.round(n).toLocaleString("ko-KR");
}

function monthKey(dateStr: string) {
  return dateStr.slice(0, 7); // YYYY-MM
}

function groupSameDayTrades(items: AllTradeItem[]): DisplayTradeItem[] {
  const map = new Map<string, DisplayTradeItem & { _avgCost: number; _avgQty: number; _knownPnl: boolean }>();
  for (const t of items) {
    const key = `${t.traded_at}|${t.symbol}|${t.side}`;
    const row = map.get(key);
    if (!row) {
      map.set(key, {
        ...t,
        trade_count: 1,
        _avgCost: t.realized_avg_price != null ? t.realized_avg_price * t.qty : 0,
        _avgQty: t.realized_avg_price != null ? t.qty : 0,
        _knownPnl: t.realized_pnl != null,
      });
      continue;
    }

    const nextQty = row.qty + t.qty;
    row.qty = nextQty;
    row.amount += t.amount;
    row.price = nextQty > 0 ? row.amount / nextQty : 0;
    row.trade_count += 1;
    row.source = row.source === t.source ? row.source : "mixed";
    if (t.memo && !row.memo?.includes(t.memo)) row.memo = row.memo ? `${row.memo} / ${t.memo}` : t.memo;

    if (t.side === "SELL") {
      if (t.realized_pnl != null) {
        row.realized_pnl = (row.realized_pnl ?? 0) + t.realized_pnl;
        row._knownPnl = true;
      }
      row.realized_pnl_estimated = row.realized_pnl_estimated || t.realized_pnl_estimated || t.realized_pnl == null;
      if (t.realized_avg_price != null) {
        row._avgCost += t.realized_avg_price * t.qty;
        row._avgQty += t.qty;
        row.realized_avg_price = row._avgQty > 0 ? row._avgCost / row._avgQty : null;
      }
    }
  }

  return [...map.values()]
    .map(({ _avgCost, _avgQty, _knownPnl, ...row }) => ({
      ...row,
      realized_pnl: row.side === "SELL" && !_knownPnl ? null : row.realized_pnl,
      memo: row.trade_count > 1 && !row.memo ? `${row.trade_count}건 합산` : row.memo,
    }))
    .sort((a, b) => b.traded_at.localeCompare(a.traded_at) || b.id - a.id);
}

// ─── 레버리지 투자 분석 패널 ─────────────────────────────────────────────
function LeverageSection() {
  const router = useRouter();
  const [liabilities, setLiabilities] = useState<Liability[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    api.getFinanceState()
      .then((state: FinanceHubState) => {
        // 경락잔금대출은 주식투자 용도가 아니므로 제외
        const investmentLoans = state.liabilities.filter(
          (l) => l.lenderType !== "auction_settlement_loan"
        );
        setLiabilities(investmentLoans);
        if (investmentLoans.length > 0) setSelectedId(investmentLoans[0].id);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading || liabilities.length === 0) return null;

  const selected = liabilities.find((l) => l.id === selectedId);

  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 hover:bg-[var(--surface-elevated)] transition-colors"
      >
        <div className="flex items-center gap-2">
          <TrendingUp size={15} className="text-emerald-500" />
          <span className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
            레버리지 투자 분석
          </span>
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
            대출 {liabilities.length}건
          </span>
        </div>
        <div className="flex items-center gap-2 text-neutral-400">
          <span className="text-xs">대출 이자 차감 후 실질 수익 분석</span>
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-[var(--border-subtle)] p-4 space-y-4">
          {/* 대출 선택 탭 */}
          {liabilities.length > 1 && (
            <div className="flex flex-wrap gap-1.5">
              {liabilities.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => setSelectedId(l.id)}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                    selectedId === l.id
                      ? "bg-emerald-600 text-white"
                      : "border border-[var(--border-subtle)] text-neutral-600 hover:bg-[var(--surface-elevated)] dark:text-neutral-400"
                  }`}
                >
                  {l.name}
                  <span className="ml-1.5 opacity-70">
                    {l.principal.toLocaleString("ko-KR")}원 · {l.interestRate}%
                  </span>
                </button>
              ))}
            </div>
          )}

          {selected ? (
            selected.startDate ? (
              <>
                {/* 대출 요약 */}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg bg-[var(--surface-elevated)] px-4 py-2.5 text-xs text-neutral-500">
                  <span className="font-medium text-neutral-800 dark:text-neutral-200">{selected.name}</span>
                  <span>원금 <strong className="text-neutral-800 dark:text-neutral-200">{selected.principal.toLocaleString("ko-KR")}원</strong></span>
                  <span>금리 <strong className="text-neutral-800 dark:text-neutral-200">{selected.interestRate}%</strong></span>
                  <span>월 이자 <strong className="text-amber-600">{selected.monthlyInterest.toLocaleString("ko-KR")}원</strong></span>
                  <span>대출 실행일 <strong className="text-neutral-800 dark:text-neutral-200">{selected.startDate}</strong></span>
                </div>
                {/* 분석 패널 */}
                <LeverageAnalysisPanel
                  startDate={selected.startDate}
                  principal={selected.principal}
                  annualRate={selected.interestRate}
                />
              </>
            ) : (
              <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/20 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
                <strong>{selected.name}</strong>의 대출 실행일이 등록되지 않았습니다.{" "}
                <button
                  type="button"
                  onClick={() => router.push("/finance/liabilities")}
                  className="inline-flex items-center gap-1 font-semibold underline hover:no-underline"
                >
                  재정보드 → 부채관리 <ExternalLink size={11} />
                </button>
                에서 대출 실행일을 입력해주세요.
              </div>
            )
          ) : null}
        </div>
      )}
    </div>
  );
}

export default function TradesPage() {
  const router = useRouter();
  const [trades, setTrades] = useState<AllTradeItem[]>([]);
  const [tradeTotal, setTradeTotal] = useState(0);
  const [syncInfo, setSyncInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const [side, setSide] = useState<SideFilter>("ALL");
  const [source, setSource] = useState<SourceFilter>("ALL");
  const [symbol, setSymbol] = useState("");
  const [period, setPeriod] = useState<TradePeriod>("6M");
  const [start, setStart] = useState(() => rangeForPeriod("6M").start);
  const [end, setEnd] = useState(() => rangeForPeriod("6M").end);
  const [symbolSort, setSymbolSort] = useState<"amount" | "net">("amount");
  const [detailSide, setDetailSide] = useState<"ALL" | "SELL">("ALL");

  useEffect(() => {
    const saved = localStorage.getItem(TRADE_PERIOD_STORAGE);
    if (!saved || saved === "CUSTOM") return;
    if (!TRADE_PERIODS.some((p) => p.id === saved)) return;
    const p = saved as Exclude<TradePeriod, "CUSTOM">;
    if (p === "ALL") {
      setPeriod("ALL");
      setStart("");
      setEnd("");
      return;
    }
    const range = rangeForPeriod(p);
    setPeriod(p);
    setStart(range.start);
    setEnd(range.end);
  }, []);

  const applyPeriod = useCallback((next: Exclude<TradePeriod, "CUSTOM">) => {
    setPeriod(next);
    localStorage.setItem(TRADE_PERIOD_STORAGE, next);
    if (next === "ALL") {
      setStart("");
      setEnd("");
      return;
    }
    const range = rangeForPeriod(next);
    setStart(range.start);
    setEnd(range.end);
  }, []);

  const handleStartChange = (value: string) => {
    setStart(value);
    setPeriod("CUSTOM");
    localStorage.setItem(TRADE_PERIOD_STORAGE, "CUSTOM");
  };

  const handleEndChange = (value: string) => {
    setEnd(value);
    setPeriod("CUSTOM");
    localStorage.setItem(TRADE_PERIOD_STORAGE, "CUSTOM");
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getAllTrades({
        side: side === "ALL" ? undefined : side,
        source: source === "ALL" ? undefined : source,
        symbol: symbol.trim() || undefined,
        start: start || undefined,
        end: end || undefined,
        limit: 2000,
      });
      setTrades(res.trades);
      setTradeTotal(res.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : "체결내역을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [side, source, symbol, start, end]);

  useEffect(() => {
    load();
  }, [load]);

  const displayedTrades = useMemo(() => groupSameDayTrades(trades), [trades]);

  const detailTrades = useMemo(
    () => (detailSide === "SELL" ? displayedTrades.filter((t) => t.side === "SELL") : displayedTrades),
    [displayedTrades, detailSide],
  );

  async function handleSyncTrades() {
    setSyncing(true);
    setError(null);
    setSyncInfo(null);
    try {
      let res;
      if (period === "ALL") {
        const range = syncRangeWhenAll();
        res = await api.syncTradeHistory({ start: range.start, end: range.end });
      } else if (start || end) {
        res = await api.syncTradeHistory({ start: start || undefined, end: end || undefined });
      } else {
        res = await api.syncTradeHistory({ days: 90 });
      }
      const yearSummary = res.years
        ? Object.entries(res.years)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([y, n]) => `${y}년 ${n}건`)
            .join(", ")
        : "";
      setSyncInfo(
        `${res.message}${yearSummary ? ` · KIS 조회: ${yearSummary}` : res.fetched != null ? ` · KIS ${res.fetched}건` : ""}`,
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "체결내역 동기화 실패");
    } finally {
      setSyncing(false);
    }
  }

  // ── 개요 ──
  const overview = useMemo(() => {
    let buyAmount = 0, sellAmount = 0, buyCount = 0, sellCount = 0, realizedPnl = 0;
    const symbols = new Set<string>();
    for (const t of displayedTrades) {
      symbols.add(t.symbol);
      if (t.side === "BUY") { buyAmount += t.amount; buyCount += 1; }
      else { sellAmount += t.amount; sellCount += 1; realizedPnl += t.realized_pnl || 0; }
    }
    return { buyAmount, sellAmount, buyCount, sellCount, symbolCount: symbols.size, net: sellAmount - buyAmount, realizedPnl };
  }, [displayedTrades]);

  // ── 월별 매수/매도 차트 데이터 ──
  const monthlyData = useMemo(() => {
    const map = new Map<string, { month: string; 매수: number; 매도: number }>();
    for (const t of displayedTrades) {
      const key = monthKey(t.traded_at);
      if (!map.has(key)) map.set(key, { month: key, 매수: 0, 매도: 0 });
      const row = map.get(key)!;
      if (t.side === "BUY") row.매수 += t.amount;
      else row.매도 += t.amount;
    }
    return [...map.values()].sort((a, b) => a.month.localeCompare(b.month));
  }, [displayedTrades]);

  // ── 종목별 집계 ──
  const bySymbol = useMemo(() => {
    const map = new Map<string, {
      symbol: string; name: string;
      buyQty: number; buyAmount: number; buyCount: number;
      sellQty: number; sellAmount: number; sellCount: number;
      realizedPnl: number; realizedEstimated: boolean;
    }>();
    for (const t of displayedTrades) {
      if (!map.has(t.symbol)) {
        map.set(t.symbol, {
          symbol: t.symbol, name: t.name,
          buyQty: 0, buyAmount: 0, buyCount: 0,
          sellQty: 0, sellAmount: 0, sellCount: 0,
          realizedPnl: 0, realizedEstimated: false,
        });
      }
      const row = map.get(t.symbol)!;
      if (t.side === "BUY") { row.buyQty += t.qty; row.buyAmount += t.amount; row.buyCount += 1; }
      else {
        row.sellQty += t.qty; row.sellAmount += t.amount; row.sellCount += 1;
        row.realizedPnl += t.realized_pnl || 0;
        if (t.realized_pnl_estimated) row.realizedEstimated = true;
      }
    }
    const list = [...map.values()];
    list.sort((a, b) => {
      if (symbolSort === "net") {
        return (b.sellAmount - b.buyAmount) - (a.sellAmount - a.buyAmount);
      }
      return (b.buyAmount + b.sellAmount) - (a.buyAmount + a.sellAmount);
    });
    return list;
  }, [displayedTrades, symbolSort]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">체결내역</h1>
          <p className="mt-0.5 text-xs text-neutral-400">
            수동 입력 + KIS 동기화 매수·매도 체결내역을 날짜·종목별로 분석합니다
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <button
            type="button"
            onClick={handleSyncTrades}
            disabled={syncing}
            className="flex items-center gap-2 rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-neutral-700 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
          >
            <RefreshCw size={14} className={syncing ? "animate-spin" : ""} />
            {syncing ? "동기화 중..." : "KIS 체결내역 동기화"}
          </button>
          <p className="text-[11px] text-neutral-400">
            {period === "ALL"
              ? (() => {
                  const r = syncRangeWhenAll();
                  return `조회: 저장된 전체 내역 · KIS 동기화: ${r.start} ~ ${r.end}`;
                })()
              : period === "CUSTOM"
                ? `기간: ${start || "시작"} ~ ${end || "종료"} (사용자 지정)`
                : `기간: ${periodLabel(period)} (${start} ~ ${end}) — 동기화·조회에 동일 적용`}
          </p>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-400">
          {error}
        </div>
      )}

      {syncInfo && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300">
          {syncInfo}
        </div>
      )}

      {tradeTotal > trades.length && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
          조건에 맞는 체결 {tradeTotal.toLocaleString()}건 중 {trades.length.toLocaleString()}건만 표시됩니다. 기간을 줄이거나 종목 필터를 사용하세요.
        </div>
      )}

      {/* 필터 */}
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] p-3">
        <div className="flex w-full flex-col gap-1.5 sm:w-auto">
          <span className="text-xs text-neutral-500">조회 기간</span>
          <div className="flex flex-wrap gap-1 rounded-md bg-[var(--surface-elevated)] p-1 text-xs">
            {TRADE_PERIODS.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                onClick={() => applyPeriod(id)}
                className={`rounded px-2.5 py-1 font-medium ${period === id ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900" : "text-neutral-500"}`}
              >
                {label}
              </button>
            ))}
            {period === "CUSTOM" && (
              <span className="rounded px-2.5 py-1 font-medium text-neutral-600 dark:text-neutral-300">사용자 지정</span>
            )}
          </div>
        </div>
        <div className="flex gap-1 rounded-md bg-[var(--surface-elevated)] p-1 text-xs">
          {(["ALL", "BUY", "SELL"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSide(s)}
              className={`rounded px-2.5 py-1 font-medium ${side === s ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900" : "text-neutral-500"}`}
            >
              {s === "ALL" ? "전체" : s === "BUY" ? "매수" : "매도"}
            </button>
          ))}
        </div>
        <div className="flex gap-1 rounded-md bg-[var(--surface-elevated)] p-1 text-xs">
          {(["ALL", "manual", "kis"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSource(s)}
              className={`rounded px-2.5 py-1 font-medium ${source === s ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900" : "text-neutral-500"}`}
            >
              {s === "ALL" ? "전체 출처" : s === "manual" ? "수동" : "KIS"}
            </button>
          ))}
        </div>
        <label className="flex flex-col gap-1 text-xs text-neutral-500">
          종목코드
          <input
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            placeholder="예: 005930"
            className="w-28 rounded-md border border-[var(--border-subtle)] bg-[var(--background)] px-2 py-1 text-xs focus:outline-none"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-neutral-500">
          시작일
          <input type="date" value={start} onChange={(e) => handleStartChange(e.target.value)} className="rounded-md border border-[var(--border-subtle)] bg-[var(--background)] px-2 py-1 text-xs focus:outline-none" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-neutral-500">
          종료일
          <input type="date" value={end} onChange={(e) => handleEndChange(e.target.value)} className="rounded-md border border-[var(--border-subtle)] bg-[var(--background)] px-2 py-1 text-xs focus:outline-none" />
        </label>
      </div>

      {loading ? (
        <div className="py-16 text-center text-sm text-neutral-400">불러오는 중...</div>
      ) : displayedTrades.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[var(--border-subtle)] py-16 text-center text-sm text-neutral-400">
          조건에 맞는 체결내역이 없습니다.
        </div>
      ) : (
        <>
          {/* 개요 */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] p-3">
              <p className="text-xs text-neutral-400">매수금액</p>
              <p className="mt-1 text-lg font-semibold text-red-600 dark:text-red-400">{fmt(overview.buyAmount)}</p>
              <p className="text-[11px] text-neutral-400">{overview.buyCount}건</p>
            </div>
            <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] p-3">
              <p className="text-xs text-neutral-400">매도금액</p>
              <p className="mt-1 text-lg font-semibold text-blue-600 dark:text-blue-400">{fmt(overview.sellAmount)}</p>
              <p className="text-[11px] text-neutral-400">
                {overview.sellCount}건 ·{" "}
                <span className={overview.realizedPnl >= 0 ? "text-red-600 dark:text-red-400" : "text-blue-600 dark:text-blue-400"}>
                  실제수익(세후) {overview.realizedPnl >= 0 ? "+" : ""}{fmt(overview.realizedPnl)}
                </span>
              </p>
            </div>
            <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] p-3">
              <p className="text-xs text-neutral-400">순매수(매수−매도)</p>
              <p className={`mt-1 text-lg font-semibold ${overview.net <= 0 ? "text-red-600 dark:text-red-400" : "text-blue-600 dark:text-blue-400"}`}>
                {fmt(-overview.net)}
              </p>
            </div>
            <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] p-3">
              <p className="text-xs text-neutral-400">거래 종목수</p>
              <p className="mt-1 text-lg font-semibold text-neutral-900 dark:text-neutral-100">{overview.symbolCount}개</p>
            </div>
            <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] p-3">
              <p className="text-xs text-neutral-400">총 체결건수</p>
              <p className="mt-1 text-lg font-semibold text-neutral-900 dark:text-neutral-100">{displayedTrades.length}건</p>
              {displayedTrades.length !== trades.length && (
                <p className="text-[11px] text-neutral-400">원본 {trades.length}건</p>
              )}
            </div>
          </div>

          {/* 레버리지 투자 분석 */}
          <LeverageSection />

          {/* 월별 매수/매도 차트 */}
          <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] p-4">
            <h2 className="mb-3 text-sm font-semibold text-neutral-900 dark:text-neutral-100">월별 매수·매도 금액</h2>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={monthlyData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 12, fill: "var(--foreground)" }} tickLine={false} />
                <YAxis
                  tick={{ fontSize: 11, fill: "var(--foreground)" }}
                  tickFormatter={(v) => `${(v / 10000).toFixed(0)}만`}
                  tickLine={false}
                  axisLine={false}
                  width={52}
                />
                <Tooltip formatter={(v, n) => [`${Number(v).toLocaleString()}원`, n]} />
                <Legend />
                <Bar dataKey="매수" fill="#ef4444" radius={[3, 3, 0, 0]} />
                <Bar dataKey="매도" fill="#3b82f6" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* 종목별 집계 */}
          <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] overflow-hidden">
            <div className="flex items-center justify-between border-b border-[var(--border-subtle)] p-3">
              <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">종목별 집계</h2>
              <div className="flex gap-1 rounded-md bg-[var(--surface-elevated)] p-1 text-xs">
                <button type="button" onClick={() => setSymbolSort("amount")} className={`rounded px-2 py-0.5 ${symbolSort === "amount" ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900" : "text-neutral-500"}`}>거래금액순</button>
                <button type="button" onClick={() => setSymbolSort("net")} className={`rounded px-2 py-0.5 ${symbolSort === "net" ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900" : "text-neutral-500"}`}>순매수순</button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border-subtle)] bg-[var(--surface-elevated)] text-xs text-neutral-500">
                    <th className="px-4 py-2 text-left font-medium">종목</th>
                    <th className="px-4 py-2 text-right font-medium">매수횟수</th>
                    <th className="px-4 py-2 text-right font-medium">매수금액</th>
                    <th className="px-4 py-2 text-right font-medium">매도횟수</th>
                    <th className="px-4 py-2 text-right font-medium">매도금액</th>
                    <th className="px-4 py-2 text-right font-medium">실제수익(세후)</th>
                    <th className="px-4 py-2 text-right font-medium">순매수</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-subtle)]">
                  {bySymbol.map((r) => {
                    const net = r.buyAmount - r.sellAmount;
                    return (
                      <tr key={r.symbol}>
                        <td className="px-4 py-2">
                          <span className="font-medium text-neutral-900 dark:text-neutral-100">{r.name}</span>
                          <span className="ml-1 text-xs text-neutral-400">{r.symbol}</span>
                        </td>
                        <td className="px-4 py-2 text-right text-neutral-600 dark:text-neutral-300">{r.buyCount}</td>
                        <td className="px-4 py-2 text-right text-red-600 dark:text-red-400">{fmt(r.buyAmount)}</td>
                        <td className="px-4 py-2 text-right text-neutral-600 dark:text-neutral-300">{r.sellCount}</td>
                        <td className="px-4 py-2 text-right text-blue-600 dark:text-blue-400">{fmt(r.sellAmount)}</td>
                        <td className="px-4 py-2 text-right">
                          {r.sellCount > 0 ? (
                            <span className={r.realizedPnl >= 0 ? "text-red-600 dark:text-red-400" : "text-blue-600 dark:text-blue-400"}>
                              {r.realizedPnl >= 0 ? "+" : ""}{fmt(r.realizedPnl)}
                              {r.realizedEstimated && <span title="동기화 범위 이전 매수 내역은 추적되지 않아 추정치일 수 있습니다" className="ml-1 cursor-help text-amber-500">*</span>}
                            </span>
                          ) : (
                            <span className="text-neutral-400">—</span>
                          )}
                        </td>
                        <td className={`px-4 py-2 text-right font-medium ${net >= 0 ? "text-red-600 dark:text-red-400" : "text-blue-600 dark:text-blue-400"}`}>
                          {net >= 0 ? "+" : ""}{fmt(net)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="border-t border-[var(--border-subtle)] px-4 py-2 text-[11px] text-neutral-400">
              실제수익(세후) = (매도금액 − 증권거래세 0.18% − 매도수수료 0.015%) − 매수원가. * 표시는 동기화된 체결내역 범위 이전에 매수한 물량이 섞여 있어 추정치일 수 있음을 의미합니다.
            </p>
          </div>

          {/* 상세 내역 */}
          <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-subtle)] p-3">
              <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                상세 내역
                {detailSide === "SELL" && (
                  <span className="ml-2 text-xs font-normal text-neutral-400">{detailTrades.length}건</span>
                )}
              </h2>
              <div className="flex gap-1 rounded-md bg-[var(--surface-elevated)] p-1 text-xs">
                <button
                  type="button"
                  onClick={() => setDetailSide("ALL")}
                  className={`rounded px-2 py-0.5 ${detailSide === "ALL" ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900" : "text-neutral-500"}`}
                >
                  전체
                </button>
                <button
                  type="button"
                  onClick={() => setDetailSide("SELL")}
                  className={`rounded px-2 py-0.5 ${detailSide === "SELL" ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900" : "text-neutral-500"}`}
                >
                  매도만
                </button>
              </div>
            </div>
            <div className="max-h-[480px] overflow-y-auto overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0">
                  <tr className="border-b border-[var(--border-subtle)] bg-[var(--surface-elevated)] text-xs text-neutral-500">
                    <th className="px-4 py-2 text-left font-medium">날짜</th>
                    <th className="px-4 py-2 text-left font-medium">종목</th>
                    <th className="px-4 py-2 text-center font-medium">구분</th>
                    <th className="px-4 py-2 text-right font-medium">수량</th>
                    <th className="px-4 py-2 text-right font-medium">단가</th>
                    <th className="px-4 py-2 text-right font-medium">금액</th>
                    <th className="px-4 py-2 text-right font-medium">적용평단</th>
                    <th className="px-4 py-2 text-right font-medium">실제수익(세후)</th>
                    <th className="px-4 py-2 text-center font-medium">출처</th>
                    <th className="px-4 py-2 text-left font-medium">메모</th>
                    <th className="px-4 py-2 text-center font-medium">분석</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-subtle)]">
                  {detailTrades.map((t) => (
                    <tr key={t.id} className="hover:bg-[var(--surface-elevated)]">
                      <td className="px-4 py-2 text-neutral-600 dark:text-neutral-300">{t.traded_at}</td>
                      <td className="px-4 py-2">
                        <span className="font-medium text-neutral-900 dark:text-neutral-100">{t.name}</span>
                        <span className="ml-1 text-xs text-neutral-400">{t.symbol}</span>
                        {t.trade_count > 1 && <span className="ml-1 rounded bg-neutral-100 px-1 text-[10px] text-neutral-500 dark:bg-neutral-800">합산 {t.trade_count}건</span>}
                      </td>
                      <td className="px-4 py-2 text-center whitespace-nowrap">
                        {t.side === "BUY" ? (
                          <span className="inline-flex items-center gap-0.5 text-red-600 dark:text-red-400"><ArrowUpRight size={12} />매수</span>
                        ) : (
                          <span className="inline-flex items-center gap-0.5 text-blue-600 dark:text-blue-400"><ArrowDownRight size={12} />매도</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right text-neutral-700 dark:text-neutral-300">{t.qty.toLocaleString()}</td>
                      <td className="px-4 py-2 text-right text-neutral-700 dark:text-neutral-300">{fmt(t.price)}</td>
                      <td className="px-4 py-2 text-right text-neutral-800 dark:text-neutral-200">{fmt(t.amount)}</td>
                      <td className="px-4 py-2 text-right text-neutral-600 dark:text-neutral-300">
                        {t.side === "SELL" && t.realized_avg_price != null ? fmt(t.realized_avg_price) : <span className="text-neutral-400">—</span>}
                      </td>
                      <td className="px-4 py-2 text-right">
                        {t.side === "SELL" && t.realized_pnl != null ? (
                          <span className={t.realized_pnl >= 0 ? "text-red-600 dark:text-red-400" : "text-blue-600 dark:text-blue-400"}>
                            {t.realized_pnl >= 0 ? "+" : ""}{fmt(t.realized_pnl)}
                            {t.realized_pnl_estimated && <span title="동기화 범위 이전 매수 내역은 추적되지 않아 추정치일 수 있습니다" className="ml-1 cursor-help text-amber-500">*</span>}
                          </span>
                        ) : (
                          <span className="text-neutral-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-center">
                        <span className={`rounded px-1.5 py-0.5 text-[10px] ${t.source === "kis" ? "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300" : "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"}`}>
                          {t.source === "mixed" ? "혼합" : t.source === "kis" ? "KIS" : "수동"}
                        </span>
                      </td>
                      <td className="px-4 py-2 max-w-[160px] truncate text-xs text-neutral-400">{t.memo || "—"}</td>
                      <td className="px-4 py-2 text-center">
                        {t.side === "SELL" && (
                          <button
                            type="button"
                            onClick={() => router.push(`/portfolio?openWhatIf=${t.id}&symbol=${t.symbol}`)}
                            title="매도 후 기회비용 분석 열기"
                            className="rounded p-1 text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                          >
                            <Calculator size={14} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
