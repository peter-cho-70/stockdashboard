"use client";

import { useEffect, useMemo, useRef } from "react";
import { tokenizeWords, type ListenScript } from "@/lib/listenScript";

function SentenceLine({
  text,
  isCurrent,
  isPast,
  currentWordIndex,
  lineRef,
}: {
  text: string;
  isCurrent: boolean;
  isPast: boolean;
  currentWordIndex: number;
  lineRef?: (el: HTMLParagraphElement | null) => void;
}) {
  const words = useMemo(() => tokenizeWords(text), [text]);

  if (!isCurrent || words.length === 0) {
    return (
      <p
        ref={lineRef}
        tabIndex={-1}
        className={`text-sm leading-relaxed rounded-md px-2.5 py-1.5 transition-colors scroll-mt-4 ${
          isPast
            ? "text-neutral-400 dark:text-neutral-500"
            : "text-neutral-700 dark:text-neutral-300"
        }`}
      >
        {text}
      </p>
    );
  }

  return (
    <p
      ref={lineRef}
      tabIndex={-1}
      className="text-sm leading-relaxed rounded-md px-2.5 py-1.5 transition-colors scroll-mt-4 bg-amber-100/40 border-l-2 border-amber-500 dark:bg-amber-900/25"
    >
      {words.map((w, i) => {
        const active = i === currentWordIndex;
        const done = currentWordIndex >= 0 && i < currentWordIndex;
        const gap = i > 0 ? text.slice(words[i - 1].end, w.start) : "";
        return (
          <span key={`${w.start}-${i}`}>
            {gap}
            <span
              aria-hidden={!active}
              className={`rounded-sm px-0.5 transition-colors ${
                active
                  ? "bg-amber-400 text-neutral-900 font-semibold dark:bg-amber-500 dark:text-neutral-900"
                  : done
                    ? "text-neutral-500 dark:text-neutral-400"
                    : "text-neutral-800 dark:text-neutral-200"
              }`}
            >
              {w.text}
            </span>
          </span>
        );
      })}
    </p>
  );
}

function scrollLineIntoContainer(line: HTMLElement, container: HTMLElement) {
  const padding = 48;
  const lineTop = line.offsetTop;
  const lineHeight = line.offsetHeight;
  const viewHeight = container.clientHeight;

  const visibleTop = container.scrollTop + padding;
  const visibleBottom = container.scrollTop + viewHeight - padding;
  const lineBottom = lineTop + lineHeight;

  if (lineTop >= visibleTop && lineBottom <= visibleBottom) return;

  const target = lineTop - viewHeight / 2 + lineHeight / 2;
  container.scrollTo({
    top: Math.max(0, target),
    behavior: "smooth",
  });
}

export function SyncedListenView({
  script,
  currentFlatIndex,
  currentWordIndex,
}: {
  script: ListenScript;
  currentFlatIndex: number;
  currentWordIndex: number;
}) {
  const refs = useRef<Map<string, HTMLParagraphElement>>(new Map());
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const pauseAutoScrollUntilRef = useRef(0);
  let flatIdx = 0;

  useEffect(() => {
    const bumpPause = () => {
      pauseAutoScrollUntilRef.current = Date.now() + 5000;
    };

    const onInteract = (e: Event) => {
      const target = e.target as Node | null;
      const controls = document.querySelector("[data-listen-controls]");
      if (controls?.contains(target)) bumpPause();
    };

    document.addEventListener("pointerdown", onInteract, true);
    document.addEventListener("focusin", onInteract, true);
    return () => {
      document.removeEventListener("pointerdown", onInteract, true);
      document.removeEventListener("focusin", onInteract, true);
    };
  }, []);

  useEffect(() => {
    if (Date.now() < pauseAutoScrollUntilRef.current) return;

    const container = scrollContainerRef.current;
    const el = refs.current.get(`flat-${currentFlatIndex}`);
    if (!container || !el) return;

    scrollLineIntoContainer(el, container);
  }, [currentFlatIndex]);

  return (
    <div
      ref={scrollContainerRef}
      aria-live="off"
      className="max-h-[min(50vh,28rem)] overflow-y-auto overscroll-contain rounded-xl border border-emerald-200/80 bg-emerald-50/30 p-4 dark:border-emerald-900/50 dark:bg-emerald-950/20"
    >
      <p className="text-[10px] font-medium text-emerald-700 dark:text-emerald-400 mb-3 sticky top-0 bg-emerald-50/95 py-1 dark:bg-emerald-950/95 backdrop-blur-sm z-[1]">
        듣기 모드 · 현재 읽는 단어가 강조됩니다 · 재생 버튼은 위 패널에서 조작하세요
      </p>
      <div className="space-y-4">
        {script.sections.map((sec) => (
          <section key={sec.id} className="space-y-2">
            <h3 className="text-xs font-semibold text-neutral-700 dark:text-neutral-300 border-b border-[var(--border-subtle)] pb-1">
              {sec.label}
            </h3>
            <div className="space-y-1.5">
              {sec.sentences.map((sent) => {
                const idx = flatIdx;
                flatIdx += 1;
                const isCurrent = idx === currentFlatIndex;
                const isPast = idx < currentFlatIndex;
                const refKey = `flat-${idx}`;
                return (
                  <SentenceLine
                    key={sent.id}
                    text={sent.text}
                    isCurrent={isCurrent}
                    isPast={isPast}
                    currentWordIndex={isCurrent ? currentWordIndex : -1}
                    lineRef={(el) => {
                      if (el) refs.current.set(refKey, el);
                      else refs.current.delete(refKey);
                    }}
                  />
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
