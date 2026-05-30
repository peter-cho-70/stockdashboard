const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api";

async function fetchApi<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(err || `HTTP ${res.status}`);
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
  analyzeContent: (payload: { url?: string; text?: string; title?: string; channel_name?: string }) =>
    fetchApi<AnalysisResult>("/intel/analyze", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  getIntelContents: (sourceType?: string) =>
    fetchApi<IntelContent[]>(
      `/intel/contents${sourceType ? `?source_type=${sourceType}` : ""}`
    ),
  getStockIssues: (symbol: string) =>
    fetchApi<StockIssues>(`/intel/stocks/${symbol}/issues`),

  // ── 헬스 ──────────────────────────────────────
  health: () => fetchApi<{ status: string }>("/health"),
};

export interface Alert {
  id: number;
  symbol: string;
  type: "PRICE_SURGE" | "PRICE_DROP" | "NEWS";
  message: string;
  change_rate: number;
  is_read: boolean;
  created_at: string;
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
  logs: AnalysisLog[];
}

export interface IntelContent {
  id: number;
  source_type: string;
  source_url: string | null;
  source_title: string | null;
  channel_name: string | null;
  summary: string | null;
  mentioned_stocks: string[];
  mentioned_sectors: string[];
  macro_analysis?: MacroAnalysis;
  sector_analysis?: SectorAnalysisItem[];
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
}

export interface StockIssues {
  symbol: string;
  name: string;
  issues: StockIssueTimeline[];
}
