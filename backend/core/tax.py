"""
core/tax.py
국내주식 매매 세금·수수료 추정 — 실현손익(세후) 계산용

세율은 종목·증권사별로 다를 수 있어 근사값을 사용한다:
- SELL_TAX_RATE: 증권거래세+농어촌특별세 (코스피/코스닥 통합, 2024년 기준 약 0.18%)
- FEE_RATE: 증권사 거래 수수료 (편도, 평균 추정치) — 매수·매도 모두 적용
"""
SELL_TAX_RATE = 0.0018
FEE_RATE = 0.00015

# 배당소득세: 소득세 14% + 지방소득세 1.4% = 15.4% (국내 상장주식 기준, 원천징수).
# 금융소득종합과세(연 2천만원 초과) 대상이거나 해외주식 배당은 실제 세율이 달라질 수 있어
# 자동계산값은 추정치이며, 사용자가 직접 수정할 수 있다.
DIVIDEND_TAX_RATE = 0.154


def net_sell_proceeds(qty: float, price: float) -> float:
    """매도 시 세금·수수료를 제외한 실수령액"""
    return qty * price * (1 - SELL_TAX_RATE - FEE_RATE)


def dividend_tax(gross_amount: float) -> float:
    """배당소득세 추정액 (원천징수 15.4% 기준)"""
    return round(gross_amount * DIVIDEND_TAX_RATE)
