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
  Minus,
  Database,
  BarChart,
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
import { api, type PortfolioSummary, type Alert, type PortfolioSnapshot } from "@/lib/api";

function fmt(n: number) {
  return `${n.toLocaleString("ko-KR")}원`;
}

function RateTag({ rate }: { rate: number }) {
  if (rate > 0)
    return (
      <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400">
        <ArrowUpRight size={11} />
        {rate.toFixed(2)}%
      </span>
    );
  if (rate < 0)
    return (
      <span className="inline-flex items-center gap-0.5 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-900/40 dark:text-red-400">
        <ArrowDownRight size={11} />
        {Math.abs(rate).toFixed(2)}%
      </span>
    );
  return (
    <span className="inline-flex items-center gap-0.5 rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
      <Minus size={11} />
      0.00%
    </span>
  );
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
  highlight?: "green" | "red";
}) {
  const valueClass =
    highlight === "green"
      ? "text-emerald-600 dark:text-emerald-400"
      : highlight === "red"
        ? "text-red-600 dark:text-red-400"
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
  const [apiStatus, setApiStatus] = useState<"checking" | "ok" | "error">("checking");
  const [lastUpdated, setLastUpdated] = useState("");
  const [refreshMsg, setRefreshMsg] = useState("");

  const loadData = useCallback(async () => {
    try {
      const [sum, al, hist] = await Promise.all([
        api.getPortfolioSummary(),
        api.getAlerts(true),
        api.getHistory(30),
      ]);
      setSummary(sum);
      setAlerts(al);
      setHistory(hist);
      setApiStatus("ok");
      setLastUpdated(new Date().toLocaleTimeString("ko-KR"));
    } catch {
      setApiStatus("error");
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  async function handleSync() {
    setSyncing(true);
    try {
      await api.syncNow();
      await loadData();
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
      await loadData();
    } catch {
      setRefreshMsg("시세 갱신 실패. 잠시 후 다시 시도해 주세요.");
    } finally {
      setRefreshing(false);
    }
  }

  const unreadCount = alerts.length;

  // 차트 데이터 포맷
  const chartData = history.map((h) => ({
    date: h.date.slice(5),  // MM-DD
    수익률: h.total_profit_rate,
    평가금액: Math.round(h.total_value / 10000),  // 만원 단위
  }));

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
            건 (±5% 이상 변동 종목)
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
                <TrendingUp size={18} className="text-emerald-500" />
              ) : (
                <TrendingDown size={18} className="text-red-500" />
              )
            }
            label="총 수익금액"
            value={fmt(summary.total_profit)}
            highlight={summary.total_profit >= 0 ? "green" : "red"}
          />
          <SummaryCard
            icon={
              summary.total_profit_rate >= 0 ? (
                <ArrowUpRight size={18} className="text-emerald-500" />
              ) : (
                <ArrowDownRight size={18} className="text-red-500" />
              )
            }
            label="총 수익률"
            value={`${summary.total_profit_rate >= 0 ? "+" : ""}${summary.total_profit_rate.toFixed(2)}%`}
            highlight={summary.total_profit_rate >= 0 ? "green" : "red"}
          />
        </div>
      )}

      {/* 수익률 차트 */}
      {chartData.length > 1 && (
        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] p-4">
          <h2 className="mb-4 text-sm font-semibold text-neutral-700 dark:text-neutral-300">
            포트폴리오 수익률 추이 (최근 30일)
          </h2>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11, fill: "var(--foreground)" }}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 11, fill: "var(--foreground)" }}
                tickFormatter={(v) => `${v}%`}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                formatter={(value) => [`${Number(value).toFixed(2)}%`, "수익률"]}
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
                dot={false}
                activeDot={{ r: 4 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* 오늘 변동 종목 */}
      {summary && summary.stocks.length > 0 && (
        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] overflow-hidden">
          <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-4 py-3">
            <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">
              전체 보유 종목 ({summary.stock_count}개)
            </h2>
            <Link
              href="/portfolio"
              className="text-xs text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"
            >
              전체 보기 →
            </Link>
          </div>
          <div className="divide-y divide-[var(--border-subtle)]">
            {summary.stocks.slice(0, 10).map((stock) => (
              <Link
                key={stock.symbol}
                href={`/chart?symbol=${stock.symbol}`}
                className={`flex items-center gap-4 px-4 py-3 transition-colors hover:bg-[var(--surface-elevated)] group ${Math.abs(stock.change_rate) >= 5 ? "bg-amber-50/50 dark:bg-amber-900/10" : ""}`}
              >
                {Math.abs(stock.change_rate) >= 5 && (
                  <Bell size={12} className="shrink-0 text-amber-500" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-neutral-900 dark:text-neutral-100 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                      {stock.name}
                    </span>
                    <span className="text-xs text-neutral-400">{stock.symbol}</span>
                    {stock.sector && (
                      <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-500 dark:bg-neutral-800">
                        {stock.sector}
                      </span>
                    )}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                    {stock.current_price.toLocaleString("ko-KR")}원
                  </div>
                  <div className="mt-0.5 flex justify-end gap-1.5">
                    <RateTag rate={stock.change_rate} />
                    <span className="text-xs text-neutral-400">당일</span>
                  </div>
                </div>
                <div className="text-right min-w-[110px]">
                  <div className="text-sm font-medium text-neutral-800 dark:text-neutral-200">
                    {(stock.current_value ?? stock.current_price * stock.qty).toLocaleString("ko-KR")}원
                  </div>
                  <div className="mt-0.5 text-xs text-neutral-400">평가금액</div>
                </div>
                <div className="text-right min-w-[80px]">
                  <RateTag rate={stock.profit_rate} />
                  <div className="mt-0.5 text-xs text-neutral-400">수익률</div>
                </div>
                <BarChart size={14} className="shrink-0 text-neutral-300 group-hover:text-blue-400 transition-colors" />
              </Link>
            ))}
          </div>
          {summary.stock_count > 10 && (
            <div className="border-t border-[var(--border-subtle)] px-4 py-2.5 text-center">
              <Link href="/portfolio" className="text-xs text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300">
                나머지 {summary.stock_count - 10}개 종목 보기 →
              </Link>
            </div>
          )}
        </div>
      )}

      {apiStatus === "ok" && summary && summary.stock_count === 0 && (
        <div className="rounded-lg border border-dashed border-[var(--border-subtle)] px-8 py-16 text-center">
          <Wallet size={40} className="mx-auto mb-3 text-neutral-300 dark:text-neutral-600" />
          <p className="font-medium text-neutral-600 dark:text-neutral-400">보유 종목이 없습니다</p>
          <p className="mt-1 text-sm text-neutral-400">
            KIS API 설정 후 동기화하거나, 종목을 직접 등록해 주세요.
          </p>
        </div>
      )}
    </div>
  );
}
