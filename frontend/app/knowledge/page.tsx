"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  knowledgeApi,
  type KnowledgeDomain,
  type KnowledgeDomainStats,
  type RemindCard,
} from "@/lib/knowledgeApi";

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
      className="block rounded-xl border border-[var(--border-subtle)] bg-[var(--surface)] p-4 hover:border-violet-300 dark:hover:border-violet-700 transition-colors"
    >
      <div className="flex items-center gap-2 mb-3">
        <span className="text-2xl">{domain.emoji}</span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-sm truncate">{domain.name}</p>
          {domain.description && (
            <p className="text-xs text-neutral-400 truncate">{domain.description}</p>
          )}
        </div>
      </div>
      {stats && (
        <div className="flex gap-3 text-xs text-neutral-500 mb-2">
          <span>
            이번 주 <strong className="text-neutral-700 dark:text-neutral-300">{stats.week_count}</strong>
          </span>
          <span>
            전체 <strong className="text-neutral-700 dark:text-neutral-300">{stats.total_count}</strong>
          </span>
          {stats.channel_count > 0 && <span>채널 {stats.channel_count}</span>}
        </div>
      )}
      {stats?.latest_title && (
        <p className="text-xs text-neutral-500 line-clamp-2 border-t border-[var(--border-subtle)] pt-2">
          {stats.latest_title}
        </p>
      )}
    </Link>
  );
}

function RemindCardItem({
  card,
  onAction,
}: {
  card: RemindCard;
  onAction: (id: number, action: "remembered" | "needs_review") => void;
}) {
  return (
    <div className="rounded-lg border border-violet-200 dark:border-violet-900 bg-violet-50/50 dark:bg-violet-950/20 p-3">
      <p className="text-[10px] text-violet-600 dark:text-violet-400 mb-1">🔄 {card.remind_reason}</p>
      <Link
        href={`/knowledge/content/${card.id}`}
        className="text-sm font-medium line-clamp-2 hover:text-violet-700 dark:hover:text-violet-300"
      >
        {card.source_title || "(제목 없음)"}
      </Link>
      <div className="flex gap-2 mt-2">
        <button
          type="button"
          onClick={() => onAction(card.id, "remembered")}
          className="text-xs rounded-md bg-emerald-600 text-white px-2 py-1"
        >
          기억함
        </button>
        <button
          type="button"
          onClick={() => onAction(card.id, "needs_review")}
          className="text-xs rounded-md border border-[var(--border-subtle)] px-2 py-1"
        >
          다시 볼게요
        </button>
      </div>
    </div>
  );
}

export default function KnowledgeHubPage() {
  const [domains, setDomains] = useState<KnowledgeDomain[]>([]);
  const [statsMap, setStatsMap] = useState<Record<number, KnowledgeDomainStats>>({});
  const [remindCards, setRemindCards] = useState<RemindCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [seeding, setSeeding] = useState(false);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [listRes, remindRes] = await Promise.all([
        knowledgeApi.getDomains(),
        knowledgeApi.getRemindCards(3).catch(() => ({ cards: [], count: 0 })),
      ]);
      let list = listRes;
      if (list.filter((d) => d.slug !== "uncategorized").length === 0) {
        await knowledgeApi.seedTemplates();
        list = await knowledgeApi.getDomains();
      }
      const visible = list.filter((d) => d.slug !== "uncategorized");
      setDomains(visible);
      setRemindCards(remindRes.cards);
      const results = await Promise.allSettled(
        visible.map((d) => knowledgeApi.getDomainStats(d.id)),
      );
      const map: Record<number, KnowledgeDomainStats> = {};
      results.forEach((r, i) => {
        if (r.status === "fulfilled") map[visible[i].id] = r.value;
      });
      setStatsMap(map);
    } catch (e) {
      setError(e instanceof Error ? e.message : "로드 실패");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  async function handleSeed() {
    setSeeding(true);
    try {
      await knowledgeApi.seedTemplates();
      await loadData();
    } catch (e) {
      alert(e instanceof Error ? e.message : "템플릿 추가 실패");
    } finally {
      setSeeding(false);
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-20 text-sm text-neutral-400">지식 허브 로딩 중...</div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 py-2">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">📚 지식 허브</h1>
          <p className="text-sm text-neutral-500 mt-1">
            관심 분야별로 모은 학습·정보 (시장 Signal·캘린더와 분리)
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/knowledge/settings/domains"
            className="rounded-lg border border-[var(--border-subtle)] px-3 py-1.5 text-sm hover:bg-[var(--surface-elevated)]"
          >
            분야 관리
          </Link>
          <Link
            href="/intelligence"
            className="rounded-lg border border-[var(--border-subtle)] px-3 py-1.5 text-sm text-neutral-500 hover:bg-[var(--surface-elevated)]"
          >
            AI 분석 →
          </Link>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-400">
          {error}
        </div>
      )}

      {remindCards.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">
            📚 오늘의 리마인드
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {remindCards.map((card) => (
              <RemindCardItem
                key={card.id}
                card={card}
                onAction={async (id, action) => {
                  await knowledgeApi.recordRemindAction(id, action);
                  setRemindCards((prev) => prev.filter((c) => c.id !== id));
                }}
              />
            ))}
          </div>
        </section>
      )}

      {domains.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--border-subtle)] py-16 text-center">
          <p className="text-sm text-neutral-500 mb-4">등록된 관심 분야가 없습니다.</p>
          <div className="flex justify-center gap-2">
            <button
              type="button"
              onClick={handleSeed}
              disabled={seeding}
              className="rounded-lg bg-violet-700 text-white px-4 py-2 text-sm font-medium disabled:opacity-50"
            >
              {seeding ? "추가 중..." : "기본 분야 5개 추가"}
            </button>
            <Link
              href="/knowledge/settings/domains"
              className="rounded-lg border border-[var(--border-subtle)] px-4 py-2 text-sm"
            >
              직접 추가
            </Link>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {domains.map((d) => (
            <DomainCard key={d.id} domain={d} stats={statsMap[d.id]} />
          ))}
          <Link
            href="/knowledge/settings/domains"
            className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[var(--border-subtle)] p-8 text-neutral-400 hover:text-neutral-600"
          >
            <span className="text-2xl mb-1">+</span>
            <span className="text-sm">분야 추가</span>
          </Link>
        </div>
      )}
    </div>
  );
}
