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
      /* keep raw message */
    }
    throw new Error(message);
  }
  return res.json();
}

// ── 포트폴리오 ──────────────────────────────────
export interface StockItem {
  id: number;
  symbol: string;
  name: string;
  market: string;
  sector: string | null;
  currency: string;
  qty: number;
  avg_price: number;
  current_price: number;
  change_rate: number;
  profit_rate: number;
  profit_loss?: number;
  current_value?: number;
  memo: string | null;
  last_synced_at: string | null;
}

export interface PortfolioSummary {
  total_value: number;
  total_purchase: number;
  total_profit: number;
  total_profit_rate: number;
  stock_count: number;
  stocks: StockItem[];
}

export interface PortfolioSnapshot {
  date: string;
  total_profit_rate: number;
  total_value: number;
}

export const api = {
  getPortfolioSummary: () => fetchApi<PortfolioSummary>("/portfolio/summary"),
  getStocks: () => fetchApi<StockItem[]>("/portfolio/stocks"),
  syncNow: () => fetchApi<unknown>("/portfolio/sync/now", { method: "POST" }),
  refreshPrices: () => fetchApi<{ message: string; updated: number; alerts: unknown[] }>("/portfolio/refresh-prices", { method: "POST" }),
  getHistory: (days?: number) => fetchApi<PortfolioSnapshot[]>(`/portfolio/history${days ? `?days=${days}` : ""}`),
  updateMemo: (symbol: string, memo: string, sector?: string) =>
    fetchApi<unknown>(`/portfolio/stocks/${symbol}/memo`, {
      method: "PATCH",
      body: JSON.stringify({ memo, sector }),
    }),

  // ── 알림 ──────────────────────────────────────
  getAlerts: (unreadOnly?: boolean) =>
    fetchApi<Alert[]>(`/alerts${unreadOnly ? "?unread_only=true" : ""}`),
  markAllRead: () =>
    fetchApi<unknown>("/alerts/read-all", { method: "PATCH" }),

  // ── AI 분석 ────────────────────────────────────
  analyzeContent: (payload: {
    url?: string;
    text?: string;
    title?: string;
    channel_name?: string;
    analysis_provider?: AnalysisProvider;
  }) =>
    fetchApi<AnalysisResult>("/intel/analyze", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  reanalyzeContent: (contentId: number, analysisProvider?: AnalysisProvider) =>
    fetchApi<AnalysisResult>(`/intel/reanalyze/${contentId}`, {
      method: "POST",
      body: JSON.stringify({ analysis_provider: analysisProvider }),
    }),
  getAnalysisProviders: () => fetchApi<AnalysisProvidersResponse>("/intel/providers"),
  getIntelContents: (sourceType?: string) =>
    fetchApi<IntelContent[]>(
      `/intel/contents${sourceType ? `?source_type=${sourceType}` : ""}`
    ),
  getIntelContent: (id: number) => fetchApi<IntelContent>(`/intel/contents/${id}`),
  getStockIssues: (symbol: string) =>
    fetchApi<StockIssues>(`/intel/stocks/${symbol}/issues`),
  getMoveCauses: (symbol: string, fromDate?: string, toDate?: string) => {
    const params = new URLSearchParams();
    if (fromDate) params.set("from_date", fromDate);
    if (toDate) params.set("to_date", toDate);
    const q = params.toString();
    return fetchApi<MoveCausesResponse>(
      `/intel/stocks/${symbol}/move-causes${q ? `?${q}` : ""}`,
    );
  },

  getStockChart: (symbol: string, period: string) =>
    fetchApi<StockChartResponse>(`/portfolio/stocks/${symbol}/chart?period=${period}`),

  // ── 헬스 ──────────────────────────────────────
  health: () => fetchApi<{ status: string }>("/health"),
};

export interface StockChartBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  ma5: number;
  ma20: number;
  ma60: number;
}

export interface StockChartResponse {
  symbol: string;
  name: string;
  sector: string | null;
  avg_price: number;
  current_price: number;
  profit_rate: number;
  period: string;
  data: StockChartBar[];
}

export interface Alert {
  id: number;
  symbol: string;
  type: "PRICE_SURGE" | "PRICE_DROP" | "NEWS";
  message: string;
  change_rate: number;
  is_read: boolean;
  created_at: string;
}

export type AnalysisProvider = "claude" | "openai" | "gemini";

