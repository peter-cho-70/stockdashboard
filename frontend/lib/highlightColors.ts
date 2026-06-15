export const HIGHLIGHT_COLORS = ["amber", "green", "sky", "violet", "rose"] as const;
export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number];

export const HIGHLIGHT_COLOR_LABELS: Record<HighlightColor, string> = {
  amber: "노랑",
  green: "초록",
  sky: "하늘",
  violet: "보라",
  rose: "분홍",
};

export const HIGHLIGHT_MARK_CLASS: Record<HighlightColor, string> = {
  amber: "bg-amber-200/90 text-amber-950 dark:bg-amber-500/40 dark:text-amber-50",
  green: "bg-emerald-200/90 text-emerald-950 dark:bg-emerald-500/35 dark:text-emerald-50",
  sky: "bg-sky-200/90 text-sky-950 dark:bg-sky-500/35 dark:text-sky-50",
  violet: "bg-violet-200/90 text-violet-950 dark:bg-violet-500/35 dark:text-violet-50",
  rose: "bg-rose-200/90 text-rose-950 dark:bg-rose-500/35 dark:text-rose-50",
};

export const HIGHLIGHT_PIN_BG: Record<HighlightColor, string> = {
  amber: "bg-amber-100/90 border-amber-300/70 dark:bg-amber-900/30 dark:border-amber-700/50",
  green: "bg-emerald-100/90 border-emerald-300/70 dark:bg-emerald-900/30 dark:border-emerald-700/50",
  sky: "bg-sky-100/90 border-sky-300/70 dark:bg-sky-900/30 dark:border-sky-700/50",
  violet: "bg-violet-100/90 border-violet-300/70 dark:bg-violet-900/30 dark:border-violet-700/50",
  rose: "bg-rose-100/90 border-rose-300/70 dark:bg-rose-900/30 dark:border-rose-700/50",
};

export function normalizeHighlightColor(c?: string | null): HighlightColor {
  const v = (c || "amber").toLowerCase() as HighlightColor;
  return HIGHLIGHT_COLORS.includes(v) ? v : "amber";
}
