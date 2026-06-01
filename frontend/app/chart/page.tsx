"use client";

import { useEffect, useState, useCallback, useMemo, useRef, Suspense } from "react";
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
  ReferenceArea,
  ReferenceDot,
  Cell,
} from "recharts";
import { ClientOnly } from "@/components/client-only";
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
  BarChart3,
  LayoutGrid,
  Sparkles,
  StickyNote,
  Trash2,
  Plus,
  Star,
} from "lucide-react";
import { api, signalApi, scoreApi, watchlistApi, type StockItem, type StockIssueTimeline, type AnalysisLog, type MoveCause, type StockSignal, type SharedSignalsResponse, type RelatedAnalysisItem, type BuyScoreResult, type ChartDateMemoItem, type WatchlistItem } from "@/lib/api";
import { streamAnalyze, AnalyzeStreamError } from "@/lib/analyzeStream";
import {
  analyzeChart,
  enrichChartBars,
  filterAnnotations,
  buildPriceEventsFromChart,
  ANNOTATION_LAYERS,
  type ChartBar,
  type ChartAnalysisResult,
  type EnrichedChartBar,
  type AnnotationLayerId,
  type ChartAnnotation,
  type SignificantMove,
  type SavedMoveCause,
} from "@/lib/chartAnalysis";
import { ChartAnalysisPanel } from "@/components/chart-analysis-panel";

type Period = "1M" | "3M" | "6M" | "1Y";

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

const ANALYSIS_DISPLAY_DAYS = 22;
const CHART_SYMBOL_STORAGE = "stockmind-chart-symbol";
const CHART_PERIOD_STORAGE = "stockmind-chart-period";

function fmtMoney(n: number, currency = "KRW") {
  if (currency === "USD") {
    return `$${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  }
  return `${Math.round(n).toLocaleString("ko-KR")}원`;
}

function ChartTooltip({
  active,
  payload,
  label,
  eventByDate,
  dateMemosByDate,
}: {
  active?: boolean;
  payload?: { name: string; value: number; color: string }[];
  label?: string;
  eventByDate?: Record<string, SignificantMove>;
  dateMemosByDate?: Record<string, string>;
}) {
  if (!active || !payload || payload.length === 0) return null;

  const volItem = payload.find((p) => p.name === "거래량");
  const ev = label ? eventByDate?.[label] : undefined;

  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] p-3 text-xs shadow-lg max-w-xs">
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
      {ev && (
        <div className={`mt-2 rounded-md border p-2 ${
          ev.direction === "up"
            ? "border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-900/20"
            : "border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/20"
        }`}>
          <p className={`font-semibold ${ev.direction === "up" ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400"}`}>
            {ev.changePct >= 0 ? "+" : ""}{ev.changePct.toFixed(1)}% {ev.direction === "up" ? "급등" : "급락"}
            {ev.matchedIssue && " · AI 연결"}
          </p>
          <p className="mt-1 text-neutral-600 dark:text-neutral-400 leading-snug">{ev.reason}</p>
        </div>
      )}
      {label && dateMemosByDate?.[label] && (
        <div className="mt-2 rounded-md border border-sky-200 bg-sky-50 p-2 dark:border-sky-800 dark:bg-sky-900/20">
          <p className="font-semibold text-sky-700 dark:text-sky-400">📝 날짜 메모</p>
          <p className="mt-1 text-neutral-600 dark:text-neutral-400 leading-snug whitespace-pre-wrap">
            {dateMemosByDate[label]}
          </p>
        </div>
      )}
    </div>
  );
}

interface ChartMemoMarker {
  id: string;
  memoId: number;
  date: string;
  y: number;
  body: string;
}

interface PriceChartProps {
  plotData: EnrichedChartBar[];
  chartData: ChartData;
  showMA: { ma5: boolean; ma20: boolean; ma60: boolean };
  analysisMode: boolean;
  analysis?: ChartAnalysisResult;
  annotationLayers: Record<AnnotationLayerId, boolean>;
  activeSignalId: string | null;
  eventAnnotations?: ChartAnnotation[];
  showEvents?: boolean;
  activeEventId?: string | null;
  eventByDate?: Record<string, SignificantMove>;
  dateMemosByDate?: Record<string, string>;
  memoMarkers?: ChartMemoMarker[];
  activeMemoId?: string | null;
  height?: number;
  signalMarkers?: { date: string; sentiment: string | null; summary: string | null }[];
  targetBuyPrice?: number | null;
}

function CrossDot(props: {
  cx?: number;
  cy?: number;
  payload?: EnrichedChartBar;
}) {
  const { cx, cy, payload } = props;
  if (cx == null || cy == null || !payload?.crossMarker) return null;
  const color = payload.crossMarker === "gc" ? "#10b981" : "#ef4444";
  const label = payload.crossMarker === "gc" ? "▲" : "▼";
  return (
    <g>
      <circle cx={cx} cy={cy} r={6} fill={color} stroke="#fff" strokeWidth={1.5} />
      <text x={cx} y={cy - 10} textAnchor="middle" fontSize={9} fill={color} fontWeight="bold">
        {label}
      </text>
    </g>
  );
}

