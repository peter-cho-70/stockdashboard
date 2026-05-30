"""
seed_portfolio.py
스크린샷 기반 포트폴리오 초기 데이터 등록
실행: python3 seed_portfolio.py
"""
import httpx

API = "http://localhost:8000/api"

# 스크린샷에서 추출한 포트폴리오 데이터
# avg_price는 current_price와 profit_rate로 역산
# avg_price = current_price / (1 + profit_rate/100)

def calc_avg(current_price: float, profit_rate: float) -> float:
    if profit_rate == 0:
        return current_price
    return current_price / (1 + profit_rate / 100)

def calc_current(eval_amount: float, qty: int) -> float:
    return eval_amount / qty if qty > 0 else 0

# 평가금액 / 수량 = 현재가
# 현재가 / (1 + 수익률) = 평균단가
RAW = [
    # 수익 종목
    {"name": "삼성전자",     "symbol": "005930", "qty": 880,  "eval": 278960000, "profit_rate": 284.90, "sector": "반도체"},
    {"name": "SK하이닉스",   "symbol": "000660", "qty": 15,   "eval": 34995000,  "profit_rate": 264.98, "sector": "반도체"},
    {"name": "현대차",       "symbol": "005380", "qty": 468,  "eval": 338364000, "profit_rate": 191.67, "sector": "자동차"},
    {"name": "현대모비스",   "symbol": "012330", "qty": 89,   "eval": 68352000,  "profit_rate": 179.33, "sector": "자동차"},
    {"name": "현대오토에버", "symbol": "307950", "qty": 26,   "eval": 24206000,  "profit_rate": 160.83, "sector": "자동차"},
    {"name": "삼성전자우",   "symbol": "005935", "qty": 65,   "eval": 13162500,  "profit_rate": 50.43,  "sector": "반도체"},
    {"name": "KODEX 200타겟위클리커버드콜", "symbol": "476580", "qty": 422, "eval": 11201990, "profit_rate": 49.63, "sector": "ETF"},
    {"name": "기아",         "symbol": "000270", "qty": 358,  "eval": 60573600,  "profit_rate": 48.85,  "sector": "자동차"},
    {"name": "현대글로비스", "symbol": "086280", "qty": 32,   "eval": 7760000,   "profit_rate": 31.30,  "sector": "자동차"},
    {"name": "HL만도",       "symbol": "204320", "qty": 120,  "eval": 7452000,   "profit_rate": 4.56,   "sector": "자동차"},
    # 손실 종목
    {"name": "이수페타시스", "symbol": "007660", "qty": 16,   "eval": 2067200,   "profit_rate": -0.65,  "sector": "반도체"},
    {"name": "PLUS 우주항공","symbol": "490020", "qty": 35,   "eval": 1493800,   "profit_rate": -1.21,  "sector": "방산"},
    {"name": "한국전력",     "symbol": "015760", "qty": 79,   "eval": 3073100,   "profit_rate": -5.15,  "sector": "에너지"},
    {"name": "KODEX 방산TOP10","symbol": "484490","qty": 60, "eval": 781200,    "profit_rate": -5.76,  "sector": "방산"},
    {"name": "KODEX 코스닥150","symbol": "229200","qty": 270,"eval": 5057100,   "profit_rate": -5.91,  "sector": "ETF"},
    {"name": "대한항공",     "symbol": "003490", "qty": 86,   "eval": 2304800,   "profit_rate": -6.84,  "sector": "자동차"},
    {"name": "현대차우",     "symbol": "005385", "qty": 63,   "eval": 17262000,  "profit_rate": -6.99,  "sector": "자동차"},
    {"name": "리노공업",     "symbol": "058470", "qty": 74,   "eval": 7207600,   "profit_rate": -7.71,  "sector": "반도체"},
    {"name": "KODEX 금융고배당TOP10타겟위클리", "symbol": "480040", "qty": 330, "eval": 3755400, "profit_rate": -12.86, "sector": "ETF"},
    {"name": "알테오젠",     "symbol": "196170", "qty": 84,   "eval": 30996000,  "profit_rate": -10.83, "sector": "바이오·헬스케어"},
    {"name": "KODEX 바이오", "symbol": "244580", "qty": 145,  "eval": 1597900,   "profit_rate": -13.64, "sector": "바이오·헬스케어"},
    {"name": "리가켐바이오", "symbol": "141080", "qty": 15,   "eval": 2266500,   "profit_rate": -18.56, "sector": "바이오·헬스케어"},
    {"name": "NAVER",        "symbol": "035420", "qty": 240,  "eval": 56160000,  "profit_rate": -18.73, "sector": "AI·빅테크"},
    {"name": "파마리서치",   "symbol": "214450", "qty": 25,   "eval": 7375000,   "profit_rate": -21.73, "sector": "바이오·헬스케어"},
    {"name": "에이비엘바이오","symbol": "298380","qty": 46,  "eval": 5147400,   "profit_rate": -33.99, "sector": "바이오·헬스케어"},
    {"name": "카카오",       "symbol": "035720", "qty": 251,  "eval": 10529450,  "profit_rate": -52.64, "sector": "AI·빅테크"},
    {"name": "SK바이오사이언스","symbol":"302440","qty": 20,  "eval": 818000,    "profit_rate": -35.58, "sector": "바이오·헬스케어"},
    {"name": "카페24",       "symbol": "042000", "qty": 154,  "eval": 3195500,   "profit_rate": -54.40, "sector": "AI·빅테크"},
    {"name": "프리챌",       "symbol": "060240", "qty": 50,   "eval": 0,         "profit_rate": 0,      "sector": "AI·빅테크"},
]

def build_payload():
    stocks = []
    for r in RAW:
        current_price = calc_current(r["eval"], r["qty"])
        avg_price = calc_avg(current_price, r["profit_rate"])
        stocks.append({
            "symbol": r["symbol"],
            "name": r["name"],
            "market": "KRX",
            "sector": r["sector"],
            "currency": "KRW",
            "qty": r["qty"],
            "avg_price": round(avg_price, 2),
            "current_price": round(current_price, 2),
            "profit_rate": r["profit_rate"],
        })
    return stocks

def main():
    payload = build_payload()
    print(f"📦 {len(payload)}개 종목 등록 시작...")

    resp = httpx.post(f"{API}/portfolio/stocks/bulk", json=payload, timeout=30)
    if resp.status_code == 200:
        data = resp.json()
        print(f"✅ {data['message']}")
        for r in data["results"]:
            print(f"   {'➕' if r['action']=='added' else '🔄'} {r['symbol']} ({r['action']})")
    else:
        print(f"❌ 오류: {resp.status_code} - {resp.text}")

if __name__ == "__main__":
    main()
