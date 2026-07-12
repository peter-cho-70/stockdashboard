# 개발 기록 (DEVLOG)

StockMind가 어떤 순서로 만들어졌는지, 어떤 외부 서비스·API 키가 언제 왜 추가됐는지 기록하는 문서입니다.
큰 기능이 추가될 때마다 아래에 새 항목을 append 합니다 (오래된 항목은 고치지 않고 그대로 둠 — 시점 기록물).

---

## 개발 변천사

### Phase 1 — 초기 구축 (2026-05-31)
- 첫 커밋: StockMind 주식 대시보드 (포트폴리오·시세 기본 골격)
- Vercel/Render 배포 설정, 프론트+API 서버리스 배포
- Gemini AI 분석 파이프라인, Signal(신호) 추출, 워치리스트, 차트 연동
- 포트폴리오 매매내역(`portfolio_trades`), 매매일자 매칭, 양도소득 보정

### Phase 2 — 지식·인텔리전스 확장 (2026-06-01 ~ 06-02)
- 워치리스트 허브, 데모 모드, 차트 UX, 인텔 재설계 기획
- 지식 허브(Knowledge Hub), 미국시장 리포트, 인텔 캘린더, 매크로 지표

### Phase 3 — 허브 통합 · KIS 연동 · FinanceHub (2026-06-16 ~ 06-19)
- 인텔리전스 허브 / 지식 허브 / 거래 리포트 구현
- 아침 브리핑(Morning Briefing) + 국내 마켓 스냅샷
- 스터디 허브, 종목 기초정보, 한국투자증권(KIS) 실시세·잔고 연동, 차트 분석 고도화
- 목표 매수/매도가 알림 (워치리스트 + 포트폴리오 공통)
- Vercel 배포 안정화 (monorepo 루트 배포, 빈 env var 크래시 수정 등 다수)
- **FinanceHub(통합 재무관리) 모듈 신설** — 자산/부채/현금흐름/장부

### Phase 4 — 옥션·자동매매·ETF (2026-06-22 ~ 06-27)
- 옥션허브, 자동매매 모듈, `(stock)` 라우트 그룹 재편
- ETF 즐겨찾기·메모·New 태그
- 키움증권 REST API 연동 추가 (KIS와 계좌 합산 지원)
- SpaceX(SPCX) 종목 추가, 포트폴리오/현금흐름 AI 분석 지속 저장

### Phase 5 — 문서화 · 매매습관 트래커 (2026-07-11)
- 프로젝트 문서를 `doc/`로 정리하고 GitHub Pages 문서 사이트(`stockdashboard-docs`) 발행,
  개인 문서 허브(`peter-cho-70.github.io`)에 등록
- **매매습관(Trade Journal) 기능** 추가 — 사용자가 관리하던 엑셀 매매습관 트래커의 로직을 이식.
  기존에 KIS로 자동 동기화되는 체결내역(`portfolio_trades`)에 매수 근거·확신도·감정·목표가·손절가(매수 시점),
  매도 사유·복기 메모(매도 시점)를 덧붙이고, 손절 준수율·익절 타이밍·감정별 승률을 자동 계산 (`/portfolio/journal`)
- 진행 중: 금융결제원 오픈뱅킹(계좌 잔액 자동 동기화) OAuth 연동 — 테스트 환경에서 인증 오류로 보류 중
  (자세한 내용은 [STATUS](STATUS.md) 참고)
- **데이터 정합성 버그 2건 수정**: ① 장마감 스냅샷이 `date.today()`(호출 시점) 대신
  `get_latest_trading_date()`(최근 거래일)를 기준으로 저장하도록 수정 — 이전엔 장마감
  직후 pykrx가 당일 데이터를 아직 못 줄 때 조용히 전일 데이터로 폴백해 잘못 저장되는
  경우, 그리고 자정 넘어 재동기화되면 다음 날짜로 잘못 찍히는 경우가 있었음(실제로
  2026-07-10 스냅샷에 7/9 데이터가 중복 저장되고 진짜 7/10 실적은 7/11로 찍힌 사고 발생,
  직접 복구함). ② 로컬 백엔드 기동 시마다 체결내역·잔고·시세를 무조건 한 번
  캐치업 동기화하도록 추가(`run_startup_catchup_sync`) — 로컬 스케줄러는 그 시각에
  프로세스가 떠있어야만 도는 한계가 있어서, 컴퓨터를 며칠 꺼둬도 다시 켤 때 자동으로
  갭을 메운다.
