"use client";

/**
 * frontend/app/knowledge/page.tsx
 * 지식 허브 메인 — 분야 보드 + 오늘의 리마인드 카드
 */

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  knowledgeApi,
  type KnowledgeDomain,
  type KnowledgeDomainStats,
  type RemindCard,
  relativeTime,
  sentimentEmoji,
  sourceTypeEmoji,
} from "@/lib/knowledgeApi";

// ── 리마인드 카드 컴포넌트 ──────────────────────────────────────────────────

function RemindCardItem({
  card,
  onAction,
}: {
  card: RemindCard;
  onAction: (id: number, action: "remembered" | "needs_review") => void;
}) {
  const [loading, setLoading] = useState(false);

  const handleAction = async (action: "remembered" | "needs_review") => {
    setLoading(true);
    onAction(card.id, action);
  };

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30 p-4 flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-amber-700 dark:text-amber-400 mb-1">
            🔄 {card.remind_reason}
          </p>
          <p className="text-sm font-semibold line-clamp-2 text-neutral-900 dark:text-neutral-100">
            {sourceTypeEmoji(card.source_type)} {card.source_title || "(제목 없음)"}
          </p>
          <p className="mt-1 text-xs text-neutral-500 line-clamp-2">
            {card.summary}
          </p>
        </div>
      </div>
      <div className="flex gap-2 mt-1">
        <button
          disabled={loading}
          onClick={() => handleAction("remembered")}
          className="flex-1 rounded-lg bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 text-xs font-medium py-1.5 hover:bg-emerald-200 dark:hover:bg-emerald-900/60 transition-colors disabled:opacity-50"
        >
          ✓ 기억함
        </button>
        <button
          disabled={loading}
          onClick={() => handleAction("needs_review")}
          className="flex-1 rounded-lg bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400 text-xs font-medium py-1.5 hover:bg-neutral-200 dark:hover:bg-neutral-700 transition-colors disabled:opacity-50"
        >
          📖 다시 읽기
        </button>
        {card.source_url && (
          <a
            href={card.source_url}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg bg-neutral-100 dark:bg-neutral-800 text-neutral-500 text-xs px-2.5 py-1.5 hover:bg-neutral-200 dark:hover:bg-neutral-700 transition-colors"
          >
            →
          </a>
        )}
      </div>
    </div>
  );
}

// ── 분야 카드 컴포넌트 ───────────────────────────────────────────────────────

function DomainCard({
  domain,
  stats,
}: {
  domain: KnowledgeDomain;
  stats?: KnowledgeDomainStats;
}) {
  return (
    <Link
      href={`/knowledge/${domain.slug}`}
      className="block rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4 hover:border-neutral-300 dark:hover:border-neutral-700 hover:shadow-sm transition-all active:scale-[0.98]"
    >
      {/* 분야 헤더 */}
      <div className="flex items-center gap-2 mb-3">
        <span className="text-2xl">{domain.emoji}</span>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm text-neutral-900 dark:text-neutral-100 truncate">
            {domain.name}
          </p>
          {domain.description && (
            <p className="text-xs text-neutral-400 truncate">{domain.description}</p>
          )}
        </div>
      </div>

      {/* 통계 */}
      {stats && (
        <div className="flex gap-3 text-xs text-neutral-500 mb-3">
          <span>
            <span className="font-semibold text-neutral-700 dark:text-neutral-300">
              {stats.week_count}
            </span>{" "}
            이번주
          </span>
          <span>
            <span className="font-semibold text-neutral-700 dark:text-neutral-300">
              {stats.total_count}
            </span>{" "}
            전체
          </span>
          {stats.news_count > 0 && (
            <span>
              <span className="font-semibold text-blue-600 dark:text-blue-400">
                {stats.news_count}
              </span>{" "}
              뉴스
            </span>
          )}
        </div>
      )}

      {/* 최신 콘텐츠 */}
      {stats?.latest_title && (
        <p className="text-xs text-neutral-600 dark:text-neutral-400 line-clamp-2 border-t border-neutral-100 dark:border-neutral-800 pt-2">
          {stats.latest_title}
        </p>
      )}

      {/* 키워드 태그 */}
      {domain.keywords.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {domain.keywords.slice(0, 4).map((kw) => (
            <span
              key={kw}
              className="text-[10px] px-1.5 py-0.5 rounded-full bg-neutral-100 dark:bg-neutral-800 text-neutral-500"
            >
              {kw}
            </span>
          ))}
        </div>
      )}
    </Link>
  );
}

