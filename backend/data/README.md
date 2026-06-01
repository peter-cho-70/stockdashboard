# 데모 포트폴리오 데이터

`DEMO_MODE=true` 일 때 API가 **실제 DB 보유 종목 대신** 이 파일의 데이터를 보여줍니다.

## 수정 방법

1. `demo_portfolio.json` 의 `holdings` 배열을 편집합니다 (약 10종목 권장).
2. 각 항목:
   - `symbol`: 6자리 종목코드 (AI·차트 연동에 사용)
   - `name`, `sector`, `market`, `currency`
   - `qty`: 보유 수량 (데모용)
   - `avg_price`: 평균 매입단가
   - `current_price`: `0` 이면 서버가 DB/pykrx 시세로 채웁니다
3. 백엔드 재시작 (또는 Vercel 재배포)

차트·매수점수·YouTube Signal 은 **같은 종목코드**로 분석된 데이터를 그대로 사용합니다.
