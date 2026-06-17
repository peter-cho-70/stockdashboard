/** 주식공부하기(chart.md 커리큘럼) ↔ 분석 화면 약어·용어 */

export interface StudyTermEntry {
  /** 매칭용 (긴 구문 우선) */
  match: string;
  /** 표시 약어 */
  abbr: string;
  /** 풀네임 */
  fullName: string;
  /** 한 줄 설명 */
  definition: string;
  /** /learn/{id} — 없으면 클릭 링크 없음 */
  lessonId?: string;
}

export const STUDY_TERM_ENTRIES: StudyTermEntry[] = [
  {
    match: "골든크로스",
    abbr: "골든크로스",
    fullName: "Golden Cross",
    definition: "단기 이동평균선이 장기선을 위로 돌파하는 교차. 상승 전환 신호로 자주 봅니다.",
    lessonId: "ma-basics",
  },
  {
    match: "데드크로스",
    abbr: "데드크로스",
    fullName: "Dead Cross",
    definition: "단기 이동평균선이 장기선을 아래로 돌파하는 교차. 추세 약화·하락 전환 신호로 봅니다.",
    lessonId: "ma-basics",
  },
  {
    match: "정배열",
    abbr: "정배열",
    fullName: "이동평균 정배열",
    definition: "단기 MA > 중기 MA > 장기 MA 순서. 상승 추세 구조로 해석하는 경우가 많습니다.",
    lessonId: "ma-basics",
  },
  {
    match: "역배열",
    abbr: "역배열",
    fullName: "이동평균 역배열",
    definition: "장기 MA > 중기 MA > 단기 MA 순서. 하락 추세 구조로 해석하는 경우가 많습니다.",
    lessonId: "ma-basics",
  },
  {
    match: "눌림목",
    abbr: "눌림목",
    fullName: "Pullback",
    definition: "상승 추세 중 단기 조정으로 이동평균선 근처까지 내려온 구간. 지지 확인 후 매수 타이밍으로 봅니다.",
    lessonId: "ma-basics",
  },
  {
    match: "이격도",
    abbr: "이격도",
    fullName: "Disparity",
    definition: "주가와 이동평균선 사이 간격. 너무 벌어지면 과열·되돌림 가능성을 봅니다.",
    lessonId: "ma-basics",
  },
  {
    match: "이동평균선",
    abbr: "이동평균",
    fullName: "Moving Average (MA)",
    definition: "일정 기간 종가 평균을 연결한 선. 추세·지지·저항 판단에 씁니다.",
    lessonId: "ma-basics",
  },
  { match: "MA120", abbr: "MA120", fullName: "120일 이동평균", definition: "약 6개월 장기 추세선.", lessonId: "ma-basics" },
  { match: "MA60", abbr: "MA60", fullName: "60일 이동평균", definition: "중기 추세선. 추세 이탈 시 비중 축소 참고.", lessonId: "ma-basics" },
  { match: "MA20", abbr: "MA20", fullName: "20일 이동평균", definition: "단기~중기 추세선. 눌림목·골든크로스에 자주 씁니다.", lessonId: "ma-basics" },
  { match: "MA5", abbr: "MA5", fullName: "5일 이동평균", definition: "초단기 추세선. 단기 매매·교차 신호에 씁니다.", lessonId: "ma-basics" },
  {
    match: "MA교차",
    abbr: "MA교차",
    fullName: "이동평균 교차",
    definition: "서로 다른 기간 이동평균선이 교차하는 지점. 골든·데드크로스와 같습니다.",
    lessonId: "ma-basics",
  },
  {
    match: "MACD",
    abbr: "MACD",
    fullName: "Moving Average Convergence Divergence",
    definition: "12·26일 EMA 차이와 시그널선으로 모멘텀·추세 전환을 봅니다. 히스토그램 방향도 중요합니다.",
  },
  {
    match: "히스토그램",
    abbr: "히스토그램",
    fullName: "MACD Histogram",
    definition: "MACD선과 시그널선의 차이. 방향 전환이 크로스보다 빠른 선행 신호로 쓰이기도 합니다.",
  },
  {
    match: "RSI",
    abbr: "RSI",
    fullName: "Relative Strength Index",
    definition: "최근 N일 상승·하락 강도 지수(0~100). 과열·과매도 구간 판단에 쓰지만 시장 국면별 해석이 달라집니다.",
  },
  {
    match: "볼린저밴드",
    abbr: "볼린저밴드",
    fullName: "Bollinger Bands",
    definition: "20일 MA를 중심으로 ±2σ 밴드를 그린 변동성 지표. 스퀴즈·밴드워크 등으로 봅니다.",
  },
  { match: "볼린저", abbr: "볼린저", fullName: "Bollinger Bands", definition: "볼린저밴드의 줄임. 변동성·추세 강도 참고.", },
  {
    match: "스퀴즈",
    abbr: "스퀴즈",
    fullName: "Bollinger Squeeze",
    definition: "볼린저 밴드 폭이 좁아진 상태. 변동성 확대(큰 움직임) 전조로 봅니다.",
  },
  {
    match: "밴드워크",
    abbr: "밴드워크",
    fullName: "Band Walk",
    definition: "강한 추세에서 주가가 볼린저 상·하단을 따라 움직이는 패턴.",
  },
  {
    match: "지지·저항",
    abbr: "지지·저항",
    fullName: "Support / Resistance",
    definition: "가격이 자주 멈추거나 반등·반락하는 구간. 52주 고저·라운드피겨 등이 기준이 됩니다.",
    lessonId: "danger-10",
  },
  {
    match: "지지",
    abbr: "지지",
    fullName: "Support",
    definition: "하락 시 매수세가 모여 가격이 버티는 구간.",
    lessonId: "danger-10",
  },
  {
    match: "저항",
    abbr: "저항",
    fullName: "Resistance",
    definition: "상승 시 매도세가 모여 가격이 막히는 구간.",
    lessonId: "danger-10",
  },
  {
    match: "손절",
    abbr: "손절",
    fullName: "Stop Loss",
    definition: "손실 한도를 정해 포지션을 줄이거나 청산하는 기준.",
    lessonId: "danger-10",
  },
  {
    match: "거래량",
    abbr: "거래량",
    fullName: "Volume",
    definition: "일정 기간 거래된 주식 수. 가격 움직임의 신뢰도를 확인할 때 함께 봅니다.",
    lessonId: "patterns-context",
  },
  {
    match: "추정 PER",
    abbr: "추정 PER",
    fullName: "Forward PER",
    definition: "애널리스트 전망 EPS 기준 PER. 미래 이익 반영 참고치입니다.",
    lessonId: "valuation",
  },
  {
    match: "추정 EPS",
    abbr: "추정 EPS",
    fullName: "Forward EPS",
    definition: "앞으로 예상되는 주당순이익(컨센서스).",
    lessonId: "valuation",
  },
  {
    match: "PER",
    abbr: "PER",
    fullName: "Price Earnings Ratio",
    definition: "주가÷EPS. 이익 대비 주가가 몇 배인지 봅니다. 업종 평균과 비교가 중요합니다.",
    lessonId: "valuation",
  },
  {
    match: "PBR",
    abbr: "PBR",
    fullName: "Price Book-value Ratio",
    definition: "주가÷BPS. 순자산 대비 주가 수준을 봅니다.",
    lessonId: "valuation",
  },
  {
    match: "EPS",
    abbr: "EPS",
    fullName: "Earnings Per Share",
    definition: "주당순이익. 1주당 벌어들인 이익(원).",
    lessonId: "valuation",
  },
  {
    match: "BPS",
    abbr: "BPS",
    fullName: "Book-value Per Share",
    definition: "주당순자산. 1주당 회사 자산 가치(원).",
    lessonId: "valuation",
  },
  {
    match: "컨센서스",
    abbr: "컨센서스",
    fullName: "Analyst Consensus",
    definition: "증권사 애널리스트들의 평균 전망(목표가·EPS 등).",
    lessonId: "valuation",
  },
  {
    match: "외국인",
    abbr: "외국인",
    fullName: "Foreign Investor",
    definition: "외국인 투자자 순매수·보유 비중. 한국 시장 수급 분석의 핵심 축입니다.",
    lessonId: "patterns-context",
  },
  {
    match: "기관",
    abbr: "기관",
    fullName: "Institutional Investor",
    definition: "연기금·보험·자산운용 등 기관 투자자. 외국인과 함께 수급을 봅니다.",
    lessonId: "patterns-context",
  },
  {
    match: "KIS",
    abbr: "KIS",
    fullName: "한국투자증권 Open API",
    definition: "한국투자증권 HTS/API 연동. 실시간 수급·잔고 조회에 사용합니다.",
  },
];

