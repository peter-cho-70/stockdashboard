export const CHART_HEX: Record<string, string> = {
  amber:   '#f59e0b',
  blue:    '#3b82f6',
  violet:  '#8b5cf6',
  rose:    '#f43f5e',
  green:   '#22c55e',
  pink:    '#ec4899',
  yellow:  '#eab308',
  slate:   '#64748b',
  red:     '#ef4444',
  teal:    '#14b8a6',
  indigo:  '#6366f1',
  emerald: '#10b981',
  gray:    '#9ca3af',
};

export function chartColor(colorKey: string): string {
  return CHART_HEX[colorKey] ?? CHART_HEX.gray;
}
