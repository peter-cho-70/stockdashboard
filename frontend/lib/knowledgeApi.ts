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
      /* keep raw */
    }
    throw new Error(message);
  }
  return res.json();
}

export interface KnowledgeDomain {
  id: number;
  name: string;
  slug: string;
  emoji: string;
  color: string;
  description: string | null;
  keywords: string[];
  sort_order: number;
  is_active: boolean;
  created_at: string;
}

export interface KnowledgeDomainStats {
  domain_id: number;
  total_count: number;
  week_count: number;
  channel_count: number;
  news_count: number;
  latest_title: string | null;
  latest_at: string | null;
}

export interface KnowledgeContent {
  id: number;
  source_type: "YOUTUBE" | "NEWS" | "TEXT" | string;
  source_url: string | null;
  source_title: string | null;
  channel_name: string | null;
  domain_id: number | null;
  content_scope?: string;
  summary: string | null;
  key_points?: string[];
  keywords: string[];
  sentiment: string | null;
  is_bookmarked: boolean;
  is_read: boolean;
  analyzed_at: string | null;
  created_at: string;
  published_at?: string | null;
  source_document?: string | null;
}

export interface FeedResponse {
  items: KnowledgeContent[];
  next_cursor: number | null;
  count: number;
}

export interface KnowledgeNewsItem {
  id: number;
  domain_id: number;
  title: string;
  url: string;
  source_name: string | null;
  published_at: string | null;
  summary: string | null;
  fetched_at: string | null;
}

export interface RemindCard {
  id: number;
  source_type: string;
  source_url: string | null;
  source_title: string | null;
  channel_name: string | null;
  domain_id: number | null;
  summary: string | null;
  key_points: string[];
  keywords: string[];
  sentiment: string | null;
  days_ago: number | null;
  remind_reason: string;
  analyzed_at: string | null;
}

export interface KnowledgeDigest {
  id: number;
  domain_id: number;
  period_start: string;
  period_end: string;
  title: string | null;
  body_markdown: string | null;
  highlights: string[];
  status: string;
  model: string | null;
  generated_at: string | null;
}

export interface KnowledgeChannel {
  id: number;
  channel_id: string;
  channel_name: string;
  channel_url: string;
  domain_id: number | null;
}

export const knowledgeApi = {
  getDomains: (includeInactive = false) =>
    fetchApi<KnowledgeDomain[]>(`/knowledge/domains?include_inactive=${includeInactive}`),

  getDomainStats: (domainId: number) =>
    fetchApi<KnowledgeDomainStats>(`/knowledge/domains/${domainId}/stats`),

  seedTemplates: () =>
    fetchApi<{ created: number; domains: KnowledgeDomain[] }>("/knowledge/domains/seed-templates", {
      method: "POST",
    }),

  createDomain: (body: {
    name: string;
    slug?: string;
    emoji?: string;
    color?: string;
    description?: string;
    keywords?: string[];
  }) =>
    fetchApi<KnowledgeDomain>("/knowledge/domains", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  updateDomain: (
    id: number,
    body: Partial<{ name: string; emoji: string; color: string; description: string; keywords: string[]; is_active: boolean }>,
  ) =>
    fetchApi<KnowledgeDomain>(`/knowledge/domains/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  deleteDomain: (id: number) =>
    fetchApi<{ ok: boolean }>(`/knowledge/domains/${id}`, { method: "DELETE" }),

  getFeed: (params?: {
    domain_id?: number;
    source_type?: string;
    search?: string;
    limit?: number;
    cursor?: number;
  }) => {
    const q = new URLSearchParams();
    if (params?.domain_id) q.set("domain_id", String(params.domain_id));
    if (params?.source_type) q.set("source_type", params.source_type);
    if (params?.search) q.set("search", params.search);
    if (params?.limit) q.set("limit", String(params.limit));
    if (params?.cursor) q.set("cursor", String(params.cursor));
    return fetchApi<FeedResponse>(`/knowledge/feed?${q}`);
  },

  getContentDetail: (id: number) => fetchApi<KnowledgeContent>(`/knowledge/feed/${id}`),

  toggleBookmark: (id: number, isBookmarked: boolean) =>
    fetchApi<{ ok: boolean }>(`/knowledge/feed/${id}/bookmark`, {
      method: "PATCH",
      body: JSON.stringify({ is_bookmarked: isBookmarked }),
    }),

  getRemindCards: (limit = 3) =>
    fetchApi<{ cards: RemindCard[]; count: number }>(`/knowledge/remind?limit=${limit}`),

  recordRemindAction: (contentId: number, action: "remembered" | "needs_review") =>
    fetchApi<{ content_id: number; action: string; next_remind: string }>(
      `/knowledge/remind/${contentId}`,
      { method: "POST", body: JSON.stringify({ action }) },
    ),

  getRemindStats: () => fetchApi<Record<string, number>>("/knowledge/remind/stats"),

  getDomainNews: (domainId: number, limit = 10) =>
    fetchApi<KnowledgeNewsItem[]>(`/knowledge/news?domain_id=${domainId}&limit=${limit}`),

  fetchNews: (domainId: number) =>
    fetchApi<{ status: string; domain_id: number; fetched?: number; message?: string }>(
      `/knowledge/news/fetch?domain_id=${domainId}`,
      { method: "POST" },
    ),

  getLatestDigest: (domainId: number) =>
    fetchApi<{ digest: KnowledgeDigest | null }>(`/knowledge/digest/${domainId}?latest=true`),

  generateDigest: (domainId: number, force = false) =>
    fetchApi<{ digest: KnowledgeDigest }>(`/knowledge/digest/${domainId}/generate`, {
      method: "POST",
      body: JSON.stringify({ force }),
    }),

  getKnowledgeChannels: (domainId?: number) => {
    const q = domainId ? `?domain_id=${domainId}` : "";
    return fetchApi<KnowledgeChannel[]>(`/knowledge/channels${q}`);
  },
};

export function relativeTime(isoString: string | null): string {
  if (!isoString) return "";
  const diff = Date.now() - new Date(isoString).getTime();
  const min = Math.floor(diff / 60000);
  const hr = Math.floor(diff / 3600000);
  const day = Math.floor(diff / 86400000);
  if (min < 1) return "방금 전";
  if (min < 60) return `${min}분 전`;
  if (hr < 24) return `${hr}시간 전`;
  if (day < 7) return `${day}일 전`;
  return new Date(isoString).toLocaleDateString("ko-KR", { month: "short", day: "numeric" });
}

export function sourceTypeEmoji(sourceType: string): string {
  if (sourceType === "YOUTUBE") return "🎬";
  if (sourceType === "NEWS") return "📰";
  return "📝";
}

export function sentimentColor(sentiment: string | null): string {
  if (sentiment === "POSITIVE") return "text-emerald-600 dark:text-emerald-400";
  if (sentiment === "NEGATIVE") return "text-red-500 dark:text-red-400";
  return "text-neutral-500";
}

export function sentimentEmoji(sentiment: string | null): string {
  if (sentiment === "POSITIVE") return "📈";
  if (sentiment === "NEGATIVE") return "📉";
  return "➡️";
}