/** 긴 구문 우선 매칭 */
export const STUDY_TERMS_BY_LENGTH = [...STUDY_TERM_ENTRIES].sort(
  (a, b) => b.match.length - a.match.length,
);

const TERM_BY_MATCH = new Map(STUDY_TERM_ENTRIES.map((e) => [e.match.toLowerCase(), e]));

export function getStudyTerm(match: string): StudyTermEntry | undefined {
  return TERM_BY_MATCH.get(match.toLowerCase());
}

export function studyLessonHref(lessonId?: string): string | null {
  if (!lessonId) return null;
  return `/learn/${lessonId}`;
}

/** 라벨(예: PER · EPS) → 대표 lessonId */
export const VALUATION_LABEL_LESSONS: Record<string, string> = {
  "PER · EPS": "valuation",
  "추정 PER · EPS": "valuation",
  "PBR · BPS": "valuation",
  "동일업종 PER": "valuation",
  "외국인 소진율": "patterns-context",
  "외국인 보유율": "patterns-context",
};

/** signal.id → lesson */
export const SIGNAL_LESSON_LINKS: Record<string, string> = {
  trend: "ma-basics",
  ma_cross: "ma-basics",
  pullback: "ma-basics",
  volume: "patterns-context",
  sr: "danger-10",
  bollinger: "ma-basics",
  macd: "ma-basics",
  rsi: "ma-basics",
};

export const STAGE_LESSON_LINKS: Record<string, string> = {
  "시장·섹터 확인": "patterns-context",
  "수급 확인 (가장 중요)": "patterns-context",
  "기술적 확인": "ma-basics",
};
