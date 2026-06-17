/** 한국 증시 관례: 상승 빨강, 하락 파랑 */

export const KR_UP_HEX = "#ef4444";
export const KR_DOWN_HEX = "#3b82f6";
export const KR_UP_HEX_STRONG = "#dc2626";
export const KR_DOWN_HEX_STRONG = "#2563eb";

export function krChangeClass(value: number): string {
  if (value > 0) return "text-red-600 dark:text-red-400";
  if (value < 0) return "text-blue-600 dark:text-blue-400";
  return "text-neutral-400";
}

export function krChangeBgClass(value: number): string {
  if (value > 0) return "bg-red-500";
  if (value < 0) return "bg-blue-500";
  return "bg-neutral-400";
}

export function krChangeBorderPanelClass(value: number): string {
  if (value > 0) return "border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/20";
  if (value < 0) return "border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-900/20";
  return "border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900/20";
}

export function krDirectionBorderPanel(direction: "up" | "down"): string {
  return krChangeBorderPanelClass(direction === "up" ? 1 : -1);
}

export function krDirectionTextClass(direction: "up" | "down"): string {
  return direction === "up"
    ? "text-red-700 dark:text-red-400"
    : "text-blue-700 dark:text-blue-400";
}

export function krSignedMediumClass(value: number): string {
  return `${krChangeClass(value)} font-medium`;
}

export function krSignedBoldClass(value: number): string {
  return `${krChangeClass(value)} font-bold`;
}

export function krBullishPanelClass(): string {
  return "text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/20";
}

export function krBearishPanelClass(): string {
  return "text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20";
}

export function krBullishBorderClass(): string {
  return "border-red-200 dark:border-red-800/50 bg-red-50/50 dark:bg-red-900/10";
}

export function krBearishBorderClass(): string {
  return "border-blue-200 dark:border-blue-800/50 bg-blue-50/50 dark:bg-blue-900/10";
}

export function krDirectionHex(direction: "up" | "down"): string {
  return direction === "up" ? KR_UP_HEX_STRONG : KR_DOWN_HEX_STRONG;
}
