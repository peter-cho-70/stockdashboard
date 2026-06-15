"use client";

import { Fragment, type ReactNode } from "react";
import { HIGHLIGHT_MARK_CLASS, normalizeHighlightColor, type HighlightColor } from "@/lib/highlightColors";

export interface SnippetMark {
  text: string;
  color?: string;
}

/** **굵게** 마크다운 + 키워드·스니펫 <mark> */
export function renderAnalysisText(
  text: string,
  opts?: {
    keywords?: string[];
    snippetTexts?: string[];
    snippetMarks?: SnippetMark[];
  },
): ReactNode {
  if (!text) return null;

  const keywords = (opts?.keywords ?? [])
    .map((k) => k.trim())
    .filter((k) => k.length >= 2)
    .sort((a, b) => b.length - a.length);

  const marks: SnippetMark[] =
    opts?.snippetMarks?.length
      ? opts.snippetMarks.filter((s) => s.text.length >= 4)
      : (opts?.snippetTexts ?? [])
          .filter((s) => s.length >= 4)
          .map((t) => ({ text: t, color: "amber" }));

  const parts: ReactNode[] = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    let earliest = -1;
    let kind: "bold" | "snippet" | "keyword" | null = null;
    let matchLen = 0;
    let matchStr = "";
    let snippetColor: HighlightColor = "amber";

    const bold = remaining.match(/\*\*(.+?)\*\*/);
    if (bold && bold.index !== undefined) {
      earliest = bold.index;
      kind = "bold";
      matchLen = bold[0].length;
      matchStr = bold[1];
    }

    for (const sn of marks) {
      const idx = remaining.indexOf(sn.text);
      if (idx >= 0 && (earliest < 0 || idx < earliest)) {
        earliest = idx;
        kind = "snippet";
        matchLen = sn.text.length;
        matchStr = sn.text;
        snippetColor = normalizeHighlightColor(sn.color);
      }
    }

    for (const kw of keywords) {
      const idx = remaining.indexOf(kw);
      if (idx >= 0 && (earliest < 0 || idx < earliest)) {
        earliest = idx;
        kind = "keyword";
        matchLen = kw.length;
        matchStr = kw;
      }
    }

    if (earliest < 0 || !kind) {
      parts.push(<Fragment key={key++}>{remaining}</Fragment>);
      break;
    }

    if (earliest > 0) {
      parts.push(<Fragment key={key++}>{remaining.slice(0, earliest)}</Fragment>);
    }

    if (kind === "bold") {
      parts.push(
        <strong key={key++} className="font-semibold text-neutral-900 dark:text-neutral-100">
          {matchStr}
        </strong>,
      );
    } else if (kind === "snippet") {
      parts.push(
        <mark key={key++} className={`rounded px-0.5 ${HIGHLIGHT_MARK_CLASS[snippetColor]}`}>
          {matchStr}
        </mark>,
      );
    } else {
      parts.push(
        <mark
          key={key++}
          className="rounded px-0.5 bg-sky-100/90 text-sky-900 dark:bg-sky-500/25 dark:text-sky-100"
        >
          {matchStr}
        </mark>,
      );
    }

    remaining = remaining.slice(earliest + matchLen);
  }

  return <>{parts}</>;
}
