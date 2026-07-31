"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  TrendingUp,
  TrendingDown,
  RefreshCw,
  Bell,
  BarChart2,
  Wallet,
  ArrowUpRight,
  ArrowDownRight,
  Database,
} from "lucide-react";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  Cell,
  ReferenceLine,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { api, type PortfolioSummary, type Alert, type PortfolioSnapshot } from "@/lib/api";
import { ClientOnly } from "@/components/client-only";
import { MarketBriefingCard } from "@/components/market-briefing-card";
import { TradeReportCard } from "@/components/trade-report-card";
import { HoldingsMiniCard } from "@/components/holdings-mini-card";
import { MorningRoutineCard } from "@/components/morning/morning-routine-card";
import { isUsReportAtBottomKST } from "@/lib/marketDisplay";
import { krChangeClass, KR_UP_HEX, KR_DOWN_HEX } from "@/lib/krMarketColors";

const CHART_PERIODS = [
  { days: 7, label: "7일" },
  { days: 30, label: "1달" },
  { days: 90, label: "3달" },
  { days: 180, label: "6달" },
  { days: 365, label: "1년" },
] as const;

function chartPeriodLabel(days: number) {
  return CHART_PERIODS.find((p) => p.days === days)?.label ?? `${days}일`;
}

function fmt(n: number) {
  return `${n.toLocaleString("ko-KR")}원`;
}