- **SK하이닉스 ADR 추적 + 국내주 비교 차트**: SK하이닉스의 나스닥 ADR 상장(2026-07-10,
  when-issued 티커 `SKHYV`, 07-13 `SKHY`로 정식 전환 예정)을 US 마켓 리포트 추적 종목에
  추가. `TrackedUsStock`에 `compare_krx_symbol` 컬럼을 신설해 ADR처럼 국내 종목과 대응되는
  티커는 클릭 시 국내 원주(000660)와 등락률(%) 정규화 비교 차트를 보여주도록
  `UsTickerChartModal`을 확장 — 통화가 달라 절대가 대신 구간 시작일 대비 등락률로 겹쳐 그림.
- **아침 루틴 ↔ 매매습관 연동**: 서로 다른 저장소(아침 루틴 = 브라우저 로컬스토리지
  `routineStore.ts`, 매매습관 = 백엔드 DB)를 데이터는 분리한 채 UX만 연결. 아침 루틴
  Phase4에서 특정 종목에 목표가·손절가·진입조건을 미리 적어두면(`stockPlans`), 그날 그
  종목을 실제로 매수했을 때 매매습관 편집 폼에 "오늘 아침 계획과 일치 — 이걸로
  채울까요?" 배너가 뜨고 한 번에 가져올 수 있음(`routineStore.ts`의 `findStockPlan`).
  목록에도 계획이 있던 매수 건에 "📋 아침 계획" 배지 표시. 엑셀 원본의 "사기 전에
  목표가·손절가부터 정하기" 원칙을 가장 직접적으로 잇는 연결.