// ── 메인 페이지 ──────────────────────────────────────────────────────────────

export default function KnowledgeHubPage() {
  const [domains, setDomains]         = useState<KnowledgeDomain[]>([]);
  const [statsMap, setStatsMap]       = useState<Record<number, KnowledgeDomainStats>>({});
  const [remindCards, setRemindCards] = useState<RemindCard[]>([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState<string | null>(null);

  // 데이터 로드
  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [domainsData, remindData] = await Promise.all([
        knowledgeApi.getDomains(),
        knowledgeApi.getRemindCards(3),
      ]);
      setDomains(domainsData.filter((d) => d.slug !== "uncategorized"));
      setRemindCards(remindData.cards);

      // 분야별 통계 병렬 로드
      const statsResults = await Promise.allSettled(
        domainsData.map((d) => knowledgeApi.getDomainStats(d.id))
      );
      const map: Record<number, KnowledgeDomainStats> = {};
      statsResults.forEach((r, i) => {
        if (r.status === "fulfilled") map[domainsData[i].id] = r.value;
      });
      setStatsMap(map);
    } catch (e) {
      setError(e instanceof Error ? e.message : "데이터 로드 실패");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // 리마인드 액션 처리
  const handleRemindAction = async (
    id: number,
    action: "remembered" | "needs_review",
  ) => {
    await knowledgeApi.recordRemindAction(id, action);
    setRemindCards((prev) => prev.filter((c) => c.id !== id));

    // "다시 읽기" 선택 시 해당 콘텐츠 페이지로 이동
    if (action === "needs_review") {
      window.open(`/knowledge/content/${id}`, "_blank");
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-sm text-neutral-400">지식 허브 로딩 중...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/30 p-6 text-center">
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        <button
          onClick={loadData}
          className="mt-3 text-sm text-red-700 dark:text-red-300 underline"
        >
          다시 시도
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* 페이지 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-neutral-900 dark:text-neutral-100">
            📚 지식 허브
          </h1>
          <p className="text-sm text-neutral-500 mt-0.5">
            내 관심 분야의 최신 동향과 학습 콘텐츠
          </p>
        </div>
        <Link
          href="/knowledge/settings/domains"
          className="rounded-lg border border-neutral-300 dark:border-neutral-700 px-3 py-1.5 text-sm text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
        >
          + 분야 추가
        </Link>
      </div>

      {/* 오늘의 리마인드 카드 */}
      {remindCards.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300 mb-3">
            🔄 오늘의 리마인드
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {remindCards.map((card) => (
              <RemindCardItem
                key={card.id}
                card={card}
                onAction={handleRemindAction}
              />
            ))}
          </div>
        </section>
      )}

      {/* 분야 보드 */}
      <section>
        <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300 mb-3">
          내 관심 분야
        </h2>

        {domains.length === 0 ? (
          <div className="rounded-xl border border-dashed border-neutral-300 dark:border-neutral-700 p-10 text-center">
            <p className="text-3xl mb-3">📁</p>
            <p className="text-sm text-neutral-500">
              아직 등록된 분야가 없습니다.
            </p>
            <Link
              href="/knowledge/settings/domains"
              className="mt-3 inline-block rounded-lg bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 px-4 py-2 text-sm font-medium"
            >
              분야 추가하기
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {domains.map((domain) => (
              <DomainCard
                key={domain.id}
                domain={domain}
                stats={statsMap[domain.id]}
              />
            ))}

            {/* 분야 추가 카드 */}
            <Link
              href="/knowledge/settings/domains"
              className="flex flex-col items-center justify-center rounded-xl border border-dashed border-neutral-300 dark:border-neutral-700 p-8 text-neutral-400 hover:border-neutral-400 dark:hover:border-neutral-600 hover:text-neutral-500 transition-colors"
            >
              <span className="text-2xl mb-1">+</span>
              <span className="text-sm">분야 추가</span>
            </Link>
          </div>
        )}
      </section>
    </div>
  );
}
