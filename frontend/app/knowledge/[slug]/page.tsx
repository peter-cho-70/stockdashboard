"use client";

/**
 * frontend/app/knowledge/[slug]/page.tsx
 * 분야 상세 페이지 — 뉴스 스트립 + 콘텐츠 피드
 */

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  knowledgeApi,
  type KnowledgeDomain,
  type KnowledgeContent,
  type KnowledgeNewsItem,
  type KnowledgeDigest,
  relativeTime,
  sentimentColor,
  sentimentEmoji,
  sourceTypeEmoji,
} from "@/lib/knowledgeApi";
import { streamAnalyze } from "@/lib/analyzeStream";

// ── 콘텐츠 카드 ──────────────────────────────────────────────────────────────

function ContentCard({
  content,
  onBookmark,
}: {
  content: KnowledgeContent;
  onBookmark: (id: number, v: boolean) => void;
}) {
  return (
    <article className={`rounded-xl border bg-white dark:bg-neutral-900 p-4 transition-all hover:shadow-sm ${
      content.is_read
        ? "border-neutral-200 dark:border-neutral-800 opacity-80"
        : "border-neutral-300 dark:border-neutral-700"
    }`}>
      {/* 헤더 */}
      <div className="flex items-start gap-2 mb-2">
        <span className="text-lg shrink-0">{sourceTypeEmoji(content.source_type)}</span>
        <div className="flex-1 min-w-0">
          <Link
            href={`/knowledge/content/${content.id}`}
            className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 hover:text-blue-600 dark:hover:text-blue-400 line-clamp-2"
          >
            {content.source_title || "(제목 없음)"}
          </Link>
          <div className="flex items-center gap-2 mt-0.5 text-xs text-neutral-400">
            {content.channel_name && <span>{content.channel_name}</span>}
            <span>{relativeTime(content.created_at)}</span>
            <span className={sentimentColor(content.sentiment)}>
              {sentimentEmoji(content.sentiment)}
            </span>
          </div>
        </div>
        {/* 북마크 버튼 */}
        <button
          onClick={() => onBookmark(content.id, !content.is_bookmarked)}
          className={`text-lg shrink-0 transition-transform active:scale-90 ${
            content.is_bookmarked ? "opacity-100" : "opacity-30 hover:opacity-60"
          }`}
        >
          🔖
        </button>
      </div>

      {/* 요약 */}
      {content.summary && (
        <p className="text-xs text-neutral-600 dark:text-neutral-400 line-clamp-2 mb-2">
          {content.summary}
        </p>
      )}

      {/* 키워드 */}
      {content.keywords.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {content.keywords.slice(0, 5).map((kw) => (
            <span
              key={kw}
              className="text-[10px] px-1.5 py-0.5 rounded-full bg-neutral-100 dark:bg-neutral-800 text-neutral-500"
            >
              #{kw}
            </span>
          ))}
        </div>
      )}

      {/* 원문 링크 */}
      {content.source_url && (
        <div className="mt-2 pt-2 border-t border-neutral-100 dark:border-neutral-800">
          <a
            href={content.source_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
          >
            원문 보기 →
          </a>
        </div>
      )}
    </article>
  );
}