- **KIS 넥스트레이드(NXT) 체결 누락 버그 근본 원인 발견·수정**: 사용자가 실제로 매수한
  삼성전자·기아 체결이 동기화되지 않는 문제를 추적한 끝에, KIS의 일별체결조회
  API(`inquire-daily-ccld`)가 신설한 `EXCG_ID_DVSN_CD`(거래소ID구분코드: KRX/NXT/SOR/ALL)
  파라미터를 우리가 보내지 않아 KRX 체결만 조회되고 있었음을 확인(KIS 공식
  `open-trading-api` 저장소 예제 코드로 확인). 여기에 더해, 이 파라미터를 추가해도
  `python-kis` 2.1.6 라이브러리가 NXT 거래소코드를 인식하지 못해 `KeyError`로 조회
  자체가 실패 — 라이브러리는 v3에서 NXT를 정식 지원할 예정이지만 아직 미출시
  (Soju06/python-kis PR #85). 우리 쪽에서 ① 요청에 `EXCG_ID_DVSN_CD: "ALL"` 추가
  ② 미지 거래소코드를 KRX로 관대하게 처리하는 임시 패치를 적용해 해결.
  2024~2026년 재동기화로 총 344건의 누락 체결을 복구(삼성전자 순매수 875→963주,
  기아 409→376주로 실제 잔고와 거의 정확히 일치).
- **매매기법 문헌조사 문서화**: 이전에 `doc/sellbuy.md`(매매 기록·시황 상관관계 분석
  프로그램 설계, 미링크 상태)에 묻혀 있던 처분효과·손절/익절 근거와 반증·포지션
  사이징·CAN SLIM·리스크패리티·와이코프 거래량 분석 문헌조사를
  [매매기법 문헌조사](guide/매매기법-문헌조사.md)로 분리해 문서 허브에 연결.
  `sellbuy.md`는 spec 섹션에 "부분 구현"으로 등록 — 기록·판정 로직은 매매습관 기능으로
  이미 구현됐고, 매크로 상관분석 부분만 미구현 로드맵으로 남음.
- **문서 앱 내 열람 + 매매습관 스크롤 버그 수정**: `doc/`를 `frontend/public/docs/`로도
  동기화해 앱 안에서(관리 → 참고자료, `/docs/index.html`) 바로 열람 가능하게 함 —
  `publish-docs.sh`가 GitHub Pages 발행과 동시에 이 복사본도 갱신한다. 매매습관에서
  체결 편집 폼을 저장하면 목록 전체가 잠깐 "불러오는 중..."으로 대체되며 스크롤이
  맨 위로 튀던 버그도 수정(최초 로드만 전체 로딩 표시 + 저장한 행의 화면 위치 기준 스크롤 보정).
- **매매습관 — 체결일 전후 주가 흐름 표시**: 체결을 기록하면서 그날 시황을 바로 참고할 수
  있도록, 편집 폼에 체결일 앞뒤 1개월 미니 차트를 추가(체결일은 점으로 강조 표시).
  그날 등락률을 색상·수치로 보여주고, ±5%(대시보드 급등락 알림과 같은 기준) 이상 움직인
  날은 배지로 나열해 그 기간의 변동성을 한눈에 파악하게 함. 이를 위해
  `GET /portfolio/stocks/{symbol}/chart`에 `end_date`(과거 특정 시점 기준 조회) 파라미터와
  일별 `change_rate` 필드를 추가 — 기존 호출부는 그대로 호환.
- **급등락 알림 중복 재발송 버그 수정**: 목표가 알림(`target_buy_alerted`/`target_sell_alerted`)에는
  있던 "임계값을 처음 넘을 때만 1회 알림" 엣지 트리거가 급등락(±5%) 알림에는 없어서, 시세가
  갱신될 때마다(스케줄러 15:35 정기 실행, 수동 "KRX 시세 갱신"/"KIS 동기화" 버튼, 시작 시
  캐치업 동기화 등) 같은 상황에 대해 새 알림이 계속 쌓이고 있었다(실사용 데이터로 확인:
  SK하이닉스 하루에만 8건 중복). `Stock`에 `price_surge_alerted`/`price_drop_alerted` 플래그를
  추가해 동일 패턴을 적용 — `format_price_alert_message`/알림 생성 로직을
  `core/target_alerts.py`(`check_price_move_alert`)로 통합해 `price_updater.py`/`portfolio.py`
  양쪽에서 재사용.
- **예측시스템 초기버전 + 매크로/섹터 감성 파이프라인 버그 수정**: `doc/spec/StockMind-예측시스템-아이디어.md`
  (2026-06-01 작성)를 다시 파보니 Phase 1(Signal 적중률 추적)·Phase 2(Lead-Lag 분석)는 이미 구현돼
  있었는데 API만 있고 프론트엔드 어디에도 연결이 안 되어 있었음. 사전 분석 중 결정적 버그 발견:
  `core/ai_analyzer.py`의 분석 프롬프트가 6/2부터 `macro_analysis.topics`/`sector_analysis`의 내부
  스키마(`sentiment`/`outlook`/`impact`)를 `"topics":[...]` 같은 생략 표기로만 써놔서 AI가 해당 필드를
  빼고 반환 → `signal_extractor.py`가 dict가 아니거나 필드가 없으면 조용히 스킵 → 5주간 `macro_signals`
  0건, `sector_signals`는 96%가 기본값 NEUTRAL(NEGATIVE는 전체 기간 0건)로 쌓임. 프롬프트를 실제
  스키마 예시로 수정(정상/deep 분기 둘 다) — 6/2~7/11 구간은 백필하지 않기로 결정(비용 발생하는
  재분석 생략, 새로 들어오는 데이터부터 정상화). 이어서 Phase 3(변동성 스코어)를 완성해
  `core/volatility_forecast.py`(볼린저 스퀴즈·거래량 이상·Signal 밀도·급변 이력·감성 분열, 국내주
  한정) + 매수스코어×변동성 매트릭스 API(`GET /intel/stocks/{symbol}/forecast`)를 추가하고 차트
  페이지의 매수스코어 카드에 변동성 배지로 노출. 이미 계산되지만 프론트에 없던 Signal 적중률·
  Lead-Lag·리스크레이더는 인텔리전스 허브 새 "예측·리스크" 탭으로 연결만 해서 노출(새 백엔드 로직
  없이 기존 API 재사용). Phase 4~8(패턴 라이브러리·가설추적·시나리오·로테이션감지)은 데이터가 더
  쌓인 뒤로 보류.
- **매크로/섹터 감성 공백 재분석 도구**: 위 프롬프트 버그로 6/2~7/11 구간 감성 필드 없이 저장된 콘텐츠
  295건을 인텔리전스 허브 "예측·리스크" 탭에서 직접 재분석할 수 있게 함(`core/signal_extractor.py`의
  `list_signal_gap_candidates` — 저장된 macro_analysis/sector_analysis JSON에 sentiment 키가 있는지로
  버그 대상 여부 판별, 이미 있던 `reanalyze_content` 재사용이라 새 백엔드 로직 없음). 개별 재분석 + "7개씩
  일괄 처리" 버튼, 진행률 바, 실패 사유(첫 error 로그) 표시, 완료 목록 접이식 표시. 처음엔 Claude로
  하다 크레딧 부족으로 Gemini로 전환.
- **차트 기술적 패턴 적중률 검증(백테스트)**: `doc/guide/한국주식_차트분석_실전가이드.md`의 13절
  체크리스트를 다시 보니 이동평균·MACD·RSI·볼린저·거래량·3단계 확인법 등이 `lib/chartAnalysis.ts`에
  이미 대부분 구현돼 있었는데, 전부 "지금 조건이 맞는가"(통과/미통과)만 보여줄 뿐 "과거에 이 패턴이
  실제로 맞아떨어졌는가"는 검증하지 않았음. `evaluatePatternAccuracy()`를 추가해 MA 골든/데드크로스
  (`findMaCrossEvents` 재사용)·볼린저 스퀴즈(`computeBollinger`의 밴드폭 재사용)·거래량 급증(20일 평균
  1.5배↑, `enrichChartBars`의 volSpike 기준과 동일)를 이 종목의 과거 가격으로 N거래일(기본 5일) 후
  실제 방향과 대조해 사후 검증(AI 호출 없음, 순수 가격 데이터). 차트에 적중(초록✓)/실패(회색✗)/검증대기
  마커로 표시(`ANNOTATION_LAYERS`에 "패턴 적중" 레이어 추가), 패널에 "이 종목 기술적 패턴 적중률"
  스코어카드로 발생 내역 상세 표시, `analyzeMaCross`/`analyzeBollinger`/`analyzeVolume`의 판정 문구에도
  이 종목 실측 적중률을 덧붙여 3단계 확인법 판정 자체가 검증된 신뢰도를 반영하도록 함.
- **예측시스템 Phase 4 — 패턴 라이브러리**: `doc/spec/StockMind-예측시스템-아이디어.md`의 남은 Phase 4~8 중
  다음 순서. 세션 초반 프롬프트 버그 수정 이후 `macro_signals`가 397건으로 늘고 감성도 실제로 다양해져(금리
  POSITIVE 50/NEGATIVE 63, 환율 NEGATIVE 26/POSITIVE 17 등) 착수할 만한 데이터가 쌓임. `core/pattern_library.py`
  신설 — "금리 인하 기대(POSITIVE) 같은 매크로 Signal 뒤 2차전지 섹터가 실제로 N일 후 어떻게 움직였는지"를
  `MacroSignal` × 과거 가격(`core/signal_tracker.py`의 `price_change_pct` 재사용)으로 집계해 `pattern_library`
  테이블에 저장, 표본 3건 미만은 `hit_rate=None`("데이터 부족")으로 정직하게 표시. 섹터별 종목 조회 로직
  (`_stocks_for_sector_eval`)은 `core/sector_peers.py`의 `find_active_stocks_in_sector`로 공개 이동해
  signal_tracker.py와 공유. 새 매크로 Signal이 고신뢰(적중률 60%+, 표본 3건+) 패턴과 일치하면
  `signal_extractor.py`에서 보유 종목에 `AlertHistory(PATTERN_MATCH)` 자동 생성(같은 종목·같은 패턴 당일
  중복 방지). `GET /intel/patterns`·`POST /intel/patterns/extract` API, 매주 일요일 02:00 자동 갱신 스케줄,
  인텔리전스 허브 "예측·리스크" 탭에 패턴 라이브러리 섹션 추가. 실제 추출 결과는 예상외로 흥미로움 — "반도체
  업황 긍정 Signal → 반도체 반응" 적중률 0%(6건 중 0건), "AI 투자 확대 기대 → 반도체" 16.7%처럼 직관과 반대되는
  낮은 수치도 미화 없이 그대로 노출.
- **예측시스템 Phase 5 — AI Provider 스코어카드**: GPT/Claude/Gemini 중 어느 AI가 더 정확한 분석을 했는지
  Signal 적중률로 비교하는 기능. 문서의 pseudo-code는 `IntelContent.analysis_provider` 컬럼이 이미 있다고
  가정했지만 실제로는 `core/ai_analyzer.py`가 어느 provider로 분석했는지 전혀 기록하지 않고 있었음 — 컬럼
  신설 후 기록 경로를 새로 만듦. `_run_provider_chain()`(YouTube/뉴스/텍스트/재분석이 전부 공유하는 핵심
  경로)이 429 시 다음 provider로 넘어가는 fallback이 있어 "요청한 provider"와 "실제 성공한 provider"가
  다를 수 있음을 발견 — 반환값에 실제 성공한 provider를 추가해 정확히 기록하도록 수정(`_analyze_document`도
  동일하게 튜플 반환으로 변경, `analyze_json_prompt` 등 다른 호출부는 영향 없도록 내부에서만 언패킹).
  `core/provider_scorecard.py`가 provider별 섹터 Signal 적중률 집계(`GET /intel/providers/accuracy`),
  표본 10건 이상인 provider 중 최고 적중률을 명시적 provider 지정이 없는 호출에 한해 자동 사용(사용자가
  UI에서 직접 고른 경우는 그대로 존중, 기존 동작 100% 보존). 이 컬럼은 과거 데이터에 소급 적용이 안 돼
  지금은 표본 0건 — 실제 회귀 확인은 콘텐츠 1건을 Gemini로 재분석해 `analysis_provider`가 정확히
  기록되는지, 매크로/섹터 Signal이 여전히 정상 파생되는지로 검증. 인텔리전스 허브 "예측·리스크" 탭에
  AI 분석 정확도 섹션 추가.
- **예측시스템 Phase 8 — 섹터 로테이션 감지**: 남은 Phase 6~8을 한 번에 착수하며 문서 순서상 "가장 단순한"
  Phase 8부터. `core/sector_rotation.py`가 새 테이블 없이 기존 `SectorSignal`만으로, 최근 window_days
  (기본 30일)를 전·후반기로 나눠 섹터별 평균 감성 점수(POSITIVE=+1/NEUTRAL=0/NEGATIVE=-1 평균)의 delta를
  계산 — 상승/하락 섹터 Top3와, 보유 종목이 하락 섹터에 10%↑ 비중으로 몰려 있으면 경고 문구 생성
  (`core/sector_peers.sectors_match`로 종목-섹터 매칭). 실제 실행 결과 2차전지가 +0.67→-0.22로 급락,
  자동차가 -0.10→+0.33으로 반등하는 등 뚜렷한 로테이션 신호 확인. `GET /intel/sector-rotation`, 인텔리전스
  허브 "예측·리스크" 탭에 상승/하락 섹터 카드 섹션 추가.
- **예측시스템 Phase 7 — 포트폴리오 시나리오 시뮬레이터**: 문서 원안은 `MACRO_SCENARIOS`라는 하드코딩된
  섹터별 영향률(%) 딕셔너리를 가정했지만("과거 패턴 평균"이라는 주석과 달리 실제로는 지어낸 숫자) — Phase 4에서
  이미 실측한 `pattern_library`(trigger_topic×trigger_sentiment×target_sector×avg_move_pct×hit_rate)가
  있으므로 시나리오 자체를 이 실측 패턴에서 그대로 가져오도록 설계를 바꿈. 새 테이블(`scenario_results`)도
  불필요해짐 — hit_rate가 이미 "이 시나리오가 과거에 얼마나 맞았는지"를 담고 있기 때문. `core/scenario_simulator.py`가
  트리거(topic×sentiment)와 일치하는 패턴들을 찾아 보유 종목 각각을 섹터 매칭하고, 포트폴리오 비중
  (`Stock.current_value`)으로 가중합산해 추정 등락률·손익을 산출. 예: "환율 NEGATIVE"(원화 강세) 트리거 시
  자동차 섹터 비중 47.51%×avg_move_pct(-2.87%) = 추정 -1.365%(-11,604,196원) — 수작업 계산과 정확히 일치
  확인. `GET /intel/portfolio/simulate`, 인텔리전스 허브에 이미 로드된 패턴 목록에서 파생한 트리거 드롭다운 +
  시뮬레이션 결과(종목별 기여도 표) 섹션 추가.
- **예측시스템 Phase 6 — 투자 가설 추적**: "왜 이 종목을 매수했는가"라는 가설을 등록해두고 최근 Signal로
  자동 검증하는 기능(Phase 6~8 중 가장 큰 작업 — 새 테이블+CRUD+검증엔진+새 탭). `investment_theses` 테이블
  신설(`stock_id`, `category`: macro/sector/product/earnings, `time_horizon`: short/mid/long, `status`:
  active/confirmed/invalidated/expired, `supporting_signals`/`contradicting_signals` JSON, `validation_score`).
  `core/thesis_tracker.py`의 `validate_theses()`가 활성 가설마다 최근 7일 Signal을 카테고리별로 매칭
  (sector→`SectorSignal`을 `sectors_match`로, macro→`MacroSignal` 전체, product/earnings→종목 심볼 매칭
  `StockSignal`) — POSITIVE=지지·NEGATIVE=반박으로 분류(가설은 암묵적으로 "매수 논리"라는 긍정 전제),
  표본 3건 이상에서 지지율 80%↑면 confirmed·20%↓면 invalidated로 자동 전환. `POST/GET/PATCH /intel/theses`,
  `POST /intel/theses/validate` API, 매일 16:00(장마감 후) 자동 검증 스케줄러 잡 추가. 인텔리전스 허브에
  "투자 가설" 탭 신설 — 상태별 카운트, 목록(지지/반박 건수·검증점수·최근 검증일), 종목 선택 드롭다운을 포함한
  생성 폼, 만료 처리 버튼. 실제 가설 1건을 등록해 검증까지 완료 — 삼성전자 "HBM 수요 확대에 따른 반도체 업황
  개선 및 실적 턴어라운드"(sector 카테고리)가 최근 7일 반도체 섹터 Signal 63건(POSITIVE 42·NEGATIVE 9·
  NEUTRAL 12) 중 지지 42/반박 9 = 82.35%로 즉시 confirmed 전환 — 테스트 데이터가 아닌 실사용 첫 가설로 유지.
  이로써 StockMind 예측시스템 Phase 1~8 로드맵 전체 구현 완료.

