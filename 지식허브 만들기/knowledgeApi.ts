/**
 * frontend/lib/knowledgeApi.ts
 * 지식 허브 API 클라이언트
 *
 * 기존 lib/api.ts의 fetchApi 패턴을 그대로 재사용합니다.
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
    } catch { /* keep raw */ }
    throw new Error(message);
  }
  return res.json();
}

// ── 타입 정의 ────────────────────────────────────────────────────────────────

export interface KnowledgeDomain {
  id:          number;
  name:        string;
  slug:        string;
  emoji:       string;
  color:       string;
  description: string | null;
  keywords:    string[];
  sort_order:  number;
  is_active:   boolean;
  created_at:  string;
}

export interface KnowledgeDomainStats {
  domain_id:     number;
  total_count:   number;
  week_count:    number;
  channel_count: number;
  news_count:    number;
  latest_title:  string | null;
  latest_at:     string | null;
}

export interface KnowledgeConcept {
  term:       string;
  definition: string;
}

export interface KnowledgeContent {
  id:             number;
  source_type:    "YOUTUBE" | "NEWS" | "TEXT";
  source_url:     string;
  source_title:   string | null;
  channel_name:   string | null;
  domain_id:      number | null;
  summary:        string | null;
  key_points:     string[];
  keywords:       string[];
  concepts:       KnowledgeConcept[];
  learning_notes: string;
  related_topics: string[];
  sentiment:      "POSITIVE" | "NEUTRAL" | "NEGATIVE" | null;
  is_bookmarked:  boolean;
  is_read:        boolean;
  analyzed_at:    string | null;
  created_at:     string;
  published_at:   string | null;
}

export interface KnowledgeNewsItem {
  id:           number;
  domain_id:    number;
  title:        string;
  url:          string;
  source_name:  string | null;
  summary:      string | null;
  published_at: string | null;
  fetched_at:   string;
}

export interface RemindCard extends KnowledgeContent {
  days_ago:      number | null;
  remind_reason: string;
}

export interface FeedResponse {
  items:       KnowledgeContent[];
  next_cursor: number | null;
  count:       number;
}

export interface RemindStats {
  total_actions:  number;
  remembered:     number;
  needs_review:   number;
  retention_rate: number;
}

// ── Domain CRUD ───────────────────────────────────────────────────────────────

