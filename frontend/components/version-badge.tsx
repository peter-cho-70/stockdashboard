"use client";

import { useEffect, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { APP_VERSION } from "@/lib/version";
import { CHANGELOG } from "@/lib/changelog";

/** 버전 배지 — 클릭하면 업데이트 내역(변경 로그)을 보여주는 팝오버 */
export function VersionBadge() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="relative inline-block" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="업데이트 내역 보기"
        className="rounded-full bg-neutral-100 px-1.5 py-0.5 text-[10px] font-normal tabular-nums text-neutral-400 transition-colors hover:bg-violet-100 hover:text-violet-600 dark:bg-neutral-800 dark:text-neutral-500 dark:hover:bg-violet-900/30 dark:hover:text-violet-400"
      >
        v{APP_VERSION}
      </button>

      {open && (
        <div className="absolute left-0 z-50 mt-1.5 w-80 max-h-96 overflow-y-auto rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-elevated)] p-3 shadow-xl">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-neutral-700 dark:text-neutral-300">
            <Sparkles size={12} className="text-violet-500" />
            업데이트 내역
          </p>
          <div className="space-y-3">
            {CHANGELOG.map((entry) => (
              <div key={entry.version}>
                <p className="text-[11px] font-medium tabular-nums text-violet-600 dark:text-violet-400">
                  v{entry.version}
                </p>
                <ul className="mt-1 list-disc space-y-0.5 pl-3 marker:text-neutral-300 dark:marker:text-neutral-600">
                  {entry.items.map((item, j) => (
                    <li key={j} className="text-[11px] leading-relaxed text-neutral-600 dark:text-neutral-400">
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