### Phase 6 — 종목 그룹 비교 차트 · 업데이트 내역 뷰어 (2026-07-12)
- **종목 그룹 가격 추이 비교 차트**: 그룹 상세 페이지(`/groups/[id]`)에 그룹 내 종목들의 구간 시작일 종가
  대비 등락률(%) 비교 차트 추가. `api.getStockChart`로 멤버별 OHLC를 병렬 조회해 날짜 기준으로 정규화·병합하고,
  종목명 칩을 눌러 차트에서 종목별로 켜고 끌 수 있음(기본은 전체 표시). 차트 데이터를 못 가져오는 종목(6자리
  KRX 코드가 아닌 해외 티커 등)은 칩이 비활성화되고 "데이터 없음"으로 표시.
- **버전 배지 업데이트 내역(변경 로그) 뷰어**: 헤더의 `v{APP_VERSION}` 배지를 클릭하면 최근 기능 추가 내역을
  팝오버로 보여주는 기능 추가(`frontend/lib/changelog.ts` + `frontend/components/version-badge.tsx`). 이제부터
  눈에 띄는 기능을 추가할 때마다 버전 배지(날짜+시간)를 갱신하면서 이 목록에도 새 항목을 함께 추가한다.
- **`doc/sector.md` 기반 종목 그룹 자동 구성**: 사용자가 정리한 섹터·ETF 유니버스 문서(코어/자산배분/팩터/
  수급 테마/반도체 소부장/자동차부품·아틀라스/지주사 NAV 등)를 바탕으로 종목 그룹 17개를 구성 — 신규 10개
  (반도체 대장주, 반도체 소부장-전공정/후공정, 2차전지, 바이오, 인터넷·플랫폼, 금융지주, 자동차부품, 아틀라스
  로봇 밸류체인, 지주사 NAV 비교) + 기존 7개 그룹 보강(하이닉스 추종·조선·삼성전기 관련주·반도체 중간지주사·
  방산·원자력·현대차 관련주). 문서에 적힌 종목코드를 그대로 쓰지 않고 `pykrx.get_market_ticker_name`으로
  전부 사전 검증 — 문서의 SK스퀘어 코드(016360)가 실제로는 삼성증권이라는 오류를 발견해 정정(SK스퀘어의
  실제 코드는 기존 DB에 있던 402340). 등록 직후 각 종목의 차트를 1회 호출해 가격을 미리 채워둠(warm-up).
