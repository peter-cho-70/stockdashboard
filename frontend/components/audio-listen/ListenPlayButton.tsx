"use client";

import { Play } from "lucide-react";

export function ListenPlayButton({
  onPlay,
  disabled,
  className = "",
  size = "sm",
}: {
  onPlay: () => void;
  disabled?: boolean;
  className?: string;
  size?: "sm" | "md";
}) {
  const sm = size === "sm";
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onPlay}
      className={`inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-1.5 rounded-md border font-medium disabled:opacity-50 ${
        sm ? "px-3 py-2 text-xs" : "px-4 py-2.5 text-sm"
      } border-emerald-400 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 dark:border-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200 dark:hover:bg-emerald-900/50 ${className}`}
      title="음성으로 듣기"
    >
      <Play size={sm ? 14 : 16} className="ml-0.5" />
      재생
    </button>
  );
}
