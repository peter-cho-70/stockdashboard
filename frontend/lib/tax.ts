// 국내주식 매도 세금·수수료 근사치 (backend/core/tax.py와 동일한 값 유지)
export const SELL_TAX_RATE = 0.0018; // 증권거래세+농어촌특별세
export const FEE_RATE = 0.00015; // 매도 수수료(편도, 평균 추정치)

export function netSellProceeds(qty: number, price: number): number {
  return qty * price * (1 - SELL_TAX_RATE - FEE_RATE);
}
