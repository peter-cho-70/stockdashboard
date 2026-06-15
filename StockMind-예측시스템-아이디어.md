# StockMind — 분석 관리 고도화 & 주가 변동성 예측 시스템 아이디어

> 코드 실증 분석 기반 · 2026-06-01  
> 현재 DB 구조(SQLite, 15개 테이블)와 기존 Signal 파이프라인을 최대한 재활용하는 전략

---

## 핵심 철학

> "예측이 아닌 **확률적 판단의 보조자**. AI는 근거를 찾아주고, 사람이 결정한다."

현재 시스템은 Signal을 잘 **수집**하고 있지만, 그 Signal들을 **시간 축으로 연결해서 패턴을 학습**하는 기능이 없다. 핵심은 두 가지다.

1. Signal → 실제 주가 변동을 **역추적하여 적중률을 누적**
2. 누적된 패턴으로 **다음 움직임의 방향성 확률**을 제시

---

## 1. 신호 적중률 추적 시스템 (Signal Accuracy Tracker)

### 1.1 아이디어 배경

현재 `SectorSignal.sentiment = POSITIVE`가 생성된 후 실제로 해당 섹터 주가가 올랐는지 전혀 검증하지 않는다. 이것이 가장 큰 미사용 데이터다.

```
현재: Signal 생성 → 끝
목표: Signal 생성 → N일 후 주가 결과 → 적중 여부 → 정확도 누적
```

### 1.2 새 DB 테이블: `signal_outcomes`

```python
class SignalOutcome(Base):
    __tablename__ = "signal_outcomes"

    id             = Column(Integer, primary_key=True)
    signal_type    = Column(String(20))   # macro | sector | stock
    signal_id      = Column(Integer)      # MacroSignal.id 등
    symbol         = Column(String(20))   # 검증 대상 종목
    signal_date    = Column(String(10))   # Signal.event_date
    signal_sentiment = Column(String(20)) # POSITIVE / NEGATIVE

    # 실제 결과 (N일 후 체크)
    check_days     = Column(Integer)      # 3 | 5 | 10 | 20
    check_date     = Column(String(10))
    actual_change  = Column(Float)        # 실제 등락률(%)
    hit            = Column(Boolean)      # 방향 일치 여부
    hit_magnitude  = Column(Float)        # 실제 변동 크기

    created_at     = Column(DateTime, default=datetime.utcnow)
```

### 1.3 적중률 계산 로직

```python
# core/signal_tracker.py

def evaluate_signal_outcomes(db: Session, check_days: int = 5):
    """
    N일이 지난 Signal의 실제 주가 결과를 체크.
    매일 스케줄러에서 자동 실행.
    """
    cutoff = (date.today() - timedelta(days=check_days)).strftime("%Y-%m-%d")

    # 아직 검증 안 된 SectorSignal 중 N일 지난 것
    unchecked = db.query(SectorSignal).filter(
        SectorSignal.event_date <= cutoff,
        ~SectorSignal.id.in_(
            db.query(SignalOutcome.signal_id).filter(
                SignalOutcome.signal_type == "sector",
                SignalOutcome.check_days == check_days,
            )
        )
    ).all()

    for sig in unchecked:
        # 해당 섹터 보유 종목의 실제 가격 변동 체크
        sector_stocks = db.query(Stock).filter(
            Stock.sector == sig.sector,
            Stock.is_active == True,
        ).all()

        for stock in sector_stocks:
            before = get_price_on(db, stock.id, sig.event_date)
            after  = get_price_on(db, stock.id, sig.check_date)
            if not before or not after:
                continue

            actual_change = (after - before) / before * 100
            predicted_up = sig.sentiment == "POSITIVE"
            actually_up  = actual_change > 0

            db.add(SignalOutcome(
                signal_type      = "sector",
                signal_id        = sig.id,
                symbol           = stock.symbol,
                signal_date      = sig.event_date,
                signal_sentiment = sig.sentiment,
                check_days       = check_days,
                check_date       = (
                    datetime.strptime(sig.event_date, "%Y-%m-%d")
                    + timedelta(days=check_days)
                ).strftime("%Y-%m-%d"),
                actual_change    = actual_change,
                hit              = (predicted_up == actually_up),
                hit_magnitude    = abs(actual_change),
            ))
    db.commit()
```

### 1.4 정확도 대시보드 API

