const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api";

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `HTTP ${res.status}`);
  }
  return res.json();
}

export interface MorningSnapshot {
  nasdaq: number | null;
  sp500: number | null;
  dow: number | null;
  sox: number | null;
  vix: number | null;
  us10y_yield: number | null;
  dxy: number | null;
  usd_krw: number | null;
  wti: number | null;
  fetched_at: string | null;
}

export interface MacroJudgmentPayload {
  nasdaq?: number | null;
  sp500?: number | null;
  vix?: number | null;
  us10y_yield?: number | null;
  dxy?: number | null;
  usd_krw?: number | null;
  wti?: number | null;
  news_types?: string[];
  news_memo?: string;
}

export const morningApi = {
  getSnapshot: () => req<MorningSnapshot>("/morning/snapshot"),
  getMacroJudgment: (payload: MacroJudgmentPayload) =>
    req<{ judgment: string }>("/morning/macro-judgment", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
};
