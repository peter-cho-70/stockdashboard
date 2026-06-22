"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, ExternalLink, Loader2, Sparkles, Trash2 } from "lucide-react";
import { studyApi, type StudyCard, type StudyCategory } from "@/lib/studyApi";
import { MarkdownLite } from "@/components/markdown-lite";
import { useListenPanel } from "@/lib/useListenPanel";
import { ListenExperience } from "@/components/audio-listen/ListenExperience";
import { ListenPlayButton } from "@/components/audio-listen/ListenPlayButton";

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
  const [categories, setCategories] = useState<StudyCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const listenSource = useMemo(
    () => (card ? ({ kind: "study" as const, card }) : null),
    [card],
  );
  const listenPanel = useListenPanel(listenSource);

  useEffect(() => {
    if (!cardId || Number.isNaN(cardId)) return;
    let cancelled = false;
    Promise.all([studyApi.getCard(cardId), studyApi.listCategories()])
      .then(([c, cats]) => {
        if (!cancelled) {
          setCard(c);
          setCategories(cats.items);
        }
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
      window.location.href = "/learn/cards";
    } catch (e) {
      setError(e instanceof Error ? e.message : "삭제 실패");
      setDeleting(false);
    }
  };

  const handleAnalyze = async (force = false) => {
    if (!card) return;
    setAnalyzing(true);
    setError(null);
    try {
      const updated = await studyApi.analyzeCard(card.id, force);
      setCard(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : "간단 분석 실패");
    } finally {
      setAnalyzing(false);
    }
  };

  const handleCategoryChange = async (categoryId: number) => {
    if (!card) return;
    try {
      const updated = await studyApi.moveCard(card.id, categoryId);
      setCard(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : "카테고리 변경 실패");
    }
  };

  const simple = card?.simple_analysis;
  const displayKeyPoints =
    simple?.key_points?.length ? simple.key_points : card?.key_points ?? [];

  if (loading) {
    return <p className="text-sm text-neutral-500">학습 카드 불러오는 중…</p>;
  }

  if (error && !card) {
    return (
      <div className="space-y-3">
        <Link href="/learn/cards" className="inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-emerald-600">
          <ArrowLeft size={14} /> 내 학습 서재
        </Link>
        <p className="text-sm text-red-600">{error}</p>
      </div>
    );
  }

  if (!card) {
    return (
      <div className="space-y-3">
        <Link href="/learn/cards" className="inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-emerald-600">
          <ArrowLeft size={14} /> 내 학습 서재
        </Link>
        <p className="text-sm text-red-600">카드를 찾을 수 없습니다.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <Link href="/learn/cards" className="inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-emerald-600 mb-3">
          <ArrowLeft size={14} /> 내 학습 서재
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 flex-1 basis-full sm:basis-auto">
            <p className="text-[10px] text-violet-600 dark:text-violet-400 mb-1">
              {card.origin === "manual" ? "학습 링크" : "AI 학습 카드"}
            </p>
            <h1 className="text-xl font-bold">{card.title}</h1>
            {card.summary && !simple?.summary && (
              <p className="text-sm text-neutral-600 dark:text-neutral-400 mt-2">{card.summary}</p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={deleting}
            onClick={handleDelete}
            className="inline-flex min-h-[44px] items-center gap-1 rounded-md border border-red-200 px-3 py-2 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:hover:bg-red-900/20 sm:min-h-0 sm:px-2 sm:py-1"
          >
            <Trash2 size={12} />
            삭제
          </button>
          {!listenPanel.open && listenPanel.canListen && (
            <ListenPlayButton onPlay={listenPanel.start} size="md" />
          )}
          </div>
        </div>

        {categories.length > 0 && (
          <div className="mt-3">
            <label className="text-[11px] text-neutral-500 mr-2">카테고리</label>
            <select
              value={card.category_id ?? categories.find((c) => c.is_default)?.id ?? ""}
              onChange={(e) => handleCategoryChange(Number(e.target.value))}
              className="text-xs rounded border border-[var(--border-subtle)] bg-transparent px-2 py-1"
            >
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {(card.source_title || card.source_url) && (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            {card.thumbnail && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={card.thumbnail}
                alt=""
                className="h-16 w-28 rounded object-cover bg-neutral-100 dark:bg-neutral-900"
              />
            )}
            <div className="flex flex-wrap gap-2 text-xs">
              {card.content_id && (
                <Link href={`/knowledge/content/${card.content_id}`} className="text-emerald-600 hover:underline">
                  상세 분석 보기
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

      {listenPanel.open && listenPanel.script && card && (
        <ListenExperience
          title={card.title}
          script={listenPanel.script}
          listen={listenPanel.listen}
          onClose={listenPanel.close}
        />
      )}

      {card.source_url && (
        <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface)] p-5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold flex items-center gap-1.5">
              <Sparkles size={14} className="text-violet-500" />
              간단 분석
            </h2>
            <button
              type="button"
              onClick={() => handleAnalyze(card.analysis_status === "done")}
              disabled={analyzing}
              className="inline-flex items-center gap-1 rounded-md border border-violet-200 bg-violet-50 px-2.5 py-1 text-xs text-violet-800 hover:bg-violet-100 disabled:opacity-50 dark:border-violet-800 dark:bg-violet-900/20 dark:text-violet-300"
            >
              {analyzing ? (
                <>
                  <Loader2 size={12} className="animate-spin" /> 분석 중…
                </>
              ) : simple ? (
                "다시 분석"
              ) : (
                "간단 분석"
              )}
            </button>
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
          {simple ? (
            <div className="space-y-3">
              {simple.summary && <p className="text-sm text-neutral-700 dark:text-neutral-300">{simple.summary}</p>}
              {displayKeyPoints.length > 0 && (
                <ul className="space-y-1.5">
                  {displayKeyPoints.map((p, i) => (
                    <li key={i} className="text-sm flex gap-2">
                      <span className="text-emerald-500 shrink-0">•</span>
                      <span>{p}</span>
                    </li>
                  ))}
                </ul>
              )}
              {simple.analyzed_at && (
                <p className="text-[10px] text-neutral-400">
                  분석: {new Date(simple.analyzed_at).toLocaleString("ko-KR")}
                </p>
              )}
            </div>
          ) : (
            <p className="text-xs text-neutral-500">
              유튜브·웹페이지 내용을 학습용으로 짧게 요약합니다. GEMINI_API_KEY가 필요합니다.
            </p>
          )}
        </section>
      )}

      {card.user_note && (
        <section className="rounded-lg border border-amber-200 bg-amber-50/50 p-3 dark:border-amber-800 dark:bg-amber-900/15">
          <p className="text-[11px] text-amber-700 dark:text-amber-400 mb-1">메모</p>
          <p className="text-sm">{card.user_note}</p>
        </section>
      )}

      {!simple && card.key_points.length > 0 && (
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
