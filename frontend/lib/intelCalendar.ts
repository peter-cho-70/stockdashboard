/**
 * 인텔리전스 캘린더 API 타입·날짜 유틸
 */
const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api";

async function fetchApi<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const err = await res.text();
    let message = err || `HTTP ${res.status}`;
    try {
      const parsed = JSON.parse(err) as { detail?: unknown };
      if (typeof parsed.detail === "string") message = parsed.detail;
    } catch {
      /* keep */
    }
    throw new Error(message);
  }
  return res.json();
}

export type IntelCalendarKind =
  | "macro"
  | "sector"
  | "stock"
  | "content"
  | "issue"
  | "price_move"
  | "economic";

export type IntelCalendarDateMode = "event" | "analyzed";

export interface IntelCalendarEvent {
  id: string;
  date: string;
  kind: IntelCalendarKind;
  title: string;
  summary: string;
  sentiment: "POSITIVE" | "NEUTRAL" | "NEGATIVE" | null;
  sector?: string | null;
  symbol?: string | null;
  stock_name?: string | null;
  source_type?: string | null;
  content_id?: number | null;
  source_url?: string | null;
  is_portfolio?: boolean;
  is_watchlist?: boolean;
  change_pct?: number | null;
}

export interface IntelCalendarDayMeta {
  event_count: number;
  sentiment: Record<string, number>;
  by_kind: Record<string, number>;
  has_digest: boolean;
  events: IntelCalendarEvent[];
}

export interface IntelCalendarKpi {
  from: string;
  to: string;
  content_count: number;
  signal_count: number;
  total_events: number;
  sentiment: Record<string, number>;
  top_sectors: { sector: string; count: number }[];
  portfolio_related_count: number;
}

export interface IntelCalendarResponse {
  from: string;
  to: string;
  date_mode: IntelCalendarDateMode;
  days: Record<string, IntelCalendarDayMeta>;
  digests: Record<string, { title?: string; status?: string }>;
  kpi: IntelCalendarKpi;
  total_events: number;
}

export interface IntelDigest {
  date: string;
  title: string | null;
  body_markdown: string | null;
  stats: Record<string, unknown>;
  source_content_ids?: number[];
  source_signal_ids?: Record<string, number[]>;
  portfolio_highlight?: unknown;
  generated_at?: string | null;
  model?: string | null;
  status: "pending" | "ready" | "failed" | string;
  error_message?: string | null;
}

export interface IntelCalendarDayResponse {
  date: string;
  date_mode: IntelCalendarDateMode;
  day: IntelCalendarDayMeta;
  briefing: {
    date: string;
    content_count: number;
    macro_count: number;
    sector_count: number;
    stock_count: number;
    issue_count: number;
    price_move_count: number;
    economic_count?: number;
    sentiment_counts: Record<string, number>;
    event_count: number;
  };
  digest: IntelDigest | null;
  disclaimer: string;
}

export const KIND_LABELS: Record<IntelCalendarKind, string> = {
  macro: "매크로",
  sector: "섹터",
  stock: "종목",
  content: "분석",
  issue: "이슈",
  price_move: "급변",
  economic: "경제일정",
};

export const KIND_ICONS: Record<IntelCalendarKind, string> = {
  macro: "🌍",
  sector: "📊",
  stock: "📈",
  content: "🎬",
  issue: "📌",
  price_move: "⚡",
  economic: "📅",
};

function pad(n: number) {
  return String(n).padStart(2, "0");
}

export function toIsoDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseIsoDate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** 경제 일정 검색용 — 표시 기간 ±패딩 */
export function padCalendarRange(from: string, to: string): { from: string; to: string } {
  const f = parseIsoDate(from);
  f.setDate(f.getDate() - 7);
  const t = parseIsoDate(to);
  t.setDate(t.getDate() + 14);
  return { from: toIsoDate(f), to: toIsoDate(t) };
}

export function monthRange(focus: Date): { from: string; to: string } {
  const y = focus.getFullYear();
  const m = focus.getMonth();
  const from = new Date(y, m, 1);
  const to = new Date(y, m + 1, 0);
  return { from: toIsoDate(from), to: toIsoDate(to) };
}

export function kpiRange(days: number): { from: string; to: string } {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - (days - 1));
  return { from: toIsoDate(from), to: toIsoDate(to) };
}

/** 월요일 시작 주간 7일 */
export function weekDates(focus: Date): string[] {
  const d = new Date(focus);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  const out: string[] = [];
  for (let i = 0; i < 7; i++) {
    out.push(toIsoDate(d));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

export function monthGridCells(focus: Date): (string | null)[] {
  const y = focus.getFullYear();
  const m = focus.getMonth();
  const first = new Date(y, m, 1);
  const last = new Date(y, m + 1, 0);
  const startPad = first.getDay();
  const cells: (string | null)[] = [];
  for (let i = 0; i < startPad; i++) cells.push(null);
  for (let d = 1; d <= last.getDate(); d++) {
    cells.push(toIsoDate(new Date(y, m, d)));
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export interface CalendarQueryParams {
  from: string;
  to: string;
  date_mode?: IntelCalendarDateMode;
  kinds?: string;
  portfolio_only?: boolean;
  watchlist_only?: boolean;
  include_events?: boolean;
}

function buildQs(params: CalendarQueryParams): string {
  const q = new URLSearchParams();
  q.set("from", params.from);
  q.set("to", params.to);
  if (params.date_mode) q.set("date_mode", params.date_mode);
  if (params.kinds) q.set("kinds", params.kinds);
  if (params.portfolio_only) q.set("portfolio_only", "true");
  if (params.watchlist_only) q.set("watchlist_only", "true");
  if (params.include_events) q.set("include_events", "true");
  return q.toString();
}

export const intelCalendarApi = {
  getCalendar: (params: CalendarQueryParams) =>
    fetchApi<IntelCalendarResponse>(`/intel/calendar?${buildQs(params)}`),
  getDigest: (date: string) => fetchApi<IntelDigest>(`/intel/digest/${date}`),
  generateDigest: (date: string, force = false) =>
    fetchApi<{ ok: boolean; digest: IntelDigest }>("/intel/digest/generate", {
      method: "POST",
      body: JSON.stringify({ date, force }),
    }),
  backfillDigests: (from: string, to: string, force = false) =>
    fetchApi<{ ok: boolean; generated: number; results: unknown[] }>(
      "/intel/digest/backfill",
      { method: "POST", body: JSON.stringify({ from_date: from, to_date: to, force }) },
    ),
  syncEconomicCalendar: (from: string, to: string, force = false) => {
    const q = new URLSearchParams({ from, to });
    if (force) q.set("force", "true");
    return fetchApi<{ synced: boolean; count: number; message: string }>(
      `/intel/calendar/economic/sync?${q}`,
      { method: "POST" },
    );
  },
  getDay: (
    date: string,
    opts?: {
      date_mode?: IntelCalendarDateMode;
      kinds?: string;
      portfolio_only?: boolean;
      watchlist_only?: boolean;
    },
  ) => {
    const q = new URLSearchParams({ date });
    if (opts?.date_mode) q.set("date_mode", opts.date_mode);
    if (opts?.kinds) q.set("kinds", opts.kinds);
    if (opts?.portfolio_only) q.set("portfolio_only", "true");
    if (opts?.watchlist_only) q.set("watchlist_only", "true");
    return fetchApi<IntelCalendarDayResponse>(`/intel/calendar/day?${q}`);
  },
};
