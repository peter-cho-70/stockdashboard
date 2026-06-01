"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  CalendarDays,
  Filter,
  FileText,
  Sparkles,
} from "lucide-react";
import {
  intelCalendarApi,
  monthGridCells,
  monthRange,
  padCalendarRange,
  weekDates,
  kpiRange,
  parseIsoDate,
  toIsoDate,
  KIND_ICONS,
  KIND_LABELS,
  type IntelCalendarDateMode,
  type IntelCalendarEvent,
  type IntelCalendarResponse,
  type IntelCalendarDayResponse,
} from "@/lib/intelCalendar";
import { api, type IntelContent } from "@/lib/api";
import { IntelDetailPanel } from "@/components/intel-detail-panel";

type ViewMode = "month" | "week" | "day";

function MarkdownBody({ md }: { md: string }) {
  const lines = md.split("\n");
  return (
    <div className="space-y-2 text-sm text-neutral-700 dark:text-neutral-300 leading-relaxed">
      {lines.map((line, i) => {
        const t = line.trimEnd();
        if (t.startsWith("## ")) {
          return (
            <h3 key={i} className="text-base font-semibold text-neutral-900 dark:text-neutral-100 mt-4 first:mt-0">
              {t.slice(3)}
            </h3>
          );
        }
        if (t.startsWith("### ")) {
          return (
            <h4 key={i} className="text-sm font-semibold text-neutral-800 dark:text-neutral-200 mt-2">
              {t.slice(4)}
            </h4>
          );
        }
        if (t.startsWith("- ")) {
          return (
            <li key={i} className="ml-4 list-disc text-neutral-600 dark:text-neutral-400">
              {t.slice(2)}
            </li>
          );
        }
        if (!t) return <div key={i} className="h-1" />;
        return <p key={i}>{t}</p>;
      })}
    </div>
  );
}

function SentDot({ s }: { s: string | null | undefined }) {
  const u = (s || "NEUTRAL").toUpperCase();
  if (u === "POSITIVE") return <span className="h-2 w-2 rounded-full bg-emerald-500" />;
  if (u === "NEGATIVE") return <span className="h-2 w-2 rounded-full bg-red-500" />;
  return <span className="h-2 w-2 rounded-full bg-neutral-400" />;
}

function sentimentBorderClass(sentiment: Record<string, number>, count: number): string {
  if (count === 0) return "border-[var(--border-subtle)]";
  const p = sentiment.POSITIVE || 0;
  const n = sentiment.NEGATIVE || 0;
  if (p > n) return "border-emerald-400/70 dark:border-emerald-600/60";
  if (n > p) return "border-red-400/70 dark:border-red-600/60";
  return "border-neutral-300 dark:border-neutral-600";
}

