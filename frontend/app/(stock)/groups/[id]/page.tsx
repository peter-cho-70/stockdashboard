"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Loader2, Layers, ExternalLink, Newspaper, Video, FileText } from "lucide-react";
import {
  groupsApi,
  type StockGroup,
  type GroupContentItem,
  type GroupLiveNewsItem,
} from "@/lib/api";
import { krChangeClass } from "@/lib/krMarketColors";

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

  useEffect(() => {
    load();
    loadContent();
  }, [load, loadContent]);

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