- **종목 그룹 상세 — 관련 ETF 패널**: 그룹 종목을 담고 있는 주요 ETF를 실시간으로 찾아 "내가 보유 중인 것"과
  "최근 3개월 수익률이 좋은 것(요즘 핫한 것)"으로 나눠 보여주는 패널 추가(`GET /stock-groups/{id}/etf-panel`,
  `core/etf_data.py`의 `build_group_etf_panel`). 사전에 sector.md에서 옮겨 적은 고정 ETF 목록을 쓰는 대신,
  기존에 있던 종목→ETF 역인덱스(`find_etfs_by_stock`, 네이버 ETF 구성종목 데이터 기반)를 그룹 멤버 전체에
  대해 조회·집계하는 방식을 택함 — 이름·코드가 자주 바뀌는 ETF를 손으로 유지보수할 필요가 없고, 실제로
  sector.md에는 없던 "SOL AI반도체소부장" 같은 최신 테마 ETF도 자동으로 잡힘. `Stock` 테이블의 보유수량으로
  보유 여부, 기존 랭킹 캐시(`fetch_etf_rankings`)로 등락률·3개월수익률을 붙여 추가 스크래핑 없이 구현.
- **노후생활(은퇴 설계) 섹션 신설**: `doc/retire_PRD.md` 기반 v1. 재정 보드에 "노후생활" 탭 추가
  (`/finance/retirement`). 백엔드 `core/retirement_service.py` — 프로필(출생연도·목표 은퇴 나이·목표 월
  생활비·위험성향, `FinanceJsonStore` 재사용), 진단 스냅샷(AI 호출 없음: 4% 룰 필요자금·달성률, 글라이드
  패스 목표 주식비중 밴드 대비 드리프트, 순자산 7일/90일 추세, 재정보드 등록 수입·지출 + 가계부 최근 3개월
  실측 평균으로 월 저축 여력 산출), AI 종합 의견(적절성 점수·향후 추세·실행 조치·재정보드 밸런스 조언·리스크
  경고 — PRD의 세제·건보료 지식 요약을 프롬프트에 내장), 주간 리뷰(매주 일 18:00 스케줄러
  `job_weekly_retirement_review` + 수동 실행, 실행 시 `AlertHistory`(RETIRE_REVIEW)로 알림 발행, 최근 30건
  보관). API는 `api/routes_retirement.py`(`/api/finance/retirement/*`). AI provider는 기본 Gemini
  (프리미엄 모델 3종 모두 quota/결제 문제로 사용 불가 확인 후 사용자가 기본 모델 진행으로 결정). 실데이터
  검증 완료 — 첫 의견(점수 92)·첫 주간 리뷰 생성됨.
