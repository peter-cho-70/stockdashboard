"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, ExternalLink, Trash2 } from "lucide-react";
import { studyApi, type StudyCard } from "@/lib/studyApi";
import { MarkdownLite } from "@/components/markdown-lite";

function QuizBlock({ quiz }: { quiz: StudyCard["quiz"] }) {
  const [open, setOpen] = useState<number | null>(null);
  if (!quiz.length) return null;

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold">퀴즈</h2>
      {quiz.map((q, i) => (
        <div key={i} className="rounded-lg border border-[var(--border-subtle)] p-3">
          <button
            type="button"
            onClick={() => setOpen(open === i ? null : i)}
            className="text-sm text-left w-full font-medium"
          >
            Q. {q.question}
          </button>
          {open === i && (
            <div className="mt-2 text-xs space-y-1">
              <p className="text-emerald-700 dark:text-emerald-400">A. {q.answer}</p>
              {q.explanation && <p className="text-neutral-500">{q.explanation}</p>}
            </div>
          )}
        </div>
      ))}
    </section>
  );
}

export default function StudyCardPage() {
  const params = useParams();
  const cardId = Number(params.id);

  const [card, setCard] = useState<StudyCard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!cardId || Number.isNaN(cardId)) return;
    let cancelled = false;
    studyApi
      .getCard(cardId)
      .then((c) => {
        if (!cancelled) setCard(c);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "불러오기 실패");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [cardId]);

  const handleDelete = async () => {
    if (!card || !confirm("이 학습 카드를 삭제할까요?")) return;
    setDeleting(true);
    try {
      await studyApi.deleteCard(card.id);
      window.location.href = "/learn";
    } catch (e) {
      setError(e instanceof Error ? e.message : "삭제 실패");
      setDeleting(false);
    }
  };

  if (loading) {
    return <p className="text-sm text-neutral-500">학습 카드 불러오는 중…</p>;
  }

  if (error || !card) {
    return (
      <div className="space-y-3">
        <Link href="/learn" className="inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-emerald-600">
          <ArrowLeft size={14} /> 주식공부하기
        </Link>
        <p className="text-sm text-red-600">{error ?? "카드를 찾을 수 없습니다."}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <Link href="/learn" className="inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-emerald-600 mb-3">
          <ArrowLeft size={14} /> 주식공부하기
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-[10px] text-violet-600 dark:text-violet-400 mb-1">학습 카드</p>
            <h1 className="text-xl font-bold">{card.title}</h1>
            {card.summary && <p className="text-sm text-neutral-600 dark:text-neutral-400 mt-2">{card.summary}</p>}
          </div>
          <button
            type="button"
            disabled={deleting}
            onClick={handleDelete}
            className="flex items-center gap-1 text-xs text-red-600 border border-red-200 rounded-md px-2 py-1 hover:bg-red-50 dark:border-red-900 dark:hover:bg-red-900/20 disabled:opacity-50"
          >
            <Trash2 size={12} />
            삭제
          </button>
        </div>
        {(card.source_title || card.source_url) && (
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            {card.content_id && (
              <Link
                href={`/knowledge/content/${card.content_id}`}
                className="text-emerald-600 hover:underline"
              >
                원본 분석 보기
              </Link>
            )}
            {card.source_url && (
              <a
                href={card.source_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-neutral-500 hover:text-neutral-700"
              >
                원본 링크 <ExternalLink size={11} />
              </a>
            )}
          </div>
        )}
        {card.study_topics.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-3">
            {card.study_topics.map((t) => (
              <Link
                key={t}
                href={`/learn/${t}`}
                className="text-[10px] rounded-full bg-emerald-50 text-emerald-800 px-2 py-0.5 dark:bg-emerald-900/30 dark:text-emerald-300"
              >
                {t}
              </Link>
            ))}
          </div>
        )}
      </div>

      {card.key_points.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold mb-2">핵심 포인트</h2>
          <ul className="space-y-1.5">
            {card.key_points.map((p, i) => (
              <li key={i} className="text-sm flex gap-2">
                <span className="text-emerald-500 shrink-0">•</span>
                <span>{p}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {card.body_markdown && (
        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface)] p-5">
          <MarkdownLite markdown={card.body_markdown} />
        </div>
      )}

      <QuizBlock quiz={card.quiz} />
    </div>
  );
}
