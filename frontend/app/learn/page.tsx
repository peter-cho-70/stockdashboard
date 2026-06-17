"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BookOpen, ChevronRight, GraduationCap, Sparkles } from "lucide-react";
import { studyApi, type StudyCard, type StudyCurriculum } from "@/lib/studyApi";
import { MarkdownLite } from "@/components/markdown-lite";

function LessonCard({ lesson }: { lesson: StudyCurriculum["lessons"][0] }) {
  return (
    <Link
      href={`/learn/${lesson.id}`}
      className="group block rounded-xl border border-[var(--border-subtle)] bg-[var(--surface)] p-4 hover:border-emerald-300 dark:hover:border-emerald-700 transition-colors"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400 mb-1">
            레슨 {lesson.order + 1}
          </p>
          <p className="font-semibold text-sm group-hover:text-emerald-700 dark:group-hover:text-emerald-300">
            {lesson.title}
          </p>
          <p className="text-xs text-neutral-500 mt-1">{lesson.subtitle}</p>
        </div>
        <ChevronRight size={16} className="shrink-0 text-neutral-300 group-hover:text-emerald-500 mt-1" />
      </div>
    </Link>
  );
}

function StudyCardPreview({ card }: { card: StudyCard }) {
  return (
    <Link
      href={`/learn/card/${card.id}`}
      className="block rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-elevated)] p-3 hover:border-violet-300 dark:hover:border-violet-700 transition-colors"
    >
      <div className="flex items-center gap-1.5 text-[10px] text-violet-600 dark:text-violet-400 mb-1">
        <Sparkles size={11} />
        {card.source_type === "YOUTUBE" ? "유튜브에서 생성" : "분석에서 생성"}
      </div>
      <p className="text-sm font-medium line-clamp-2">{card.title}</p>
      {card.summary && (
        <p className="text-xs text-neutral-500 mt-1 line-clamp-2">{card.summary}</p>
      )}
    </Link>
  );
}

export default function LearnPage() {
  const [curriculum, setCurriculum] = useState<StudyCurriculum | null>(null);
  const [cards, setCards] = useState<StudyCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [c, cardRes] = await Promise.all([
          studyApi.getCurriculum(),
          studyApi.listCards(),
        ]);
        if (!cancelled) {
          setCurriculum(c);
          setCards(cardRes.items.slice(0, 6));
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "불러오기 실패");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return <p className="text-sm text-neutral-500">커리큘럼 불러오는 중…</p>;
  }

  if (error || !curriculum) {
    return (
      <p className="text-sm text-red-600 bg-red-50 dark:bg-red-900/20 rounded-lg p-4">
        {error ?? "커리큘럼을 불러올 수 없습니다."}
      </p>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <div className="flex items-center gap-2 mb-2">
          <GraduationCap size={22} className="text-emerald-500" />
          <h1 className="text-xl font-bold">{curriculum.title}</h1>
        </div>
        <p className="text-sm text-neutral-500 mb-4">
          chart.md 기반 차트·밸류 학습 코너 · AI 분석·유튜브에서 학습 카드도 만들 수 있습니다.
        </p>
        {curriculum.intro_markdown && (
          <div className="rounded-xl border border-amber-200 bg-amber-50/60 dark:border-amber-800 dark:bg-amber-900/15 p-4 mb-4">
            <MarkdownLite markdown={curriculum.intro_markdown.split("\n## ")[0]} />
          </div>
        )}
        <p className="text-xs text-neutral-400 rounded-lg border border-[var(--border-subtle)] px-3 py-2">
          {curriculum.disclaimer}
        </p>
      </div>

      {cards.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold flex items-center gap-1.5">
              <Sparkles size={15} className="text-violet-500" />
              내가 만든 학습 카드
            </h2>
            <Link href="/learn/cards" className="text-xs text-neutral-500 hover:text-emerald-600">
              전체 보기
            </Link>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {cards.map((c) => (
              <StudyCardPreview key={c.id} card={c} />
            ))}
          </div>
        </section>
      )}

      <section>
        <div className="flex items-center gap-1.5 mb-3">
          <BookOpen size={15} className="text-emerald-500" />
          <h2 className="text-sm font-semibold">커리큘럼</h2>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {curriculum.lessons.map((lesson) => (
            <LessonCard key={lesson.id} lesson={lesson} />
          ))}
        </div>
      </section>

      <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface)] p-4 text-xs text-neutral-500">
        <p className="font-medium text-neutral-700 dark:text-neutral-300 mb-1">유튜브 → 학습 카드 만들기</p>
        <p>
          AI 분석 또는 지식 허브에서 콘텐츠를 열고 「학습용으로 만들기」를 누르면 핵심 개념만 정리된 학습 카드가
          생성됩니다.
        </p>
        <Link href="/intelligence" className="inline-block mt-2 text-emerald-600 hover:underline">
          AI 분석으로 이동 →
        </Link>
      </div>
    </div>
  );
}
