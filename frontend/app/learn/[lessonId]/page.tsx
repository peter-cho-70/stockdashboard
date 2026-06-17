"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, BarChart3, ExternalLink, Sparkles } from "lucide-react";
import { studyApi, type RelatedContentItem, type StudyCard, type StudyLessonDetail } from "@/lib/studyApi";
import { MarkdownLite } from "@/components/markdown-lite";
import { LessonImagePastePanel } from "@/components/lesson-image-paste-panel";
import { LessonYoutubeLinksPanel } from "@/components/lesson-youtube-links-panel";
import { useListenPanel } from "@/lib/useListenPanel";
import { ListenExperience } from "@/components/audio-listen/ListenExperience";
import { ListenPlayButton } from "@/components/audio-listen/ListenPlayButton";

export default function LearnLessonPage() {
  const params = useParams();
  const lessonId = params.lessonId as string;

  const [lesson, setLesson] = useState<StudyLessonDetail | null>(null);
  const [cards, setCards] = useState<StudyCard[]>([]);
  const [related, setRelated] = useState<RelatedContentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const listenSource = useMemo(
    () => (lesson ? ({ kind: "lesson" as const, lesson }) : null),
    [lesson],
  );
  const listenPanel = useListenPanel(listenSource);

  useEffect(() => {
    if (!lessonId) return;
    let cancelled = false;
    (async () => {
      try {
        const [l, cardRes, rel] = await Promise.all([
          studyApi.getLesson(lessonId),
          studyApi.listCards({ lessonId }),
          studyApi.getRelatedContent(lessonId),
        ]);
        if (!cancelled) {
          setLesson(l);
          setCards(cardRes.items);
          setRelated(rel.items);
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
  }, [lessonId]);

  if (loading) {
    return <p className="text-sm text-neutral-500">레슨 불러오는 중…</p>;
  }

  if (error || !lesson) {
    return (
      <div className="space-y-3">
        <Link href="/learn" className="inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-emerald-600">
          <ArrowLeft size={14} /> 주식공부하기
        </Link>
        <p className="text-sm text-red-600">{error ?? "레슨을 찾을 수 없습니다."}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <Link href="/learn" className="inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-emerald-600 mb-3">
          <ArrowLeft size={14} /> 주식공부하기
        </Link>
        <p className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400 mb-1">
          레슨 {lesson.order + 1}
        </p>
        <h1 className="text-xl font-bold">{lesson.title}</h1>
        <p className="text-sm text-neutral-500 mt-1">{lesson.subtitle}</p>
        <div className="flex flex-wrap items-center gap-2 mt-3">
          {!listenPanel.open && listenPanel.canListen && (
            <ListenPlayButton onPlay={listenPanel.start} size="md" />
          )}
          {lesson.chart_link && (
            <Link
              href={lesson.chart_link}
              className="inline-flex items-center gap-1 text-xs rounded-md border border-emerald-200 bg-emerald-50 text-emerald-800 px-2.5 py-1.5 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300"
            >
              <BarChart3 size={12} />
              차트에서 연습하기
            </Link>
          )}
        </div>
      </div>

      {listenPanel.open && listenPanel.script && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-4 dark:border-emerald-800 dark:bg-emerald-950/20">
          <ListenExperience
            title={lesson.title}
            script={listenPanel.script}
            listen={listenPanel.listen}
            onClose={listenPanel.close}
          />
        </div>
      )}

      <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface)] p-5">
        <MarkdownLite markdown={lesson.body_markdown} />
      </div>

      <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface)] p-5">
        <LessonYoutubeLinksPanel lessonId={lesson.id} />
      </div>

      <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface)] p-5">
        <LessonImagePastePanel lessonId={lesson.id} />
      </div>

      {cards.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold flex items-center gap-1.5 mb-3">
            <Sparkles size={14} className="text-violet-500" />
            관련 학습 카드
          </h2>
          <div className="space-y-2">
            {cards.map((c) => (
              <Link
                key={c.id}
                href={`/learn/card/${c.id}`}
                className="block rounded-lg border border-[var(--border-subtle)] p-3 hover:border-violet-300 dark:hover:border-violet-700"
              >
                <p className="text-sm font-medium">{c.title}</p>
                {c.summary && <p className="text-xs text-neutral-500 mt-1 line-clamp-2">{c.summary}</p>}
              </Link>
            ))}
          </div>
        </section>
      )}

      {related.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold mb-3">관련 AI 분석 · 유튜브</h2>
          <div className="space-y-2">
            {related.map((item) => (
              <Link
                key={item.id}
                href={`/knowledge/content/${item.id}`}
                className="block rounded-lg border border-[var(--border-subtle)] p-3 hover:border-neutral-300 dark:hover:border-neutral-600"
              >
                <p className="text-[10px] text-neutral-400 mb-0.5">
                  {item.source_type}
                  {item.channel_name ? ` · ${item.channel_name}` : ""}
                </p>
                <p className="text-sm font-medium line-clamp-2">{item.source_title || "(제목 없음)"}</p>
                {item.summary && <p className="text-xs text-neutral-500 mt-1 line-clamp-2">{item.summary}</p>}
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