```
GET /api/intel/signal-accuracy
→ {
    "sector": {
      "overall_hit_rate": 0.63,   # 전체 63% 적중
      "by_sector": {
        "반도체": { "hit_rate": 0.71, "sample_count": 28, "avg_magnitude": 2.3 },
        "자동차": { "hit_rate": 0.58, "sample_count": 15 }
      },
      "by_check_days": {
        "3":  { "hit_rate": 0.55 },   # 3일 후
        "5":  { "hit_rate": 0.63 },   # 5일 후 — 최적 창
        "10": { "hit_rate": 0.61 },
        "20": { "hit_rate": 0.57 }
      }
    },
    "macro": { ... },
    "stock": { ... },
    "best_signal_window_days": 5  # 가장 예측력 높은 Signal 시차
  }
```

**활용:** 섹터 Signal의 3일 적중률이 55%, 5일 적중률이 71%라면 → "이 섹터 Signal은 **5일 이후** 주가에 반응"이라는 개인화된 인사이트 생성.

---

## 2. Signal 선행 지표 분석 (Lead-Lag Detector)

### 2.1 핵심 질문

"매크로 Signal이 먼저냐, 섹터 Signal이 먼저냐, 실제 주가 변동이 먼저냐?"

현재 시스템은 Signal과 주가 급변을 개별로 보지만, **어느 Signal이 주가보다 며칠 앞서 왔는지** 분석하면 선행 지표를 발견할 수 있다.

### 2.2 Lead-Lag 분석 테이블

```python
class SignalLeadLag(Base):
    __tablename__ = "signal_lead_lag"

    id             = Column(Integer, primary_key=True)
    symbol         = Column(String(20))
    move_date      = Column(String(10))    # 주가 급변일 (PriceMoveCause.event_date)
    move_pct       = Column(Float)         # 변동률
    signal_type    = Column(String(20))    # macro | sector | stock
    signal_id      = Column(Integer)
    signal_date    = Column(String(10))
    signal_sentiment = Column(String(20))
    lead_days      = Column(Integer)       # 양수=Signal 선행, 음수=주가 선행
    # lead_days = move_date - signal_date
    # +3이면 "Signal이 주가 3일 전에 발생"
    # -2이면 "주가 급변 후 2일 뒤 Signal"
    sector         = Column(String(50))
    created_at     = Column(DateTime, default=datetime.utcnow)
```

### 2.3 Lead-Lag 분석 로직

```python
def compute_lead_lag(db: Session):
    """
    기존 PriceMoveCause × Signal 교차 분석.
    추가 AI 호출 없음 — 저장된 데이터만 활용.
    """
    causes = db.query(PriceMoveCause).all()

    for cause in causes:
        stock = db.get(Stock, cause.stock_id)

        # ±15일 내 Signal 검색
        for macro in db.query(MacroSignal).filter(
            MacroSignal.event_date.between(
                offset_date(cause.event_date, -15),
                offset_date(cause.event_date, +15),
            )
        ).all():
            lead_days = date_diff(cause.event_date, macro.event_date)
            db.add(SignalLeadLag(
                symbol=stock.symbol,
                move_date=cause.event_date,
                move_pct=cause.change_pct,
                signal_type="macro",
                signal_id=macro.id,
                signal_date=macro.event_date,
                signal_sentiment=macro.sentiment,
                lead_days=lead_days,
                sector=stock.sector,
            ))

        # 섹터 Signal도 동일 처리
        for sector_sig in db.query(SectorSignal).filter(
            SectorSignal.sector == normalize_sector(stock.sector),
            SectorSignal.event_date.between(
                offset_date(cause.event_date, -15),
                offset_date(cause.event_date, +15),
            )
        ).all():
            ...

    db.commit()
```

### 2.4 분석 결과 예시

```
반도체 섹터 분석 결과 (30건 기준):
─────────────────────────────────────
매크로 Signal (금리)    평균 선행 +8일  → 금리 Signal 후 8일 뒤 반도체 급변
섹터 Signal (반도체)   평균 선행 +3일  → 섹터 Signal 후 3일이 가장 빠름
StockSignal (삼성전자)  평균 선행 +1일  → 종목 직접 언급은 다음날 반응
PriceMoveCause (급락)  평균 선행 -2일  → 주가 먼저 빠지고 2일 후 뉴스

→ "반도체는 매크로보다 섹터 Signal이 더 빠른 선행 지표"
→ "금리 Signal은 직접 반응보다 8일 시차 — 즉각 매매 판단에 부적합"
```

**이 분석 결과가 buy_score.py의 가중치를 자동 조정하는 근거가 된다.**

---

## 3. 변동성 예측 스코어보드 (Volatility Forecast Board)

### 3.1 개념

현재 `buy_score.py`는 **매수 타이밍**만 판단한다. 여기에 **변동성 크기 예측**을 추가한다.