function KpiStrip({
  kpi,
  kpiDays,
  onKpiDays,
}: {
  kpi: IntelCalendarResponse["kpi"] | null;
  kpiDays: number;
  onKpiDays: (d: number) => void;
}) {
  const total = kpi?.total_events ?? 0;
  const sent = kpi?.sentiment ?? { POSITIVE: 0, NEUTRAL: 0, NEGATIVE: 0 };
  const sentTotal = sent.POSITIVE + sent.NEUTRAL + sent.NEGATIVE || 1;

  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">정량 요약</h3>
        <div className="flex gap-1">
          {[7, 30, 90].map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => onKpiDays(d)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                kpiDays === d
                  ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                  : "text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
              }`}
            >
              {d}일
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-center">
        <div className="rounded-md bg-[var(--surface-elevated)] p-2">
          <p className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">{total}</p>
          <p className="text-[10px] text-neutral-500">이벤트</p>
        </div>
        <div className="rounded-md bg-[var(--surface-elevated)] p-2">
          <p className="text-lg font-semibold">{kpi?.content_count ?? 0}</p>
          <p className="text-[10px] text-neutral-500">분석</p>
        </div>
        <div className="rounded-md bg-[var(--surface-elevated)] p-2">
          <p className="text-lg font-semibold">{kpi?.signal_count ?? 0}</p>
          <p className="text-[10px] text-neutral-500">Signal</p>
        </div>
        <div className="rounded-md bg-[var(--surface-elevated)] p-2">
          <p className="text-lg font-semibold text-emerald-600">
            {Math.round((sent.POSITIVE / sentTotal) * 100)}%
          </p>
          <p className="text-[10px] text-neutral-500">긍정</p>
        </div>
        <div className="rounded-md bg-[var(--surface-elevated)] p-2 col-span-2 sm:col-span-1">
          <p className="text-lg font-semibold">{kpi?.portfolio_related_count ?? 0}</p>
          <p className="text-[10px] text-neutral-500">보유·관심</p>
        </div>
        <div className="rounded-md bg-[var(--surface-elevated)] p-2 col-span-2 lg:col-span-1 text-left">
          <p className="text-[10px] text-neutral-500 mb-1">활성 섹터</p>
          <p className="text-xs text-neutral-700 dark:text-neutral-300 truncate">
            {(kpi?.top_sectors ?? [])
              .map((s) => `${s.sector}(${s.count})`)
              .join(" · ") || "—"}
          </p>
        </div>
      </div>
    </div>
  );
}

function EventChip({
  ev,
  onClick,
}: {
  ev: IntelCalendarEvent;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left rounded-md border border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-2 py-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
    >
      <div className="flex items-center gap-1.5">
        <span className="text-xs">{KIND_ICONS[ev.kind]}</span>
        <SentDot s={ev.sentiment} />
        <span className="text-xs font-medium text-neutral-800 dark:text-neutral-200 truncate flex-1">
          {ev.title}
        </span>
        {(ev.is_portfolio || ev.is_watchlist) && (
          <span className="text-[9px] text-amber-600">★</span>
        )}
      </div>
      {ev.kind === "economic" && ev.sector && (
        <p className="text-[10px] text-neutral-400 mt-0.5">{ev.sector}</p>
      )}
      {ev.summary && (
        <p className="text-[10px] text-neutral-500 line-clamp-1 mt-0.5">{ev.summary}</p>
      )}
    </button>
  );
}

export function IntelCalendarHub() {
  const router = useRouter();
  const [viewMode, setViewMode] = useState<ViewMode>("month");
  const [focusDate, setFocusDate] = useState(() => toIsoDate(new Date()));
  const [dateMode, setDateMode] = useState<IntelCalendarDateMode>("event");
  const [kpiDays, setKpiDays] = useState(30);
  const [portfolioOnly, setPortfolioOnly] = useState(false);
  const [watchlistOnly, setWatchlistOnly] = useState(false);

  const [calendar, setCalendar] = useState<IntelCalendarResponse | null>(null);
  const [kpiCalendar, setKpiCalendar] = useState<IntelCalendarResponse | null>(null);
  const [dayDetail, setDayDetail] = useState<IntelCalendarDayResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [dayLoading, setDayLoading] = useState(false);
  const [digestGenerating, setDigestGenerating] = useState(false);
  const [digestError, setDigestError] = useState<string | null>(null);
  const [economicSyncing, setEconomicSyncing] = useState(false);

  const [detailContent, setDetailContent] = useState<IntelContent | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const focus = useMemo(() => parseIsoDate(focusDate), [focusDate]);

  const queryOpts = useMemo(
    () => ({
      date_mode: dateMode,
      portfolio_only: portfolioOnly,
      watchlist_only: watchlistOnly,
    }),
    [dateMode, portfolioOnly, watchlistOnly],
  );

  const fetchCalendarData = useCallback(
    async (range: { from: string; to: string }) => {
      const [cal, kpiCal] = await Promise.all([
        intelCalendarApi.getCalendar({
          ...range,
          ...queryOpts,
          include_events: viewMode !== "month",
        }),
        intelCalendarApi.getCalendar({ ...kpiRange(kpiDays), ...queryOpts }),
      ]);
      setCalendar(cal);
      setKpiCalendar(kpiCal);
    },
    [viewMode, queryOpts, kpiDays],
  );

  const loadCalendar = useCallback(async () => {
    setLoading(true);
    try {
      const range =
        viewMode === "month"
          ? monthRange(focus)
          : viewMode === "week"
            ? { from: weekDates(focus)[0], to: weekDates(focus)[6] }
            : { from: focusDate, to: focusDate };

      await fetchCalendarData(range);

      if (dateMode === "event") {
        const padded = padCalendarRange(range.from, range.to);
        setEconomicSyncing(true);
        intelCalendarApi
          .syncEconomicCalendar(padded.from, padded.to)
          .then(async (res) => {
            if (res.synced) await fetchCalendarData(range);
          })
          .catch(() => {})
          .finally(() => setEconomicSyncing(false));
      }
    } catch {
      setCalendar(null);
      setKpiCalendar(null);
    } finally {
      setLoading(false);
    }
  }, [focus, focusDate, viewMode, dateMode, fetchCalendarData]);

  async function refreshEconomicCalendar(force = true) {
    const range =
      viewMode === "month"
        ? monthRange(focus)
        : viewMode === "week"
          ? { from: weekDates(focus)[0], to: weekDates(focus)[6] }
          : { from: focusDate, to: focusDate };
    const padded = padCalendarRange(range.from, range.to);
    setEconomicSyncing(true);
    try {
      await intelCalendarApi.syncEconomicCalendar(padded.from, padded.to, force);
      await fetchCalendarData(range);
      if (viewMode === "day") await loadDay();
    } catch {
      /* ignore */
    } finally {
      setEconomicSyncing(false);
    }
  }

  const loadDay = useCallback(async () => {
    if (viewMode !== "day") return;
    setDayLoading(true);
    try {
      const d = await intelCalendarApi.getDay(focusDate, queryOpts);
      setDayDetail(d);
    } catch {
      setDayDetail(null);
    } finally {
      setDayLoading(false);
    }
  }, [focusDate, viewMode, queryOpts]);

  useEffect(() => {
    loadCalendar();
  }, [loadCalendar]);

  useEffect(() => {
    loadDay();
  }, [loadDay]);

  function shiftMonth(delta: number) {
    const d = parseIsoDate(focusDate);
    d.setMonth(d.getMonth() + delta);
    setFocusDate(toIsoDate(d));
  }

  function shiftWeek(delta: number) {
    const d = parseIsoDate(focusDate);
    d.setDate(d.getDate() + delta * 7);
    setFocusDate(toIsoDate(d));
  }

  function selectDay(iso: string) {
    setFocusDate(iso);
    setViewMode("day");
  }

  async function generateDigest(force = false) {
    setDigestGenerating(true);
    setDigestError(null);
    try {
      await intelCalendarApi.generateDigest(focusDate, force);
      await loadDay();
      await loadCalendar();
    } catch (e) {
      setDigestError(e instanceof Error ? e.message : "digest 생성 실패");
    } finally {
      setDigestGenerating(false);
    }
  }

  async function openEvent(ev: IntelCalendarEvent) {
    if (ev.kind === "economic" && ev.source_url) {
      window.open(ev.source_url, "_blank");
      return;
    }
    if (ev.symbol) {
      router.push(`/chart?symbol=${encodeURIComponent(ev.symbol)}`);
      return;
    }
    if (ev.content_id) {
      try {
        const c = await api.getIntelContent(ev.content_id);
        setDetailContent(c);
        setDetailOpen(true);
      } catch {
        /* ignore */
      }
    } else if (ev.source_url) {
      window.open(ev.source_url, "_blank");
    }
  }

  const monthLabel = `${focus.getFullYear()}년 ${focus.getMonth() + 1}월`;
  const weekLabel = weekDates(focus);
  const cells = monthGridCells(focus);

  return (
    <div className="space-y-4">
      <KpiStrip kpi={kpiCalendar?.kpi ?? null} kpiDays={kpiDays} onKpiDays={setKpiDays} />

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] p-1">
          {(["month", "week", "day"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setViewMode(v)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                viewMode === v
                  ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                  : "text-neutral-500"
              }`}
            >
              {v === "month" ? "월" : v === "week" ? "주" : "일"}
            </button>
          ))}
        </div>

        <div className="flex gap-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] p-1">
          <button
            type="button"
            onClick={() => setDateMode("event")}
            className={`rounded-md px-2.5 py-1.5 text-xs font-medium ${
              dateMode === "event"
                ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                : "text-neutral-500"
            }`}
          >
            사건일
          </button>
          <button
            type="button"
            onClick={() => setDateMode("analyzed")}
            className={`rounded-md px-2.5 py-1.5 text-xs font-medium ${
              dateMode === "analyzed"
                ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                : "text-neutral-500"
            }`}
          >
            분석일
          </button>
        </div>

        <label className="flex items-center gap-1.5 text-xs text-neutral-600 dark:text-neutral-400 cursor-pointer">
          <input
            type="checkbox"
            checked={portfolioOnly}
            onChange={(e) => setPortfolioOnly(e.target.checked)}
            className="rounded"
          />
          보유만
        </label>
        <label className="flex items-center gap-1.5 text-xs text-neutral-600 dark:text-neutral-400 cursor-pointer">
          <input
            type="checkbox"
            checked={watchlistOnly}
            onChange={(e) => setWatchlistOnly(e.target.checked)}
            className="rounded"
          />
          관심만
        </label>

        {dateMode === "event" && (
          <button
            type="button"
            onClick={() => refreshEconomicCalendar(true)}
            disabled={economicSyncing}
            className="flex items-center gap-1 rounded-md border border-[var(--border-subtle)] px-2.5 py-1.5 text-xs font-medium text-neutral-600 dark:text-neutral-400 hover:bg-[var(--surface-elevated)] disabled:opacity-50"
          >
            {economicSyncing ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <CalendarDays size={12} />
            )}
            경제 일정
          </button>
        )}

        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() => (viewMode === "month" ? shiftMonth(-1) : shiftWeek(-1))}
            className="rounded-md border border-[var(--border-subtle)] p-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            <ChevronLeft size={16} />
          </button>
          <span className="text-sm font-medium text-neutral-800 dark:text-neutral-200 min-w-[120px] text-center">
            {viewMode === "day" ? focusDate : monthLabel}
          </span>
          <button
            type="button"
            onClick={() => (viewMode === "month" ? shiftMonth(1) : shiftWeek(1))}
            className="rounded-md border border-[var(--border-subtle)] p-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            <ChevronRight size={16} />
          </button>
          <button
            type="button"
            onClick={() => setFocusDate(toIsoDate(new Date()))}
            className="rounded-md border border-[var(--border-subtle)] px-2 py-1.5 text-xs text-neutral-600 dark:text-neutral-400"
          >
            오늘
          </button>
        </div>
      </div>

      {economicSyncing && dateMode === "event" && (
        <p className="text-[11px] text-neutral-500 flex items-center gap-1.5">
          <Loader2 size={12} className="animate-spin" />
          주요 경제 일정을 검색·반영 중입니다…
        </p>
      )}

      {loading ? (
        <div className="flex justify-center py-16 text-neutral-400">
          <Loader2 className="animate-spin" size={24} />
        </div>
      ) : viewMode === "month" ? (
        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] overflow-hidden">
          <div className="grid grid-cols-7 border-b border-[var(--border-subtle)] bg-[var(--surface-elevated)]">
            {["일", "월", "화", "수", "목", "금", "토"].map((w) => (
              <div key={w} className="py-2 text-center text-xs font-medium text-neutral-500">
                {w}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {cells.map((iso, i) => {
              if (!iso) {
                return <div key={`empty-${i}`} className="min-h-[72px] border-b border-r border-[var(--border-subtle)]/50 bg-neutral-50/50 dark:bg-neutral-900/20" />;
              }
              const meta = calendar?.days[iso];
              const cnt = meta?.event_count ?? 0;
              const isToday = iso === toIsoDate(new Date());
              const isFocus = iso === focusDate;
              return (
                <button
                  key={iso}
                  type="button"
                  onClick={() => selectDay(iso)}
                  className={`min-h-[72px] border-b border-r border-[var(--border-subtle)] p-1.5 text-left hover:bg-[var(--surface-elevated)] transition-colors ${
                    isFocus ? "ring-2 ring-inset ring-blue-400" : ""
                  } ${sentimentBorderClass(meta?.sentiment ?? {}, cnt)}`}
                >
                  <div className="flex items-center justify-between gap-0.5">
                    <span
                      className={`text-xs font-medium ${isToday ? "text-blue-600 dark:text-blue-400" : "text-neutral-700 dark:text-neutral-300"}`}
                    >
                      {parseIsoDate(iso).getDate()}
                    </span>
                    {meta?.has_digest && (
                      <span className="text-[10px]" title="일일 정리 문서">
                        📄
                      </span>
                    )}
                  </div>
                  {cnt > 0 && (
                    <div className="mt-1 space-y-0.5">
                      <div className="flex gap-0.5 justify-center">
                        {Array.from({ length: Math.min(cnt, 5) }).map((_, j) => (
                          <span
                            key={j}
                            className="h-1 w-1 rounded-full bg-neutral-400 dark:bg-neutral-500"
                          />
                        ))}
                      </div>
                      <p className="text-[9px] text-center text-neutral-500">{cnt}건</p>
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ) : viewMode === "week" ? (
        <div className="grid grid-cols-7 gap-2">
          {weekLabel.map((iso) => {
            const meta = calendar?.days[iso];
            const events = meta?.events ?? [];
            return (
              <div
                key={iso}
                className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] min-h-[200px] flex flex-col"
              >
                <button
                  type="button"
                  onClick={() => selectDay(iso)}
                  className="border-b border-[var(--border-subtle)] px-2 py-2 text-left hover:bg-[var(--surface-elevated)]"
                >
                  <p className="text-xs font-semibold text-neutral-800 dark:text-neutral-200">
                    {parseIsoDate(iso).toLocaleDateString("ko-KR", {
                      month: "numeric",
                      day: "numeric",
                      weekday: "short",
                    })}
                  </p>
                  <p className="text-[10px] text-neutral-500">
                    {meta?.event_count ?? 0}건
                    {meta?.has_digest ? " · 📄" : ""}
                  </p>
                </button>
                <div className="flex-1 p-1.5 space-y-1 overflow-y-auto max-h-[280px]">
                  {events.slice(0, 8).map((ev) => (
                    <EventChip key={ev.id} ev={ev} onClick={() => openEvent(ev)} />
                  ))}
                  {(meta?.event_count ?? 0) > 8 && (
                    <button
                      type="button"
                      onClick={() => selectDay(iso)}
                      className="text-[10px] text-blue-600 w-full text-center py-1"
                    >
                      +{(meta?.event_count ?? 0) - 8} 더보기
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="space-y-4">
          {dayLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="animate-spin text-neutral-400" size={22} />
            </div>
          ) : (
            <>
              <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold flex items-center gap-2 text-neutral-800 dark:text-neutral-200">
                    <FileText size={16} className="text-neutral-400" />
                    일일 정리 문서
                  </h3>
                  <button
                    type="button"
                    onClick={() => generateDigest(dayDetail?.digest?.status === "ready")}
                    disabled={digestGenerating}
                    className="flex items-center gap-1.5 rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white dark:bg-neutral-100 dark:text-neutral-900 disabled:opacity-50"
                  >
                    {digestGenerating ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : (
                      <Sparkles size={12} />
                    )}
                    {dayDetail?.digest?.status === "ready" ? "재생성" : "AI 요약 생성"}
                  </button>
                </div>
                {digestError && (
                  <p className="text-xs text-red-600 dark:text-red-400">{digestError}</p>
                )}
                {dayDetail?.digest?.status === "ready" && dayDetail.digest.body_markdown ? (
                  <div>
                    <p className="text-base font-semibold text-neutral-900 dark:text-neutral-100 mb-3">
                      {dayDetail.digest.title}
                    </p>
                    <MarkdownBody md={dayDetail.digest.body_markdown} />
                    {dayDetail.digest.generated_at && (
                      <p className="text-[10px] text-neutral-400 mt-4">
                        생성: {dayDetail.digest.generated_at}
                        {dayDetail.digest.model ? ` · ${dayDetail.digest.model}` : ""}
                      </p>
                    )}
                  </div>
                ) : dayDetail?.digest?.status === "failed" ? (
                  <p className="text-sm text-amber-700 dark:text-amber-400">
                    {dayDetail.digest.error_message || "생성에 실패했습니다. 이벤트가 없거나 AI 오류일 수 있습니다."}
                  </p>
                ) : (
                  <p className="text-sm text-neutral-500">
                    이 날짜의 Signal·분석을 모아 AI 브리핑을 생성합니다. (Gemini API 필요)
                  </p>
                )}
              </div>

              <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] p-4">
                <h3 className="text-sm font-semibold flex items-center gap-2 mb-3">
                  <CalendarDays size={16} className="text-neutral-400" />
                  {focusDate} 요약
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
                  {[
                    ["분석", dayDetail?.briefing.content_count],
                    ["경제일정", dayDetail?.briefing.economic_count],
                    ["매크로", dayDetail?.briefing.macro_count],
                    ["섹터", dayDetail?.briefing.sector_count],
                    ["종목", dayDetail?.briefing.stock_count],
                  ].map(([label, n]) => (
                    <div key={String(label)} className="rounded-md bg-[var(--surface-elevated)] px-3 py-2">
                      <span className="text-neutral-500 text-xs">{label}</span>
                      <p className="font-semibold text-neutral-900 dark:text-neutral-100">{n ?? 0}</p>
                    </div>
                  ))}
                </div>
                <p className="text-[10px] text-neutral-400 mt-3">{dayDetail?.disclaimer}</p>
              </div>

              <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] divide-y divide-[var(--border-subtle)]">
                <div className="px-4 py-3 flex items-center gap-2 text-sm font-semibold text-neutral-700 dark:text-neutral-300">
                  <Filter size={14} />
                  이슈 타임라인 ({dayDetail?.day.events.length ?? 0})
                </div>
                {(dayDetail?.day.events.length ?? 0) === 0 ? (
                  <p className="px-4 py-8 text-center text-sm text-neutral-400">이날 기록된 이벤트가 없습니다.</p>
                ) : (
                  dayDetail?.day.events.map((ev) => (
                    <div key={ev.id} className="px-4 py-3">
                      <EventChip ev={ev} onClick={() => openEvent(ev)} />
                      <div className="mt-1 flex flex-wrap gap-2 text-[10px] text-neutral-500">
                        <span>{KIND_LABELS[ev.kind]}</span>
                        {ev.sector && <span>· {ev.sector}</span>}
                        {ev.symbol && (
                          <Link
                            href={`/chart?symbol=${ev.symbol}`}
                            className="text-blue-600 hover:underline"
                            onClick={(e) => e.stopPropagation()}
                          >
                            차트 →
                          </Link>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </div>
      )}

      <p className="text-[10px] text-neutral-400 text-center">
        참고용 정보이며 투자 권유가 아닙니다. digest는 DB에 기록된 Signal·분석만 근거로 합니다.
      </p>

      {detailOpen && detailContent && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-xl bg-[var(--surface)] border border-[var(--border-subtle)] shadow-xl p-4">
            <div className="flex justify-end mb-2">
              <button
                type="button"
                onClick={() => setDetailOpen(false)}
                className="text-sm text-neutral-500 hover:text-neutral-800"
              >
                닫기
              </button>
            </div>
            <IntelDetailPanel data={detailContent} />
          </div>
        </div>
      )}
    </div>
  );
}