function NewsStrip({
  domainId,
  onFetched,
}: {
  domainId: number;
  onFetched?: () => void;
}) {
  const [news, setNews] = useState<KnowledgeNewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetching, setFetching] = useState(false);

  useEffect(() => {
    knowledgeApi.getDomainNews(domainId, 8).then(setNews).finally(() => setLoading(false));
  }, [domainId]);

  async function handleFetch() {
    setFetching(true);
    try {
      await knowledgeApi.fetchNews(domainId);
      await new Promise((r) => setTimeout(r, 2000));
      const items = await knowledgeApi.getDomainNews(domainId, 8);
      setNews(items);
      onFetched?.();
    } catch (e) {
      alert(e instanceof Error ? e.message : "뉴스 수집 실패");
    } finally {
      setFetching(false);
    }
  }

  if (loading) {
    return <div className="text-xs text-neutral-400 py-2">뉴스 로딩...</div>;
  }

  return (
    <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface)] p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">📰 분야 뉴스</h2>
        <button
          type="button"
          onClick={handleFetch}
          disabled={fetching}
          className="text-xs rounded-md border border-[var(--border-subtle)] px-2 py-1 disabled:opacity-50"
        >
          {fetching ? "수집 중..." : "뉴스 수집"}
        </button>
      </div>
      {news.length === 0 ? (
        <p className="text-xs text-neutral-500">
          키워드 기반 뉴스가 없습니다. 분야 설정에 키워드를 추가한 뒤 「뉴스 수집」을 누르세요.
        </p>
      ) : (
        <ul className="space-y-2 max-h-48 overflow-y-auto">
          {news.map((item) => (
            <li key={item.id} className="text-xs border-b border-[var(--border-subtle)] pb-2 last:border-0">
              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-blue-600 dark:text-blue-400 hover:underline line-clamp-1"
              >
                {item.title}
              </a>
              {item.summary && (
                <p className="text-neutral-500 mt-0.5 line-clamp-2">{item.summary}</p>
              )}
              {item.source_name && (
                <span className="text-[10px] text-neutral-400">{item.source_name}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function WeeklyDigestPanel({ domainId }: { domainId: number }) {
  const [digest, setDigest] = useState<KnowledgeDigest | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    knowledgeApi
      .getLatestDigest(domainId)
      .then((r) => setDigest(r.digest))
      .finally(() => setLoading(false));
  }, [domainId]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleGenerate() {
    setGenerating(true);
    try {
      const r = await knowledgeApi.generateDigest(domainId, !!digest);
      setDigest(r.digest);
    } catch (e) {
      alert(e instanceof Error ? e.message : "다이제스트 생성 실패");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface)] p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">📋 주간 다이제스트</h2>
        <button
          type="button"
          onClick={handleGenerate}
          disabled={generating}
          className="text-xs rounded-md bg-violet-700 text-white px-2 py-1 disabled:opacity-50"
        >
          {generating ? "생성 중..." : digest ? "다시 생성" : "생성"}
        </button>
      </div>
      {loading ? (
        <p className="text-xs text-neutral-400">로딩...</p>
      ) : !digest ? (
        <p className="text-xs text-neutral-500">
          이번 주 학습·뉴스를 AI가 요약합니다. (일요일 20:00 자동 생성)
        </p>
      ) : (
        <div className="text-sm space-y-2">
          <p className="text-xs text-neutral-400">
            {digest.period_start} ~ {digest.period_end}
          </p>
          {digest.highlights.length > 0 && (
            <ul className="text-xs space-y-1">
              {digest.highlights.map((h, i) => (
                <li key={i}>• {h}</li>
              ))}
            </ul>
          )}
          {digest.body_markdown && (
            <div className="text-xs text-neutral-600 dark:text-neutral-400 whitespace-pre-wrap line-clamp-12">
              {digest.body_markdown}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

// ── 메인 페이지 ──────────────────────────────────────────────────────────────

export default function KnowledgeDomainPage() {
  const params  = useParams();
  const router  = useRouter();
  const slug    = typeof params.slug === "string" ? params.slug : "";

  const [domain, setDomain]       = useState<KnowledgeDomain | null>(null);
  const [contents, setContents]   = useState<KnowledgeContent[]>([]);
  const [cursor, setCursor]       = useState<number | null>(null);
  const [hasMore, setHasMore]     = useState(true);
  const [loading, setLoading]     = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [search, setSearch]       = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [analyzeUrl, setAnalyzeUrl]   = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 도메인 로드
  useEffect(() => {
    knowledgeApi.getDomains().then((domains) => {
      const found = domains.find((d) => d.slug === slug);
      if (!found) { router.replace("/knowledge"); return; }
      setDomain(found);
    });
  }, [slug, router]);

  // 피드 로드
  const loadFeed = useCallback(
    async (reset = false) => {
      if (!domain) return;
      if (reset) setLoading(true); else setLoadingMore(true);

      try {
        const res = await knowledgeApi.getFeed({
          domain_id:   domain.id,
          search:      search || undefined,
          source_type: sourceFilter || undefined,
          limit:       20,
          cursor:      reset ? undefined : cursor || undefined,
        });
        setContents((prev) => reset ? res.items : [...prev, ...res.items]);
        setCursor(res.next_cursor);
        setHasMore(res.next_cursor !== null);
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [domain, search, sourceFilter, cursor],
  );

  useEffect(() => {
    if (domain) loadFeed(true);
  }, [domain, search, sourceFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  // 검색 디바운스
  const handleSearch = (v: string) => {
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => setSearch(v), 400);
  };

  // 북마크 토글
  const handleBookmark = async (id: number, value: boolean) => {
    await knowledgeApi.toggleBookmark(id, value);
    setContents((prev) =>
      prev.map((c) => (c.id === id ? { ...c, is_bookmarked: value } : c))
    );
  };

  // URL 분석
  const handleAnalyze = async () => {
    if (!domain || !analyzeUrl.trim()) return;
    setAnalyzing(true);
    try {
      await streamAnalyze(
        "/intel/analyze/stream",
        {
          url: analyzeUrl.trim(),
          market_impact: false,
          domain_id: domain.id,
        },
        () => {},
      );
      setAnalyzeUrl("");
      await loadFeed(true);
    } catch (e) {
      alert(e instanceof Error ? e.message : "분석 실패");
    } finally {
      setAnalyzing(false);
    }
  };

  if (!domain) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-sm text-neutral-400">분야 로딩 중...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div>
        <Link href="/knowledge" className="text-sm text-neutral-400 hover:text-neutral-600">
          ← 지식 허브
        </Link>
        <div className="flex items-center gap-3 mt-2">
          <span className="text-3xl">{domain.emoji}</span>
          <div>
            <h1 className="text-xl font-bold text-neutral-900 dark:text-neutral-100">
              {domain.name}
            </h1>
            {domain.description && (
              <p className="text-sm text-neutral-500">{domain.description}</p>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <NewsStrip domainId={domain.id} onFetched={() => loadFeed(true)} />
        <WeeklyDigestPanel domainId={domain.id} />
      </div>

      {/* URL 분석 입력 */}
      <div className="flex gap-2">
        <input
          type="url"
          placeholder="YouTube URL 또는 뉴스 URL 붙여넣기..."
          value={analyzeUrl}
          onChange={(e) => setAnalyzeUrl(e.target.value)}
          className="flex-1 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
        />
        <button
          onClick={handleAnalyze}
          disabled={analyzing || !analyzeUrl.trim()}
          className="rounded-lg bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {analyzing ? "분석 중..." : "분석"}
        </button>
      </div>

      {/* 필터 */}
      <div className="flex gap-2 flex-wrap">
        <input
          type="text"
          placeholder="검색..."
          onChange={(e) => handleSearch(e.target.value)}
          className="rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
        />
        {["", "YOUTUBE", "NEWS", "TEXT"].map((type) => (
          <button
            key={type}
            onClick={() => setSourceFilter(type)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              sourceFilter === type
                ? "bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900"
                : "border border-neutral-300 dark:border-neutral-700 text-neutral-600 dark:text-neutral-400"
            }`}
          >
            {type === "" ? "전체" : type === "YOUTUBE" ? "🎬 유튜브" : type === "NEWS" ? "📰 뉴스" : "📝 텍스트"}
          </button>
        ))}
      </div>

      {/* 콘텐츠 피드 */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-36 animate-pulse rounded-xl bg-neutral-100 dark:bg-neutral-800" />
          ))}
        </div>
      ) : contents.length === 0 ? (
        <div className="py-16 text-center">
          <p className="text-3xl mb-3">📭</p>
          <p className="text-sm text-neutral-500">
            {search ? "검색 결과가 없습니다." : "이 분야에 콘텐츠가 없습니다."}
          </p>
          <p className="text-xs text-neutral-400 mt-1">
            위 URL 입력창에 YouTube 또는 뉴스 URL을 붙여넣어 분석해보세요.
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {contents.map((c) => (
              <ContentCard key={c.id} content={c} onBookmark={handleBookmark} />
            ))}
          </div>
          {hasMore && (
            <div className="text-center">
              <button
                onClick={() => loadFeed(false)}
                disabled={loadingMore}
                className="rounded-lg border border-neutral-300 dark:border-neutral-700 px-6 py-2 text-sm text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:opacity-50"
              >
                {loadingMore ? "로딩 중..." : "더 보기"}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