```
현재: 매수 스코어 A/B/C/D (방향만)
추가: 변동성 스코어 H/M/L (크기 예측)

조합:
  A등급 + 고변동성 → "올라갈 가능성 높으나 크게 흔들릴 수 있음. 분할 매수 권장"
  A등급 + 저변동성 → "안정적 상승 기대. 적극 매수 가능"
  D등급 + 고변동성 → "하락 + 급변 위험. 손절 라인 설정 필수"
```

### 3.2 변동성 스코어 계산

```python
# core/volatility_forecast.py

def calculate_volatility_score(
    db: Session,
    stock: Stock,
    price_data: list[dict],  # chartAnalysis.ts와 동일 구조
    *,
    days: int = 30,
) -> dict:
    """
    변동성 스코어 (0~100, 높을수록 급변 가능성 높음).
    추가 AI 호출 없음 — 기존 Signal + 기술적 지표만 활용.
    """
    score = 0
    factors = []

    # ── Factor 1: 볼린저 밴드 스퀴즈 (이미 chartAnalysis.ts에 있음) ──
    # 볼린저 밴드 폭이 좁아지면 급변 임박 신호
    bw = bollinger_width(price_data[-20:])
    if bw < 5:          # 5% 미만 = 강한 스퀴즈
        score += 30
        factors.append({"factor": "볼린저 스퀴즈", "score": 30,
                        "desc": f"밴드 폭 {bw:.1f}% — 방향 불문 큰 움직임 예고"})
    elif bw < 10:
        score += 15

    # ── Factor 2: 거래량 이상 (chartAnalysis.ts analyzeVolume 재활용) ──
    avg_vol = average_volume(price_data, 20)
    recent_vol = price_data[-1]["volume"]
    vol_ratio = recent_vol / avg_vol if avg_vol > 0 else 1
    if vol_ratio > 2.0:
        score += 20
        factors.append({"factor": "거래량 급증", "score": 20,
                        "desc": f"평균 대비 {vol_ratio:.1f}배 — 세력 진입 가능성"})

    # ── Factor 3: Signal 밀도 (최근 7일 내 Signal 건수) ──
    since = (date.today() - timedelta(days=7)).strftime("%Y-%m-%d")
    signal_count = (
        db.query(SectorSignal).filter(
            SectorSignal.event_date >= since,
            SectorSignal.sector == normalize_sector(stock.sector),
        ).count()
        + db.query(MacroSignal).filter(MacroSignal.event_date >= since).count()
    )
    if signal_count >= 5:
        score += 20
        factors.append({"factor": "Signal 과밀", "score": 20,
                        "desc": f"최근 7일 {signal_count}건 — 정보 과부하 구간"})

    # ── Factor 4: 과거 이 종목의 급변 빈도 (AlertHistory) ──
    alert_count = db.query(AlertHistory).filter(
        AlertHistory.stock_symbol == stock.symbol,
        AlertHistory.created_at >= since_90days,
    ).count()
    if alert_count >= 5:
        score += 15
        factors.append({"factor": "고빈도 급변 이력", "score": 15,
                        "desc": f"최근 90일 {alert_count}회 급변 이력"})

    # ── Factor 5: Signal 감성 분열 (긍정·부정 혼재) ──
    pos = count_sentiment(db, stock, "POSITIVE", 14)
    neg = count_sentiment(db, stock, "NEGATIVE", 14)
    if pos > 0 and neg > 0 and abs(pos - neg) <= 1:
        score += 15
        factors.append({"factor": "감성 분열", "score": 15,
                        "desc": "긍정·부정 Signal 동시 존재 — 시장 불확실성 높음"})

    level = "HIGH" if score >= 60 else "MEDIUM" if score >= 30 else "LOW"

    return {
        "symbol":       stock.symbol,
        "volatility_score": min(100, score),
        "volatility_level": level,
        "factors":      factors,
        "interpretation": _interpret_volatility(level, score),
        "suggested_action": _suggest_action(level),
    }

def _interpret_volatility(level: str, score: int) -> str:
    if level == "HIGH":
        return f"변동성 높음({score}점) — 단기 급변 가능. 분할 매수·손절 라인 설정 필수"
    if level == "MEDIUM":
        return f"변동성 보통({score}점) — 추세 방향 확인 후 진입"
    return f"변동성 낮음({score}점) — 안정적 흐름. 추세 방향에 집중"
```

### 3.3 매수 스코어 × 변동성 스코어 매트릭스

```
                 변동성 LOW    변동성 MEDIUM   변동성 HIGH
                ┌────────────┬──────────────┬────────────┐
매수 A (70+)   │ ✅ 적극진입 │ ⚠️ 분할매수  │ 🔄 소량선취 │
매수 B (50+)   │ 👀 모니터링 │ 👀 모니터링  │ ⛔ 관망     │
매수 C (30+)   │ ⛔ 관망     │ ⛔ 관망      │ ⛔ 관망     │
매수 D (<30)   │ ❌ 진입금지 │ ❌ 진입금지  │ ❌ 진입금지 │
                └────────────┴──────────────┴────────────┘
```