- **프로그램 전반 점검·수정**: 워킹트리 전체를 8개 관점으로 병렬 점검하고 건별 재검증 후 15건 수정
  (정확성 9 + 정리·효율 6). 대표 수정 — 오픈뱅킹 refresh 토큰 미저장 유실, 주식공부하기 레슨 본문 공백
  (`chart.md` 이동 후 경로 깨짐), `advanceDueDate` KST 하루 밀림, 휴장일 stale 스냅샷 가드, 시나리오
  시뮬레이터 표본부족 패턴 제외, SQLite WAL+busy_timeout, FinanceJsonStore upsert 3중복 단일화,
  `is_krx_stock` 판정 통일. 상세·보류 권고 7건은 [doc/report/2026-07-12-전반점검.md](report/2026-07-12-전반점검.md).
  문서 형식 통일 — 인덱스 전 항목에 일자 표기, 리포트는 `doc/report/YYYY-MM-DD-주제.md` 규칙 신설.
- **바이브 코딩 과정 기록 + 허브 페이지**: 6주간의 개발 과정 자체를 기록·최적화 대상으로 문서화.
  [바이브 코딩 개발 과정 기록](guide/바이브코딩-프로세스.md)(타임라인·협업 구조·효율 장치·세션 간
  컨텍스트 복원법·실사고 기반 교훈 10) + 문서들에 흩어진 규칙·체크리스트를 한 화면에 모은
  [바이브 코딩 허브](vibecoding.html)(표준 워크플로 6단계, 기능 완료 체크리스트, 규칙 카드 8종,
  문서 맵, 교훈 10) 신설. 새 Phase가 끝나거나 새 규칙·교훈이 생기면 과정 기록에 append하고
  허브 페이지를 갱신한다.

