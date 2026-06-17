import { api, marketApi, watchlistApi, type StockItem } from "@/lib/api";

/** 차트 조회 전 DB에 Stock 행 확보 (여러 API 순차 시도) */
export async function ensureStockForChart(
  symbol: string,
  stockName?: string,
): Promise<StockItem> {
  const sym = symbol.trim();
  const name = (stockName || sym).trim();

  try {
    const res = await marketApi.ensureKrStock(sym);
    return res.stock;
  } catch {
    /* market router 미배포 시 portfolio 경로 시도 */
  }

  try {
    const res = await api.ensureStock(sym);
    return res.stock;
  } catch {
    /* 최종 fallback: 관심종목 등록으로 Stock 행 생성 */
  }

  await watchlistApi.addBySymbol({ symbol: sym, stock_name: name });
  const lookup = await watchlistApi.lookupSymbol(sym);
  return {
    id: 0,
    symbol: sym,
    name: lookup.stock_name || name,
    market: "KRX",
    sector: lookup.sector,
    currency: "KRW",
    qty: 0,
    avg_price: 0,
    current_price: lookup.current_price ?? 0,
    change_rate: 0,
    profit_rate: 0,
    memo: null,
    last_synced_at: null,
  };
}