**API:**
```
GET /api/intel/stocks/{symbol}/forecast
→ {
    buy_score: { score: 75, grade: "A" },
    volatility: { score: 40, level: "MEDIUM" },
    matrix_signal: "분할매수",
    matrix_reason: "매수 조건 양호하나 변동성 보통 — 3회 분할 진입 권장"
  }
```

---

## 4. 패턴 라이브러리 (Pattern Library)

### 4.1 개념

과거 `PriceMoveCause + Signal` 조합에서 반복되는 **이슈 패턴**을 추출해 저장한다.  
예: "금리 동결 발표 → 2차전지 섹터 Signal POSITIVE → 3일 후 +3~5%" 패턴이 5번 이상 반복됐다면 라이브러리에 저장.

### 4.2 새 DB 테이블: `pattern_library`

```python
class PatternLibrary(Base):
    __tablename__ = "pattern_library"

    id              = Column(Integer, primary_key=True)
    pattern_name    = Column(String(100))     # "금리동결→2차전지 랠리"
    trigger_type    = Column(String(20))      # macro | sector | stock
    trigger_topic   = Column(String(50))      # "금리" (MacroSignal.topic)
    trigger_sentiment = Column(String(20))    # "POSITIVE"
    target_sector   = Column(String(50))      # "2차전지"
    target_symbol   = Column(String(20), nullable=True)  # 특정 종목 패턴이면
    avg_lead_days   = Column(Float)           # 평균 선행 일수
    avg_move_pct    = Column(Float)           # 평균 주가 변동률
    hit_count       = Column(Integer)         # 발생 횟수
    hit_rate        = Column(Float)           # 성공률 (0~1)
    last_occurred   = Column(String(10))      # 마지막 발생일
    example_dates   = Column(Text)            # JSON: 과거 발생 날짜 목록
    created_at      = Column(DateTime, default=datetime.utcnow)
    updated_at      = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
```

### 4.3 패턴 자동 추출

```python
# core/pattern_detector.py

KNOWN_PATTERNS = [
    # (트리거_토픽, 트리거_감성, 타겟_섹터, 이름)
    ("금리",  "POSITIVE", "2차전지",  "금리 인하 기대 → 2차전지 랠리"),
    ("금리",  "POSITIVE", "부동산·리츠", "금리 인하 기대 → 리츠 상승"),
    ("FOMC/연준", "NEGATIVE", "반도체", "FOMC 매파 → 반도체 조정"),
    ("환율",  "NEGATIVE", "자동차",  "원화 강세 → 수출주 약세"),
    ("AI",    "POSITIVE", "반도체",  "AI 투자 확대 → 반도체 수혜"),
    ("유가",  "POSITIVE", "에너지",  "유가 상승 → 에너지주 상승"),
    ("중국정책", "POSITIVE", "2차전지", "중국 경기부양 → 배터리 랠리"),
]

def extract_patterns(db: Session):
    for trigger_topic, trigger_sent, target_sector, name in KNOWN_PATTERNS:
        # 1) 해당 매크로 Signal 찾기
        macro_sigs = db.query(MacroSignal).filter(
            MacroSignal.topic == trigger_topic,
            MacroSignal.sentiment == trigger_sent,
        ).all()

        results = []
        for macro in macro_sigs:
            # 2) N일 후 타겟 섹터 주가 변동 확인
            for days in [3, 5, 10]:
                check_date = offset_date(macro.event_date, days)
                sector_stocks = db.query(Stock).filter(
                    Stock.sector == target_sector
                ).all()
                moves = [
                    get_price_change(db, s, macro.event_date, check_date)
                    for s in sector_stocks
                ]
                avg_move = mean([m for m in moves if m is not None])
                if avg_move:
                    results.append({
                        "date": macro.event_date,
                        "move": avg_move,
                        "hit": (trigger_sent == "POSITIVE") == (avg_move > 0)
                    })

        if len(results) >= 3:  # 최소 3건 이상이면 패턴으로 등록
            hit_rate = sum(1 for r in results if r["hit"]) / len(results)
            avg_move = mean([r["move"] for r in results])
            upsert_pattern(db, name, trigger_topic, trigger_sent,
                           target_sector, hit_rate, avg_move, results)
```

### 4.4 실시간 패턴 알림

새 MacroSignal이 생성될 때 → 패턴 라이브러리 대조 → 매칭 패턴 즉시 알림:

