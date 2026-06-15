/**
 * AI 분석 — 사용자 강조(핀·스니펫·직접 포인트)
 */
const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api";

export interface HighlightSnippet {
  id: string;
  field: string;
  text: string;
  note?: string;
  color?: string;
  created_at?: string;
}

export interface UserHighlights {
  pinned_key_point_indexes: number[];
  pin_colors?: Record<string, string>;
  user_key_points: string[];
  snippets: HighlightSnippet[];
}

export interface KeyPointItem {
  text: string;
  importance?: "high" | "normal" | "low";
  by?: "ai" | "user";
}

export const EMPTY_USER_HIGHLIGHTS: UserHighlights = {
  pinned_key_point_indexes: [],
  pin_colors: {},
  user_key_points: [],
  snippets: [],
};

export function normalizeKeyPoint(kp: string | KeyPointItem): KeyPointItem {
  if (typeof kp === "string") {
    let text = kp.trim();
    let importance: KeyPointItem["importance"] = "normal";
    if (text.startsWith("[중요]")) {
      text = text.slice(4).trim();
      importance = "high";
    } else if (text.startsWith("★")) {
      text = text.replace(/^★+\s*/, "").trim();
      importance = "high";
    }
    return { text, importance, by: "ai" };
  }
  return {
    text: (kp.text || "").trim(),
    importance: kp.importance || "normal",
    by: kp.by || "ai",
  };
}

export function normalizeKeyPoints(raw: unknown): KeyPointItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeKeyPoint).filter((k) => k.text);
}

export function normalizeUserHighlights(raw: unknown): UserHighlights {
  if (!raw || typeof raw !== "object") return { ...EMPTY_USER_HIGHLIGHTS };
  const o = raw as Record<string, unknown>;
  const pin_colors =
    o.pin_colors && typeof o.pin_colors === "object" && !Array.isArray(o.pin_colors)
      ? (o.pin_colors as Record<string, string>)
      : {};
  return {
    pinned_key_point_indexes: Array.isArray(o.pinned_key_point_indexes)
      ? o.pinned_key_point_indexes.filter((i): i is number => typeof i === "number")
      : [],
    pin_colors,
    user_key_points: Array.isArray(o.user_key_points)
      ? o.user_key_points.map(String).filter(Boolean)
      : [],
    snippets: Array.isArray(o.snippets) ? (o.snippets as HighlightSnippet[]) : [],
  };
}

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

export const intelHighlightsApi = {
  get: (contentId: number) =>
    fetchApi<UserHighlights>(`/intel/contents/${contentId}/highlights`),
  save: (contentId: number, highlights: UserHighlights) =>
    fetchApi<{ ok: boolean; user_highlights: UserHighlights }>(
      `/intel/contents/${contentId}/highlights`,
      { method: "PATCH", body: JSON.stringify(highlights) },
    ),
};

export function newSnippetId(): string {
  return `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
