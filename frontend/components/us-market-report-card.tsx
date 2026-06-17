"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ExternalLink, HelpCircle, Loader2, RefreshCw, Globe } from "lucide-react";
import {
  marketApi,
  normalizeUsSnapshot,
  type UsMarketArticle,
  type UsMarketInterpretation,
  type UsMarketInterpretationTopic,
  type UsMarketQuote,
  type UsMarketReport,
  type UsMarketSnapshot,
} from "@/lib/api";
import { getUsMarketQuoteTooltip } from "@/lib/usMarketTooltips";
import { loadUsReportCache, saveUsReportCache } from "@/lib/marketCache";
import { todayKst } from "@/lib/marketDisplay";
import { krChangeClass } from "@/lib/krMarketColors";

/** KST 08:30~22:59 — 미국 선물 표시 구간 */
function isUsDaytimeKst(now = new Date()): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  const totalMinutes = hour * 60 + minute;
  return totalMinutes >= 8 * 60 + 30 && totalMinutes < 23 * 60;
}

function formatArticleDate(article: UsMarketArticle): string | null {
  if (article.published_at) {
    try {
      return new Date(article.published_at).toLocaleString("ko-KR", {
        timeZone: "Asia/Seoul",
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      /* fall through */
    }
  }
  if (article.published) {
    try {
      return new Date(article.published).toLocaleString("ko-KR", {
        timeZone: "Asia/Seoul",
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return article.published.slice(0, 16);
    }
  }
  return null;
}

function formatQuoteAsOf(item: UsMarketQuote): string | null {
  if (item.as_of_label) return item.as_of_label;
  if (item.date) return item.date;
  return null;
}

function formatClose(item: UsMarketQuote): string {
  if (item.error || item.close == null) return "—";
  const v = item.close;
  if (item.unit === "yield") return `${v.toFixed(2)}%`;
  if (item.unit === "fx") {
    if (item.name.includes("원")) return `${v.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}원`;
    if (item.name.includes("엔")) return `¥${v.toFixed(2)}`;
    if (item.name.includes("위안")) return `¥${v.toFixed(4)}`;
    return v.toFixed(2);
  }
  if (item.unit === "price" || item.unit === "stock" || item.unit === "futures") {
    return `$${v.toFixed(2)}`;
  }
  return v.toLocaleString("en-US", { maximumFractionDigits: 2 });
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

function QuoteCard({ item }: { item: UsMarketQuote }) {
  const tooltip = getUsMarketQuoteTooltip(item.name, item.ticker);
  const asOf = formatQuoteAsOf(item);

  return (
    <div
      className={`relative rounded-md border border-[var(--border-subtle)] px-3 py-2 ${
        tooltip ? "group cursor-help" : ""
      }`}
      title={tooltip ?? undefined}
    >
      <p className="text-[10px] text-neutral-400 leading-tight flex items-start gap-0.5">
        <span className={tooltip ? "border-b border-dotted border-neutral-400/60" : ""}>
          {item.name}
        </span>
        {tooltip && (
          <HelpCircle
            size={10}
            className="shrink-0 mt-px text-neutral-400 opacity-70 group-hover:text-blue-500"
            aria-hidden
          />
        )}
      </p>
      {item.error ? (
        <p className="text-xs text-neutral-500">—</p>
      ) : (
        <>
          <p className="text-sm font-semibold tabular-nums">{formatClose(item)}</p>
          <ChangePct value={item.change_pct} />
          {asOf && (
            <p className="text-[9px] text-neutral-400 mt-0.5 tabular-nums leading-tight">
              {asOf}
            </p>
          )}
        </>
      )}
      {tooltip && (
        <div
          role="tooltip"
          className="pointer-events-none absolute left-0 right-0 bottom-full z-30 mb-1 hidden group-hover:block group-focus-within:block"
        >
          <div className="rounded-md border border-neutral-700/80 bg-neutral-900 px-2.5 py-2 text-[11px] leading-snug text-neutral-100 shadow-lg dark:bg-neutral-800">
            {tooltip}
          </div>
        </div>
      )}
    </div>
  );
}

function QuoteGrid({ items }: { items: UsMarketQuote[] }) {
  if (items.length === 0) return null;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
      {items.map((idx) => (
        <QuoteCard key={`${idx.ticker ?? idx.name}`} item={idx} />
      ))}
    </div>
  );
}

function InterpretationBlock({
  topic,
  interpretation,
  articles,
}: {
  topic: UsMarketInterpretationTopic;
  interpretation?: UsMarketInterpretation;
  articles: UsMarketArticle[];
}) {
  if (!interpretation?.summary && !(interpretation?.bullets?.length)) return null;

  const indexes = interpretation.source_indexes ?? [];
  const cited = indexes
    .map((i) => articles.find((a) => a.index === i))
    .filter((a): a is UsMarketArticle => !!a && !!a.url);
  const topicArticles = articles.filter((a) => a.topic === topic && a.url);
  const sources =
    cited.length > 0
      ? cited
      : topicArticles.slice(0, 3);

  return (
    <div className="mt-3 rounded-md bg-[var(--surface-elevated)]/60 border border-[var(--border-subtle)] px-3 py-2.5 space-y-2">
      <p className="text-xs leading-relaxed text-neutral-700 dark:text-neutral-300">
        {interpretation.summary}
      </p>
      {interpretation.bullets && interpretation.bullets.length > 0 && (
        <ul className="space-y-0.5 text-xs text-neutral-600 dark:text-neutral-400">
          {interpretation.bullets.map((b, i) => (
            <li key={i} className="flex gap-1.5">
              <span className="text-neutral-400 shrink-0">·</span>
              <span>{b}</span>
            </li>
          ))}
        </ul>
      )}
      {sources.length > 0 && (
        <div className="pt-1 border-t border-[var(--border-subtle)]">
          <p className="text-[10px] font-medium text-neutral-400 mb-1">참고 기사</p>
          <ul className="space-y-1">
            {sources.map((a) => {
              const pubLabel = formatArticleDate(a);
              return (
                <li key={`${a.index}-${a.url}`}>
                  <a
                    href={a.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-start gap-1 text-[11px] text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    <ExternalLink size={10} className="shrink-0 mt-0.5" />
                    <span className="line-clamp-2">
                      {pubLabel && (
                        <span className="text-neutral-400 font-normal mr-1">[{pubLabel}]</span>
                      )}
                      {a.title}
                    </span>
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

function SnapshotSections({
  snapshot,
  liveLabel,
}: {
  snapshot: UsMarketSnapshot;
  liveLabel?: string | null;
}) {
  const { interpretations, articles } = snapshot;
  const futures = snapshot.us_futures ?? [];

  return (
    <div className="space-y-4">
      {liveLabel && (
        <p className="text-[10px] text-neutral-400">시세 기준: {liveLabel}</p>
      )}
      {snapshot.us_indices.length > 0 && (
        <section>
          <h3 className="text-[11px] font-semibold text-neutral-500 mb-2">
            미국 주요 지수
            <span className="font-normal text-neutral-400 ml-1">(전일 마감)</span>
          </h3>
          <QuoteGrid items={snapshot.us_indices} />
          <InterpretationBlock
            topic="us_indices"
            interpretation={interpretations.us_indices}
            articles={articles}
          />
        </section>
      )}
      {futures.length > 0 && (
        <section>
          <h3 className="text-[11px] font-semibold text-neutral-500 mb-2">
            미국 지수 선물
            <span className="font-normal text-neutral-400 ml-1">(실시간)</span>
          </h3>
          <QuoteGrid items={futures} />
        </section>
      )}
      {(snapshot.commodity.length > 0 || snapshot.fx.length > 0) && (
        <section>
          <h3 className="text-[11px] font-semibold text-neutral-500 mb-2">유가 · 환율</h3>
          <QuoteGrid items={[...snapshot.commodity, ...snapshot.fx]} />
          {snapshot.commodity.length > 0 && (
            <InterpretationBlock
              topic="commodity"
              interpretation={interpretations.commodity}
              articles={articles}
            />
          )}
          {snapshot.fx.length > 0 && (
            <InterpretationBlock
              topic="fx"
              interpretation={interpretations.fx}
              articles={articles}
            />
          )}
        </section>
      )}
      {snapshot.treasury.length > 0 && (
        <section>
          <h3 className="text-[11px] font-semibold text-neutral-500 mb-2">미국 국채 수익률</h3>
          <QuoteGrid items={snapshot.treasury} />
          <InterpretationBlock
            topic="treasury"
            interpretation={interpretations.treasury}
            articles={articles}
          />
        </section>
      )}
      {snapshot.us_stocks.length > 0 && (
        <section>
          <h3 className="text-[11px] font-semibold text-neutral-500 mb-2">주요 미국 주식</h3>
          <QuoteGrid items={snapshot.us_stocks} />
          <InterpretationBlock
            topic="us_stocks"
            interpretation={interpretations.us_stocks}
            articles={articles}
          />
        </section>
      )}
    </div>
  );
}

export function UsMarketReportCard({
  cacheOnly = false,
  marketToggle,
}: {
  cacheOnly?: boolean;
  marketToggle?: ReactNode;
}) {
  const initialCached = cacheOnly ? loadUsReportCache() : null;
  const [report, setReport] = useState<UsMarketReport | null>(initialCached);
  const [liveLabel, setLiveLabel] = useState<string | null>(
    initialCached?.generated_at ? `저장 리포트 · ${initialCached.report_date}` : null,
  );
  const [displaySnapshot, setDisplaySnapshot] = useState<UsMarketSnapshot | null>(
    initialCached ? normalizeUsSnapshot(initialCached) : null,
  );
  const [loading, setLoading] = useState(cacheOnly ? false : !initialCached);
  const [generating, setGenerating] = useState(false);
  const [refreshingNews, setRefreshingNews] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mergeLiveIntoSnapshot = useCallback(
    (base: UsMarketSnapshot, live: Awaited<ReturnType<typeof marketApi.getUsLiveSnapshot>>["snapshot"]) => {
      const merged: UsMarketSnapshot = {
        ...base,
        us_indices: live.us_indices.length > 0 ? live.us_indices : base.us_indices,
        us_futures: live.us_futures ?? [],
        commodity: live.commodity.length > 0 ? live.commodity : base.commodity,
        fx: live.fx.length > 0 ? live.fx : base.fx,
        treasury: live.treasury.length > 0 ? live.treasury : base.treasury,
        us_stocks: live.us_stocks.length > 0 ? live.us_stocks : base.us_stocks,
        articles: live.articles.length > 0 ? live.articles : base.articles,
      };
      return merged;
    },
    [],
  );

  const applyCachedReport = useCallback((r: UsMarketReport | null) => {
    if (!r || r.status !== "ready") {
      setReport(r);
      setDisplaySnapshot(null);
      setLiveLabel(null);
      return;
    }
    setReport(r);
    setDisplaySnapshot(normalizeUsSnapshot(r));
    setLiveLabel(r.generated_at ? `저장 리포트 · ${r.report_date}` : null);
    saveUsReportCache(r);
  }, []);

  const applyReport = useCallback(
    async (r: UsMarketReport | null, opts?: { refreshNews?: boolean }) => {
      if (!r || r.status !== "ready") {
        setReport(r);
        setDisplaySnapshot(null);
        setLiveLabel(null);
        return;
      }
      setReport(r);
      const base = normalizeUsSnapshot(r);
      try {
        const { snapshot: live } = await marketApi.getUsLiveSnapshot("auto");
        setDisplaySnapshot(mergeLiveIntoSnapshot(base, live));
        setLiveLabel(live.fetched_at_label);
      } catch {
        setDisplaySnapshot(base);
        setLiveLabel(null);
      }

      const isToday = r.report_date === todayKst();
      const generatedAt = r.generated_at ? new Date(r.generated_at).getTime() : 0;
      const stale = !generatedAt || Date.now() - generatedAt > 60 * 60 * 1000;
      if (isToday && stale && opts?.refreshNews !== false) {
        setRefreshingNews(true);
        try {
          const { report: refreshed } = await marketApi.refreshUsReportNews({
            date: r.report_date,
            refreshQuotes: isUsDaytimeKst(),
          });
          setReport(refreshed);
          const refreshedBase = normalizeUsSnapshot(refreshed);
          try {
            const { snapshot: live } = await marketApi.getUsLiveSnapshot("auto");
            const merged = mergeLiveIntoSnapshot(refreshedBase, live);
            merged.articles = refreshedBase.articles;
            merged.interpretations = refreshedBase.interpretations;
            setDisplaySnapshot(merged);
            setLiveLabel(live.fetched_at_label);
          } catch {
            setDisplaySnapshot(refreshedBase);
          }
        } catch {
          /* 기사 갱신 실패 시 기존 리포트 유지 */
        } finally {
          setRefreshingNews(false);
        }
      }
    },
    [mergeLiveIntoSnapshot],
  );

  const load = useCallback(async () => {
    if (!cacheOnly) setLoading(true);
    setError(null);
    try {
      const today = todayKst();
      const res = await marketApi.getUsReport(today);
      if (res.report?.status === "ready") {
        if (cacheOnly) {
          applyCachedReport(res.report);
        } else {
          await applyReport(res.report);
        }
        return;
      }
      const list = await marketApi.listUsReports(3);
      const latest = list.reports.find((r) => r.status === "ready");
      const picked = latest ?? res.report ?? null;
      if (cacheOnly) {
        applyCachedReport(picked);
      } else {
        await applyReport(picked, { refreshNews: false });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "리포트 로드 실패");
      if (!cacheOnly && !initialCached) {
        setReport(null);
        setDisplaySnapshot(null);
      }
    } finally {
      if (!cacheOnly) setLoading(false);
    }
  }, [applyReport, applyCachedReport, cacheOnly, initialCached]);

  useEffect(() => {
    if (cacheOnly) return;
    load();
  }, [cacheOnly, load]);

  async function handleGenerate(force = false) {
    setGenerating(true);
    setError(null);
    try {
      const res = await marketApi.generateUsReport({ force });
      if (cacheOnly) {
        applyCachedReport(res.report);
      } else {
        await applyReport(res.report, { refreshNews: false });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "생성 실패");
    } finally {
      setGenerating(false);
    }
  }

  const snapshot = displaySnapshot ?? (report ? normalizeUsSnapshot(report) : null);

  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-subtle)] px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          {marketToggle}
          <Globe size={16} className="text-blue-500" />
          <h2 className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">
            오늘의 미국 증시
          </h2>
          {report?.report_date && (
            <span className="text-xs text-neutral-400">{report.report_date}</span>
          )}
          {liveLabel && cacheOnly && (
            <span className="text-[10px] text-neutral-400">저장본</span>
          )}
          {!cacheOnly && refreshingNews && (
            <span className="text-[10px] text-neutral-400 flex items-center gap-1">
              <Loader2 size={10} className="animate-spin" />
              기사 갱신 중
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => handleGenerate(!!report)}
          disabled={generating}
          className="flex items-center gap-1.5 rounded-md border border-[var(--border-subtle)] px-2.5 py-1 text-xs font-medium hover:bg-[var(--surface-elevated)] disabled:opacity-50"
        >
          <RefreshCw size={12} className={generating ? "animate-spin" : ""} />
          {generating ? "생성 중..." : report ? "다시 생성" : "리포트 생성"}
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-neutral-400">
          <Loader2 size={16} className="animate-spin" />
          로딩 중...
        </div>
      ) : error ? (
        <div className="px-4 py-6 text-sm text-red-500">{error}</div>
      ) : !report || report.status !== "ready" ? (
        <div className="px-4 py-8 text-center text-sm text-neutral-500">
          <p className="mb-3">아직 오늘 리포트가 없습니다.</p>
          <p className="text-xs text-neutral-400">
            평일 08:05에 자동 생성되며, 버튼으로 지금 생성할 수 있습니다.
          </p>
        </div>
      ) : (
        <div className="p-4 space-y-4 overflow-visible">
          {snapshot && <SnapshotSections snapshot={snapshot} liveLabel={liveLabel} />}

          {report.highlights.length > 0 && (
            <ul className="space-y-1 text-sm text-neutral-700 dark:text-neutral-300 border-t border-[var(--border-subtle)] pt-4">
              {report.highlights.map((h, i) => (
                <li key={i} className="flex gap-2">
                  <span className="text-neutral-400">•</span>
                  <span>{h}</span>
                </li>
              ))}
            </ul>
          )}

          {report.body_markdown && (
            <div className="prose prose-sm dark:prose-invert max-w-none text-neutral-700 dark:text-neutral-300 whitespace-pre-wrap text-sm leading-relaxed border-t border-[var(--border-subtle)] pt-4">
              {report.body_markdown.replace(/^# .+\n\n?/m, "").slice(0, 4000)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