```python
# signal_extractor.py의 extract_signals() 마지막에 추가
def check_pattern_alerts(db: Session, content: IntelContent):
    """새 Signal 생성 직후 기존 패턴과 매칭 — 추가 AI 호출 없음."""
    for macro in content.macro_signals:
        patterns = db.query(PatternLibrary).filter(
            PatternLibrary.trigger_topic == macro.topic,
            PatternLibrary.trigger_sentiment == macro.sentiment,
            PatternLibrary.hit_rate >= 0.6,  # 60% 이상 적중 패턴만
        ).all()
        for pattern in patterns:
            # 해당 섹터 보유 종목이 있으면 알림 생성
            stocks = db.query(Stock).filter(
                Stock.sector == pattern.target_sector,
                Stock.is_active == True,
            ).all()
            for stock in stocks:
                db.add(AlertHistory(
                    stock_symbol=stock.symbol,
                    alert_type="PATTERN_MATCH",
                    message=(
                        f"📊 패턴 감지: [{pattern.pattern_name}] "
                        f"적중률 {pattern.hit_rate:.0%} · "
                        f"평균 {pattern.avg_move_pct:+.1f}% "
                        f"({pattern.avg_lead_days:.0f}일 후)"
                    ),
                ))
```

---

## 5. 분석 품질 자가 검증 시스템 (AI Provider Scorecard)

### 5.1 개념

현재 GPT/Claude/Gemini 중 어느 AI가 더 정확한 분석을 했는지 전혀 비교하지 않는다.  
Signal 적중률을 AI 제공자별로 집계하면 **최적 AI를 자동 선택**할 수 있다.

### 5.2 Provider별 적중률 집계

```python
# core/provider_scorecard.py

def get_provider_accuracy(db: Session, days: int = 90) -> dict:
    """
    AI 제공자별 Signal 예측 정확도.
    IntelContent.analysis_provider × SignalOutcome.hit 집계.
    """
    since = offset_date(today(), -days)

    results = {}
    for provider in ["openai", "claude", "gemini"]:
        # 해당 AI가 생성한 IntelContent → Signal → 결과
        contents = db.query(IntelContent).filter(
            IntelContent.analysis_provider == provider,
            IntelContent.analyzed_at >= since,
        ).all()
        content_ids = [c.id for c in contents]

        outcomes = db.query(SignalOutcome).filter(
            SignalOutcome.signal_id.in_(
                db.query(SectorSignal.id).filter(
                    SectorSignal.content_id.in_(content_ids)
                )
            )
        ).all()

        if outcomes:
            hit_rate = sum(1 for o in outcomes if o.hit) / len(outcomes)
            results[provider] = {
                "hit_rate":     round(hit_rate, 3),
                "sample_count": len(outcomes),
                "avg_magnitude": mean([o.hit_magnitude for o in outcomes]),
            }

    # 최적 AI 추천
    best = max(results, key=lambda p: results[p]["hit_rate"])
    results["recommended_provider"] = best
    return results
```

### 5.3 자동 AI 선택 연동

```python
# ai_analyzer.py의 _analyze_document() 수정
def _get_optimal_provider(db: Session) -> str:
    """최근 90일 적중률 기준으로 최적 AI 자동 선택."""
    scorecard = get_provider_accuracy(db, days=90)
    recommended = scorecard.get("recommended_provider", "openai")
    # 샘플이 10건 미만이면 기본값 사용
    if scorecard.get(recommended, {}).get("sample_count", 0) < 10:
        return "openai"
    return recommended
```

---

## 6. 투자 가설 추적 시스템 (Investment Thesis Tracker)

### 6.1 개념

`Stock.memo` 컬럼에 현재 자유 텍스트로 투자 근거를 적을 수 있지만, **가설의 상태(검증중/확인/반증)**를 추적하지 않는다.

구조화된 가설 관리로 "내가 왜 이 종목을 샀는가" → "그 가설이 지금도 유효한가"를 자동으로 업데이트한다.

### 6.2 새 DB 테이블: `investment_theses`

```python
class InvestmentThesis(Base):
    __tablename__ = "investment_theses"

    id             = Column(Integer, primary_key=True)
    stock_id       = Column(Integer, ForeignKey("stocks.id"))
    title          = Column(String(200))  # "AI 반도체 수요 급증 수혜"
    body           = Column(Text)         # 상세 근거
    category       = Column(String(50))   # macro | sector | product | earnings
    time_horizon   = Column(String(20))   # short(1개월) | mid(6개월) | long(1년+)
    status         = Column(String(20), default="active")
    # active | confirmed | invalidated | expired

    # 자동 업데이트 필드
    supporting_signals   = Column(Text)   # JSON: 지지하는 Signal id[]
    contradicting_signals = Column(Text)  # JSON: 반박하는 Signal id[]
    last_validated_at    = Column(DateTime)
    validation_score     = Column(Float)  # 0~1 (지지/반박 Signal 비율)

    created_at     = Column(DateTime, default=datetime.utcnow)
    updated_at     = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
```

