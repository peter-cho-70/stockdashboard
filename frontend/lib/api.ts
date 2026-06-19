const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api";

const REPORT_GENERATE_TIMEOUT_MS = 300_000;

function networkErrorMessage(err: unknown): string {
  if (err instanceof TypeError && /fetch/i.test(err.message)) {
    return "서버에 연결할 수 없습니다. 백엔드가 실행 중인지 확인해 주세요.";
  }
  if (err instanceof DOMException && err.name === "TimeoutError") {
    return "요청 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.";
  }
  if (err instanceof Error) return err.message;
  return "요청 실패";
}

async function fetchApi<T>(path: string, init?: RequestInit): Promise<T> {
  try {
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
  } catch (err) {
    if (err instanceof Error && err.message !== "Failed to fetch") throw err;
    throw new Error(networkErrorMessage(err));
  }
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
  target_buy_price?: number | null;
  target_sell_price?: number | null;
  target_buy_hit?: boolean;
  target_sell_hit?: boolean;
  target_buy_gap_pct?: number | null;
  target_sell_gap_pct?: number | null;
}

export interface SectorPeerStock {
  symbol: string;
  name: string;
  market: string;
  current_price: number;
  change_rate: number;
  is_holding: boolean;
  is_watched: boolean;
}

export interface SectorPeersResponse {
  sector: string | null;
  peers: SectorPeerStock[];
}

export interface CoMentionedStock {
  symbol: string | null;
  name: string;
  current_price: number | null;
  change_rate: number | null;
  mention_count: number;
  latest_date: string;
  sentiment: "POSITIVE" | "NEUTRAL" | "NEGATIVE" | string;
  is_holding: boolean;
}

export interface CoMentionedResponse {
  symbol: string;
  name: string;
  days: number;
  peers: CoMentionedStock[];
}

export interface StockGroupMember {
  symbol: string;
  name: string;
  current_price: number | null;
  change_rate: number | null;
  is_holding: boolean;
}

export interface StockGroup {
  id: number;
  name: string;
  created_at: string | null;
  members: StockGroupMember[];
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
  target_buy_price?: number;
  target_sell_price?: number;
}

export interface PortfolioTradePayload {
  side: "BUY" | "SELL";
  qty: number;
  price: number;
  traded_at?: string;
  memo?: string;
}

export interface MixedTradePayload {
  sell_qty?: number;
  sell_price?: number;
  buy_qty?: number;
  buy_price?: number;
  traded_at?: string;
  memo?: string;
}

export interface TradeWhatIfCreatePayload {
  sell_symbol?: string;
  sell_qty?: number;
  sell_price?: number;
  sell_date?: string;
  sell_trade_id?: number;
  sell_trade_ids?: number[];
  buy_symbol?: string;
  buy_qty?: number;
  buy_price?: number;
  buy_date?: string;
  buy_trade_id?: number;
  memo?: string;
}

export interface TradeWhatIfItem {
  id: number;
  source: "virtual" | "real";
  sell_symbol: string;
  sell_name: string | null;
  sell_qty: number;
  sell_price: number;
  sell_avg_price: number | null;
  sell_date: string;
  sell_trade_ids?: number[] | null;
  sell_trade_count?: number | null;
  sell_compare_price: number;
  holding_opportunity: number;
  realized_if_sold?: number;
  buy_symbol?: string | null;
  buy_name?: string | null;
  buy_qty?: number | null;
  buy_price?: number | null;
  buy_date?: string | null;
  buy_compare_price?: number;
  buy_pnl?: number;
  switch_advantage?: number;
  memo: string | null;
  created_at: string | null;
  as_of: string;
  error?: string;
}

export interface AllTradeItem {
  id: number;
  symbol: string;
  name: string;
  side: "BUY" | "SELL";
  qty: number;
  price: number;
  amount: number;
  traded_at: string;
  source: string;
  memo: string | null;
  realized_pnl: number | null;
  realized_pnl_estimated: boolean;
  realized_avg_price: number | null;
}

