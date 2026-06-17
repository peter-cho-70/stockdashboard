"use client";

import Link from "next/link";
import type { StudyTermEntry } from "@/lib/studyTermGlossary";
import { studyLessonHref } from "@/lib/studyTermGlossary";

export function StudyTermLink({
  entry,
  matchedText,
  className = "",
}: {
  entry: StudyTermEntry;
  matchedText: string;
  className?: string;
}) {
  const href = studyLessonHref(entry.lessonId);
  const tooltip = `${entry.fullName}\n${entry.definition}${entry.lessonId ? "\n\n클릭 → 주식공부하기" : ""}`;

  const inner = (
    <span
      className={`border-b border-dotted border-blue-400/60 text-blue-700 dark:text-blue-300 ${href ? "cursor-pointer hover:border-blue-500 hover:bg-blue-50/80 dark:hover:bg-blue-950/30" : "cursor-help"} ${className}`}
      title={tooltip}
    >
      {matchedText}
    </span>
  );

  if (href) {
    return (
      <Link
        href={href}
        className="inline no-underline"
        onClick={(e) => e.stopPropagation()}
      >
        {inner}
      </Link>
    );
  }

  return inner;
}

export function StudyLessonChip({
  lessonId,
  label = "공부하기",
}: {
  lessonId: string;
  label?: string;
}) {
  const href = studyLessonHref(lessonId);
  if (!href) return null;

  return (
    <Link
      href={href}
      className="inline-flex items-center gap-0.5 rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-800 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200 dark:hover:bg-emerald-900/50"
      onClick={(e) => e.stopPropagation()}
    >
      {label}
    </Link>
  );
}