export interface AnalysisProviderInfo {
  id: AnalysisProvider;
  label: string;
  available: boolean;
  model: string;
}

export interface AnalysisProvidersResponse {
  default: AnalysisProvider;
  ai_fallback: boolean;
  ai_skip_if_cached: boolean;
  enable_bulk_youtube_analyze: boolean;
  providers: AnalysisProviderInfo[];
}

export interface AnalysisLog {
  level: "info" | "warn" | "error";
  msg: string;
  ts: string;
}

export interface StockIssueItem {
  stock_id: number;
  symbol: string | null;
  name: string | null;
  issue_summary: string;
  sentiment: "POSITIVE" | "NEUTRAL" | "NEGATIVE";
}

export interface MacroTopic {
  topic: string;
  summary: string;
  sentiment: string;
  impact?: string;
}

export interface MacroAnalysis {
  summary: string;
  topics: MacroTopic[];
}

export interface SectorAnalysisItem {
  sector: string;
  summary: string;
  sentiment: string;
  outlook?: string;
  mentioned_stocks?: string[];
}

export interface AnalysisResult {
  id: number;
  source_type: string;
  source_url?: string | null;
  source_title?: string | null;
  summary: string;
  key_points: string[];
  mentioned_stocks: string[];
  mentioned_sectors: string[];
  keywords: string[];
  sentiment: "POSITIVE" | "NEUTRAL" | "NEGATIVE";
  analyzed_at: string | null;
  stock_issues: StockIssueItem[];
  macro_analysis: MacroAnalysis;
  sector_analysis: SectorAnalysisItem[];
  source_document?: string | null;
  logs: AnalysisLog[];
}

export interface IntelContent {
  id: number;
  source_type: string;
  source_url: string | null;
  source_title: string | null;
  channel_name: string | null;
  summary: string | null;
  key_points?: string[];
  keywords?: string[];
  mentioned_stocks: string[];
  mentioned_sectors: string[];
  macro_analysis?: MacroAnalysis;
  sector_analysis?: SectorAnalysisItem[];
  stock_issues?: StockIssueItem[];
  source_document?: string | null;
  sentiment: string | null;
  analyzed_at: string | null;
}

export interface ChartBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  ma5: number;
  ma20: number;
  ma60: number;
}

export interface StockIssueTimeline {
  id: number;
  issue_summary: string;
  sentiment: string;
  source_type: string | null;
  source_url: string | null;
  source_title: string | null;
  created_at: string;
  analyzed_at?: string | null;
}

export interface StockIssues {
  symbol: string;
  name: string;
  issues: StockIssueTimeline[];
}