export interface RecentTradeForWhatIf {
  trade_id: number;
  symbol: string;
  name: string;
  qty: number;
  price: number;
  traded_at: string;
  memo: string | null;
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

export interface FinanceHubState {
  cashAssets: import("@/lib/finance/types").CashAsset[];
  illiquidAssets: import("@/lib/finance/types").IlliquidAsset[];
  realEstateAssets: import("@/lib/finance/types").RealEstateAsset[];
  liabilities: import("@/lib/finance/types").Liability[];
  fixedExpenses: import("@/lib/finance/types").FixedExpense[];
  incomes: import("@/lib/finance/types").Income[];
  fundingNeeds: import("@/lib/finance/types").FundingNeed[];
}

export interface FinanceLedgerState {
  transactions: import("@/lib/finance/types").Transaction[];
  budgets: import("@/lib/finance/types").Budget[];
  settings: import("@/lib/finance/types").LedgerSettings;
}

export interface FinanceStockSnapshot {
  total_value: number;
  total_purchase: number;
  total_profit: number;
  total_profit_rate: number;
  stock_count: number;
  updated_at: string;
}

export const api = {
  getPortfolioSummary: () => fetchApi<PortfolioSummary>("/portfolio/summary"),
  getStocks: () => fetchApi<StockItem[]>("/portfolio/stocks"),
  syncNow: () => fetchApi<unknown>("/portfolio/sync/now", { method: "POST" }),
  syncTradeHistory: (opts: number | { days?: number; start?: string; end?: string } = 90) => {
    const params = typeof opts === "number" ? { days: opts } : opts;
    const qs = new URLSearchParams();
    if (params.start) qs.set("start", params.start);
    if (params.end) qs.set("end", params.end);
    if (!params.start && params.days) qs.set("days", String(params.days));
    return fetchApi<{
      message: string;
      added: number;
      skipped: number;
      fetched?: number;
      years?: Record<string, number>;
      start?: string;
      end?: string;
    }>(
      `/portfolio/sync/trades?${qs.toString()}`,
      { method: "POST" },
    );
  },
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
  createMixedTrade: (symbol: string, body: MixedTradePayload) =>
    fetchApi<{ message: string; stock: StockItem; realized_pnl: number; trades: PortfolioTradeItem[] }>(
      `/portfolio/stocks/${symbol}/trades/mixed`,
      { method: "POST", body: JSON.stringify(body) },
    ),
  getStockTrades: (symbol: string, limit = 30) =>
    fetchApi<{ symbol: string; trades: PortfolioTradeItem[] }>(
      `/portfolio/stocks/${symbol}/trades?limit=${limit}`,
    ),
  getRecentTradesForWhatIf: (
    side: "SELL" | "BUY",
    opts: {
      limit?: number;
      symbol?: string;
      start?: string;
      end?: string;
    } = {},
  ) => {
    const qs = new URLSearchParams({ side });
    if (opts.limit) qs.set("limit", String(opts.limit));
    if (opts.symbol) qs.set("symbol", opts.symbol);
    if (opts.start) qs.set("start", opts.start);
    if (opts.end) qs.set("end", opts.end);
    return fetchApi<{ trades: RecentTradeForWhatIf[] }>(
      `/portfolio/trade-what-ifs/recent-trades?${qs.toString()}`,
    );
  },
  createTradeWhatIf: (body: TradeWhatIfCreatePayload) =>
    fetchApi<{ message: string; trade: TradeWhatIfItem }>("/portfolio/trade-what-ifs", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  getTradeWhatIfs: (asOf?: string) =>
    fetchApi<{ trades: TradeWhatIfItem[] }>(
      `/portfolio/trade-what-ifs${asOf ? `?as_of=${asOf}` : ""}`,
    ),
  deleteTradeWhatIf: (id: number) =>
    fetchApi<{ message: string }>(`/portfolio/trade-what-ifs/${id}`, { method: "DELETE" }),
  getAllTrades: (params: {
    side?: "BUY" | "SELL";
    symbol?: string;
    source?: string;
    start?: string;
    end?: string;
    limit?: number;
    offset?: number;
  } = {}) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== "") qs.set(k, String(v));
    });
    return fetchApi<{ trades: AllTradeItem[]; total: number }>(
      `/portfolio/trades${qs.toString() ? `?${qs.toString()}` : ""}`,
    );
  },
  getPriceOnDate: (symbol: string, date?: string) =>
    fetchApi<{ symbol: string; date: string | null; price: number }>(
      `/portfolio/stocks/${symbol}/price-on-date${date ? `?date=${date}` : ""}`,
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
  /** 차트 조회용 임시 등록 (qty=0, 보유 목록 제외) */
  ensureStock: (symbol: string) =>
    fetchApi<{ message: string; created: boolean; stock: StockItem }>(
      `/portfolio/stocks/${encodeURIComponent(symbol)}/ensure`,
      { method: "POST" },
    ),
  /** 같은 섹터의 다른 보유·관심 종목 묶어보기 */
  getRelatedSectorStocks: (symbol: string, limit = 12) =>
    fetchApi<SectorPeersResponse>(
      `/portfolio/stocks/${encodeURIComponent(symbol)}/related-sector?limit=${limit}`,
    ),

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

  patchIntelHighlights: (id: number, highlights: UserHighlights) =>
    fetchApi<{ ok: boolean; user_highlights: UserHighlights }>(
      `/intel/contents/${id}/highlights`,
      { method: "PATCH", body: JSON.stringify(highlights) },
    ),
  setIntelContentScope: (id: number, scope: "knowledge" | "market") =>
    fetchApi<{ ok: boolean; content: IntelContent }>(`/intel/contents/${id}/scope`, {
      method: "PATCH",
      body: JSON.stringify({ scope }),
    }),
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

  // ── 재정허브 ──────────────────────────────────
  getFinanceState: () => fetchApi<FinanceHubState>("/finance/state"),
  saveFinanceState: (body: FinanceHubState) =>
    fetchApi<FinanceHubState>("/finance/state", {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  resetFinanceState: () =>
    fetchApi<FinanceHubState>("/finance/state", { method: "DELETE" }),
  getLedgerState: () => fetchApi<FinanceLedgerState>("/finance/ledger"),
  saveLedgerState: (body: FinanceLedgerState) =>
    fetchApi<FinanceLedgerState>("/finance/ledger", {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  resetLedgerState: () =>
    fetchApi<FinanceLedgerState>("/finance/ledger", { method: "DELETE" }),
  getFinanceStockSnapshot: () =>
    fetchApi<FinanceStockSnapshot>("/finance/stock-snapshot"),

  // ── 헬스 ──────────────────────────────────────
  health: () => fetchApi<{ status: string; demo_mode?: boolean }>("/health"),
};

export interface DemoModeStatus {
  demo_mode: boolean;
  source: "database" | "env";
  env_default: boolean;
  pin_configured: boolean;
  message?: string;
}

export const settingsApi = {
  getDemoMode: () => fetchApi<DemoModeStatus>("/settings/demo-mode"),
  setDemoMode: (enabled: boolean, pin: string) =>
    fetchApi<DemoModeStatus>("/settings/demo-mode", {
      method: "PATCH",
      body: JSON.stringify({ enabled, pin }),
    }),
};

export interface DbBackupSummary {
  tables: string[];
  counts: Record<string, number>;
}

export interface DbInfo {
  db_path: string;
  exists: boolean;
  backup_dir: string;
  backup_count: number;
  size_bytes?: number;
  modified_at?: string;
  summary?: DbBackupSummary;
}

export interface DbBackupItem {
  filename: string;
  label: string;
  created_at: string;
  size_bytes: number;
}

export const systemApi = {
  getDbInfo: () => fetchApi<DbInfo>("/system/db"),
  listBackups: () =>
    fetchApi<{ backups: DbBackupItem[]; db: DbInfo }>("/system/db/backups"),
  createBackup: (label = "manual") =>
    fetchApi<{ backup: DbBackupItem & { summary?: DbBackupSummary }; backups: DbBackupItem[] }>(
      "/system/db/backups",
      { method: "POST", body: JSON.stringify({ label }) },
    ),
  restoreBackup: (filename: string) =>
    fetchApi<{
      ok: boolean;
      restored_from: string;
      pre_restore_backup: string | null;
      message: string;
      summary?: DbBackupSummary;
    }>("/system/db/restore", {
      method: "POST",
      body: JSON.stringify({ filename }),
    }),
  deleteBackup: (filename: string) =>
    fetchApi<{ ok: boolean; backups: DbBackupItem[] }>(
      `/system/db/backups/${encodeURIComponent(filename)}`,
      { method: "DELETE" },
    ),
  devRestart: (label = "pre_restart") =>
    fetchApi<{ ok: boolean; message: string; backup: DbBackupItem }>(
      "/system/dev/restart",
      { method: "POST", body: JSON.stringify({ label }) },
    ),
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
  type: "PRICE_SURGE" | "PRICE_DROP" | "NEWS" | "TARGET_BUY" | "TARGET_SELL";
  message: string;
  change_rate: number;
  is_read: boolean;
  created_at: string;
  created_at_kst?: string | null;
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

export interface KeyPointItem {
  text: string;
  importance?: "high" | "normal" | "low";
  by?: "ai" | "user";
}

export interface UserHighlights {
  pinned_key_point_indexes: number[];
  user_key_points: string[];
  snippets: {
    id: string;
    field: string;
    text: string;
    note?: string;
    color?: string;
    created_at?: string;
  }[];
}

export interface AnalysisResult {
  id: number;
  source_type: string;
  source_url?: string | null;
  source_title?: string | null;
  summary: string;
  key_points: (string | KeyPointItem)[];
  mentioned_stocks: string[];
  mentioned_sectors: string[];
  keywords: string[];
  sentiment: "POSITIVE" | "NEUTRAL" | "NEGATIVE";
  analyzed_at: string | null;
  stock_issues: StockIssueItem[];
  macro_analysis: MacroAnalysis;
  sector_analysis: SectorAnalysisItem[];
  source_document?: string | null;
  content_scope?: "knowledge" | "market" | string;
  user_highlights?: UserHighlights;
  logs: AnalysisLog[];
}

export interface IntelContent {
  id: number;
  source_type: string;
  source_url: string | null;
  source_title: string | null;
  channel_name: string | null;
  summary: string | null;
  key_points?: (string | KeyPointItem)[];
  user_highlights?: UserHighlights;
  keywords?: string[];
  mentioned_stocks: string[];
  mentioned_sectors: string[];
  macro_analysis?: MacroAnalysis;
  sector_analysis?: SectorAnalysisItem[];
  stock_issues?: StockIssueItem[];
  source_document?: string | null;
  sentiment: string | null;
  analyzed_at: string | null;
  content_scope?: "knowledge" | "market" | string;
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

export interface SignalAccuracyBucket {
  hit_rate: number | null;
  sample_count: number;
  avg_magnitude?: number | null;
  insufficient_data?: boolean;
}

export interface SignalAccuracyBlock {
  overall_hit_rate: number | null;
  sample_count: number;
  avg_magnitude?: number | null;
  by_check_days: Record<string, SignalAccuracyBucket>;
  by_sector?: Record<string, SignalAccuracyBucket>;
  by_topic?: Record<string, SignalAccuracyBucket>;
  best_check_days?: number;
  insufficient_data?: boolean;
}

export interface LeadLagBucket {
  sample_count: number;
  avg_lead_days: number | null;
  median_lead_days: number | null;
  pct_signal_leads: number | null;
  insufficient_data?: boolean;
}

export interface LeadLagSummary {
  window_days: number;
  total_pairs: number;
  aligned_only: boolean;
  by_type: Record<string, LeadLagBucket>;
  by_sector: Record<string, Record<string, LeadLagBucket>>;
  by_macro_topic: Record<string, LeadLagBucket>;
  insights: string[];
  min_sample: number;
  disclaimer: string;
}

export interface SignalAccuracyResponse {
  sector: SignalAccuracyBlock;
  macro: SignalAccuracyBlock;
  stock: SignalAccuracyBlock;
  best_signal_window_days: number | null;
  total_outcomes: number;
  disclaimer: string;
  min_sample_for_rate: number;
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
  getCoMentioned: (symbol: string, days = 90, limit = 10) =>
    fetchApi<CoMentionedResponse>(
      `/intel/stocks/${symbol}/co-mentioned?days=${days}&limit=${limit}`,
    ),
  backfill: () => fetchApi<{ ok: boolean; result: Record<string, number> }>("/intel/signals/backfill", { method: "POST" }),
  getSignalAccuracy: () => fetchApi<SignalAccuracyResponse>("/intel/signal-accuracy"),
  evaluateSignalOutcomes: () =>
    fetchApi<{ ok: boolean; evaluation: Record<string, number>; accuracy: SignalAccuracyResponse }>(
      "/intel/signal-outcomes/evaluate",
      { method: "POST" },
    ),
  getLeadLag: (params?: { sector?: string; symbol?: string; aligned_only?: boolean; window_days?: number }) => {
    const q = new URLSearchParams();
    if (params?.sector) q.set("sector", params.sector);
    if (params?.symbol) q.set("symbol", params.symbol);
    if (params?.aligned_only === false) q.set("aligned_only", "false");
    if (params?.window_days) q.set("window_days", String(params.window_days));
    const qs = q.toString();
    return fetchApi<LeadLagSummary>(`/intel/lead-lag${qs ? `?${qs}` : ""}`);
  },
  computeLeadLag: (windowDays = 15) =>
    fetchApi<{ ok: boolean; computation: Record<string, number>; summary: LeadLagSummary }>(
      `/intel/lead-lag/compute?window_days=${windowDays}`,
      { method: "POST" },
    ),
  getRecommendations: (days = 30, sector?: string) =>
    fetchApi<{ days: number; sector: string | null; total: number; recommendations: StockRecommendation[] }>(
      `/intel/recommendations?days=${days}${sector ? `&sector=${encodeURIComponent(sector)}` : ""}`,
    ),
};

// ── 목표가 · 미국 리포트 ─────────────────────────────────
export interface PriceTarget {
  id: number;
  symbol: string;
  source: string;
  analyst: string | null;
  target_price: number;
  rating: string | null;
  report_date: string | null;
  currency: string;
  is_consensus: boolean;
  source_url: string | null;
  source_title: string | null;
  notes: string | null;
  fetched_at: string | null;
}

export interface PriceTargetSearchArticle {
  title: string;
  url: string;
  published?: string | null;
  snippet?: string | null;
  used_in_target?: boolean;
}

export interface KisSupplyCheck {
  available: boolean;
  passed: number;
  total: number;
  latest_date?: string | null;
  items: { label: string; passed: boolean; unavailable?: boolean }[];
}

export interface KisInvestOpinion {
  report_date: string | null;
  broker: string;
  rating: string | null;
  prev_rating?: string | null;
  target_price: number | null;
  prev_close?: number | null;
  upside_pct?: number | null;
  source?: string;
}

export interface KisInvestorTrendRow {
  date: string | null;
  close?: number | null;
  change?: number | null;
  foreign_net_qty?: number | null;
  institution_net_qty?: number | null;
  personal_net_qty?: number | null;
  foreign_net_amount?: number | null;
  institution_net_amount?: number | null;
}

export interface KisInvestInfo {
  symbol: string;
  source: string;
  fetched_at: string;
  opinions: KisInvestOpinion[];
  opinions_by_broker: KisInvestOpinion[];
  investor_trend: KisInvestorTrendRow[];
  supply_check: KisSupplyCheck;
}

export interface StockInvestmentInfo {
  market_cap?: string | null;
  market_cap_rank?: string | null;
  listed_shares?: string | null;
  face_value_trading_unit?: string | null;
  foreign_limit_shares?: string | null;
  foreign_held_shares?: string | null;
  foreign_exhaustion_rate?: string | null;
  foreign_holding_rate?: string | null;
  consensus_rating?: string | null;
  consensus_target_price?: string | null;
  consensus_rating_score?: string | null;
  consensus_target_price_numeric?: string | null;
  week52_range?: string | null;
  week52_high?: string | null;
  week52_low?: string | null;
  per_eps?: string | null;
  forward_per_eps?: string | null;
  pbr_bps?: string | null;
  per?: string | null;
  eps?: string | null;
  forward_per?: string | null;
  forward_eps?: string | null;
  pbr?: string | null;
  bps?: string | null;
  dividend_yield?: string | null;
  industry_per?: string | null;
  industry_change_pct?: string | null;
  consensus_date?: string | null;
  consensus_opinion_line?: string | null;
  dividend_amount?: string | null;
  trading_volume?: string | null;
  trading_value?: string | null;
  table_rows?: StockBasicsTableRow[];
  [key: string]: string | null | StockBasicsTableRow[] | undefined;
}

export interface StockBasicsNewsItem {
  title: string;
  url: string;
  published?: string;
}

export interface StockBasicsTableRow {
  label: string;
  value: string;
}

export interface StockQuoteSnapshot {
  close_price?: string | null;
  change?: string | null;
  change_pct?: string | null;
  change_direction?: string | null;
  market_status?: string | null;
  traded_at?: string | null;
  exchange?: string | null;
  items?: StockBasicsTableRow[];
  [key: string]: string | null | StockBasicsTableRow[] | undefined;
}

export interface StockInvestorTrendRow {
  date?: string;
  close_price?: string | null;
  change?: string | null;
  change_direction?: string | null;
  volume?: string | null;
  foreign_net_buy?: string | null;
  foreign_holding_rate?: string | null;
  institution_net_buy?: string | null;
  individual_net_buy?: string | null;
}

export interface StockFinancePeriod {
  key?: string;
  title?: string;
  is_consensus?: boolean;
}

export interface StockFinanceRow {
  title?: string;
  columns?: Record<string, string | null | undefined>;
}

export interface StockFinanceTable {
  period_type?: string;
  periods?: StockFinancePeriod[];
  rows?: StockFinanceRow[];
}

export interface StockIndustryPeer {
  symbol?: string;
  name?: string;
  close_price?: string | null;
  change_pct?: string | null;
  change_direction?: string | null;
  market_cap?: string | null;
}

export interface StockResearchReport {
  broker?: string | null;
  title?: string | null;
  date?: string | null;
  target_price?: string | null;
  report_id?: number | null;
}

export interface StockBasics {
  symbol: string;
  name: string;
  source: string;
  fetched_at: string;
  investment_info: StockInvestmentInfo;
  quote?: StockQuoteSnapshot;
  investment_table?: StockBasicsTableRow[];
  quote_table?: StockBasicsTableRow[];
  investor_trends?: StockInvestorTrendRow[];
  financials?: {
    annual?: StockFinanceTable;
    quarterly?: StockFinanceTable;
  };
  industry_peers?: StockIndustryPeer[];
  research_reports?: StockResearchReport[];
  corporation_summary?: Record<string, string>;
  overview: string;
  news: StockBasicsNewsItem[];
}

export interface VolatilityIssue {
  date: string;
  period: "daily" | "weekly";
  change_pct: number;
  direction: "up" | "down";
  close?: number;
  label: string;
  reason?: string;
  cause_source?: string;
  confidence?: string | null;
  key_factors?: string[];
  week_start?: string;
  week_end?: string;
  week_key?: string;
  summary?: string;
  daily_moves_in_week?: number;
  related_issues?: {
    summary: string;
    sentiment: string | null;
    source_title?: string | null;
    source_url?: string | null;
  }[];
}

export interface HoldingsAnalysis {
  symbol: string;
  name: string;
  is_holding: boolean;
  eligible: boolean;
  message?: string;
  qty?: number;
  avg_price?: number;
  current_price?: number;
  profit_rate?: number;
  headline?: string;
  investment_info?: StockInvestmentInfo;
  quote?: StockQuoteSnapshot;
  investment_table?: StockBasicsTableRow[];
  quote_table?: StockBasicsTableRow[];
  investor_trends?: StockInvestorTrendRow[];
  financials?: {
    annual?: StockFinanceTable;
    quarterly?: StockFinanceTable;
  };
  industry_peers?: StockIndustryPeer[];
  research_reports?: StockResearchReport[];
  corporation_summary?: Record<string, string>;
  overview?: string;
  news?: StockBasicsNewsItem[];
  daily_issues?: VolatilityIssue[];
  weekly_issues?: VolatilityIssue[];
  fetched_at?: string;
  source?: string;
}

export interface UsMarketQuote {
  name: string;
  ticker?: string;
  category?: string;
  unit?: "index" | "fx" | "yield" | "price" | "stock" | "futures";
  close?: number;
  change_pct?: number;
  change?: number;
  date?: string;
  as_of?: string;
  as_of_label?: string;
  error?: string;
}

export type UsMarketInterpretationTopic =
  | "us_indices"
  | "commodity"
  | "fx"
  | "treasury"
  | "us_stocks";

export interface UsMarketInterpretation {
  summary?: string;
  bullets?: string[];
  source_indexes?: number[];
}

export interface UsMarketArticle {
  index: number;
  topic: UsMarketInterpretationTopic;
  title: string;
  url: string;
  published?: string | null;
  published_at?: string | null;
  snippet?: string | null;
}

export interface UsMarketLiveSnapshot {
  us_indices: UsMarketQuote[];
  us_futures: UsMarketQuote[];
  commodity: UsMarketQuote[];
  fx: UsMarketQuote[];
  treasury: UsMarketQuote[];
  us_stocks: UsMarketQuote[];
  articles: UsMarketArticle[];
  quote_mode: "futures_daytime" | "cash_close";
  fetched_at: string;
  fetched_at_label: string;
}

export interface UsMarketSnapshot {
  us_indices: UsMarketQuote[];
  us_futures?: UsMarketQuote[];
  commodity: UsMarketQuote[];
  fx: UsMarketQuote[];
  treasury: UsMarketQuote[];
  us_stocks: UsMarketQuote[];
  interpretations: Partial<Record<UsMarketInterpretationTopic, UsMarketInterpretation>>;
  articles: UsMarketArticle[];
}

export interface KrMarketMover {
  symbol: string;
  name: string;
  close?: number | null;
  change_pct?: number | null;
  /** 외국인·기관 순매수/순매도 금액 (억원) */
  net_amount_억?: number | null;
  volume?: number | null;
  market?: string;
}

export interface KrMarketSector {
  name: string;
  change_pct: number;
  theme_no?: string | null;
  kind?: string;
  group_no?: string | null;
}

export interface KrMarketPopularItem {
  rank: number;
  symbol: string;
  name: string;
  close?: number | null;
}

export interface KrMarketChartPoint {
  time: string;
  price: number;
  volume: number;
}

export interface KrMarketInvestorFlow {
  label: string;
  buy: KrMarketMover[];
  sell: KrMarketMover[];
}

export interface KrMarketBreadth {
  individual_net_억?: number;
  foreign_net_억?: number;
  institution_net_억?: number;
  limit_up?: number;
  advancers?: number;
  unchanged?: number;
  decliners?: number;
  limit_down?: number;
}

export interface KrMarketSnapshot {
  session_date: string;
  indices: UsMarketQuote[];
  macro?: UsMarketQuote[];
  market_stats?: {
    kospi?: KrMarketBreadth;
    kosdaq?: KrMarketBreadth;
  };
  movers?: {
    kospi?: { gainers: KrMarketMover[]; losers: KrMarketMover[] };
    kosdaq?: { gainers: KrMarketMover[]; losers: KrMarketMover[] };
    hot_gainers?: KrMarketMover[];
  };
  sectors?: KrMarketSector[];
  industries?: KrMarketSector[];
  rankings?: {
    upper_limit?: { kospi?: KrMarketMover[]; kosdaq?: KrMarketMover[] };
    volume?: { kospi?: KrMarketMover[]; kosdaq?: KrMarketMover[] };
  };
  investor_flow?: {
    foreign?: KrMarketInvestorFlow;
    institution?: KrMarketInvestorFlow;
  };
  popular_search?: KrMarketPopularItem[];
  index_chart?: {
    kospi?: KrMarketChartPoint[];
    kosdaq?: KrMarketChartPoint[];
  };
  fetched_at: string;
  fetched_at_label: string;
  source: string;
}

export interface UsMarketReport {
  id: number;
  report_date: string;
  session_date: string | null;
  snapshot?: UsMarketSnapshot;
  indices: UsMarketQuote[];
  interpretations?: Partial<Record<UsMarketInterpretationTopic, UsMarketInterpretation>>;
  articles?: UsMarketArticle[];
  highlights: string[];
  body_markdown: string | null;
  status: string;
  error_message: string | null;
  model: string | null;
  generated_at: string | null;
  generated_at_kst?: string | null;
}

export interface TradeMonthlyReport {
  id: number;
  report_month: string;
  ref_yyyymm: string | null;
  revision?: string;
  summary: Record<string, unknown>[];
  countries: Record<string, unknown>[];
  items: Record<string, unknown>[];
  analyses: {
    summary_trend?: string;
    country_trade?: string;
    sector_items?: string;
    integrated?: string;
  };
  highlights: string[];
  body_markdown: string | null;
  status: string;
  error_message: string | null;
  model: string | null;
  generated_at: string | null;
}

const EMPTY_US_SNAPSHOT = (): UsMarketSnapshot => ({
  us_indices: [],
  us_futures: [],
  commodity: [],
  fx: [],
  treasury: [],
  us_stocks: [],
  interpretations: {},
  articles: [],
});

export function normalizeUsSnapshot(report: UsMarketReport): UsMarketSnapshot {
  const interpretations =
    report.interpretations ?? report.snapshot?.interpretations ?? {};
  const articles = report.articles ?? report.snapshot?.articles ?? [];

  if (report.snapshot) {
    return {
      ...EMPTY_US_SNAPSHOT(),
      ...report.snapshot,
      us_futures: report.snapshot.us_futures ?? [],
      us_stocks: report.snapshot.us_stocks ?? [],
      interpretations,
      articles,
    };
  }
  const snap = EMPTY_US_SNAPSHOT();
  snap.interpretations = interpretations;
  snap.articles = articles;
  for (const item of report.indices ?? []) {
    const cat = item.category ?? "us_index";
    if (cat === "commodity") snap.commodity.push(item);
    else if (cat === "fx") snap.fx.push(item);
    else if (cat === "treasury") snap.treasury.push(item);
    else if (cat === "us_stock") snap.us_stocks.push(item);
    else if (cat === "us_futures") (snap.us_futures ??= []).push(item);
    else snap.us_indices.push(item);
  }
  return snap;
}

const ANALYST_TARGET_COLORS = ["#8b5cf6", "#f59e0b", "#14b8a6", "#ec4899", "#6366f1"];

export function analystTargetColor(index: number, isConsensus?: boolean): string {
  if (isConsensus) return "#9333ea";
  return ANALYST_TARGET_COLORS[index % ANALYST_TARGET_COLORS.length];
}

export const marketApi = {
  getPriceTargets: (symbol: string) =>
    fetchApi<{ symbol: string; targets: PriceTarget[] }>(
      `/stocks/${encodeURIComponent(symbol)}/price-targets`,
    ),

  fetchPriceTargets: (symbol: string) =>
    fetchApi<{
      symbol: string;
      name: string;
      fetched_count: number;
      disclaimer: string;
      message?: string;
      search_articles: PriceTargetSearchArticle[];
      targets: PriceTarget[];
    }>(`/stocks/${encodeURIComponent(symbol)}/price-targets/fetch`, { method: "POST" }),

  fetchKisPriceTargets: (symbol: string) =>
    fetchApi<{
      symbol: string;
      name: string;
      fetched_count: number;
      disclaimer: string;
      kis_invest_info?: {
        supply_check: KisSupplyCheck;
        investor_trend: KisInvestorTrendRow[];
        opinion_count: number;
      };
      targets: PriceTarget[];
    }>(`/stocks/${encodeURIComponent(symbol)}/price-targets/fetch-kis`, { method: "POST" }),

  getKisInvestInfo: (symbol: string) =>
    fetchApi<KisInvestInfo>(`/stocks/${encodeURIComponent(symbol)}/kis-invest-info`),

  getStockBasics: (symbol: string) =>
    fetchApi<StockBasics>(`/stocks/${encodeURIComponent(symbol)}/basics`),

  getHoldingsAnalysis: (symbol: string) =>
    fetchApi<HoldingsAnalysis>(`/stocks/${encodeURIComponent(symbol)}/holdings-analysis`),

  addPriceTarget: (
    symbol: string,
    body: {
      source: string;
      target_price: number;
      analyst?: string;
      rating?: string;
      report_date?: string;
      is_consensus?: boolean;
    },
  ) =>
    fetchApi<PriceTarget>(`/stocks/${encodeURIComponent(symbol)}/price-targets`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  deletePriceTarget: (symbol: string, targetId: number) =>
    fetchApi<{ ok: boolean }>(
      `/stocks/${encodeURIComponent(symbol)}/price-targets/${targetId}`,
      { method: "DELETE" },
    ),

  getUsReport: (date?: string) =>
    fetchApi<{ report: UsMarketReport | null }>(
      date
        ? `/reports/us/daily?date=${encodeURIComponent(date)}`
        : "/reports/us/daily?days=7",
    ),

  listUsReports: (days = 7) =>
    fetchApi<{ reports: UsMarketReport[] }>(`/reports/us/daily?days=${days}`),

  generateUsReport: (opts?: { date?: string; force?: boolean }) => {
    const q = new URLSearchParams();
    if (opts?.date) q.set("date", opts.date);
    if (opts?.force) q.set("force", "true");
    const qs = q.toString();
    return fetchApi<{ report: UsMarketReport }>(
      `/reports/us/daily/generate${qs ? `?${qs}` : ""}`,
      {
        method: "POST",
        signal: AbortSignal.timeout(REPORT_GENERATE_TIMEOUT_MS),
      },
    );
  },

  getUsLiveSnapshot: (mode: "auto" | "cash" | "futures" = "auto") =>
    fetchApi<{ snapshot: UsMarketLiveSnapshot }>(
      `/reports/us/daily/live-snapshot?mode=${mode}`,
    ),

  refreshUsReportNews: (opts?: { date?: string; refreshQuotes?: boolean }) => {
    const q = new URLSearchParams();
    if (opts?.date) q.set("date", opts.date);
    if (opts?.refreshQuotes) q.set("refresh_quotes", "true");
    const qs = q.toString();
    return fetchApi<{ report: UsMarketReport }>(
      `/reports/us/daily/refresh-news${qs ? `?${qs}` : ""}`,
      { method: "POST" },
    );
  },

  getKrMarketSnapshot: (force = false) =>
    fetchApi<{ snapshot: KrMarketSnapshot }>(
      `/market/kr/snapshot${force ? "?force=true" : ""}`,
    ),

  getKrGroupStocks: (groupType: "theme" | "upjong", groupNo: string, limit = 10) =>
    fetchApi<{
      group_type: string;
      group_no: string;
      name: string | null;
      stocks: KrMarketMover[];
    }>(
      `/market/kr/group-stocks?group_type=${encodeURIComponent(groupType)}&group_no=${encodeURIComponent(groupNo)}&limit=${limit}`,
    ),

  ensureKrStock: (symbol: string) =>
    fetchApi<{ message: string; created: boolean; stock: StockItem }>(
      `/market/kr/stocks/${encodeURIComponent(symbol)}/ensure`,
      { method: "POST" },
    ),

  getTradeReport: (month: string) =>
    fetchApi<{ report: TradeMonthlyReport | null }>(
      `/reports/trade/monthly?month=${encodeURIComponent(month)}`,
    ),

  listTradeReports: (limit = 12) =>
    fetchApi<{ reports: TradeMonthlyReport[] }>(
      `/reports/trade/monthly?limit=${limit}`,
    ),

  generateTradeReport: async (opts?: { month?: string; force?: boolean }) => {
    const q = new URLSearchParams();
    if (opts?.month) q.set("month", opts.month);
    if (opts?.force) q.set("force", "true");
    const qs = q.toString();
    try {
      const res = await fetch(`${BASE}/reports/trade/monthly/generate${qs ? `?${qs}` : ""}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(REPORT_GENERATE_TIMEOUT_MS),
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
      return res.json() as Promise<{ report: TradeMonthlyReport; warning?: string }>;
    } catch (err) {
      if (err instanceof Error && err.message !== "Failed to fetch") throw err;
      throw new Error(networkErrorMessage(err));
    }
  },
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
  target_sell_price: number | null;
  target_buy_hit: boolean;
  target_sell_hit: boolean;
  target_buy_gap_pct: number | null;
  target_sell_gap_pct: number | null;
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
    target_sell_price?: number;
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
    target_sell_price?: number;
  }) => fetchApi<WatchlistItem>("/watchlist", { method: "POST", body: JSON.stringify(body) }),
  update: (
    id: number,
    body: { memo?: string; target_buy_price?: number; target_sell_price?: number; sector?: string },
  ) => fetchApi<WatchlistItem>(`/watchlist/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  getInsight: (id: number, days = 30) =>
    fetchApi<WatchlistInsight>(`/watchlist/${id}/insight?days=${days}`),
  getDetail: (id: number, days = 90) =>
    fetchApi<WatchlistDetail>(`/watchlist/${id}/detail?days=${days}`),
  remove: (id: number) => fetchApi<{ ok: boolean }>(`/watchlist/${id}`, { method: "DELETE" }),
};

export const groupsApi = {
  getAll: () => fetchApi<{ total: number; groups: StockGroup[] }>("/stock-groups"),
  getBySymbol: (symbol: string) =>
    fetchApi<{ symbol: string; groups: StockGroup[] }>(
      `/stock-groups/by-symbol/${encodeURIComponent(symbol)}`,
    ),
  create: (body: { name: string; symbols?: string[] }) =>
    fetchApi<StockGroup>("/stock-groups", { method: "POST", body: JSON.stringify(body) }),
  rename: (id: number, name: string) =>
    fetchApi<StockGroup>(`/stock-groups/${id}`, { method: "PATCH", body: JSON.stringify({ name }) }),
  addMember: (id: number, body: { symbol?: string; stock_name?: string }) =>
    fetchApi<StockGroup>(`/stock-groups/${id}/members`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  removeMember: (id: number, symbol: string) =>
    fetchApi<StockGroup>(`/stock-groups/${id}/members/${encodeURIComponent(symbol)}`, {
      method: "DELETE",
    }),
  remove: (id: number) => fetchApi<{ ok: boolean }>(`/stock-groups/${id}`, { method: "DELETE" }),
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