### 6.3 가설 자동 검증 로직

```python
# core/thesis_validator.py

def validate_theses(db: Session):
    """
    새 Signal이 기존 투자 가설을 지지하는지/반박하는지 자동 체크.
    추가 AI 호출 없음 — keyword 매칭 + sentiment 분석만.
    """
    active_theses = db.query(InvestmentThesis).filter(
        InvestmentThesis.status == "active"
    ).all()

    for thesis in active_theses:
        stock = db.get(Stock, thesis.stock_id)

        # 최근 생성된 Signal 중 이 종목/섹터 관련
        recent_signals = get_recent_signals(db, stock, days=7)

        supporting = []
        contradicting = []

        for signal in recent_signals:
            # 가설 카테고리와 Signal 매칭
            if thesis.category == "macro":
                # 매크로 방향이 가설과 같으면 지지
                if signal_supports_thesis(signal, thesis):
                    supporting.append(signal["id"])
                else:
                    contradicting.append(signal["id"])

            elif thesis.category == "sector":
                if signal["kind"] == "sector" and signal["sector"] == stock.sector:
                    if signal["sentiment"] == "POSITIVE":
                        supporting.append(signal["id"])
                    elif signal["sentiment"] == "NEGATIVE":
                        contradicting.append(signal["id"])

        # 검증 점수: 지지/(지지+반박)
        total = len(supporting) + len(contradicting)
        if total > 0:
            thesis.validation_score = len(supporting) / total
            thesis.supporting_signals = json.dumps(supporting)
            thesis.contradicting_signals = json.dumps(contradicting)
            thesis.last_validated_at = datetime.utcnow()

            # 자동 상태 변경
            if thesis.validation_score >= 0.8 and total >= 3:
                thesis.status = "confirmed"
            elif thesis.validation_score <= 0.2 and total >= 3:
                thesis.status = "invalidated"

    db.commit()
```

### 6.4 가설 대시보드 UI

```
투자 가설 상태                           상태: 활성 3 | 확인 1 | 반박 1
─────────────────────────────────────────────────────────────────────
✅ [확인] 삼성전자 — AI 반도체 수요 급증 수혜
   검증 점수: 85% | 지지 Signal: 17건 | 반박: 3건 | 중기(6개월)
   최근 지지: "AI 인프라 투자 CAPEX 급증 → 반도체 수요" (3일 전)

⚠️ [활성] SK하이닉스 — HBM 독점 공급 프리미엄
   검증 점수: 62% | 지지 Signal: 8건 | 반박: 5건 | 장기(1년)
   최근 반박: "중국 CXMT HBM 생산 진입 우려" (1일 전)

❌ [반박] LG에너지솔루션 — 전기차 보급률 가속화 수혜
   검증 점수: 18% | 지지 Signal: 2건 | 반박: 9건 | 중기(6개월)
   → 가설 재검토 필요: "전기차 수요 둔화 장기화 우려"
```

---

## 7. 포트폴리오 시나리오 시뮬레이터 (Scenario Simulator)

### 7.1 개념

"만약 FOMC가 금리를 0.25% 올린다면 내 포트폴리오는 어떻게 될까?"를 현재 DB 데이터로 시뮬레이션한다. AI 호출 없이 **과거 패턴 라이브러리 기반** 시뮬레이션.

### 7.2 시나리오 정의

```python
MACRO_SCENARIOS = {
    "금리_인상_0.25": {
        "trigger":   {"topic": "금리", "sentiment": "NEGATIVE"},
        "sector_impacts": {
            "부동산·리츠": -3.5,   # 과거 패턴 평균
            "2차전지":     -2.1,
            "금융":        +1.8,
            "에너지":      +0.5,
            "반도체":      -1.2,
        }
    },
    "금리_인하_0.25": {
        "trigger":   {"topic": "금리", "sentiment": "POSITIVE"},
        "sector_impacts": {
            "부동산·리츠": +4.2,
            "2차전지":     +3.1,
            "금융":        -0.9,
            "반도체":      +1.8,
        }
    },
    "원화_강세_5pct": {
        "trigger":   {"topic": "환율", "sentiment": "POSITIVE"},
        "sector_impacts": {
            "자동차":   -2.8,  # 수출주 불리
            "소비재":   +1.5,  # 수입 소비재 유리
            "반도체":   -1.1,
        }
    },
    # ... 추가 시나리오
}
```

### 7.3 시뮬레이션 API