export const knowledgeApi = {

  // 분야 목록
  getDomains: (includeInactive = false) =>
    fetchApi<KnowledgeDomain[]>(
      `/knowledge/domains?include_inactive=${includeInactive}`
    ),

  // 분야 통계
  getDomainStats: (domainId: number) =>
    fetchApi<KnowledgeDomainStats>(`/knowledge/domains/${domainId}/stats`),

  // 분야 생성
  createDomain: (body: {
    name: string; slug: string; emoji?: string;
    color?: string; description?: string; keywords?: string[];
  }) =>
    fetchApi<KnowledgeDomain>("/knowledge/domains", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  // 분야 수정
  updateDomain: (id: number, body: Partial<KnowledgeDomain & { keywords: string[] }>) =>
    fetchApi<KnowledgeDomain>(`/knowledge/domains/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  // 분야 삭제
  deleteDomain: (id: number) =>
    fetchApi<{ ok: boolean }>(`/knowledge/domains/${id}`, { method: "DELETE" }),

  // ── 피드 ─────────────────────────────────────────────────────────────────

  getFeed: (params?: {
    domain_id?:   number;
    source_type?: string;
    sentiment?:   string;
    search?:      string;
    bookmarked?:  boolean;
    limit?:       number;
    cursor?:      number;
  }) => {
    const q = new URLSearchParams();
    if (params?.domain_id)   q.set("domain_id",   String(params.domain_id));
    if (params?.source_type) q.set("source_type", params.source_type);
    if (params?.sentiment)   q.set("sentiment",   params.sentiment);
    if (params?.search)      q.set("search",      params.search);
    if (params?.bookmarked)  q.set("bookmarked",  "true");
    if (params?.limit)       q.set("limit",       String(params.limit));
    if (params?.cursor)      q.set("cursor",      String(params.cursor));
    return fetchApi<FeedResponse>(`/knowledge/feed?${q}`);
  },

  getContentDetail: (id: number) =>
    fetchApi<KnowledgeContent>(`/knowledge/feed/${id}`),

  toggleBookmark: (id: number, isBookmarked: boolean) =>
    fetchApi<{ ok: boolean }>(`/knowledge/feed/${id}/bookmark`, {
      method: "PATCH",
      body: JSON.stringify({ is_bookmarked: isBookmarked }),
    }),

  markRead: (id: number, isRead = true) =>
    fetchApi<{ ok: boolean }>(`/knowledge/feed/${id}/read`, {
      method: "PATCH",
      body: JSON.stringify({ is_read: isRead }),
    }),

  changeContentDomain: (contentId: number, domainId: number) =>
    fetchApi<{ ok: boolean }>(`/knowledge/feed/${contentId}/domain?domain_id=${domainId}`, {
      method: "PATCH",
    }),

  // ── 분석 ─────────────────────────────────────────────────────────────────

  analyze: (body: { url: string; domain_id: number; channel_name?: string; force_reanalyze?: boolean }) =>
    fetchApi<{ status: string; message?: string }>("/knowledge/analyze", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  // ── 리마인드 ─────────────────────────────────────────────────────────────

  getRemindCards: (limit = 3) =>
    fetchApi<{ cards: RemindCard[]; count: number }>(`/knowledge/remind?limit=${limit}`),

  recordRemindAction: (contentId: number, action: "remembered" | "needs_review") =>
    fetchApi<{ content_id: number; action: string; next_remind: string }>(
      `/knowledge/remind/${contentId}`,
      { method: "POST", body: JSON.stringify({ action }) }
    ),

  getRemindStats: () =>
    fetchApi<RemindStats>("/knowledge/remind/stats"),

  // ── 뉴스 ─────────────────────────────────────────────────────────────────

  getDomainNews: (domainId: number, limit = 10) =>
    fetchApi<KnowledgeNewsItem[]>(`/knowledge/news?domain_id=${domainId}&limit=${limit}`),

  fetchNews: (domainId: number) =>
    fetchApi<{ status: string }>(`/knowledge/news/fetch?domain_id=${domainId}`, {
      method: "POST",
    }),

  saveNewsAsContent: (newsId: number, domainId?: number) =>
    fetchApi<{ status: string }>(
      `/knowledge/news/${newsId}/save-as-content${domainId ? `?domain_id=${domainId}` : ""}`,
      { method: "POST" }
    ),

  // ── 채널 ─────────────────────────────────────────────────────────────────

  getKnowledgeChannels: (domainId?: number) => {
    const q = domainId ? `?domain_id=${domainId}` : "";
    return fetchApi<unknown[]>(`/knowledge/channels${q}`);
  },

  changeChannelDomain: (channelId: number, domainId: number) =>
    fetchApi<{ ok: boolean }>(
      `/knowledge/channels/${channelId}/domain?domain_id=${domainId}`,
      { method: "PATCH" }
    ),
};

// ── 유틸리티 ─────────────────────────────────────────────────────────────────

/** 상대 시간 표시 (예: "3일 전") */
export function relativeTime(isoString: string | null): string {
  if (!isoString) return "";
  const diff = Date.now() - new Date(isoString).getTime();
  const min  = Math.floor(diff / 60000);
  const hr   = Math.floor(diff / 3600000);
  const day  = Math.floor(diff / 86400000);
  if (min  <  1) return "방금 전";
  if (min  < 60) return `${min}분 전`;
  if (hr   < 24) return `${hr}시간 전`;
  if (day  <  7) return `${day}일 전`;
  return new Date(isoString).toLocaleDateString("ko-KR", { month: "short", day: "numeric" });
}

/** 감성 → 색상 클래스 */
export function sentimentColor(sentiment: string | null): string {
  if (sentiment === "POSITIVE") return "text-emerald-600 dark:text-emerald-400";
  if (sentiment === "NEGATIVE") return "text-red-500 dark:text-red-400";
  return "text-neutral-500";
}

/** 감성 → 이모지 */
export function sentimentEmoji(sentiment: string | null): string {
  if (sentiment === "POSITIVE") return "📈";
  if (sentiment === "NEGATIVE") return "📉";
  return "➡️";
}

/** 소스 타입 → 이모지 */
export function sourceTypeEmoji(sourceType: string): string {
  if (sourceType === "YOUTUBE") return "🎬";
  if (sourceType === "NEWS")    return "📰";
  return "📝";
}