---

## 외부 연동 · API 키 현황

키 값 자체는 절대 이 문서(공개 저장소)에 적지 않습니다 — 이름·용도·발급처만 기록합니다. 실제 값은 `backend/.env`(git 미추적)에 보관.

| 연동 | 키 이름 | 용도 | 발급처 | 필수 여부 | 도입 시점 |
|---|---|---|---|---|---|
| 한국투자증권(KIS) | `KIS_APP_KEY` / `KIS_APP_SECRET` | 잔고·시세·체결내역 동기화 | apiportal.koreainvestment.com | 필수 | 2026-05-31 (최초 커밋) |
| 키움증권 | `KIWOOM_APP_KEY` / `KIWOOM_APP_SECRET` | KIS와 계좌 합산(종목코드 기준) | openapi.kiwoom.com | 선택 | 2026-06-26 |
| Google Gemini | `GEMINI_API_KEY` | 유튜브/텍스트 AI 분석, 기본 분석 provider | aistudio.google.com | 필수 | 2026-05-31 |
| OpenAI | `OPENAI_API_KEY` | 구조화 분석 대체 provider (`gpt-4o-mini`) | platform.openai.com | 권장 | 2026-05-31 (스캐폴드) |
| Anthropic Claude | `ANTHROPIC_API_KEY` | 구조화 분석 대체 provider | console.anthropic.com | 선택 | 2026-05-31 (스캐폴드) |
| YouTube Data API | `YOUTUBE_API_KEY` | 채널 영상 목록 조회 | console.cloud.google.com | 선택 | 2026-05-31 (스캐폴드) |
| 공공데이터포털 | `PUBLIC_DATA_API_KEY` | 수출입 상세 통계 (없으면 KITA 통계로 대체) | data.go.kr | 선택 | 2026-05-31 |
| 금융결제원 오픈뱅킹 | `OPENBANKING_CLIENT_ID` / `OPENBANKING_CLIENT_SECRET` / `OPENBANKING_REDIRECT_URI` | 계좌 잔액 자동 동기화 (FinanceHub) | openbanking.or.kr | 선택 | 2026-06월 말 ~ 진행 중 (OAuth 인증 오류로 미완료, [STATUS](STATUS.md) 참고) |

**패턴**: 각 연동은 보통 "① 해당 기능(예: FinanceHub, 오픈뱅킹) 설계 → ② 발급 포털에서 앱/서비스 등록 → ③ `.env.example`에 변수 추가 + `README`의 API 키 표 갱신 → ④ 실제 `.env`에 값 입력" 순서로 정리됨. 여러 계좌/키가 필요한 KIS·키움은 `KIS_ACCOUNTS`/`KIWOOM_ACCOUNTS` 형식(세미콜론 구분)으로 계좌별 키를 한 줄에 모아 관리.

---

**갱신 규칙**: 새 기능이 완료되거나 새 외부 연동이 추가될 때 위 "개발 변천사"에 새 Phase(또는 기존 Phase에 항목)를 추가하고, 새 API 키가 생기면 "외부 연동 · API 키 현황" 표에 행을 추가한다. 과거 항목은 수정하지 않는다 (시점 기록물).
