"use client";

import { useEffect, useState, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import {
  ComposedChart,
  Line,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import {
  TrendingUp,
  TrendingDown,
  ArrowUpRight,
  ArrowDownRight,
  Loader2,
  Video,
  Newspaper,
  FileText,
  ExternalLink,
} from "lucide-react";
import { api, type StockItem, type StockIssueTimeline } from "@/lib/api";

type Period = "1M" | "3M" | "6M" | "1Y";

interface ChartBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  ma5: number;
  ma20: number;
  ma60: number;
}

interface ChartData {
  symbol: string;
  name: string;
  sector: string | null;
  avg_price: number;
  current_price: number;
  profit_rate: number;
  period: string;
  data: ChartBar[];
}

const PERIODS: { id: Period; label: string }[] = [
  { id: "1M", label: "1개월" },
  { id: "3M", label: "3개월" },
  { id: "6M", label: "6개월" },
  { id: "1Y", label: "1년" },
];

// 커스텀 툴팁
function ChartTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: { name: string; value: number; color: string }[];
  label?: string;
}) {
  if (!active || !payload || payload.length === 0) return null;

  const closeItem = payload.find((p) => p.name === "종가");
  const volItem = payload.find((p) => p.name === "거래량");

  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] p-3 text-xs shadow-lg">
      <p className="mb-2 font-semibold text-neutral-700 dark:text-neutral-300">{label}</p>
      {payload.filter(p => p.name !== "거래량").map((p) => (
        <div key={p.name} className="flex justify-between gap-4">
          <span style={{ color: p.color }}>{p.name}</span>
          <span className="font-medium text-neutral-900 dark:text-neutral-100">
            {p.value.toLocaleString("ko-KR")}원
          </span>
        </div>
      ))}
      {volItem && (
        <div className="mt-1 flex justify-between gap-4 border-t border-[var(--border-subtle)] pt-1">
          <span className="text-neutral-400">거래량</span>
          <span className="font-medium text-neutral-600 dark:text-neutral-400">
            {volItem.value.toLocaleString("ko-KR")}
          </span>
        </div>
      )}
    </div>
  );
}

export default function ChartPage() {
  return (
    <Suspense fallback={<div className="py-16 text-center text-sm text-neutral-400">불러오는 중...</div>}>
      <ChartContent />
    </Suspense>
  );
}

function SentimentDot({ sentiment }: { sentiment: string }) {
  if (sentiment === "POSITIVE") return <span className="inline-block h-2 w-2 rounded-full bg-emerald-500 shrink-0" />;
  if (sentiment === "NEGATIVE") return <span className="inline-block h-2 w-2 rounded-full bg-red-500 shrink-0" />;
  return <span className="inline-block h-2 w-2 rounded-full bg-neutral-400 shrink-0" />;
}

function IssueSourceIcon({ type }: { type: string | null }) {
  if (type === "YOUTUBE") return <Video size={12} className="text-red-500 shrink-0" />;
  if (type === "NEWS")    return <Newspaper size={12} className="text-blue-500 shrink-0" />;
  return <FileText size={12} className="text-neutral-400 shrink-0" />;
}

