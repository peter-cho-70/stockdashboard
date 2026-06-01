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
  position_source?: "kis" | "manual";
  last_synced_at: string | null;
}

export interface StockCreatePayload {
  symbol: string;
  name: string;
  market?: string;
  sector?: string;
  currency?: string;
  qty: number;
  avg_price: number;
  current_price?: number;
}

export interface PositionUpdatePayload {
  qty?: number;
  avg_price?: number;
  name?: string;
  sector?: string;
  current_price?: number;
}

export interface PortfolioTradePayload {
  side: "BUY" | "SELL";
  qty: number;
  price: number;
  traded_at?: string;
  memo?: string;
}

export interface PortfolioTradeItem {
  id: number;
  side: string;
  qty: number;
  price: number;
  traded_at: string;
  memo: string | null;
  created_at: string | null;
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

export interface ChartDateMemoItem {
  id: number;
  symbol: string;
  event_date: string;
  body: string;
  created_at: string | null;
  updated_at: string | null;
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
  addStock: (body: StockCreatePayload) =>
    fetchApi<{ message: string; stock: StockItem }>("/portfolio/stocks", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  deleteStock: (symbol: string) =>
    fetchApi<{ message: string; symbol: string }>(`/portfolio/stocks/${symbol}`, {
      method: "DELETE",
    }),
  updatePosition: (symbol: string, body: PositionUpdatePayload) =>
    fetchApi<{ message: string; stock: StockItem }>(`/portfolio/stocks/${symbol}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  createTrade: (symbol: string, body: PortfolioTradePayload) =>
    fetchApi<{ message: string; stock: StockItem; trade: PortfolioTradeItem }>(
      `/portfolio/stocks/${symbol}/trades`,
      { method: "POST", body: JSON.stringify(body) },
    ),
  getStockTrades: (symbol: string, limit = 30) =>
    fetchApi<{ symbol: string; trades: PortfolioTradeItem[] }>(
      `/portfolio/stocks/${symbol}/trades?limit=${limit}`,
    ),
  getChartMemos: (symbol: string) =>
    fetchApi<ChartDateMemoItem[]>(`/portfolio/stocks/${symbol}/chart-memos`),
  createChartMemo: (symbol: string, body: { event_date: string; body: string }) =>
    fetchApi<{ message: string; memo: ChartDateMemoItem }>(
      `/portfolio/stocks/${symbol}/chart-memos`,
      { method: "POST", body: JSON.stringify(body) },
    ),
  deleteChartMemo: (memoId: number) =>
    fetchApi<{ message: string }>(`/portfolio/chart-memos/${memoId}`, { method: "DELETE" }),

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
  health: () => fetchApi<{ status: string; demo_mode?: boolean }>("/health"),
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
  published_at?: string | null;
  event_date?: string | null;
  match_source?: string | null;
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
  target_buy_price: number | null;
  target_hit: boolean;
  target_gap_pct: number | null;
  current_price: number | null;
  change_rate: number | null;
  created_at: string | null;
}

export interface WatchlistInsight {
  item: WatchlistItem;
  buy_score: BuyScoreResult;
  issues: {
    id: number;
    issue_summary: string;
    sentiment: string | null;
    event_date: string | null;
    source_title: string | null;
    source_url: string | null;
    created_at: string | null;
  }[];
  ai_summary: string;
}

export interface WatchlistTimelineItem {
  date: string;
  kind: "ai_issue" | "price_move";
  title: string;
  summary: string;
  sentiment: string | null;
  source_title?: string | null;
  source_url?: string | null;
  change_pct?: number;
  issue_id?: number;
}

export interface WatchlistDetail {
  item: WatchlistItem;
  profile: {
    symbol: string;
    name: string;
    sector: string | null;
    market: string;
    intro: string;
  };
  chart_summary: {
    period_days: number;
    start_date: string | null;
    end_date: string | null;
    start_close: number;
    end_close: number;
    period_return_pct: number;
    high: number;
    low: number;
    avg_volume: number;
  };
  buy_score: BuyScoreResult;
  timeline: WatchlistTimelineItem[];
  days: number;
}

export interface SymbolLookup {
  symbol: string;
  stock_name: string;
  sector: string | null;
  current_price: number | null;
}

export interface BuyScoreComponent {
  category: string;
  score: number;
  label: string;
  reason: string;
  signal_count?: number;
  note?: string;
}

export interface BuyScoreResult {
  symbol: string;
  name: string;
  score: number;
  raw_score: number;
  grade: string;
  grade_label: string;
  components: BuyScoreComponent[];
  recent_issues: {
    sentiment: string;
    summary: string;
    analyzed_at: string | null;
    source_title: string | null;
  }[];
  warnings: string[];
  disclaimer: string;
  calculated_at: string;
  days_window: number;
}

export interface RiskAxis {
  axis: string;
  value: number;
  risk_level: "낮음" | "보통" | "높음";
  description: string;
}

export interface RiskRadarResult {
  days: number;
  stock_count: number;
  axes: RiskAxis[];
  sector_distribution: Record<string, number>;
  calculated_at: string;
}

export const scoreApi = {
  getBuyScore: (symbol: string, days = 30) =>
    fetchApi<BuyScoreResult>(`/intel/stocks/${symbol}/buy-score?days=${days}`),
  getRiskRadar: (days = 30) =>
    fetchApi<RiskRadarResult>(`/intel/portfolio/risk-radar?days=${days}`),
};

export const watchlistApi = {
  getAll: () => fetchApi<{ total: number; items: WatchlistItem[] }>("/watchlist"),
  lookupName: (name: string) =>
    fetchApi<SymbolLookup>(
      `/watchlist/lookup-name?name=${encodeURIComponent(name.trim())}`,
    ),
  lookupSymbol: (symbol: string) =>
    fetchApi<SymbolLookup>(`/watchlist/lookup/${encodeURIComponent(symbol.trim())}`),
  addBySymbol: (body: {
    symbol: string;
    stock_name?: string;
    target_buy_price?: number;
    memo?: string;
  }) =>
    fetchApi<WatchlistItem>("/watchlist/by-symbol", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  add: (body: {
    stock_name: string;
    symbol?: string;
    sector?: string;
    source_type?: string;
    source_id?: number;
    memo?: string;
    target_buy_price?: number;
  }) => fetchApi<WatchlistItem>("/watchlist", { method: "POST", body: JSON.stringify(body) }),
  update: (id: number, body: { memo?: string; target_buy_price?: number | null; sector?: string }) =>
    fetchApi<WatchlistItem>(`/watchlist/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  getInsight: (id: number, days = 30) =>
    fetchApi<WatchlistInsight>(`/watchlist/${id}/insight?days=${days}`),
  getDetail: (id: number, days = 90) =>
    fetchApi<WatchlistDetail>(`/watchlist/${id}/detail?days=${days}`),
  remove: (id: number) => fetchApi<{ ok: boolean }>(`/watchlist/${id}`, { method: "DELETE" }),
};

/** AI 추천 → 지켜보기 (종목코드 자동 조회 후 등록) */
export async function addRecommendationToWatchlist(
  rec: StockRecommendation,
  opts?: { sector?: string; source_type?: string },
): Promise<WatchlistItem> {
  let symbol = rec.symbol ?? undefined;
  let stockName = rec.stock_name;
  if (!symbol) {
    const looked = await watchlistApi.lookupName(rec.stock_name);
    symbol = looked.symbol;
    stockName = looked.stock_name || stockName;
  }
  const src = rec.sources?.[0];
  if (symbol.length === 6) {
    return watchlistApi.addBySymbol({
      symbol,
      stock_name: stockName,
    });
  }
  return watchlistApi.add({
    stock_name: stockName,
    symbol,
    sector: rec.sector || opts?.sector,
    source_type: opts?.source_type ?? src?.type ?? "sector",
    source_id: src?.id,
  });
}
