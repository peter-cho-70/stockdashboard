"""
core/tax.py
국내주식 매매 세금·수수료 추정 — 실현손익(세후) 계산용

세율은 종목·증권사별로 다를 수 있어 근사값을 사용한다:
- SELL_TAX_RATE: 증권거래세+농어촌특별세 (코스피/코스닥 통합, 2024년 기준 약 0.18%)
- FEE_RATE: 증권사 거래 수수료 (편도, 평균 추정치) — 매수·매도 모두 적용
"""
SELL_TAX_RATE = 0.0018
FEE_RATE = 0.00015


def net_sell_proceeds(qty: float, price: float) -> float:
    """매도 시 세금·수수료를 제외한 실수령액"""
    return qty * price * (1 - SELL_TAX_RATE - FEE_RATE)