```
POST /api/intel/portfolio/simulate
Body: { "scenario": "금리_인상_0.25", "confidence": "medium" }

Response:
{
  "scenario": "금리_인상_0.25",
  "portfolio_impact": {
    "estimated_total_change": -1.8,  # 포트 전체 추정 등락률
    "estimated_pnl": -2160000,       # 추정 손익 (원)
    "by_stock": [
      { "symbol": "005380", "name": "현대차",
        "sector": "자동차",
        "sector_impact": -2.8,
        "weight": 0.15,
        "contribution": -0.42  # 포트 기여도
      },
      ...
    ]
  },
  "historical_accuracy": {
    "sample_count": 4,
    "avg_deviation": 1.2,   # 예측과 실제의 평균 오차(%)
  },
  "disclaimer": "과거 패턴 기반 참고치. 실제 결과는 다를 수 있습니다."
}
```

### 7.4 시나리오 결과 저장 & 사후 검증

```python
class ScenarioResult(Base):
    __tablename__ = "scenario_results"

    id               = Column(Integer, primary_key=True)
    scenario_name    = Column(String(100))
    simulated_at     = Column(DateTime)
    trigger_date     = Column(String(10))   # 실제 매크로 이벤트 발생일 (나중에 채움)
    predicted_impact = Column(Float)        # 예측 등락률
    actual_impact    = Column(Float)        # 실제 등락률 (N일 후 채움)
    accuracy         = Column(Float)        # |예측 - 실제|
    checked_at       = Column(DateTime)
```

---

## 8. 섹터 로테이션 감지기 (Sector Rotation Detector)

### 8.1 개념

"돈이 어느 섹터에서 어느 섹터로 이동하고 있는가"를 Signal 흐름으로 감지한다. 매크로 환경 변화 → 섹터별 Signal 감성 변화를 추적하면 로테이션을 포착할 수 있다.

### 8.2 로테이션 감지 알고리즘

```python
# core/sector_rotation.py

def detect_sector_rotation(db: Session, window_days: int = 30) -> dict:
    """
    최근 N일 섹터별 Signal 감성 변화로 로테이션 방향 감지.
    추가 AI 호출 없음.
    """
    sectors = ["반도체", "2차전지", "자동차", "바이오·헬스케어",
               "금융", "에너지", "방산", "AI·빅테크"]

    half = window_days // 2
    now  = date.today()

    # 전반기 vs 후반기 감성 비교
    results = {}
    for sector in sectors:
        early_signals = get_sector_signals(db, sector,
            from_date=offset_date(now, -window_days),
            to_date=offset_date(now, -half))

        late_signals = get_sector_signals(db, sector,
            from_date=offset_date(now, -half),
            to_date=str(now))

        early_score = sentiment_score(early_signals)  # POSITIVE=+1, NEUTRAL=0, NEGATIVE=-1
        late_score  = sentiment_score(late_signals)

        delta = late_score - early_score

        results[sector] = {
            "early_score": early_score,
            "late_score":  late_score,
            "delta":       delta,
            "trend":       "상승" if delta > 0.2 else "하락" if delta < -0.2 else "유지",
            "signal_count": len(early_signals) + len(late_signals),
        }

    # 가장 강하게 올라온 섹터 vs 빠진 섹터
    rising  = sorted(results.items(), key=lambda x: -x[1]["delta"])[:3]
    falling = sorted(results.items(), key=lambda x: x[1]["delta"])[:3]

    return {
        "window_days":       window_days,
        "rising_sectors":   [{"sector": k, **v} for k, v in rising],
        "falling_sectors":  [{"sector": k, **v} for k, v in falling],
        "rotation_signal":  _describe_rotation(rising, falling),
        "all_sectors":      results,
    }

def _describe_rotation(rising, falling) -> str:
    r = [s for s, _ in rising[:2]]
    f = [s for s, _ in falling[:2]]
    return f"{' · '.join(f)} → {' · '.join(r)} 로테이션 감지"
    # 예: "2차전지 · 자동차 → 반도체 · 방산 로테이션 감지"
```

### 8.3 포트폴리오 로테이션 경고

```
🔄 섹터 로테이션 감지 (최근 30일)

올라오는 섹터:  반도체 ↑+0.8  /  방산 ↑+0.6  /  AI·빅테크 ↑+0.4
내려가는 섹터:  2차전지 ↓-0.7  /  자동차 ↓-0.5  /  부동산 ↓-0.3

⚠️ 내 포트폴리오 경고:
  LG에너지솔루션(2차전지) 비중 22% — 하락 섹터 편중
  → 반도체 섹터 비중 확대 검토 권장
```

---

## 9. 종합 구현 로드맵

### 9.1 단계별 정리