function SummaryCard({
  icon,
  label,
  value,
  sub,
  highlight,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  highlight?: "up" | "down";
}) {
  const valueClass =
    highlight === "up"
      ? krChangeClass(1)
      : highlight === "down"
        ? krChangeClass(-1)
        : "text-neutral-900 dark:text-neutral-100";

  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] p-4 shadow-xs">
      <div className="flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
        {icon}
        {label}
      </div>
      <div className={`mt-2 text-lg font-bold ${valueClass}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-neutral-400">{sub}</div>}
    </div>
  );
}

export default function DashboardPage() {
  const [summary, setSummary] = useState<PortfolioSummary | null>(null);
  const [history, setHistory] = useState<PortfolioSnapshot[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [catchingUp, setCatchingUp] = useState(false);
  const [apiStatus, setApiStatus] = useState<"checking" | "ok" | "error">("checking");
  const [lastUpdated, setLastUpdated] = useState("");
  const [refreshMsg, setRefreshMsg] = useState("");
  const [chartDays, setChartDays] = useState(30);
  const [chartMode, setChartMode] = useState<"daily" | "cumulative">("daily");
  const [historyLoading, setHistoryLoading] = useState(false);
  const [usReportAtBottom, setUsReportAtBottom] = useState(() => isUsReportAtBottomKST());

  useEffect(() => {
    const tick = () => setUsReportAtBottom(isUsReportAtBottomKST());
    tick();
    const id = window.setInterval(tick, 60_000);
    return () => window.clearInterval(id);
  }, []);

  const loadHistory = useCallback(async (days: number) => {
    setHistoryLoading(true);
    try {
      const hist = await api.getHistory(days);
      setHistory(hist);
    } catch {
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const loadCore = useCallback(async () => {
    try {
      const [sum, al] = await Promise.all([
        api.getPortfolioSummary(),
        api.getAlerts(true),
      ]);
      setSummary(sum);
      setAlerts(al);
      setApiStatus("ok");
      setLastUpdated(new Date().toLocaleTimeString("ko-KR"));
    } catch {
      setApiStatus("error");
    }
  }, []);

  useEffect(() => {
    loadCore();
  }, [loadCore]);

  useEffect(() => {
    if (apiStatus !== "ok") return;
    loadHistory(chartDays);
  }, [chartDays, apiStatus, loadHistory]);

  async function handleSync() {
    setSyncing(true);
    try {
      await api.syncNow();
      await loadCore();
      await loadHistory(chartDays);
    } catch {
      // ignore
    } finally {
      setSyncing(false);
    }
  }

  async function handleRefreshPrices() {
    setRefreshing(true);
    setRefreshMsg("");
    try {
      const result = await api.refreshPrices();
      setRefreshMsg(result.message);
      await loadCore();
      await loadHistory(chartDays);
    } catch {
      setRefreshMsg("시세 갱신 실패. 잠시 후 다시 시도해 주세요.");
    } finally {
      setRefreshing(false);
    }
  }

  async function handleCatchupPriceHistory() {
    setCatchingUp(true);
    setRefreshMsg("");
    try {
      const result = await api.catchupPriceHistory();
      setRefreshMsg(result.message);
      await loadHistory(chartDays);
    } catch {
      setRefreshMsg("시세 이력 복원 실패. 잠시 후 다시 시도해 주세요.");
    } finally {
      setCatchingUp(false);
    }
  }

  const unreadCount = alerts.length;

  const chartLabelFormat = chartDays > 90 ? (d: string) => d.slice(2, 7) : (d: string) => d.slice(5);

  const chartData = history.map((h) => ({
    date: chartLabelFormat(h.date),
    fullDate: h.date,
    수익률: h.total_profit_rate,
    평가금액: Math.round(h.total_value / 10000),
  }));

  // 일별 손익: 전일 대비 평가손익(원) 변화 = 그날 계좌 자산 증가액. 신규 매수/입금에는
  // 영향받지 않고(평가손익 기준), 두 계좌(KIS)는 잔고 동기화 시 종목 단위로 합산되어
  // 스냅샷에 이미 포함된다. (실제 매매 실현손익이 아님)
  const dailyData = history.slice(1).map((h, i) => {
    const prev = history[i];
    const dayProfit = h.total_profit - prev.total_profit;
    const dayRate = h.total_profit_rate - prev.total_profit_rate;
    return {
      date: chartLabelFormat(h.date),
      fullDate: h.date,
      일별손익: Math.round(dayProfit),
      일별손익만원: Math.round(dayProfit / 10000),
      일별수익률: Number(dayRate.toFixed(2)),
    };
  });

  const dailyPnlTotal = dailyData.reduce((sum, d) => sum + d.일별손익, 0);
  const dailyPnlHasData = dailyData.length > 0;

  const marketStack = (
    <div className="space-y-4">
      {/* 보유종목을 모닝 루틴보다 앞에 — 미국증시 옆 배치 */}
      <div className="grid gap-4 lg:grid-cols-3 items-stretch">
        <div className="lg:col-span-2">
          <MarketBriefingCard />
        </div>
        <div className="lg:col-span-1">
          <HoldingsMiniCard summary={summary} />
        </div>
      </div>
      <MorningRoutineCard />
      <TradeReportCard />
    </div>
  );

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">대시보드</h1>
          {lastUpdated && (
            <p className="mt-0.5 text-xs text-neutral-400">최종 갱신: {lastUpdated}</p>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleCatchupPriceHistory}
            disabled={catchingUp}
            title="컴퓨터를 꺼둬서 조회하지 않은 날의 시세·수익 이력을 다시 복원합니다 (알림은 생성되지 않습니다)"
            className="flex items-center gap-2 rounded-md border border-[var(--border-subtle)] px-3 py-2 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-100 disabled:opacity-50 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            <RefreshCw size={14} className={catchingUp ? "animate-spin" : ""} />
            {catchingUp ? "복원 중..." : "놓친 시세 다시 체크"}
          </button>
          <button
            onClick={handleRefreshPrices}
            disabled={refreshing}
            className="flex items-center gap-2 rounded-md border border-[var(--border-subtle)] px-3 py-2 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-100 disabled:opacity-50 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            <Database size={14} className={refreshing ? "animate-pulse" : ""} />
            {refreshing ? "시세 갱신 중..." : "KRX 시세 갱신"}
          </button>
          <button
            onClick={handleSync}
            disabled={syncing}
            className="flex items-center gap-2 rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-neutral-700 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
          >
            <RefreshCw size={14} className={syncing ? "animate-spin" : ""} />
            {syncing ? "KIS 동기화 중..." : "KIS 동기화"}
          </button>
        </div>
      </div>

      {/* 상태 메시지 */}
      {refreshMsg && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300">
          ✅ {refreshMsg}
        </div>
      )}

      {apiStatus === "error" && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
          백엔드 서버에 연결할 수 없습니다.{" "}
          <code className="rounded bg-amber-100 px-1 py-0.5 text-xs dark:bg-amber-900/40">
            python3 main.py
          </code>
          로 서버를 시작해 주세요.
        </div>
      )}

      {!usReportAtBottom && marketStack}

      {/* 알림 배지 */}
      {unreadCount > 0 && (
        <Link
          href="/alerts"
          className="flex items-center gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] px-4 py-3 shadow-xs transition-colors hover:border-neutral-300 dark:hover:border-neutral-600"
        >
          <Bell size={16} className="text-amber-500" />
          <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
            읽지 않은 알림{" "}
            <span className="rounded-full bg-red-500 px-2 py-0.5 text-xs font-bold text-white">
              {unreadCount}
            </span>
            건 (±5% 이상 변동 · 희망가 도달 종목)
          </span>
          <ArrowUpRight size={14} className="ml-auto text-neutral-400" />
        </Link>
      )}

      {/* 요약 카드 */}
      {summary && summary.stock_count > 0 && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <SummaryCard
            icon={<Wallet size={18} className="text-blue-500" />}
            label="총 평가금액"
            value={fmt(summary.total_value)}
            sub={`${summary.stock_count}개 종목`}
          />
          <SummaryCard
            icon={<BarChart2 size={18} className="text-neutral-500" />}
            label="총 매입금액"
            value={fmt(summary.total_purchase)}
          />
          <SummaryCard
            icon={
              summary.total_profit >= 0 ? (
                <TrendingUp size={18} className="text-red-500" />
              ) : (
                <TrendingDown size={18} className="text-blue-500" />
              )
            }
            label="총 수익금액"
            value={fmt(summary.total_profit)}
            highlight={summary.total_profit >= 0 ? "up" : "down"}
          />
          <SummaryCard
            icon={
              summary.total_profit_rate >= 0 ? (
                <ArrowUpRight size={18} className="text-red-500" />
              ) : (
                <ArrowDownRight size={18} className="text-blue-500" />
              )
            }
            label="총 수익률"
            value={`${summary.total_profit_rate >= 0 ? "+" : ""}${summary.total_profit_rate.toFixed(2)}%`}
            highlight={summary.total_profit_rate >= 0 ? "up" : "down"}
          />
        </div>
      )}

      {/* 수익률 차트 */}
      {apiStatus === "ok" && summary && summary.stock_count > 0 && (
        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] p-4">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">
              {chartMode === "daily" ? (
                <>
                  일별 손익 (전일 대비 자산 증가액 · 두 계좌 합산 · 최근 {chartPeriodLabel(chartDays)})
                  {dailyPnlHasData && (
                    <span className={`ml-2 text-xs font-bold ${krChangeClass(dailyPnlTotal)}`}>
                      합계 {dailyPnlTotal >= 0 ? "+" : ""}{dailyPnlTotal.toLocaleString("ko-KR")}원
                    </span>
                  )}
                </>
              ) : (
                `포트폴리오 수익률 추이 (누적 · 최근 ${chartPeriodLabel(chartDays)})`
              )}
            </h2>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex rounded-md border border-[var(--border-subtle)] p-0.5">
                <button
                  type="button"
                  onClick={() => setChartMode("daily")}
                  className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                    chartMode === "daily"
                      ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                      : "text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"
                  }`}
                >
                  일별 손익
                </button>
                <button
                  type="button"
                  onClick={() => setChartMode("cumulative")}
                  className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                    chartMode === "cumulative"
                      ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                      : "text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"
                  }`}
                >
                  누적 수익률
                </button>
              </div>
              <div className="flex rounded-md border border-[var(--border-subtle)] p-0.5">
                {CHART_PERIODS.map(({ days, label }) => (
                  <button
                    key={days}
                    type="button"
                    onClick={() => setChartDays(days)}
                    className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                      chartDays === days
                        ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                        : "text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          {historyLoading ? (
            <div className="flex h-[200px] items-center justify-center text-sm text-neutral-400">
              차트 불러오는 중...
            </div>
          ) : (chartMode === "daily" ? !dailyPnlHasData : chartData.length === 0) ? (
            <div className="flex h-[200px] flex-col items-center justify-center gap-1 text-center text-sm text-neutral-400">
              <BarChart2 size={28} className="text-neutral-300 dark:text-neutral-600" />
              <p>
                {chartMode === "daily"
                  ? "일별 손익을 계산하려면 최소 2일치 데이터가 필요합니다."
                  : "이 기간에 저장된 일별 데이터가 없습니다."}
              </p>
              <p className="text-xs">KRX 시세 갱신 또는 KIS 동기화 후 며칠 지나면 표시됩니다.</p>
            </div>
          ) : (
            <ClientOnly
              fallback={
                <div className="flex h-[200px] items-center justify-center text-sm text-neutral-400">
                  차트 불러오는 중...
                </div>
              }
            >
            <ResponsiveContainer width="100%" height={200}>
              {chartMode === "daily" ? (
                <BarChart data={dailyData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 11, fill: "var(--foreground)" }}
                    tickLine={false}
                    interval={dailyData.length > 60 ? Math.floor(dailyData.length / 8) : 0}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: "var(--foreground)" }}
                    tickFormatter={(v) => `${v}만`}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip
                    cursor={{ fill: "var(--border-subtle)", opacity: 0.3 }}
                    labelFormatter={(_, payload) => {
                      const row = payload?.[0]?.payload as { fullDate?: string } | undefined;
                      return row?.fullDate ?? "";
                    }}
                    formatter={(_value, _name, item) => {
                      const row = item?.payload as { 일별손익?: number; 일별수익률?: number } | undefined;
                      const amt = row?.일별손익 ?? 0;
                      const rate = row?.일별수익률 ?? 0;
                      return [
                        `${amt >= 0 ? "+" : ""}${amt.toLocaleString("ko-KR")}원 (${rate >= 0 ? "+" : ""}${rate}%p)`,
                        "일별 손익",
                      ];
                    }}
                    contentStyle={{
                      background: "var(--surface)",
                      border: "1px solid var(--border-subtle)",
                      borderRadius: "8px",
                      fontSize: "12px",
                    }}
                  />
                  <ReferenceLine y={0} stroke="var(--foreground)" strokeOpacity={0.4} />
                  <Bar dataKey="일별손익만원" radius={[2, 2, 0, 0]} maxBarSize={28}>
                    {dailyData.map((d) => (
                      <Cell
                        key={d.fullDate}
                        fill={d.일별손익 >= 0 ? KR_UP_HEX : KR_DOWN_HEX}
                      />
                    ))}
                  </Bar>
                </BarChart>
              ) : (
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 11, fill: "var(--foreground)" }}
                    tickLine={false}
                    interval={chartData.length > 60 ? Math.floor(chartData.length / 8) : 0}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: "var(--foreground)" }}
                    tickFormatter={(v) => `${v}%`}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip
                    labelFormatter={(_, payload) => {
                      const row = payload?.[0]?.payload as { fullDate?: string } | undefined;
                      return row?.fullDate ?? "";
                    }}
                    formatter={(value, name) => {
                      if (name === "수익률") return [`${Number(value).toFixed(2)}%`, "수익률"];
                      if (name === "평가금액") return [`${Number(value).toLocaleString("ko-KR")}만원`, "평가금액"];
                      return [value, name];
                    }}
                    contentStyle={{
                      background: "var(--surface)",
                      border: "1px solid var(--border-subtle)",
                      borderRadius: "8px",
                      fontSize: "12px",
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="수익률"
                    stroke="#10b981"
                    strokeWidth={2}
                    dot={chartData.length <= 14}
                    activeDot={{ r: 4 }}
                  />
                </LineChart>
              )}
            </ResponsiveContainer>
            </ClientOnly>
          )}
        </div>
      )}

      {usReportAtBottom && marketStack}
    </div>
  );
}