function ChartContent() {
  const searchParams = useSearchParams();
  const [stocks, setStocks] = useState<StockItem[]>([]);
  const [selectedSymbol, setSelectedSymbol] = useState<string>("");
  const [period, setPeriod] = useState<Period>("3M");
  const [chartData, setChartData] = useState<ChartData | null>(null);
  const [loading, setLoading] = useState(false);
  const [showMA, setShowMA] = useState({ ma5: true, ma20: true, ma60: false });
  const [issues, setIssues] = useState<StockIssueTimeline[]>([]);
  const [issuesLoading, setIssuesLoading] = useState(false);

  // 종목 목록 로드 + URL 파라미터 우선 선택
  useEffect(() => {
    api.getStocks().then((data) => {
      const krx = data.filter((s) => s.market === "KRX");
      setStocks(krx);
      const urlSymbol = searchParams.get("symbol");
      if (urlSymbol && krx.find((s) => s.symbol === urlSymbol)) {
        setSelectedSymbol(urlSymbol);
      } else if (krx.length > 0) {
        setSelectedSymbol(krx[0].symbol);
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 차트 데이터 로드
  const loadChart = useCallback(async () => {
    if (!selectedSymbol) return;
    setLoading(true);
    try {
      const data = await fetch(
        `/api/portfolio/stocks/${selectedSymbol}/chart?period=${period}`
      ).then((r) => r.json());
      setChartData(data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [selectedSymbol, period]);

  // AI 이슈 타임라인 로드
  const loadIssues = useCallback(async () => {
    if (!selectedSymbol) return;
    setIssuesLoading(true);
    try {
      const data = await api.getStockIssues(selectedSymbol);
      setIssues(data.issues);
    } catch {
      setIssues([]);
    } finally {
      setIssuesLoading(false);
    }
  }, [selectedSymbol]);

  useEffect(() => { loadChart(); }, [loadChart]);
  useEffect(() => { loadIssues(); }, [loadIssues]);

  // 차트용 데이터 (거래량 단위 조정)
  const plotData = chartData?.data.map((d) => ({
    ...d,
    vol_k: Math.round(d.volume / 1000),  // 천주 단위
  })) ?? [];

  // 통계
  const prices = plotData.map((d) => d.close).filter(Boolean);
  const maxPrice = prices.length ? Math.max(...prices) : 0;
  const minPrice = prices.length ? Math.min(...prices) : 0;
  const firstClose = plotData[0]?.close ?? 0;
  const lastClose = plotData[plotData.length - 1]?.close ?? 0;
  const periodReturn = firstClose > 0 ? ((lastClose - firstClose) / firstClose) * 100 : 0;

  const currentStock = stocks.find((s) => s.symbol === selectedSymbol);

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div>
        <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">주가 차트</h1>
        <p className="mt-0.5 text-xs text-neutral-400">
          보유 종목의 주가 추이와 이동평균을 확인하세요
        </p>
      </div>

      {/* 종목 선택 */}
      <div className="flex flex-wrap gap-3">
        <div className="flex-1 min-w-[200px]">
          <select
            value={selectedSymbol}
            onChange={(e) => setSelectedSymbol(e.target.value)}
            className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-neutral-400"
          >
            {stocks.map((s) => (
              <option key={s.symbol} value={s.symbol}>
                {s.name} ({s.symbol})
              </option>
            ))}
          </select>
        </div>

        {/* 기간 선택 */}
        <div className="flex gap-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] p-1">
          {PERIODS.map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setPeriod(id)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                period === id
                  ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                  : "text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* 종목 요약 카드 */}
      {chartData && currentStock && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] px-4 py-3">
            <div className="text-xs text-neutral-400">현재가</div>
            <div className="mt-1 text-base font-bold text-neutral-900 dark:text-neutral-100">
              {chartData.current_price.toLocaleString("ko-KR")}원
            </div>
          </div>
          <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] px-4 py-3">
            <div className="text-xs text-neutral-400">평균단가</div>
            <div className="mt-1 text-base font-bold text-neutral-900 dark:text-neutral-100">
              {chartData.avg_price.toLocaleString("ko-KR")}원
            </div>
          </div>
          <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] px-4 py-3">
            <div className="text-xs text-neutral-400">보유 수익률</div>
            <div className={`mt-1 flex items-center gap-1 text-base font-bold ${chartData.profit_rate >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
              {chartData.profit_rate >= 0 ? <ArrowUpRight size={16} /> : <ArrowDownRight size={16} />}
              {chartData.profit_rate >= 0 ? "+" : ""}{chartData.profit_rate.toFixed(2)}%
            </div>
          </div>
          <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] px-4 py-3">
            <div className="text-xs text-neutral-400">{PERIODS.find(p => p.id === period)?.label} 수익률</div>
            <div className={`mt-1 flex items-center gap-1 text-base font-bold ${periodReturn >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
              {periodReturn >= 0 ? <TrendingUp size={16} /> : <TrendingDown size={16} />}
              {periodReturn >= 0 ? "+" : ""}{periodReturn.toFixed(2)}%
            </div>
          </div>
        </div>
      )}

      {/* 차트 영역 */}
      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] overflow-hidden">
        {/* 차트 헤더 */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-subtle)] px-4 py-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">
              {chartData?.name ?? "종목 선택"}
            </h2>
            {chartData?.sector && (
              <span className="rounded bg-neutral-100 px-2 py-0.5 text-xs text-neutral-500 dark:bg-neutral-800">
                {chartData.sector}
              </span>
            )}
            {chartData && (
              <span className="text-xs text-neutral-400">
                고가 {maxPrice.toLocaleString("ko-KR")}원 · 저가 {minPrice.toLocaleString("ko-KR")}원
              </span>
            )}
          </div>

          {/* 이동평균 토글 */}
          <div className="flex gap-2 text-xs">
            {([
              { key: "ma5",  label: "MA5",  color: "#f59e0b" },
              { key: "ma20", label: "MA20", color: "#3b82f6" },
              { key: "ma60", label: "MA60", color: "#a855f7" },
            ] as const).map(({ key, label, color }) => (
              <button
                key={key}
                onClick={() => setShowMA((prev) => ({ ...prev, [key]: !prev[key] }))}
                className={`flex items-center gap-1 rounded-full px-2.5 py-1 font-medium transition-colors border ${
                  showMA[key]
                    ? "border-transparent text-white"
                    : "border-[var(--border-subtle)] text-neutral-400 bg-transparent"
                }`}
                style={showMA[key] ? { backgroundColor: color, borderColor: color } : {}}
              >
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
                {label}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 size={28} className="animate-spin text-neutral-400" />
            <span className="ml-3 text-sm text-neutral-400">차트 데이터 불러오는 중...</span>
          </div>
        ) : plotData.length === 0 ? (
          <div className="py-24 text-center text-sm text-neutral-400">데이터가 없습니다.</div>
        ) : (
          <div className="p-4">
            {/* 주가 차트 */}
            <div className="mb-1">
              <p className="text-xs font-medium text-neutral-400 mb-2">주가 (원)</p>
              <ResponsiveContainer width="100%" height={320}>
                <ComposedChart data={plotData} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 11, fill: "var(--foreground)" }}
                    tickLine={false}
                    interval="preserveStartEnd"
                    tickFormatter={(v) => v.slice(5)}
                  />
                  <YAxis
                    domain={["auto", "auto"]}
                    tick={{ fontSize: 11, fill: "var(--foreground)" }}
                    tickFormatter={(v) => v.toLocaleString("ko-KR")}
                    tickLine={false}
                    axisLine={false}
                    width={72}
                  />
                  <Tooltip content={<ChartTooltip />} />
                  <Legend
                    wrapperStyle={{ fontSize: "11px" }}
                    formatter={(value) => <span className="text-neutral-600 dark:text-neutral-400">{value}</span>}
                  />

                  {/* 평균단가 기준선 */}
                  {chartData && chartData.avg_price > 0 && (
                    <ReferenceLine
                      y={chartData.avg_price}
                      stroke="#ef4444"
                      strokeDasharray="4 2"
                      label={{ value: "평균단가", position: "insideTopRight", fontSize: 10, fill: "#ef4444" }}
                    />
                  )}

                  {/* 종가 */}
                  <Line
                    type="monotone"
                    dataKey="close"
                    name="종가"
                    stroke="#18181b"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4, fill: "#18181b" }}
                  />

                  {/* 이동평균 */}
                  {showMA.ma5 && (
                    <Line type="monotone" dataKey="ma5" name="MA5" stroke="#f59e0b"
                      strokeWidth={1.5} dot={false} activeDot={false} />
                  )}
                  {showMA.ma20 && (
                    <Line type="monotone" dataKey="ma20" name="MA20" stroke="#3b82f6"
                      strokeWidth={1.5} dot={false} activeDot={false} />
                  )}
                  {showMA.ma60 && (
                    <Line type="monotone" dataKey="ma60" name="MA60" stroke="#a855f7"
                      strokeWidth={1.5} dot={false} activeDot={false} />
                  )}
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            {/* 거래량 차트 */}
            <div>
              <p className="text-xs font-medium text-neutral-400 mb-2 mt-4">거래량 (천주)</p>
              <ResponsiveContainer width="100%" height={100}>
                <ComposedChart data={plotData} margin={{ top: 0, right: 8, bottom: 0, left: 8 }}>
                  <XAxis dataKey="date" hide />
                  <YAxis
                    tick={{ fontSize: 10, fill: "var(--foreground)" }}
                    tickFormatter={(v) => `${v}K`}
                    tickLine={false}
                    axisLine={false}
                    width={48}
                  />
                  <Tooltip
                    formatter={(v) => [`${Number(v).toLocaleString("ko-KR")}천주`, "거래량"]}
                    contentStyle={{
                      background: "var(--surface)",
                      border: "1px solid var(--border-subtle)",
                      borderRadius: "8px",
                      fontSize: "12px",
                    }}
                  />
                  <Bar
                    dataKey="vol_k"
                    name="거래량"
                    fill="#94a3b8"
                    opacity={0.7}
                    radius={[2, 2, 0, 0]}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>

      {/* AI 분석 이슈 타임라인 */}
      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] overflow-hidden">
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">
              AI 분석 이슈
              {issues.length > 0 && (
                <span className="ml-2 text-xs font-normal text-neutral-400">{issues.length}건</span>
              )}
            </h2>
            <p className="mt-0.5 text-xs text-neutral-400">이 종목이 언급된 분석 이력</p>
          </div>
          <button
            onClick={loadIssues}
            className="flex items-center gap-1 rounded-md border border-[var(--border-subtle)] px-2.5 py-1 text-xs text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            <Loader2 size={11} className={issuesLoading ? "animate-spin" : "opacity-0 w-0"} />
            새로고침
          </button>
        </div>

        {issuesLoading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-neutral-400">
            <Loader2 size={14} className="animate-spin" /> 불러오는 중...
          </div>
        ) : issues.length === 0 ? (
          <div className="py-8 text-center text-sm text-neutral-400">
            아직 이 종목이 언급된 분석이 없습니다.
            <br />
            <span className="text-xs">AI 인텔리전스에서 유튜브나 기사를 분석해 보세요.</span>
          </div>
        ) : (
          <div className="divide-y divide-[var(--border-subtle)]">
            {issues.map((issue) => (
              <div key={issue.id} className="flex gap-3 px-4 py-3 hover:bg-[var(--surface-elevated)] transition-colors">
                <div className="flex flex-col items-center gap-1 pt-1">
                  <SentimentDot sentiment={issue.sentiment} />
                  <div className="w-px flex-1 bg-[var(--border-subtle)]" />
                </div>
                <div className="min-w-0 flex-1 pb-1">
                  <div className="flex items-center gap-2 mb-1">
                    <IssueSourceIcon type={issue.source_type} />
                    <span className="text-xs text-neutral-400">
                      {new Date(issue.created_at).toLocaleDateString("ko-KR", {
                        year: "numeric", month: "short", day: "numeric",
                      })}
                    </span>
                    {issue.sentiment === "POSITIVE" && (
                      <span className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 px-1.5 py-0.5 rounded-full">긍정</span>
                    )}
                    {issue.sentiment === "NEGATIVE" && (
                      <span className="text-[10px] font-medium text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 px-1.5 py-0.5 rounded-full">부정</span>
                    )}
                    {issue.sentiment === "NEUTRAL" && (
                      <span className="text-[10px] font-medium text-neutral-500 bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5 rounded-full">중립</span>
                    )}
                  </div>
                  {issue.source_title && (
                    <p className="text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1 line-clamp-1">
                      {issue.source_title}
                    </p>
                  )}
                  <p className="text-xs text-neutral-600 dark:text-neutral-400 leading-relaxed line-clamp-3">
                    {issue.issue_summary}
                  </p>
                  {issue.source_url && (
                    <a
                      href={issue.source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1 inline-flex items-center gap-1 text-[11px] text-blue-500 hover:underline"
                    >
                      원문 보기 <ExternalLink size={9} />
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 보유 종목 빠른 선택 */}
      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] p-4">
        <p className="mb-3 text-xs font-medium text-neutral-500 dark:text-neutral-400">보유 종목 빠른 선택</p>
        <div className="flex flex-wrap gap-2">
          {stocks.map((s) => (
            <button
              key={s.symbol}
              onClick={() => setSelectedSymbol(s.symbol)}
              className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                selectedSymbol === s.symbol
                  ? "border-neutral-900 bg-neutral-900 text-white dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900"
                  : "border-[var(--border-subtle)] text-neutral-600 hover:border-neutral-400 dark:text-neutral-400"
              }`}
            >
              <span className="font-medium">{s.name}</span>
              <span
                className={`ml-1.5 text-xs ${
                  s.profit_rate >= 0
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-red-500 dark:text-red-400"
                }`}
              >
                {s.profit_rate >= 0 ? "+" : ""}{s.profit_rate.toFixed(1)}%
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