function PriceChart({
  plotData,
  chartData,
  showMA,
  analysisMode,
  analysis,
  annotationLayers,
  activeSignalId,
  eventAnnotations = [],
  showEvents = true,
  activeEventId = null,
  eventByDate = {},
  dateMemosByDate = {},
  memoMarkers = [],
  activeMemoId = null,
  height = 320,
  signalMarkers = [],
  targetBuyPrice = null,
}: PriceChartProps) {
  const annotations =
    analysisMode && analysis
      ? filterAnnotations(analysis.annotations, annotationLayers, activeSignalId)
      : [];

  const visibleEvents =
    showEvents && (!analysisMode || annotationLayers.events)
      ? eventAnnotations.filter((a) => !activeEventId || a.id === activeEventId)
      : [];

  const showBollinger =
    analysisMode &&
    annotationLayers.bollinger &&
    (!activeSignalId || activeSignalId === "bollinger");

  const emphasizeVolume =
    analysisMode &&
    annotationLayers.volume &&
    activeSignalId === "volume";

  return (
    <>
      <ClientOnly
        fallback={
          <div style={{ height: height + (analysisMode ? 80 : 100) + 48 }} aria-hidden />
        }
      >
      <div className="mb-1">
        <p className="text-xs font-medium text-neutral-400 mb-2">
          주가 (원){analysisMode ? " · 최근 1개월" : ""}
        </p>
        <ResponsiveContainer width="100%" height={height}>
          <ComposedChart data={plotData} margin={{ top: 16, right: 8, bottom: 0, left: 8 }}>
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
            <Tooltip content={<ChartTooltip eventByDate={eventByDate} dateMemosByDate={dateMemosByDate} />} />
            <Legend
              wrapperStyle={{ fontSize: "11px" }}
              formatter={(value) => <span className="text-neutral-600 dark:text-neutral-400">{value}</span>}
            />

            {analysisMode &&
              annotations
                .filter((a) => a.type === "area")
                .map((a) => (
                  <ReferenceArea
                    key={a.id}
                    x1={a.dateStart}
                    x2={a.dateEnd}
                    y1={a.y}
                    y2={a.y2}
                    fill={a.color}
                    fillOpacity={a.fillOpacity ?? 0.1}
                    stroke={a.color}
                    strokeOpacity={0.3}
                  />
                ))}

            {chartData.avg_price > 0 && (
              <ReferenceLine
                y={chartData.avg_price}
                stroke="#ef4444"
                strokeDasharray="4 2"
                label={{ value: "평균단가", position: "insideTopRight", fontSize: 10, fill: "#ef4444" }}
              />
            )}

            {targetBuyPrice != null && targetBuyPrice > 0 && (
              <ReferenceLine
                y={targetBuyPrice}
                stroke="#0ea5e9"
                strokeDasharray="6 3"
                label={{ value: "매수 희망가", position: "insideTopLeft", fontSize: 10, fill: "#0ea5e9" }}
              />
            )}

            {analysisMode &&
              annotations
                .filter((a) => a.type === "line")
                .map((a) => (
                  <ReferenceLine
                    key={a.id}
                    y={a.y}
                    stroke={a.color}
                    strokeDasharray={a.strokeDasharray ?? "3 3"}
                    label={{
                      value: a.label,
                      position: "insideTopLeft",
                      fontSize: 9,
                      fill: a.color,
                    }}
                  />
                ))}

            {showBollinger && (
              <>
                <Line
                  type="monotone"
                  dataKey="bbUpper"
                  name="BB상단"
                  stroke="#94a3b8"
                  strokeWidth={1}
                  dot={false}
                  strokeDasharray="2 2"
                  activeDot={false}
                />
                <Line
                  type="monotone"
                  dataKey="bbMiddle"
                  name="BB중심"
                  stroke="#cbd5e1"
                  strokeWidth={1}
                  dot={false}
                  activeDot={false}
                />
                <Line
                  type="monotone"
                  dataKey="bbLower"
                  name="BB하단"
                  stroke="#94a3b8"
                  strokeWidth={1}
                  dot={false}
                  strokeDasharray="2 2"
                  activeDot={false}
                />
              </>
            )}

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

            <Line
              type="monotone"
              dataKey="close"
              name="종가"
              stroke="#18181b"
              strokeWidth={2}
              dot={analysisMode ? CrossDot : false}
              activeDot={{ r: 4, fill: "#18181b" }}
            />

            {visibleEvents.map((a) => (
                  <ReferenceDot
                    key={a.id}
                    x={a.date}
                    y={a.y}
                    r={activeEventId === a.id ? 9 : 7}
                    fill={a.color}
                    stroke={activeEventId === a.id ? "#fbbf24" : "#fff"}
                    strokeWidth={activeEventId === a.id ? 3 : 2}
                    label={{
                      value: a.label,
                      position: a.changePct != null && a.changePct < 0 ? "bottom" : "top",
                      fontSize: 9,
                      fill: a.color,
                      fontWeight: a.matchedIssue ? "bold" : "normal",
                    }}
                  />
                ))}

            {memoMarkers
              .filter((m) => !activeMemoId || activeMemoId === m.id)
              .map((m) => (
                <ReferenceDot
                  key={m.id}
                  x={m.date}
                  y={m.y}
                  r={activeMemoId === m.id ? 9 : 7}
                  fill="#0ea5e9"
                  stroke={activeMemoId === m.id ? "#fbbf24" : "#fff"}
                  strokeWidth={activeMemoId === m.id ? 3 : 2}
                  label={{
                    value: "📝",
                    position: "top",
                    fontSize: 10,
                    fill: "#0ea5e9",
                  }}
                />
              ))}

            {signalMarkers.map((m, i) => (
              <ReferenceLine
                key={`sig-${i}`}
                x={m.date}
                stroke={m.sentiment === "POSITIVE" ? "#10b981" : m.sentiment === "NEGATIVE" ? "#ef4444" : "#94a3b8"}
                strokeDasharray="4 2"
                strokeOpacity={0.6}
                strokeWidth={1.5}
                label={{
                  value: m.sentiment === "POSITIVE" ? "📈" : m.sentiment === "NEGATIVE" ? "📉" : "📋",
                  position: "top",
                  fontSize: 11,
                }}
              />
            ))}

            {analysisMode &&
              annotations
                .filter((a) => a.type === "dot" && a.date && a.y != null)
                .map((a) => (
                  <ReferenceDot
                    key={a.id}
                    x={a.date}
                    y={a.y}
                    r={7}
                    fill={a.color}
                    stroke="#fff"
                    strokeWidth={2}
                    label={{
                      value: a.label,
                      position: "top",
                      fontSize: 9,
                      fill: a.color,
                    }}
                  />
                ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div>
        <p className="text-xs font-medium text-neutral-400 mb-2 mt-4">거래량 (천주)</p>
        <ResponsiveContainer width="100%" height={analysisMode ? 80 : 100}>
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
            <Bar dataKey="vol_k" name="거래량" radius={[2, 2, 0, 0]}>
              {plotData.map((entry, index) => {
                let fill = "#94a3b8";
                let opacity = 0.7;
                if (analysisMode && annotationLayers.volume) {
                  if (entry.volSpike) {
                    fill = entry.close >= (plotData[index - 1]?.close ?? entry.close) ? "#3b82f6" : "#ef4444";
                    opacity = emphasizeVolume || !activeSignalId ? 1 : 0.95;
                  } else if (emphasizeVolume) {
                    opacity = 0.25;
                  }
                }
                return <Cell key={entry.date} fill={fill} fillOpacity={opacity} />;
              })}
            </Bar>
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      </ClientOnly>

      {analysisMode && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {[
            { color: "#6366f1", label: "지지·저항 박스" },
            { color: "#10b981", label: "지지선" },
            { color: "#f97316", label: "저항선" },
            { color: "#3b82f6", label: "눌림목 구간" },
            { color: "#10b981", label: "▲ 골든크로스" },
            { color: "#ef4444", label: "▼ 데드크로스" },
            { color: "#3b82f6", label: "거래량 급증" },
            { color: "#059669", label: "▲ 급등 (AI)" },
            { color: "#dc2626", label: "▼ 급락 (AI)" },
          ].map(({ color, label }) => (
            <span
              key={label}
              className="inline-flex items-center gap-1 rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400"
            >
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
              {label}
            </span>
          ))}
        </div>
      )}
      {!analysisMode && showEvents && visibleEvents.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {[
            { color: "#059669", label: "▲ 급등" },
            { color: "#dc2626", label: "▼ 급락" },
            { color: "#fbbf24", label: "선택 강조" },
          ].map(({ color, label }) => (
            <span
              key={label}
              className="inline-flex items-center gap-1 rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400"
            >
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
              {label}
            </span>
          ))}
        </div>
      )}
    </>
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

function ExplainLogPanel({ logs, analyzing }: { logs: AnalysisLog[]; analyzing: boolean }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logs.length, analyzing]);

  if (!analyzing && logs.length === 0) return null;

  const levelColor = (l: string) =>
    l === "error" ? "text-red-400" : l === "warn" ? "text-amber-400" : "text-emerald-400";

  return (
    <div className="mt-3 rounded-lg border border-neutral-800 bg-neutral-950 overflow-hidden">
      <div className="flex items-center gap-2 border-b border-neutral-800 px-3 py-2">
        <span className="text-xs text-neutral-400 font-mono">AI 원인 검색 로그</span>
        {analyzing && (
          <span className="ml-auto flex items-center gap-1 text-[10px] text-amber-400">
            <Loader2 size={10} className="animate-spin" /> 진행 중
          </span>
        )}
      </div>
      <div
        ref={scrollRef}
        className="p-3 font-mono text-[10px] space-y-0.5 max-h-36 overflow-y-auto"
      >
        {logs.map((l, i) => (
          <div key={`${l.ts}-${i}`} className="flex gap-2">
            <span className="text-neutral-600 shrink-0">{l.ts}</span>
            <span className={levelColor(l.level)}>{l.msg}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

type PriorCauseContext = {
  reason: string;
  sourceTitle?: string | null;
  sourceUrl?: string | null;
  label: string;
};

function causeSourceLabel(m: SignificantMove): string {
  if (m.matchedIssue) return "종목 이슈";
  if (m.causeSource === "sector") return "섹터 공유";
  if (m.causeSource === "macro") return "매크로";
  if (m.causeSource === "ai_search") return "AI 원인";
  return "가격 변동";
}

function snapshotPriorCause(move: SignificantMove): PriorCauseContext {
  return {
    reason: move.reason,
    sourceTitle: move.sourceTitle,
    sourceUrl: move.sourceUrl,
    label: causeSourceLabel(move),
  };
}

function logTs() {
  return new Date().toLocaleTimeString("ko-KR", { hour12: false });
}

const EXPLAIN_PROVIDER_OPTIONS = [
  { id: "gemini" as const,  label: "Gemini", hint: "gemini-3.1-flash-lite" },
  { id: "openai" as const,  label: "GPT",    hint: "gpt-4o-mini" },
  { id: "claude" as const,  label: "Claude", hint: "claude-3-5-haiku" },
];

const RELATED_TYPE_LABEL: Record<string, string> = {
  sector: "📊 섹터",
  macro: "🌍 매크로",
  peer_stock: "🔗 peer",
  keyword: "🏷 키워드",
};

function RelatedAnalysisPanel({
  items,
  loading,
  eventDate,
}: {
  items: RelatedAnalysisItem[];
  loading: boolean;
  eventDate: string | null;
}) {
  if (!eventDate) return null;

  return (
    <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50/50 dark:border-blue-800 dark:bg-blue-900/10 overflow-hidden">
      <div className="border-b border-blue-200 dark:border-blue-800 px-3 py-2">
        <p className="text-xs font-semibold text-blue-800 dark:text-blue-300">
          관련 분석 · {eventDate}
        </p>
        <p className="text-[10px] text-blue-600/70 dark:text-blue-400/70">
          섹터·매크로·키워드 연관 — 참고용 (동일 원인 단정 아님)
        </p>
      </div>
      <div className="p-3 space-y-2 max-h-48 overflow-y-auto">
        {loading && (
          <div className="flex items-center gap-2 text-xs text-neutral-400">
            <Loader2 size={12} className="animate-spin" /> 연관 분석 불러오는 중...
          </div>
        )}
        {!loading && items.length === 0 && (
          <p className="text-xs text-neutral-400">연관된 분석이 없습니다.</p>
        )}
        {!loading && items.map((item) => (
          <div key={`${item.type}-${item.id}`} className="rounded-md border border-[var(--border-subtle)] bg-[var(--surface)] px-2.5 py-2">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className="text-[10px] font-medium text-neutral-600 dark:text-neutral-400">
                {RELATED_TYPE_LABEL[item.type] ?? item.type} {item.label}
              </span>
              {item.event_date && (
                <span className="text-[10px] text-neutral-400">{item.event_date}</span>
              )}
              <span className="text-[10px] text-neutral-300">·</span>
              <span className="text-[10px] text-neutral-400">
                {item.match_reasons?.join(" · ")}
              </span>
            </div>
            <p className="text-xs text-neutral-700 dark:text-neutral-300 leading-relaxed">
              {item.summary}
            </p>
            {item.source_title && (
              <a
                href={item.source_url ?? "#"}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 block text-[10px] text-blue-600 dark:text-blue-400 truncate hover:underline"
                onClick={(e) => { if (!item.source_url) e.preventDefault(); }}
              >
                {item.channel_name ? `${item.channel_name} · ` : ""}{item.source_title}
              </a>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function PriceEventsPanel({
  moves,
  activeEventId,
  onSelect,
  explainingDate,
  onExplainMove,
  explainProvider,
  onProviderChange,
  priorCauses,
}: {
  moves: SignificantMove[];
  activeEventId: string | null;
  onSelect: (id: string | null) => void;
  explainingDate: string | null;
  onExplainMove: (move: SignificantMove, force?: boolean) => void;
  explainProvider: "openai" | "gemini" | "claude";
  onProviderChange: (p: "openai" | "gemini" | "claude") => void;
  priorCauses: Record<string, PriorCauseContext>;
}) {
  return (
    <div className="space-y-3">
      {/* AI Provider 선택 */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] text-neutral-400 shrink-0">원인 검색 AI:</span>
        {EXPLAIN_PROVIDER_OPTIONS.map((opt) => (
          <button
            key={opt.id}
            type="button"
            onClick={() => onProviderChange(opt.id)}
            title={opt.hint}
            className={`rounded-full px-2.5 py-0.5 text-[10px] font-medium border transition-colors ${
              explainProvider === opt.id
                ? "border-violet-600 bg-violet-600 text-white"
                : "border-[var(--border-subtle)] text-neutral-400 hover:border-violet-400 hover:text-violet-500"
            }`}
          >
            {opt.label}
          </button>
        ))}
        <span className="text-[10px] text-neutral-400 ml-1">
          · 섹터·매크로 공유 신호 자동 연결
        </span>
      </div>

      {moves.length === 0 && (
        <p className="text-xs text-neutral-400 py-2">
          표시 기간 내 ±5% 이상 급등·급락 구간이 없습니다.
        </p>
      )}
      {moves.map((m) => {
        const id = `event-${m.date}-${m.direction}`;
        const active = activeEventId === id;
        const prior = priorCauses[m.date];
        const isSearching = explainingDate === m.date;
        const hasAiResult = m.causeSource === "ai_search" || !!prior;
        const needsForce =
          !!prior ||
          m.matchedIssue ||
          m.causeSource === "sector" ||
          m.causeSource === "macro" ||
          m.causeSource === "ai_search";
        return (
          <div
            key={id}
            role="button"
            tabIndex={0}
            onClick={() => onSelect(active ? null : id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect(active ? null : id);
              }
            }}
            className={`w-full text-left rounded-lg border px-3 py-2.5 transition-colors cursor-pointer ${
              active
                ? "border-amber-400 bg-amber-50 dark:border-amber-600 dark:bg-amber-900/20"
                : "border-[var(--border-subtle)] hover:bg-[var(--surface-elevated)]"
            }`}
          >
            <div className="flex items-center gap-2 mb-1">
              <span
                className={`text-xs font-bold ${
                  m.direction === "up" ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"
                }`}
              >
                {m.date.slice(5)} {m.changePct >= 0 ? "+" : ""}{m.changePct.toFixed(1)}%
              </span>
              {prior ? (
                <span className="text-[10px] rounded-full bg-violet-100 text-violet-700 px-1.5 py-0.5 dark:bg-violet-900/30 dark:text-violet-400">
                  AI 원인
                </span>
              ) : m.matchedIssue ? (
                <span className="text-[10px] rounded-full bg-blue-100 text-blue-700 px-1.5 py-0.5 dark:bg-blue-900/30 dark:text-blue-400">
                  종목 이슈
                </span>
              ) : m.causeSource === "sector" ? (
                <span className="text-[10px] rounded-full bg-amber-100 text-amber-800 px-1.5 py-0.5 dark:bg-amber-900/30 dark:text-amber-400">
                  섹터 공유
                </span>
              ) : m.causeSource === "macro" ? (
                <span className="text-[10px] rounded-full bg-purple-100 text-purple-700 px-1.5 py-0.5 dark:bg-purple-900/30 dark:text-purple-400">
                  매크로
                </span>
              ) : m.causeSource === "ai_search" ? (
                <span className="text-[10px] rounded-full bg-violet-100 text-violet-700 px-1.5 py-0.5 dark:bg-violet-900/30 dark:text-violet-400">
                  AI 원인
                </span>
              ) : (
                <span className="text-[10px] text-neutral-400">가격 변동</span>
              )}
              {m.sentiment === "POSITIVE" && (
                <span className="text-[10px] text-emerald-600">긍정</span>
              )}
              {m.sentiment === "NEGATIVE" && (
                <span className="text-[10px] text-red-600">부정</span>
              )}
            </div>

            {prior && (
              <div className="mt-1.5 rounded-md border border-neutral-200 bg-neutral-50 px-2.5 py-2 dark:border-neutral-700 dark:bg-neutral-900/40">
                <p className="text-[10px] font-medium text-neutral-500 dark:text-neutral-400">
                  기존 연결 · {prior.label}
                </p>
                <p className="mt-0.5 text-xs text-neutral-600 dark:text-neutral-400 leading-relaxed">
                  {prior.reason}
                </p>
                {prior.sourceTitle && (
                  <p className="mt-1 text-[10px] text-neutral-400 truncate">{prior.sourceTitle}</p>
                )}
              </div>
            )}

            {prior && (
              <p className="mt-2 text-[10px] font-medium text-violet-600 dark:text-violet-400">
                AI 원인 검색
              </p>
            )}

            <p className={`text-xs text-neutral-600 dark:text-neutral-400 leading-relaxed ${prior ? "mt-0.5" : ""} ${isSearching ? "italic text-neutral-400" : ""}`}>
              {isSearching && !prior ? "AI가 원인을 분석하는 중입니다…" : m.reason}
            </p>
            {m.sourceTitle && !isSearching && (
              <p className="mt-1 text-[10px] text-neutral-400 truncate">{m.sourceTitle}</p>
            )}

            <div className="mt-2 flex justify-end" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                disabled={isSearching}
                onClick={() => onExplainMove(m, needsForce)}
                className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-medium disabled:opacity-50 ${
                  hasAiResult
                    ? "border-neutral-300 text-neutral-600 hover:bg-neutral-100 dark:border-neutral-600 dark:text-neutral-400 dark:hover:bg-neutral-800"
                    : "border-violet-300 bg-violet-50 text-violet-700 hover:bg-violet-100 dark:border-violet-700 dark:bg-violet-900/20 dark:text-violet-300 dark:hover:bg-violet-900/40"
                }`}
              >
                {isSearching ? (
                  <>
                    <Loader2 size={10} className="animate-spin" /> 검색 중...
                  </>
                ) : (
                  <>
                    <Sparkles size={10} />
                    {hasAiResult ? "다시 검색" : "AI 원인 검색"}
                  </>
                )}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DateMemosPanel({
  memos,
  plotDates,
  activeMemoId,
  onSelect,
  memoDate,
  memoBody,
  onMemoDateChange,
  onMemoBodyChange,
  onSave,
  onDelete,
  saving,
}: {
  memos: ChartDateMemoItem[];
  plotDates: Set<string>;
  activeMemoId: string | null;
  onSelect: (id: string | null) => void;
  memoDate: string;
  memoBody: string;
  onMemoDateChange: (v: string) => void;
  onMemoBodyChange: (v: string) => void;
  onSave: () => void;
  onDelete: (memoId: number) => void;
  saving: boolean;
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 items-end">
        <div>
          <label className="block text-[10px] text-neutral-400 mb-1">날짜</label>
          <input
            type="date"
            value={memoDate}
            onChange={(e) => onMemoDateChange(e.target.value)}
            className="rounded-md border border-[var(--border-subtle)] bg-[var(--background)] px-2 py-1.5 text-xs"
          />
        </div>
        <div className="flex-1 min-w-[200px]">
          <label className="block text-[10px] text-neutral-400 mb-1">메모</label>
          <input
            type="text"
            value={memoBody}
            onChange={(e) => onMemoBodyChange(e.target.value)}
            placeholder="해당 날짜에 기록할 내용"
            className="w-full rounded-md border border-[var(--border-subtle)] bg-[var(--background)] px-2 py-1.5 text-xs"
          />
        </div>
        <button
          type="button"
          onClick={onSave}
          disabled={saving || !memoDate || !memoBody.trim()}
          className="flex items-center gap-1 rounded-md bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-700 disabled:opacity-50"
        >
          <Plus size={12} />
          {saving ? "저장 중..." : "날짜에 메모 추가"}
        </button>
      </div>

      {memos.length === 0 ? (
        <p className="text-xs text-neutral-400 py-1">등록된 날짜 메모가 없습니다.</p>
      ) : (
        <div className="space-y-2">
          {memos.map((m) => {
            const id = `memo-${m.id}`;
            const active = activeMemoId === id;
            const inRange = plotDates.has(m.event_date);
            return (
              <div
                key={m.id}
                role="button"
                tabIndex={0}
                onClick={() => onSelect(active ? null : id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelect(active ? null : id);
                  }
                }}
                className={`w-full text-left rounded-lg border px-3 py-2.5 transition-colors cursor-pointer ${
                  active
                    ? "border-sky-400 bg-sky-50 dark:border-sky-600 dark:bg-sky-900/20"
                    : "border-[var(--border-subtle)] hover:bg-[var(--surface-elevated)]"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <StickyNote size={12} className="text-sky-500 shrink-0" />
                      <span className="text-xs font-bold text-sky-700 dark:text-sky-400">
                        {m.event_date.slice(5)}
                      </span>
                      {!inRange && (
                        <span className="text-[10px] text-neutral-400">(표시 기간 밖)</span>
                      )}
                    </div>
                    <p className="text-xs text-neutral-600 dark:text-neutral-400 leading-relaxed whitespace-pre-wrap">
                      {m.body}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(m.id);
                    }}
                    className="shrink-0 rounded p-1 text-neutral-300 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20"
                    title="삭제"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ChartContent() {
  const searchParams = useSearchParams();
  const [stocks, setStocks] = useState<StockItem[]>([]);
  const [watchlistItems, setWatchlistItems] = useState<WatchlistItem[]>([]);
  const [selectedSymbol, setSelectedSymbol] = useState<string>("");
  const [period, setPeriod] = useState<Period>("3M");

  useEffect(() => {
    const saved = localStorage.getItem(CHART_PERIOD_STORAGE);
    if (saved && PERIODS.some((p) => p.id === saved)) {
      setPeriod(saved as Period);
    }
  }, []);
  const [analysisMode, setAnalysisMode] = useState(false);
  const [chartData, setChartData] = useState<ChartData | null>(null);
  const [loading, setLoading] = useState(false);
  const [chartError, setChartError] = useState<string | null>(null);
  const [showMA, setShowMA] = useState({ ma5: true, ma20: true, ma60: false });
  const [issues, setIssues] = useState<StockIssueTimeline[]>([]);
  const [issuesLoading, setIssuesLoading] = useState(false);
  const [moveCauses, setMoveCauses] = useState<SavedMoveCause[]>([]);
  const [stockSignals, setStockSignals] = useState<StockSignal[]>([]);
  const [sharedSignals, setSharedSignals] = useState<SharedSignalsResponse | null>(null);
  const [relatedItems, setRelatedItems] = useState<RelatedAnalysisItem[]>([]);
  const [relatedLoading, setRelatedLoading] = useState(false);
  const [explainingDate, setExplainingDate] = useState<string | null>(null);
  const [explainLogs, setExplainLogs] = useState<AnalysisLog[]>([]);
  const [explainProvider, setExplainProvider] = useState<"openai" | "gemini" | "claude">("gemini");
  const [aiOverrideDates, setAiOverrideDates] = useState<Record<string, boolean>>({});
  const [priorCauses, setPriorCauses] = useState<Record<string, PriorCauseContext>>({});
  const [activeSignalId, setActiveSignalId] = useState<string | null>(null);
  const [activeEventId, setActiveEventId] = useState<string | null>(null);
  const [showPriceEvents, setShowPriceEvents] = useState(true);
  const [annotationLayers, setAnnotationLayers] = useState<Record<AnnotationLayerId, boolean>>(() =>
    Object.fromEntries(ANNOTATION_LAYERS.map((l) => [l.id, l.defaultOn])) as Record<
      AnnotationLayerId,
      boolean
    >
  );
  const [buyScore, setBuyScore] = useState<BuyScoreResult | null>(null);
  const [buyScoreLoading, setBuyScoreLoading] = useState(false);
  const [dateMemos, setDateMemos] = useState<ChartDateMemoItem[]>([]);
  const [activeMemoId, setActiveMemoId] = useState<string | null>(null);
  const [memoDate, setMemoDate] = useState("");
  const [memoBody, setMemoBody] = useState("");
  const [memoSaving, setMemoSaving] = useState(false);

  const fetchPeriod = analysisMode ? "6M" : period;

  const loadDateMemos = useCallback(async () => {
    if (!selectedSymbol) {
      setDateMemos([]);
      return;
    }
    try {
      setDateMemos(await api.getChartMemos(selectedSymbol));
    } catch {
      setDateMemos([]);
    }
  }, [selectedSymbol]);

  useEffect(() => {
    loadDateMemos();
    setActiveMemoId(null);
  }, [loadDateMemos]);

  useEffect(() => {
    (async () => {
      const [stocksRes, wlRes] = await Promise.allSettled([
        api.getStocks(),
        watchlistApi.getAll(),
      ]);
      const data = stocksRes.status === "fulfilled" ? stocksRes.value : [];
      const wlItems = wlRes.status === "fulfilled" ? wlRes.value.items : [];
      setWatchlistItems(wlItems);

      const krx = data.filter((s) => s.market === "KRX");
      const watchExtras: StockItem[] = wlItems
        .filter((w) => w.symbol && !krx.some((s) => s.symbol === w.symbol))
        .map((w) => ({
          id: -w.id,
          symbol: w.symbol!,
          name: w.stock_name,
          market: "KRX",
          sector: w.sector,
          currency: "KRW",
          qty: 0,
          avg_price: 0,
          current_price: w.current_price ?? 0,
          change_rate: w.change_rate ?? 0,
          profit_rate: 0,
          memo: w.memo,
          last_synced_at: null,
        }));
      const combined = [...krx, ...watchExtras];

      const urlSymbol = searchParams.get("symbol");
      const savedSymbol =
        typeof window !== "undefined" ? localStorage.getItem(CHART_SYMBOL_STORAGE) : null;

      if (urlSymbol && !combined.some((s) => s.symbol === urlSymbol)) {
        combined.unshift({
          id: 0,
          symbol: urlSymbol,
          name: urlSymbol,
          market: "KRX",
          sector: null,
          currency: "KRW",
          qty: 0,
          avg_price: 0,
          current_price: 0,
          change_rate: 0,
          profit_rate: 0,
          memo: null,
          last_synced_at: null,
        });
      }

      setStocks(combined);

      if (urlSymbol) {
        setSelectedSymbol(urlSymbol);
      } else if (savedSymbol && combined.some((s) => s.symbol === savedSymbol)) {
        setSelectedSymbol(savedSymbol);
      } else if (combined.length > 0) {
        setSelectedSymbol(combined[0].symbol);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectSymbol = useCallback((symbol: string) => {
    setSelectedSymbol(symbol);
    localStorage.setItem(CHART_SYMBOL_STORAGE, symbol);
  }, []);

  const selectPeriod = useCallback((p: Period) => {
    setPeriod(p);
    localStorage.setItem(CHART_PERIOD_STORAGE, p);
  }, []);

  const loadChart = useCallback(async () => {
    if (!selectedSymbol) return;
    setLoading(true);
    setChartError(null);
    try {
      const data = await api.getStockChart(selectedSymbol, fetchPeriod);
      if (!Array.isArray(data.data)) {
        setChartData(null);
        setChartError("차트 데이터 형식이 올바르지 않습니다.");
        return;
      }
      const normalized: ChartData = {
        symbol: data.symbol,
        name: data.name,
        sector: data.sector ?? null,
        avg_price: data.avg_price ?? 0,
        current_price: data.current_price ?? 0,
        profit_rate: data.profit_rate ?? 0,
        period: data.period ?? fetchPeriod,
        data: data.data,
      };
      setChartData(normalized);
      if (data.data.length === 0) {
        setChartError("표시할 차트 데이터가 없습니다. 종목코드·시장(KRX)을 확인하세요.");
      }
    } catch (e) {
      setChartData(null);
      setChartError(e instanceof Error ? e.message : "차트를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [selectedSymbol, fetchPeriod]);

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

  useEffect(() => {
    if (!selectedSymbol) {
      setBuyScore(null);
      return;
    }
    setBuyScoreLoading(true);
    scoreApi
      .getBuyScore(selectedSymbol, 30)
      .then(setBuyScore)
      .catch(() => setBuyScore(null))
      .finally(() => setBuyScoreLoading(false));
  }, [selectedSymbol]);

  const loadMoveCauses = useCallback(async () => {
    if (!selectedSymbol) return;
    try {
      const data = await api.getMoveCauses(selectedSymbol);
      setMoveCauses(
        data.causes.map((c: MoveCause): SavedMoveCause => ({
          id: c.id,
          event_date: c.event_date,
          change_pct: c.change_pct,
          direction: c.direction,
          close_price: c.close_price,
          reason: c.reason,
          sentiment: c.sentiment,
          key_factors: c.key_factors,
          source_urls: c.source_urls,
          confidence: c.confidence,
          analysis_provider: c.analysis_provider,
        })),
      );
    } catch {
      setMoveCauses([]);
    }
  }, [selectedSymbol]);

  useEffect(() => { loadChart(); setActiveEventId(null); }, [loadChart]);
  useEffect(() => { loadIssues(); setActiveEventId(null); }, [loadIssues]);
  useEffect(() => { loadMoveCauses(); }, [loadMoveCauses]);

  useEffect(() => {
    if (!selectedSymbol) return;
    signalApi.getReminders(90).then((r) => {
      const entry = r.reminders.find((rm) => rm.symbol === selectedSymbol);
      setStockSignals(entry ? entry.signals : []);
    }).catch(() => setStockSignals([]));
  }, [selectedSymbol]);

  useEffect(() => {
    if (!selectedSymbol) {
      setSharedSignals(null);
      return;
    }
    signalApi.getSharedSignals(selectedSymbol, 120).then(setSharedSignals).catch(() => setSharedSignals(null));
  }, [selectedSymbol]);

  const activeEventDate = useMemo(() => {
    if (!activeEventId) return null;
    const match = activeEventId.match(/^event-(\d{4}-\d{2}-\d{2})-/);
    return match ? match[1] : null;
  }, [activeEventId]);

  useEffect(() => {
    if (!selectedSymbol || !activeEventDate) {
      setRelatedItems([]);
      return;
    }
    setRelatedLoading(true);
    signalApi.getRelated(selectedSymbol, activeEventDate, 7)
      .then((r) => setRelatedItems(r.related))
      .catch(() => setRelatedItems([]))
      .finally(() => setRelatedLoading(false));
  }, [selectedSymbol, activeEventDate]);

  useEffect(() => {
    setAiOverrideDates({});
    setPriorCauses({});
    setExplainLogs([]);
    setExplainingDate(null);
  }, [selectedSymbol]);

  const handleExplainMove = useCallback(
    async (move: SignificantMove, force = false) => {
      if (!selectedSymbol || explainingDate) return;

      const shouldSnapshot =
        move.matchedIssue ||
        move.causeSource === "sector" ||
        move.causeSource === "macro" ||
        move.causeSource === "ai_search";

      setPriorCauses((prev) => {
        if (prev[move.date] || !shouldSnapshot) return prev;
        return { ...prev, [move.date]: snapshotPriorCause(move) };
      });

      if (shouldSnapshot || force) {
        setAiOverrideDates((prev) => ({ ...prev, [move.date]: true }));
      }

      setExplainingDate(move.date);
      setExplainLogs((prev) => [
        ...prev,
        {
          level: "info",
          msg: `── ${move.date} AI 원인 검색 ${force ? "(재검색)" : ""} ──`,
          ts: logTs(),
        },
      ]);

      try {
        await streamAnalyze(
          `/intel/stocks/${selectedSymbol}/explain-move/stream`,
          {
            event_date: move.date,
            change_pct: move.changePct,
            direction: move.direction,
            close_price: move.close,
            force,
            analysis_provider: explainProvider,
          },
          (log) => setExplainLogs((prev) => [...prev, log]),
        );
        await loadMoveCauses();
      } catch (e) {
        if (e instanceof AnalyzeStreamError) {
          setExplainLogs((prev) => [...prev, ...e.logs]);
        }
      } finally {
        setExplainingDate(null);
      }
    },
    [selectedSymbol, explainingDate, loadMoveCauses, explainProvider],
  );

  const toggleAnalysisMode = () => {
    setAnalysisMode((prev) => {
      const next = !prev;
      if (next) {
        setShowMA({ ma5: true, ma20: true, ma60: true });
      } else {
        setActiveSignalId(null);
      }
      return next;
    });
  };

  const fullPlotData: EnrichedChartBar[] = useMemo(() => {
    if (!chartData?.data.length) return [];
    if (analysisMode) return enrichChartBars(chartData.data, ANALYSIS_DISPLAY_DAYS);
    return chartData.data.map((d) => ({
      ...d,
      vol_k: Math.round(d.volume / 1000),
      bbUpper: d.close,
      bbLower: d.close,
      bbMiddle: d.close,
      volSpike: false,
      crossMarker: null,
      pullback: false,
    }));
  }, [chartData, analysisMode]);

  const displayPlotData = fullPlotData;

  const plotDateSet = useMemo(
    () => new Set(displayPlotData.map((d) => d.date)),
    [displayPlotData],
  );

  const dateMemosByDate = useMemo(
    () => Object.fromEntries(dateMemos.map((m) => [m.event_date, m.body])),
    [dateMemos],
  );

  const memoMarkers: ChartMemoMarker[] = useMemo(() => {
    return dateMemos
      .map((m) => {
        const bar = displayPlotData.find((d) => d.date === m.event_date);
        if (!bar) return null;
        return {
          id: `memo-${m.id}`,
          memoId: m.id,
          date: m.event_date,
          y: bar.close,
          body: m.body,
        };
      })
      .filter((x): x is ChartMemoMarker => x != null);
  }, [dateMemos, displayPlotData]);

  async function saveDateMemo() {
    if (!selectedSymbol || !memoDate || !memoBody.trim()) return;
    setMemoSaving(true);
    try {
      const res = await api.createChartMemo(selectedSymbol, {
        event_date: memoDate,
        body: memoBody.trim(),
      });
      setMemoBody("");
      await loadDateMemos();
      setActiveMemoId(`memo-${res.memo.id}`);
      setActiveEventId(null);
    } finally {
      setMemoSaving(false);
    }
  }

  async function deleteDateMemo(memoId: number) {
    if (!confirm("이 날짜 메모를 삭제할까요?")) return;
    await api.deleteChartMemo(memoId);
    if (activeMemoId === `memo-${memoId}`) setActiveMemoId(null);
    await loadDateMemos();
  }

  const priceEventData = useMemo(() => {
    if (!chartData?.data?.length) {
      return { moves: [] as SignificantMove[], annotations: [] as ChartAnnotation[], eventByDate: {} as Record<string, SignificantMove> };
    }
    const visibleDates = displayPlotData.map((d) => d.date);
    const sectorForMatch = (sharedSignals?.sector_signals ?? []).map((s) => ({
      type: "sector" as const,
      id: s.id,
      event_date: s.event_date,
      summary: s.summary,
      sentiment: s.sentiment,
      label: s.label,
      source_url: s.source_url,
      source_title: s.source_title,
      channel_name: s.channel_name,
    }));
    const macroForMatch = (sharedSignals?.macro_signals ?? []).map((m) => ({
      type: "macro" as const,
      id: m.id,
      event_date: m.event_date,
      summary: m.summary,
      sentiment: m.sentiment,
      label: m.label,
      source_url: m.source_url,
      source_title: m.source_title,
      channel_name: m.channel_name,
    }));
    const { moves: rawMoves, annotations } = buildPriceEventsFromChart(
      chartData.data,
      issues,
      visibleDates,
      moveCauses,
      sectorForMatch,
      macroForMatch,
      aiOverrideDates,
    );
    const moves = rawMoves.map((move) => {
      if (aiOverrideDates[move.date] && explainingDate === move.date) {
        const saved = moveCauses.find((c) => c.event_date === move.date);
        if (!saved) {
          return {
            ...move,
            matchedIssue: false,
            causeSource: "ai_search" as const,
            reason: "AI가 원인을 분석하는 중입니다…",
          };
        }
      }
      return move;
    });
    const eventByDate = Object.fromEntries(moves.map((m) => [m.date, m]));
    return { moves, annotations, eventByDate };
  }, [chartData, issues, displayPlotData, moveCauses, sharedSignals, aiOverrideDates, explainingDate]);

  const analysisResult = useMemo(() => {
    if (!chartData?.data?.length) return null;
    return analyzeChart(
      chartData.data,
      chartData.avg_price,
      chartData.current_price
    );
  }, [chartData]);

  const statsData = analysisMode ? displayPlotData : fullPlotData;
  const prices = statsData.map((d) => d.close).filter(Boolean);
  const maxPrice = prices.length ? Math.max(...prices) : 0;
  const minPrice = prices.length ? Math.min(...prices) : 0;
  const firstClose = statsData[0]?.close ?? 0;
  const lastClose = statsData[statsData.length - 1]?.close ?? 0;
  const periodReturn = firstClose > 0 ? ((lastClose - firstClose) / firstClose) * 100 : 0;

  const currentStock = stocks.find((s) => s.symbol === selectedSymbol);

  const watchlistSymbolSet = useMemo(
    () => new Set(watchlistItems.map((w) => w.symbol).filter((s): s is string => !!s)),
    [watchlistItems],
  );

  const selectedWatchlist = useMemo(
    () => watchlistItems.find((w) => w.symbol === selectedSymbol) ?? null,
    [watchlistItems, selectedSymbol],
  );

  const stocksForPicker = useMemo(() => {
    return [...stocks].sort((a, b) => {
      const aw = watchlistSymbolSet.has(a.symbol) ? 0 : 1;
      const bw = watchlistSymbolSet.has(b.symbol) ? 0 : 1;
      if (aw !== bw) return aw - bw;
      return a.name.localeCompare(b.name, "ko");
    });
  }, [stocks, watchlistSymbolSet]);

  const displayPrice = chartData?.current_price ?? currentStock?.current_price ?? 0;
  const displayAvg = chartData?.avg_price ?? currentStock?.avg_price ?? 0;
  const displayProfitRate = chartData?.profit_rate ?? currentStock?.profit_rate ?? 0;
  const displayQty = currentStock?.qty ?? 0;
  const displayCurrency = currentStock?.currency ?? "KRW";
  const evalAmount =
    currentStock?.current_value ?? displayQty * displayPrice;
  const pnlAmount =
    currentStock?.profit_loss ?? evalAmount - displayQty * displayAvg;
  const hasHoldings = displayQty > 0;

  const maToggles = [
    { key: "ma5" as const, label: "MA5", color: "#f59e0b" },
    { key: "ma20" as const, label: "MA20", color: "#3b82f6" },
    { key: "ma60" as const, label: "MA60", color: "#a855f7" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">주가 차트</h1>
          <p className="mt-0.5 text-xs text-neutral-400">
            {analysisMode
              ? "1개월 차트 + 실전 가이드 기반 분석"
              : "보유 종목의 주가 추이와 이동평균을 확인하세요"}
          </p>
        </div>
        <button
          type="button"
          onClick={toggleAnalysisMode}
          className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
            analysisMode
              ? "border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400"
              : "border-[var(--border-subtle)] bg-[var(--surface)] text-neutral-600 hover:border-neutral-400 dark:text-neutral-400"
          }`}
        >
          {analysisMode ? <LayoutGrid size={16} /> : <BarChart3 size={16} />}
          {analysisMode ? "기본 보기" : "분석 모드"}
        </button>
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="flex-1 min-w-[200px]">
          <select
            value={selectedSymbol}
            onChange={(e) => selectSymbol(e.target.value)}
            className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-neutral-400"
          >
            {stocksForPicker.map((s) => (
              <option key={s.symbol} value={s.symbol}>
                {watchlistSymbolSet.has(s.symbol) ? "★ " : ""}
                {s.name} ({s.symbol})
              </option>
            ))}
          </select>
        </div>

        {!analysisMode && (
          <div className="flex gap-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] p-1">
            {PERIODS.map(({ id, label }) => (
              <button
                key={id}
                onClick={() => selectPeriod(id)}
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
        )}

        {analysisMode && (
          <span className="flex items-center rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-400">
            1개월 분석 · 6M 데이터 기반 지표
          </span>
        )}
      </div>

      {chartData && currentStock && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] px-4 py-3">
            <div className="text-xs text-neutral-400">현재가</div>
            <div className="mt-1 text-base font-bold text-neutral-900 dark:text-neutral-100">
              {fmtMoney(displayPrice, displayCurrency)}
            </div>
          </div>
          <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] px-4 py-3">
            <div className="text-xs text-neutral-400">평균단가</div>
            <div className="mt-1 text-base font-bold text-neutral-900 dark:text-neutral-100">
              {fmtMoney(displayAvg, displayCurrency)}
            </div>
          </div>
          <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] px-4 py-3">
            <div className="text-xs text-neutral-400">
              평가액{hasHoldings ? ` · ${displayQty.toLocaleString()}주` : ""}
            </div>
            <div className="mt-1 text-base font-bold text-neutral-900 dark:text-neutral-100">
              {hasHoldings ? fmtMoney(evalAmount, displayCurrency) : "—"}
            </div>
          </div>
          <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] px-4 py-3">
            <div className="text-xs text-neutral-400">차익액</div>
            {hasHoldings ? (
              <div
                className={`mt-1 flex items-center gap-1 text-base font-bold ${
                  pnlAmount >= 0
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-red-600 dark:text-red-400"
                }`}
              >
                {pnlAmount >= 0 ? <ArrowUpRight size={16} /> : <ArrowDownRight size={16} />}
                {pnlAmount >= 0 ? "+" : "-"}
                {fmtMoney(Math.abs(pnlAmount), displayCurrency)}
              </div>
            ) : (
              <div className="mt-1 text-base font-bold text-neutral-400">—</div>
            )}
          </div>
          <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] px-4 py-3">
            <div className="text-xs text-neutral-400">보유 수익률</div>
            <div className={`mt-1 flex items-center gap-1 text-base font-bold ${displayProfitRate >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
              {displayProfitRate >= 0 ? <ArrowUpRight size={16} /> : <ArrowDownRight size={16} />}
              {displayProfitRate >= 0 ? "+" : ""}{displayProfitRate.toFixed(2)}%
            </div>
          </div>
          <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] px-4 py-3">
            <div className="text-xs text-neutral-400">
              {analysisMode ? "1개월" : PERIODS.find(p => p.id === period)?.label} 수익률
            </div>
            <div className={`mt-1 flex items-center gap-1 text-base font-bold ${periodReturn >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
              {periodReturn >= 0 ? <TrendingUp size={16} /> : <TrendingDown size={16} />}
              {periodReturn >= 0 ? "+" : ""}{periodReturn.toFixed(2)}%
            </div>
          </div>
        </div>
      )}

      {selectedSymbol && (
        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Sparkles size={16} className="text-violet-500" />
              <span className="text-sm font-medium text-neutral-800 dark:text-neutral-200">
                매수 타이밍 스코어
              </span>
              <span className="text-xs text-neutral-400">Signal DB · 최근 30일</span>
            </div>
            {buyScoreLoading && <Loader2 size={14} className="animate-spin text-neutral-400" />}
          </div>
          {buyScore ? (
            <div className="mt-3 space-y-3">
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <span
                    className={`text-3xl font-bold ${
                      buyScore.score >= 70
                        ? "text-emerald-600 dark:text-emerald-400"
                        : buyScore.score >= 45
                          ? "text-amber-600 dark:text-amber-400"
                          : "text-red-600 dark:text-red-400"
                    }`}
                  >
                    {buyScore.score}
                  </span>
                  <span className="ml-1 text-sm text-neutral-400">/ 100</span>
                </div>
                <span className="rounded-md bg-neutral-100 px-2 py-0.5 text-xs font-semibold text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
                  {buyScore.grade} · {buyScore.grade_label}
                </span>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {buyScore.components.map((c) => (
                  <div
                    key={c.category}
                    className="rounded-md border border-[var(--border-subtle)] px-3 py-2 text-xs"
                  >
                    <div className="flex justify-between text-neutral-500">
                      <span>{c.label}</span>
                      <span className="font-medium text-neutral-800 dark:text-neutral-200">
                        {c.score > 0 ? "+" : ""}
                        {c.score}
                      </span>
                    </div>
                    <p className="mt-1 text-neutral-600 dark:text-neutral-400 line-clamp-2">{c.reason}</p>
                  </div>
                ))}
              </div>
              {buyScore.warnings.length > 0 && (
                <ul className="text-xs text-amber-700 dark:text-amber-400 space-y-0.5">
                  {buyScore.warnings.map((w, i) => (
                    <li key={i}>⚠ {w}</li>
                  ))}
                </ul>
              )}
              <p className="text-[10px] text-neutral-400">{buyScore.disclaimer}</p>
            </div>
          ) : !buyScoreLoading ? (
            <p className="mt-2 text-xs text-neutral-400">스코어를 불러올 수 없습니다 (보유·관심 종목만 지원).</p>
          ) : null}
        </div>
      )}

      {/* 차트 + 분석 패널 */}
      <div
        className={
          analysisMode
            ? "grid grid-cols-1 gap-4 lg:grid-cols-5"
            : ""
        }
      >
        <div
          className={`rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] overflow-hidden ${
            analysisMode ? "lg:col-span-3" : ""
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-subtle)] px-4 py-3">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">
                {chartData?.name ?? "종목 선택"}
              </h2>
              {selectedWatchlist && (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                  <Star size={10} className="fill-amber-500 text-amber-500" />
                  관심종목
                </span>
              )}
              {selectedWatchlist?.target_buy_price != null && selectedWatchlist.target_buy_price > 0 && (
                <span className="text-[10px] text-sky-600 dark:text-sky-400">
                  희망가 {selectedWatchlist.target_buy_price.toLocaleString("ko-KR")}원
                </span>
              )}
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

            <div className="flex gap-2 text-xs flex-wrap">
              <button
                type="button"
                onClick={() => setShowPriceEvents((v) => !v)}
                className={`flex items-center gap-1 rounded-full px-2.5 py-1 font-medium transition-colors border ${
                  showPriceEvents
                    ? "border-emerald-600 bg-emerald-600 text-white"
                    : "border-[var(--border-subtle)] text-neutral-400"
                }`}
              >
                <span className="h-2 w-2 rounded-full bg-emerald-400" />
                급등·급락
              </button>
              {maToggles.map(({ key, label, color }) => (
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

          {analysisMode && (
            <div className="flex flex-wrap gap-1.5 border-b border-[var(--border-subtle)] px-4 py-2 bg-[var(--surface-elevated)]">
              <span className="text-[10px] text-neutral-400 self-center mr-1">표시:</span>
              {ANNOTATION_LAYERS.map(({ id, label }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() =>
                    setAnnotationLayers((prev) => ({ ...prev, [id]: !prev[id] }))
                  }
                  className={`rounded-full px-2 py-0.5 text-[10px] font-medium border transition-colors ${
                    annotationLayers[id]
                      ? "border-neutral-700 bg-neutral-800 text-white dark:border-neutral-300 dark:bg-neutral-200 dark:text-neutral-900"
                      : "border-[var(--border-subtle)] text-neutral-400"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-24">
              <Loader2 size={28} className="animate-spin text-neutral-400" />
              <span className="ml-3 text-sm text-neutral-400">차트 데이터 불러오는 중...</span>
            </div>
          ) : chartError ? (
            <div className="py-24 text-center text-sm text-red-500 px-4">{chartError}</div>
          ) : displayPlotData.length === 0 ? (
            <div className="py-24 text-center text-sm text-neutral-400">데이터가 없습니다.</div>
          ) : chartData ? (
            <div className="p-4">
              <PriceChart
                plotData={displayPlotData}
                chartData={chartData}
                showMA={showMA}
                analysisMode={analysisMode}
                analysis={analysisResult ?? undefined}
                annotationLayers={annotationLayers}
                activeSignalId={activeSignalId}
                eventAnnotations={priceEventData.annotations}
                showEvents={showPriceEvents}
                activeEventId={activeEventId}
                eventByDate={priceEventData.eventByDate}
                dateMemosByDate={dateMemosByDate}
                memoMarkers={memoMarkers}
                activeMemoId={activeMemoId}
                height={analysisMode ? 280 : 320}
                signalMarkers={stockSignals.map((s) => ({
                  date: s.event_date ?? "",
                  sentiment: s.sentiment,
                  summary: s.summary,
                }))}
                targetBuyPrice={selectedWatchlist?.target_buy_price ?? null}
              />
            </div>
          ) : null}
        </div>

        {analysisMode && analysisResult && chartData && (
          <div className="lg:col-span-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] p-4 overflow-y-auto max-h-[720px]">
            <ChartAnalysisPanel
              analysis={analysisResult}
              stockName={chartData.name}
              activeSignalId={activeSignalId}
              onSignalSelect={setActiveSignalId}
            />
          </div>
        )}
      </div>

      {/* 날짜 메모 */}
      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] overflow-hidden">
        <div className="border-b border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-4 py-3">
          <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">
            날짜 메모
            {dateMemos.length > 0 && (
              <span className="ml-2 text-xs font-normal text-neutral-400">{dateMemos.length}건</span>
            )}
          </h2>
          <p className="mt-0.5 text-xs text-neutral-400">
            특정 날짜에 메모를 남기면 차트에 📝 표시 · 급변 구간처럼 클릭해 강조
          </p>
        </div>
        <div className="p-4">
          <DateMemosPanel
            memos={dateMemos}
            plotDates={plotDateSet}
            activeMemoId={activeMemoId}
            onSelect={(id) => {
              setActiveMemoId(id);
              if (id) setActiveEventId(null);
            }}
            memoDate={memoDate}
            memoBody={memoBody}
            onMemoDateChange={setMemoDate}
            onMemoBodyChange={setMemoBody}
            onSave={saveDateMemo}
            onDelete={deleteDateMemo}
            saving={memoSaving}
          />
        </div>
      </div>

      {/* 급등·급락 구간 (차트 포인트 연동) */}
      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] overflow-hidden">
        <div className="border-b border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-4 py-3">
          <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">
            주가 급변 구간
            {priceEventData.moves.length > 0 && (
              <span className="ml-2 text-xs font-normal text-neutral-400">
                {priceEventData.moves.length}건 · 종목{" "}
                {priceEventData.moves.filter((m) => m.issueMatchQuality === "strong").length} · 섹터{" "}
                {priceEventData.moves.filter((m) => m.causeSource === "sector").length} · 매크로{" "}
                {priceEventData.moves.filter((m) => m.causeSource === "macro").length} · AI{" "}
                {priceEventData.moves.filter((m) => m.causeSource === "ai_search").length}
              </span>
            )}
          </h2>
          <p className="mt-0.5 text-xs text-neutral-400">
            ±5% 이상 또는 거래량 급증 · 섹터·매크로 공유 신호 자동 연결 · 클릭 시 관련 분석 표시
          </p>
        </div>
        <div className="p-4">
          <PriceEventsPanel
            moves={priceEventData.moves}
            activeEventId={activeEventId}
            onSelect={(id) => {
              setActiveEventId(id);
              if (id) setActiveMemoId(null);
            }}
            explainingDate={explainingDate}
            onExplainMove={handleExplainMove}
            explainProvider={explainProvider}
            onProviderChange={setExplainProvider}
            priorCauses={priorCauses}
          />
          <ExplainLogPanel logs={explainLogs} analyzing={!!explainingDate} />
          <RelatedAnalysisPanel
            items={relatedItems}
            loading={relatedLoading}
            eventDate={activeEventDate}
          />
        </div>
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
            <p className="mt-0.5 text-xs text-neutral-400">
            이 종목이 언급된 분석 — 이벤트 날짜가 있는 경우만 차트 급등·급락에 자동 연결
          </p>
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
            {issues.map((issue) => {
              const linkedMove = priceEventData.moves.find(
                (m) => m.issueId === issue.id && m.issueMatchQuality === "strong",
              );
              const linkedEventId = linkedMove
                ? `event-${linkedMove.date}-${linkedMove.direction}`
                : null;
              const isLinkedActive = linkedEventId && activeEventId === linkedEventId;
              const hasEventDate = !!issue.event_date;

              return (
              <div
                key={issue.id}
                role={linkedEventId ? "button" : undefined}
                tabIndex={linkedEventId ? 0 : undefined}
                onClick={() => {
                  if (linkedEventId) {
                    setShowPriceEvents(true);
                    setActiveEventId(isLinkedActive ? null : linkedEventId);
                  }
                }}
                onKeyDown={(e) => {
                  if (linkedEventId && (e.key === "Enter" || e.key === " ")) {
                    e.preventDefault();
                    setShowPriceEvents(true);
                    setActiveEventId(isLinkedActive ? null : linkedEventId);
                  }
                }}
                className={`flex gap-3 px-4 py-3 transition-colors ${
                  isLinkedActive
                    ? "bg-amber-50 dark:bg-amber-900/15"
                    : linkedEventId
                      ? "hover:bg-[var(--surface-elevated)] cursor-pointer"
                      : "hover:bg-[var(--surface-elevated)]"
                }`}
              >
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
                    {hasEventDate ? (
                      <span className="text-[10px] text-neutral-400">
                        이벤트 {issue.event_date}
                      </span>
                    ) : (
                      <span className="text-[10px] rounded-full bg-neutral-100 text-neutral-500 px-1.5 py-0.5 dark:bg-neutral-800">
                        종목 분석 · 날짜 무관
                      </span>
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
                  {linkedEventId ? (
                    <p className="mt-1 text-[10px] text-amber-600 dark:text-amber-400">
                      차트 급변 구간과 연결됨 · 클릭하여 차트에서 강조
                    </p>
                  ) : hasEventDate ? (
                    <p className="mt-1 text-[10px] text-neutral-400">
                      표시 기간 내 급등·급락과 날짜 불일치 — 종목 참고용
                    </p>
                  ) : (
                    <p className="mt-1 text-[10px] text-neutral-400">
                      차트 자동 연결 없음 — 이 종목 분석 이력만 표시
                    </p>
                  )}
                  {issue.source_url && (
                    <a
                      href={issue.source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="mt-1 inline-flex items-center gap-1 text-[11px] text-blue-500 hover:underline"
                    >
                      원문 보기 <ExternalLink size={9} />
                    </a>
                  )}
                </div>
              </div>
            );
            })}
          </div>
        )}
      </div>

      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] p-4">
        <p className="mb-3 text-xs font-medium text-neutral-500 dark:text-neutral-400">
          보유·관심 종목 빠른 선택
          <span className="ml-2 inline-flex items-center gap-1 text-amber-700 dark:text-amber-400">
            <Star size={10} className="fill-amber-500 text-amber-500" />
            관심
          </span>
        </p>
        <div className="flex flex-wrap gap-2">
          {stocksForPicker.map((s) => {
            const isWatch = watchlistSymbolSet.has(s.symbol);
            const isSelected = selectedSymbol === s.symbol;
            return (
              <button
                key={s.symbol}
                type="button"
                onClick={() => selectSymbol(s.symbol)}
                className={`inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                  isSelected
                    ? isWatch
                      ? "border-amber-600 bg-amber-600 text-white dark:border-amber-500 dark:bg-amber-500"
                      : "border-neutral-900 bg-neutral-900 text-white dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900"
                    : isWatch
                      ? "border-amber-300 bg-amber-50 text-amber-900 hover:border-amber-400 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200"
                      : "border-[var(--border-subtle)] text-neutral-600 hover:border-neutral-400 dark:text-neutral-400"
                }`}
              >
                {isWatch && (
                  <Star
                    size={12}
                    className={
                      isSelected
                        ? "fill-white text-white"
                        : "fill-amber-500 text-amber-500"
                    }
                  />
                )}
                <span className="font-medium">{s.name}</span>
                {s.qty > 0 ? (
                  <span
                    className={`text-xs ${
                      isSelected
                        ? "text-white/90"
                        : s.profit_rate >= 0
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-red-500 dark:text-red-400"
                    }`}
                  >
                    {s.profit_rate >= 0 ? "+" : ""}
                    {s.profit_rate.toFixed(1)}%
                  </span>
                ) : isWatch ? (
                  <span className={`text-xs ${isSelected ? "text-white/80" : "text-amber-700/80 dark:text-amber-300/80"}`}>
                    관심
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
