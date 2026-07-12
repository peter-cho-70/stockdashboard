export interface SecuritiesOverlapWarning {
  securitiesCash: number;
  stockHoldings: number;
  ratio: number;
}

export function detectSecuritiesOverlap(
  securitiesCash: number,
  stockHoldings: number,
  threshold = 0.85
): SecuritiesOverlapWarning | null {
  if (stockHoldings <= 0 || securitiesCash <= 0) return null;
  const ratio = securitiesCash / stockHoldings;
  if (ratio < threshold) return null;
  return { securitiesCash, stockHoldings, ratio };
}

export function securitiesOverlapMessage(w: SecuritiesOverlapWarning): string {
  const fmt = (n: number) =>
    new Intl.NumberFormat("ko-KR", {
      style: "currency",
      currency: "KRW",
    }).format(n);
  return `증권 예수금(${fmt(w.securitiesCash)})이 StockMind 보유주식(${fmt(w.stockHoldings)})과 유사합니다. 예수금만 입력하세요 — 주식 평가액은 StockMind에서 자동 반영됩니다.`;
}