| Phase | 기능 | 핵심 테이블 | AI 호출 | 개발 공수 |
|-------|------|------------|---------|----------|
| **1** | Signal 적중률 추적 | `signal_outcomes` | 없음 | 3일 |
| **2** | Lead-Lag 분석 | `signal_lead_lag` | 없음 | 2일 |
| **3** | 변동성 스코어 | 기존 테이블만 | 없음 | 2일 |
| **4** | 패턴 라이브러리 | `pattern_library` | 없음 | 4일 |
| **5** | AI Provider 점수카드 | 기존 + outcomes | 없음 | 1일 |
| **6** | 투자 가설 추적 | `investment_theses` | 선택적 | 3일 |
| **7** | 시나리오 시뮬레이터 | `scenario_results` | 없음 | 3일 |
| **8** | 섹터 로테이션 감지 | 기존 테이블만 | 없음 | 2일 |

**총 소요: 약 3~4주 / AI 추가 비용: Phase 1~5는 0원**

### 9.2 데이터 누적 전제 조건

이 모든 기능의 전제는 **Signal 데이터 누적량**이다.

| 기능 | 최소 필요 데이터 |
|------|----------------|
| Signal 적중률 | SectorSignal 30건 + PriceHistory 90일 |
| Lead-Lag 분석 | PriceMoveCause 20건 이상 |
| 패턴 라이브러리 | 각 패턴 3회 이상 발생 |
| 변동성 스코어 | AlertHistory 10건 + 차트 데이터 90일 |
| 시나리오 시뮬레이터 | 패턴 라이브러리 완성 후 |

→ **지금 당장 시작해야 할 것:** 매일 분석 실행 + Signal 저장 루틴 정착. 데이터가 쌓일수록 예측력이 높아진다.

### 9.3 스케줄러 자동화 로드맵

```python
# scheduler/jobs.py 추가 jobs

# Phase 1: 매일 00:30 — Signal 결과 체크 (N일 지난 Signal)
scheduler.add_job(job_check_signal_outcomes, CronTrigger(hour=0, minute=30))

# Phase 2: 매일 01:00 — Lead-Lag 분석 갱신
scheduler.add_job(job_compute_lead_lag, CronTrigger(hour=1, minute=0))

# Phase 4: 매주 일요일 02:00 — 패턴 라이브러리 갱신
scheduler.add_job(job_extract_patterns, CronTrigger(day_of_week="sun", hour=2))

# Phase 6: 매일 분석 후 — 투자 가설 자동 검증
scheduler.add_job(job_validate_theses, CronTrigger(hour=16, minute=0))

# Phase 8: 매일 15:40 — 섹터 로테이션 감지
scheduler.add_job(job_detect_sector_rotation, CronTrigger(hour=15, minute=40))
```

---

## 10. 예측 시스템 전체 데이터 흐름

```
외부 입력
  YouTube/뉴스/텍스트
       │
       ▼
  IntelContent + Signal (기존)
       │
       ├──────────────────────────┐
       │                          │
       ▼                          ▼
  Signal 적중률 추적          Lead-Lag 분석
  (signal_outcomes)          (signal_lead_lag)
       │                          │
       └──────────┬───────────────┘
                  ▼
          패턴 라이브러리
          (pattern_library)
                  │
       ┌──────────┼──────────────┐
       │          │              │
       ▼          ▼              ▼
  변동성 스코어  시나리오       섹터 로테이션
  (실시간)       시뮬레이터     감지기
       │          │              │
       └──────────┴──────────────┘
                  │
                  ▼
         ┌────────────────┐
         │ 종합 판단 엔진  │
         │                │
         │ 매수 스코어 ×   │
         │ 변동성 스코어  │
         │ × 패턴 적중률  │
         └────────────────┘
                  │
       ┌──────────┴──────────┐
       │                     │
       ▼                     ▼
  매트릭스 신호           투자 가설
  (적극/분할/관망/금지)   자동 검증
```

---

## 11. 면책 및 운영 원칙

모든 예측·스코어·시뮬레이션 결과에는 다음을 항상 표시:

1. "본 시스템의 모든 분석은 투자 판단의 근거가 될 수 없으며, 참고용 정보 제공 목적입니다."
2. "Signal 적중률은 과거 데이터 기반이며, 미래 성과를 보장하지 않습니다."
3. 샘플 수가 10건 미만인 패턴은 "데이터 부족" 표시 — 숫자만 보면 오판 가능.
4. 변동성 HIGH 종목에 대해서는 매수 스코어가 A여도 "소량 선취 후 관망" 권장 문구 유지.

---

*문서 끝 — StockMind 분석 관리 고도화 & 변동성 예측 시스템 아이디어 v1.0*
