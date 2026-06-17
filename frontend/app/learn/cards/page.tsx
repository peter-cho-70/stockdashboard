"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { studyApi, type StudyCard } from "@/lib/studyApi";

export default function LearnCardsPage() {
  const [cards, setCards] = useState<StudyCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    studyApi
      .listCards()
      .then((r) => setCards(r.items))
      .catch((e) => setError(e instanceof Error ? e.message : "불러오기 실패"))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-4 max-w-3xl">
      <Link href="/learn" className="inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-emerald-600">
        <ArrowLeft size={14} /> 주식공부하기
      </Link>
      <h1 className="text-xl font-bold">내 학습 카드</h1>
      {loading && <p className="text-sm text-neutral-500">불러오는 중…</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
      {!loading && cards.length === 0 && (
        <p className="text-sm text-neutral-500">아직 만든 학습 카드가 없습니다. AI 분석에서 「학습용으로 만들기」를 사용해 보세요.</p>
      )}
      <div className="space-y-2">
        {cards.map((c) => (
          <Link
            key={c.id}
            href={`/learn/card/${c.id}`}
            className="block rounded-lg border border-[var(--border-subtle)] p-3 hover:border-violet-300 dark:hover:border-violet-700"
          >
            <p className="text-sm font-medium">{c.title}</p>
            {c.summary && <p className="text-xs text-neutral-500 mt-1 line-clamp-2">{c.summary}</p>}
            {c.created_at && (
              <p className="text-[10px] text-neutral-400 mt-1">{new Date(c.created_at).toLocaleString("ko-KR")}</p>
            )}
          </Link>
        ))}
      </div>
    </div>
  );
}