export interface MoveCause {
  id: number;
  event_date: string;
  change_pct: number;
  direction: "up" | "down";
  close_price: number | null;
  reason: string;
  sentiment: string;
  key_factors: string[];
  source_urls: string[];
  confidence: string | null;
  analysis_provider: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface MoveCausesResponse {
  symbol: string;
  name: string;
  causes: MoveCause[];
}

export interface ExplainMoveResult extends MoveCause {
  logs: AnalysisLog[];
}

// ── 신호(Signal) 타입 ───────────────────────────────────
export interface MacroSignal {
  id: number;
  content_id: number;
  topic: string;
  summary: string | null;
  sentiment: string | null;
  impact: string | null;
  event_date: string | null;
  created_at: string | null;
}

export interface SectorSignal {
  id: number;
  content_id: number;
  sector: string;
  summary: string | null;
  sentiment: string | null;
  outlook: string | null;
  mentioned_stocks: string[] | null;
  event_date: string | null;
  created_at: string | null;
}

export interface StockSignal {
  id: number;
  content_id: number;
  symbol: string | null;
  stock_name: string;
  is_portfolio: boolean;
  summary: string | null;
  sentiment: string | null;
  event_date: string | null;
  created_at: string | null;
}

export interface DailyBriefing {
  date: string;
  content_count: number;
  macro_count: number;
  sector_count: number;
  stock_count: number;
  sentiment_counts: Record<string, number>;
  top_topics: { topic: string; count: number }[];
  contents: {
    id: number; source_type: string; source_title: string | null;
    channel_name: string | null; summary: string | null; sentiment: string | null; analyzed_at: string | null;
  }[];
}

export interface MacroHub {
  days: number;
  total: number;
  topics: { topic: string; count: number; signals: MacroSignal[] }[];
}

export interface SectorHub {
  days: number;
  total: number;
  sectors: {
    sector: string; count: number;
    positive: number; neutral: number; negative: number;
    signals: SectorSignal[];
  }[];
}

export interface PortfolioReminder {
  symbol: string;
  stock_name: string;
  current_price: number | null;
  change_rate: number | null;
  signal_count: number;
  latest_date: string | null;
  latest_sentiment: string | null;
  signals: StockSignal[];
}

export interface SharedSignalItem {
  type: "sector" | "macro";
  id: number;
  content_id: number;
  summary: string | null;
  sentiment: string | null;
  event_date: string | null;
  label: string;
  sector?: string;
  topic?: string;
  outlook?: string | null;
  impact?: string | null;
  mentioned_stocks?: string[];
  source_type?: string | null;
  source_url?: string | null;
  source_title?: string | null;
  channel_name?: string | null;
  keywords?: string[];
}

export interface SharedSignalsResponse {
  symbol: string;
  name: string;
  normalized_sector: string | null;
  sector_signals: SharedSignalItem[];
  macro_signals: SharedSignalItem[];
}

export interface RelatedAnalysisItem {
  score: number;
  type: "sector" | "macro" | "peer_stock" | "keyword";
  id: number;
  label: string;
  summary: string | null;
  sentiment: string | null;
  event_date: string | null;
  date_distance: number;
  match_reasons: string[];
  source_type?: string | null;
  source_url?: string | null;
  source_title?: string | null;
  channel_name?: string | null;
  outlook?: string | null;
  impact?: string | null;
}

export const signalApi = {
  getDaily: (days = 7) =>
    fetchApi<{ days: number; since: string; briefings: DailyBriefing[] }>(`/intel/daily?days=${days}`),
  getMacro: (days = 30, topic?: string) =>
    fetchApi<MacroHub>(`/intel/macro?days=${days}${topic ? `&topic=${encodeURIComponent(topic)}` : ""}`),
  getSectors: (days = 30, sector?: string) =>
    fetchApi<SectorHub>(`/intel/sectors?days=${days}${sector ? `&sector=${encodeURIComponent(sector)}` : ""}`),
  getReminders: (days = 30) =>
    fetchApi<{ days: number; total_signals: number; reminders: PortfolioReminder[] }>(`/intel/portfolio/remind?days=${days}`),
  getSharedSignals: (symbol: string, days = 90) =>
    fetchApi<SharedSignalsResponse>(`/intel/stocks/${symbol}/shared-signals?days=${days}`),
  getRelated: (symbol: string, date: string, windowDays = 7) =>
    fetchApi<{ symbol: string; name: string; event_date: string; total: number; related: RelatedAnalysisItem[] }>(
      `/intel/stocks/${symbol}/related?date=${encodeURIComponent(date)}&window_days=${windowDays}`,
    ),
  backfill: () => fetchApi<{ ok: boolean; result: Record<string, number> }>("/intel/signals/backfill", { method: "POST" }),
  getRecommendations: (days = 30, sector?: string) =>
    fetchApi<{ days: number; sector: string | null; total: number; recommendations: StockRecommendation[] }>(
      `/intel/recommendations?days=${days}${sector ? `&sector=${encodeURIComponent(sector)}` : ""}`,
    ),
};

// ── 관심 종목 (Watchlist) ───────────────────────────────
export interface StockRecommendation {
  stock_name: string;
  symbol: string | null;
  sector: string;
  mention_count: number;
  latest_date: string;
  latest_sentiment: string;
  latest_summary: string;
  sources: { type: string; id: number; date: string; sentiment: string }[];
}

export interface WatchlistItem {
  id: number;
  symbol: string | null;
  stock_name: string;
  sector: string | null;
  source_type: string | null;
  source_id: number | null;
  memo: string | null;
  current_price: number | null;
  change_rate: number | null;
  created_at: string | null;
}

export const watchlistApi = {
  getAll: () => fetchApi<{ total: number; items: WatchlistItem[] }>("/watchlist"),
  add: (body: {
    stock_name: string;
    symbol?: string;
    sector?: string;
    source_type?: string;
    source_id?: number;
    memo?: string;
  }) => fetchApi<WatchlistItem>("/watchlist", { method: "POST", body: JSON.stringify(body) }),
  remove: (id: number) => fetchApi<{ ok: boolean }>(`/watchlist/${id}`, { method: "DELETE" }),
};
