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
  relativeTime,
  sentimentColor,
  sentimentEmoji,
  sourceTypeEmoji,
} from "@/lib/knowledgeApi";

// ── 뉴스 스트립 ──────────────────────────────────────────────────────────────

function NewsStrip({
  domainId,
  onFetch,
}: {
  domainId: number;
  onFetch: () => void;
}) {
  const [news, setNews]       = useState<KnowledgeNewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetching, setFetching] = useState(false);

  useEffect(() => {
    knowledgeApi.getDomainNews(domainId, 8).then(setNews).finally(() => setLoading(false));
  }, [domainId]);

  const handleFetch = async () => {
    setFetching(true);
    await knowledgeApi.fetchNews(domainId).catch(() => null);
    await knowledgeApi.getDomainNews(domainId, 8).then(setNews).catch(() => null);
    setFetching(false);
    onFetch();
  };

  if (loading) return <div className="h-14 animate-pulse bg-neutral-100 dark:bg-neutral-800 rounded-xl" />;
  if (news.length === 0) {
    return (
      <div className="flex items-center justify-between rounded-xl border border-neutral-200 dark:border-neutral-800 px-4 py-3">
        <p className="text-sm text-neutral-400">뉴스가 없습니다.</p>
        <button
          onClick={handleFetch}
          disabled={fetching}
          className="text-xs text-blue-600 dark:text-blue-400 disabled:opacity-50"
        >
          {fetching ? "수집 중..." : "뉴스 수집"}
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-neutral-100 dark:border-neutral-800">
        <h3 className="text-xs font-semibold text-neutral-600 dark:text-neutral-400">
          📰 최신 뉴스
        </h3>
        <button
          onClick={handleFetch}
          disabled={fetching}
          className="text-xs text-blue-600 dark:text-blue-400 disabled:opacity-50"
        >
          {fetching ? "수집 중..." : "새로고침"}
        </button>
      </div>
      <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
        {news.map((item) => (
          <li key={item.id} className="px-4 py-2.5 flex items-start gap-3 group">
            <div className="flex-1 min-w-0">
              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-neutral-800 dark:text-neutral-200 hover:text-blue-600 dark:hover:text-blue-400 line-clamp-1 font-medium"
              >
                {item.title}
              </a>
              <div className="flex items-center gap-2 mt-0.5">
                {item.source_name && (
                  <span className="text-xs text-neutral-400">{item.source_name}</span>
                )}
                <span className="text-xs text-neutral-400">
                  {relativeTime(item.published_at || item.fetched_at)}
                </span>
              </div>
              {item.summary && (
                <p className="text-xs text-neutral-500 mt-0.5 line-clamp-1">{item.summary}</p>
              )}
            </div>
            <button
              onClick={() => knowledgeApi.saveNewsAsContent(item.id)}
              className="opacity-0 group-hover:opacity-100 text-xs text-neutral-400 hover:text-blue-600 transition-all shrink-0"
              title="지식으로 저장"
            >
              💾
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

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
      await knowledgeApi.analyze({ url: analyzeUrl.trim(), domain_id: domain.id });
      setAnalyzeUrl("");
      setTimeout(() => loadFeed(true), 3000);
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

      {/* 뉴스 스트립 */}
      <NewsStrip domainId={domain.id} onFetch={() => loadFeed(true)} />

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
