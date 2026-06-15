"""
trade_analyzer.py
한국 수출입통계 자동 수집 + AI 분석 프로그램

데이터 소스:
  - 관세청 수출입 무역통계 (unipass.customs.go.kr/ets)
  - 공공데이터포털 Open API (data.go.kr)

분석:
  - 투자 목적: 품목별 수출 트렌드 (반도체, 자동차, 2차전지 등)
  - 거시경제:  국가별 무역수지, 전년 동월 비교, 추이 차트

실행: python trade_analyzer.py
"""

import os
import json
import time
import logging
import argparse
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

import requests
import pandas as pd

# ── 로깅 설정 ─────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)

# ── 경로 설정 ─────────────────────────────────────────────────────────────────
BASE_DIR   = Path(__file__).parent
DATA_DIR   = BASE_DIR / "data"
OUTPUT_DIR = BASE_DIR / "output"
DATA_DIR.mkdir(exist_ok=True)
OUTPUT_DIR.mkdir(exist_ok=True)

# ── 상수 ─────────────────────────────────────────────────────────────────────

# 공공데이터포털 관세청 API 기본 URL
CUSTOMS_API_BASE = "https://apis.data.go.kr/1220000"

# 관심 품목 (HS Code 2단위 기준)
SECTORS = {
    "반도체":      ["85"],        # HS 85: 전기기기
    "자동차":      ["87"],        # HS 87: 자동차
    "2차전지":     ["85"],        # 배터리 포함 (85류 하위)
    "선박":        ["89"],        # HS 89: 선박
    "석유화학":    ["39", "29"],   # 플라스틱, 유기화학품
    "철강":        ["72", "73"],   # 철강
    "디스플레이":  ["85", "90"],   # 전기기기, 광학기기
    "바이오/의약": ["30"],        # HS 30: 의약품
}

# 주요 무역 상대국 코드 (ISO 2자리)
COUNTRIES = {
    "중국":   "CN",
    "미국":   "US",
    "일본":   "JP",
    "베트남": "VN",
    "홍콩":   "HK",
    "대만":   "TW",
    "독일":   "DE",
    "인도":   "IN",
    "싱가폴": "SG",
    "호주":   "AU",
}


# ─────────────────────────────────────────────────────────────────────────────
# 1. 데이터 수집 레이어
# ─────────────────────────────────────────────────────────────────────────────

class TradeDataCollector:
    """
    관세청 공공 API를 통한 수출입 데이터 수집

    API 키 없이 사용 가능한 unipass 통계 엔드포인트 우선 사용,
    공공데이터포털 키가 있으면 더 상세한 데이터 수집
    """

    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key
        self.session = requests.Session()
        self.session.headers.update({
            "User-Agent": "TradeAnalyzer/1.0 (Research Purpose)",
            "Accept":     "application/json",
        })

    # ── 총괄 수출입 (API 키 불필요) ──────────────────────────────────────────

    def get_monthly_summary(self, year: int, month: int) -> Optional[dict]:
        """
        월별 수출입 총괄 통계 수집
        관세청 유니패스 통계 엔드포인트 사용 (인증 불필요)
        """
        yyyymm = f"{year}{month:02d}"
        logger.info(f"  수출입 총괄 조회: {yyyymm}")

        # 방법 1: 공공데이터포털 API (키 있을 때)
        if self.api_key:
            return self._fetch_summary_official(yyyymm)

        # 방법 2: 관세청 유니패스 통계 JSON (키 없을 때)
        return self._fetch_summary_unipass(yyyymm)

    def _fetch_summary_official(self, yyyymm: str) -> Optional[dict]:
        """공공데이터포털 관세청 수출입 총괄 API"""
        url = f"{CUSTOMS_API_BASE}/수출입총괄/getSumImpExpTotalList"
        params = {
            "serviceKey": self.api_key,
            "yyyyMm":     yyyymm,
            "numOfRows":  10,
            "pageNo":     1,
            "type":       "json",
        }
        try:
            resp = self.session.get(url, params=params, timeout=15)
            resp.raise_for_status()
            data = resp.json()
            items = (data.get("response", {})
                        .get("body", {})
                        .get("items", {})
                        .get("item", []))
            if items:
                return items[0] if isinstance(items, list) else items
        except Exception as e:
            logger.warning(f"공식 API 실패: {e}")
        return None

    def _fetch_summary_unipass(self, yyyymm: str) -> Optional[dict]:
        """
        관세청 유니패스 수출입통계 비공식 JSON 엔드포인트
        (브라우저에서 사용하는 내부 API)
        """
        url = "https://unipass.customs.go.kr/ets/ETS_CPLT_YM_ITEM.do"
        params = {
            "mblSeCd":  "M",      # 월별
            "yyyyMm":   yyyymm,
            "pageUnit": 10,
            "pageIndex": 1,
        }
        try:
            resp = self.session.get(url, params=params, timeout=15)
            if resp.status_code == 200:
                return {"raw": resp.text[:2000], "yyyymm": yyyymm}
        except Exception as e:
            logger.warning(f"유니패스 접근 실패: {e}")

        # Fallback: KITA K-stat 통계 (스크래핑)
        return self._fetch_from_kita(yyyymm)

    def _fetch_from_kita(self, yyyymm: str) -> Optional[dict]:
        """한국무역협회 K-stat 통계 (JSON API)"""
        year  = yyyymm[:4]
        month = yyyymm[4:]
        url = "https://stat.kita.net/stat/kts/sum/SumImpExpTotalAjax.screen"
        params = {
            "startYear":  year,
            "endYear":    year,
            "startMonth": month,
            "endMonth":   month,
        }
        try:
            resp = self.session.get(url, params=params, timeout=15)
            if resp.status_code == 200:
                data = resp.json()
                if data:
                    row = data[0] if isinstance(data, list) else data
                    return {
                        "yyyymm":      yyyymm,
                        "expDlr":      row.get("expAmt", 0),    # 수출액 (천달러)
                        "impDlr":      row.get("impAmt", 0),    # 수입액 (천달러)
                        "balDlr":      row.get("balAmt", 0),    # 무역수지
                        "expGrwRt":    row.get("expGrwRt", 0),  # 수출 증가율
                        "impGrwRt":    row.get("impGrwRt", 0),  # 수입 증가율
                    }
        except Exception as e:
            logger.warning(f"KITA 조회 실패: {e}")
        return None

    # ── 국가별 수출입 ─────────────────────────────────────────────────────────

    def get_country_stats(self, year: int, month: int) -> pd.DataFrame:
        """국가별 수출입 실적 수집"""
        yyyymm = f"{year}{month:02d}"
        logger.info(f"  국가별 수출입 조회: {yyyymm}")
        records = []

        if self.api_key:
            # 공공데이터포털 국가별 수출입 API
            url = f"{CUSTOMS_API_BASE}/국가별수출입실적/getCtrImpExpList"
            for ctr_name, ctr_cd in COUNTRIES.items():
                try:
                    params = {
                        "serviceKey": self.api_key,
                        "yyyyMm":     yyyymm,
                        "ctrCd":      ctr_cd,
                        "numOfRows":  1,
                        "type":       "json",
                    }
                    resp = self.session.get(url, params=params, timeout=15)
                    data = resp.json()
                    items = (data.get("response", {})
                                 .get("body", {})
                                 .get("items", {})
                                 .get("item", {}))
                    if items:
                        item = items if isinstance(items, dict) else items[0]
                        records.append({
                            "국가":     ctr_name,
                            "국가코드": ctr_cd,
                            "수출액":   float(item.get("expDlr", 0)),
                            "수입액":   float(item.get("impDlr", 0)),
                            "무역수지": float(item.get("balDlr", 0)),
                            "수출증가율": float(item.get("expGrwRt", 0)),
                        })
                    time.sleep(0.2)
                except Exception as e:
                    logger.warning(f"국가별 조회 실패 ({ctr_name}): {e}")
        else:
            # KITA 국가별 통계 (키 없을 때)
            records = self._fetch_country_kita(yyyymm)

        return pd.DataFrame(records) if records else pd.DataFrame()

    def _fetch_country_kita(self, yyyymm: str) -> list[dict]:
        """KITA 국가별 통계"""
        year  = yyyymm[:4]
        month = yyyymm[4:]
        records = []
        url = "https://stat.kita.net/stat/kts/ctr/CtrImpExpTotalAjax.screen"
        for ctr_name, ctr_cd in COUNTRIES.items():
            try:
                params = {
                    "startYear":  year, "endYear":   year,
                    "startMonth": month, "endMonth": month,
                    "ctrCd":      ctr_cd,
                }
                resp = self.session.get(url, params=params, timeout=10)
                if resp.status_code == 200:
                    data = resp.json()
                    if data:
                        row = data[0] if isinstance(data, list) else data
                        records.append({
                            "국가":     ctr_name,
                            "국가코드": ctr_cd,
                            "수출액":   float(row.get("expAmt", 0)),
                            "수입액":   float(row.get("impAmt", 0)),
                            "무역수지": float(row.get("balAmt", 0)),
                            "수출증가율": float(row.get("expGrwRt", 0)),
                        })
                time.sleep(0.15)
            except Exception:
                pass
        return records

    # ── 품목별 수출입 ─────────────────────────────────────────────────────────

    def get_item_stats(self, year: int, month: int) -> pd.DataFrame:
        """주요 품목별 수출입 실적 수집 (HS 2단위)"""
        yyyymm = f"{year}{month:02d}"
        logger.info(f"  품목별 수출입 조회: {yyyymm}")
        records = []

        # 중복 제거 (여러 섹터가 같은 HS 코드 사용)
        unique_hs = set()
        hs_to_sector = {}
        for sector, codes in SECTORS.items():
            for code in codes:
                if code not in unique_hs:
                    unique_hs.add(code)
                    hs_to_sector[code] = sector

        if self.api_key:
            url = f"{CUSTOMS_API_BASE}/품목별수출입실적/getItemImpExpList"
            for hs_code, sector in hs_to_sector.items():
                try:
                    params = {
                        "serviceKey": self.api_key,
                        "yyyyMm":     yyyymm,
                        "hsCd":       hs_code,
                        "hsUnit":     "2",
                        "numOfRows":  1,
                        "type":       "json",
                    }
                    resp = self.session.get(url, params=params, timeout=15)
                    data = resp.json()
                    items = (data.get("response", {})
                                 .get("body", {})
                                 .get("items", {})
                                 .get("item", {}))
                    if items:
                        item = items if isinstance(items, dict) else items[0]
                        records.append({
                            "섹터":     sector,
                            "HS코드":   hs_code,
                            "품목명":   item.get("itemNm", f"HS{hs_code}"),
                            "수출액":   float(item.get("expDlr", 0)),
                            "수입액":   float(item.get("impDlr", 0)),
                            "수출증가율": float(item.get("expGrwRt", 0)),
                            "수입증가율": float(item.get("impGrwRt", 0)),
                        })
                    time.sleep(0.2)
                except Exception as e:
                    logger.warning(f"품목 조회 실패 (HS{hs_code}): {e}")
        else:
            records = self._fetch_items_kita(yyyymm, hs_to_sector)

        return pd.DataFrame(records) if records else pd.DataFrame()

    def _fetch_items_kita(self, yyyymm: str, hs_to_sector: dict) -> list[dict]:
        """KITA 품목별 통계"""
        year  = yyyymm[:4]
        month = yyyymm[4:]
        records = []
        url = "https://stat.kita.net/stat/kts/mc/McImpExpTotalAjax.screen"
        for hs_code, sector in hs_to_sector.items():
            try:
                params = {
                    "startYear": year, "endYear": year,
                    "startMonth": month, "endMonth": month,
                    "hsCd": hs_code, "hsCdUnit": "2",
                }
                resp = self.session.get(url, params=params, timeout=10)
                if resp.status_code == 200:
                    data = resp.json()
                    if data:
                        row = data[0] if isinstance(data, list) else data
                        records.append({
                            "섹터":     sector,
                            "HS코드":   hs_code,
                            "품목명":   row.get("itemNm", f"HS{hs_code}"),
                            "수출액":   float(row.get("expAmt", 0)),
                            "수입액":   float(row.get("impAmt", 0)),
                            "수출증가율": float(row.get("expGrwRt", 0)),
                            "수입증가율": float(row.get("impGrwRt", 0)),
                        })
                time.sleep(0.15)
            except Exception:
                pass
        return records

    # ── 다월 수집 ─────────────────────────────────────────────────────────────

    def collect_months(self, months: int = 12) -> dict:
        """
        최근 N개월 데이터 전체 수집
        반환: {
          "summary":   DataFrame (월별 총괄),
          "countries": DataFrame (국가별, 최신월),
          "items":     DataFrame (품목별, 최신월),
          "meta":      dict
        }
        """
        logger.info(f"📦 최근 {months}개월 수출입 데이터 수집 시작")
        today = datetime.today()

        # 총괄: 최근 N개월
        summary_records = []
        for i in range(months):
            d = today.replace(day=1) - timedelta(days=i * 28)
            d = d.replace(day=1)
            row = self.get_monthly_summary(d.year, d.month)
            if row:
                row["year"]  = d.year
                row["month"] = d.month
                row["yyyymm"] = f"{d.year}{d.month:02d}"
                summary_records.append(row)
            time.sleep(0.3)

        # 국가별·품목별: 최신 완성된 달 기준
        ref = today.replace(day=1) - timedelta(days=35)
        ref = ref.replace(day=1)
        logger.info(f"  국가별/품목별 기준월: {ref.year}-{ref.month:02d}")

        country_df = self.get_country_stats(ref.year, ref.month)
        item_df    = self.get_item_stats(ref.year, ref.month)

        summary_df = pd.DataFrame(summary_records)

        # 캐시 저장
        cache_path = DATA_DIR / f"trade_data_{today.strftime('%Y%m')}.json"
        cache = {
            "collected_at": today.isoformat(),
            "months":       months,
            "ref_month":    f"{ref.year}{ref.month:02d}",
            "summary":      summary_records,
            "countries":    country_df.to_dict("records") if not country_df.empty else [],
            "items":        item_df.to_dict("records") if not item_df.empty else [],
        }
        cache_path.write_text(json.dumps(cache, ensure_ascii=False, indent=2))
        logger.info(f"✅ 데이터 캐시 저장: {cache_path}")

        return {
            "summary":   summary_df,
            "countries": country_df,
            "items":     item_df,
            "meta":      {"ref_month": f"{ref.year}-{ref.month:02d}", "months": months},
        }

    def load_cached(self) -> Optional[dict]:
        """이번 달 캐시 데이터 로드"""
        cache_path = DATA_DIR / f"trade_data_{datetime.today().strftime('%Y%m')}.json"
        if cache_path.exists():
            logger.info(f"📂 캐시 데이터 로드: {cache_path}")
            data = json.loads(cache_path.read_text())
            return {
                "summary":   pd.DataFrame(data.get("summary", [])),
                "countries": pd.DataFrame(data.get("countries", [])),
                "items":     pd.DataFrame(data.get("items", [])),
                "meta":      {"ref_month": data.get("ref_month"), "months": data.get("months")},
            }
        return None


# ─────────────────────────────────────────────────────────────────────────────
# 2. AI 분석 레이어
# ─────────────────────────────────────────────────────────────────────────────

class TradeAnalyzer:
    """
    Gemini AI를 활용한 수출입 데이터 분석

    분석 항목:
      1. 투자 관점: 주요 수출 품목 트렌드 → 관련 종목 투자 시사점
      2. 거시경제: 무역수지, 국가별 현황, 경기 시그널
    """

    SYSTEM_PROMPT = """당신은 한국 무역·거시경제 전문 애널리스트입니다.
제공된 수출입 통계를 바탕으로 투자자와 경제 연구자에게 유용한 분석을 제공합니다.

분석 원칙:
- 숫자를 단순 나열하지 않고 의미와 시사점을 해석합니다
- 투자 관점과 거시경제 관점을 동시에 제공합니다
- 전월 대비·전년 동월 대비 변화를 중심으로 분석합니다
- 관련 산업·섹터에 대한 투자 시사점을 명확히 제시합니다

⚠️ 투자 권유나 특정 종목 매수·매도 의견은 제시하지 않습니다.
   참고용 정보로만 활용하도록 안내합니다."""

    def __init__(self, gemini_api_key: str):
        self.api_key = gemini_api_key
        self._setup_gemini()

    def _setup_gemini(self):
        try:
            import google.generativeai as genai
            genai.configure(api_key=self.api_key)
            self.model = genai.GenerativeModel(
                "gemini-2.0-flash",
                system_instruction=self.SYSTEM_PROMPT,
            )
            logger.info("✅ Gemini AI 초기화 완료")
        except ImportError:
            logger.error("google-generativeai 미설치. pip install google-generativeai")
            self.model = None
        except Exception as e:
            logger.error(f"Gemini 초기화 실패: {e}")
            self.model = None

    def _call_gemini(self, prompt: str) -> str:
        """Gemini API 호출"""
        if not self.model:
            return "⚠️ Gemini API 미초기화. GEMINI_API_KEY를 확인하세요."
        try:
            response = self.model.generate_content(prompt)
            return response.text
        except Exception as e:
            logger.error(f"Gemini 호출 실패: {e}")
            return f"AI 분석 실패: {e}"

    def _df_to_text(self, df: pd.DataFrame, max_rows: int = 20) -> str:
        """DataFrame → 분석용 텍스트"""
        if df.empty:
            return "(데이터 없음)"
        return df.head(max_rows).to_string(index=False)

    # ── 분석 1: 수출입 총괄 트렌드 ──────────────────────────────────────────

    def analyze_summary_trend(self, summary_df: pd.DataFrame) -> str:
        """월별 총괄 수출입 트렌드 분석"""
        logger.info("  📊 수출입 총괄 트렌드 분석 중...")

        data_text = self._df_to_text(summary_df)
        prompt = f"""
## 한국 월별 수출입 총괄 데이터 (최근 {len(summary_df)}개월)

{data_text}

위 데이터를 바탕으로 다음을 분석해주세요:

### 분석 요청
1. **수출 트렌드 해석**
   - 최근 3개월 수출 방향성 (증가/감소/횡보)
   - 전년 동월 대비 성장률 평가
   - 주목할 변화 포인트

2. **무역수지 분석**
   - 흑자/적자 추이 및 원인 추정
   - 수출-수입 간 구조적 변화 여부

3. **거시경제 시사점**
   - 현재 무역 트렌드가 한국 경제에 주는 신호
   - 향후 1~3개월 전망

4. **투자 시사점** (참고용, 투자 권유 아님)
   - 수출 호조/부진이 특정 섹터에 미치는 영향
   - 주의 깊게 볼 지표

분석은 구체적 수치를 인용하면서 핵심 인사이트를 중심으로 서술해주세요.
"""
        return self._call_gemini(prompt)

    # ── 분석 2: 국가별 무역 분석 ─────────────────────────────────────────────

    def analyze_country_trade(self, country_df: pd.DataFrame, ref_month: str) -> str:
        """국가별 수출입 현황 분석"""
        logger.info("  🌍 국가별 무역 분석 중...")

        if country_df.empty:
            return "국가별 데이터 없음"

        # 수출 상위 5개국, 무역수지 기준 정렬
        sorted_exp = country_df.sort_values("수출액", ascending=False)
        sorted_bal = country_df.sort_values("무역수지", ascending=False)

        prompt = f"""
## 한국 국가별 수출입 실적 ({ref_month})

### 수출액 상위 순위
{self._df_to_text(sorted_exp)}

### 무역수지 순위
{self._df_to_text(sorted_bal)}

위 데이터를 바탕으로 다음을 분석해주세요:

### 분석 요청
1. **핵심 무역 상대국 현황**
   - 대중국 무역의 특징과 변화
   - 대미국 수출 동향
   - 새롭게 부상하거나 주목할 국가

2. **무역수지 국가별 해석**
   - 대규모 흑자·적자 국가와 그 구조적 원인
   - 무역 다변화 진행 여부

3. **지정학·공급망 리스크**
   - 특정 국가 의존도 문제
   - 공급망 재편과 관련된 시사점

4. **투자 관점 시사점** (참고용)
   - 국가별 수출 증감이 관련 산업에 주는 영향
   - 수혜 가능 섹터 (정보 목적, 투자 권유 아님)
"""
        return self._call_gemini(prompt)

    # ── 분석 3: 품목별 섹터 분석 ─────────────────────────────────────────────

    def analyze_sector_items(self, item_df: pd.DataFrame, ref_month: str) -> str:
        """주요 품목별 섹터 분석 — 투자 관점"""
        logger.info("  🏭 품목별 섹터 분석 중...")

        if item_df.empty:
            return "품목별 데이터 없음"

        sorted_df = item_df.sort_values("수출액", ascending=False)

        prompt = f"""
## 한국 주요 품목별 수출입 실적 ({ref_month})

{self._df_to_text(sorted_df)}

위 데이터를 바탕으로 다음을 분석해주세요:

### 분석 요청
1. **핵심 수출 품목 현황**
   - 수출 1~3위 품목의 성장성 평가
   - 전년 동월 대비 두드러진 증가/감소 품목

2. **섹터별 투자 관점 분석** (참고용, 투자 권유 아님)
   - 반도체: 글로벌 AI 수요와의 연관성
   - 자동차: EV 전환 영향
   - 2차전지: 글로벌 배터리 시장 포지션
   - 기타 주목 품목

3. **수출 집중도·다변화 분석**
   - 특정 품목 의존도 문제
   - 신성장 품목 부상 여부

4. **섹터별 단기 전망** (1~3개월)
   - 각 섹터 수출 전망 및 주요 변수
   - 주의 깊게 볼 경제 이벤트

구체적 수치와 함께 투자자·연구자가 바로 활용할 수 있는 인사이트를 제공해주세요.
"""
        return self._call_gemini(prompt)

    # ── 분석 4: 종합 인사이트 + 투자·거시경제 통합 ───────────────────────────

    def analyze_integrated(
        self,
        summary_df: pd.DataFrame,
        country_df: pd.DataFrame,
        item_df:    pd.DataFrame,
        ref_month:  str,
    ) -> str:
        """투자 목적 + 거시경제 통합 분석"""
        logger.info("  🔗 통합 분석 중...")

        # 핵심 수치 추출 (프롬프트 길이 절약)
        summary_top = self._df_to_text(summary_df.head(3))
        country_top = self._df_to_text(
            country_df.sort_values("수출액", ascending=False).head(5)
            if not country_df.empty else country_df
        )
        item_top = self._df_to_text(
            item_df.sort_values("수출액", ascending=False).head(5)
            if not item_df.empty else item_df
        )

        prompt = f"""
## 한국 수출입통계 통합 분석 보고서 ({ref_month})

### 최근 월별 총괄 추이 (최근 3개월)
{summary_top}

### 주요 수출 대상국 (수출액 상위 5개국)
{country_top}

### 주요 수출 품목 (수출액 상위 5개 품목)
{item_top}

---

## 요청: 아래 두 가지 관점에서 통합 분석 보고서를 작성해주세요

### [투자 관점 분석]
- 현재 수출 트렌드에서 주목해야 할 섹터 (반도체, 자동차, 배터리 등)
- 국가별 수출 데이터가 주는 섹터별 투자 시사점
- 향후 1~3개월 수출 전망과 관련 섹터 영향
- (※ 투자 권유 아님, 참고 정보 목적)

### [거시경제 관점 분석]
- 현재 한국 무역의 강점과 취약점
- 글로벌 경기·지정학 리스크와 한국 수출의 관계
- 환율·원자재 가격과 무역수지의 연관성
- 향후 주목해야 할 경제 지표·이벤트 캘린더

### [종합 결론]
- 이번 달 가장 중요한 트레이드 시그널 3가지
- 다음 달 발표 시 주의깊게 볼 포인트

보고서 형식으로 작성하되, 핵심 내용을 불릿으로 명확하게 정리해주세요.
"""
        return self._call_gemini(prompt)


# ─────────────────────────────────────────────────────────────────────────────
# 3. 리포트 생성
# ─────────────────────────────────────────────────────────────────────────────

class ReportGenerator:
    """분석 결과를 Markdown + Excel 리포트로 저장"""

    def __init__(self, output_dir: Path = OUTPUT_DIR):
        self.output_dir = output_dir

    def save_markdown(self, analyses: dict, meta: dict) -> Path:
        """전체 분석 결과를 Markdown 리포트로 저장"""
        now = datetime.now()
        ref = meta.get("ref_month", now.strftime("%Y-%m"))
        fname = f"trade_report_{now.strftime('%Y%m%d_%H%M')}.md"
        path  = self.output_dir / fname

        lines = [
            f"# 한국 수출입통계 분석 리포트",
            f"**분석 기준월**: {ref}  ",
            f"**생성 일시**: {now.strftime('%Y년 %m월 %d일 %H:%M')}  ",
            f"**수집 범위**: 최근 {meta.get('months', 12)}개월",
            "",
            "> ⚠️ **면책 조항**: 본 리포트는 공공 데이터를 기반으로 AI가 작성한 참고용 정보입니다.",
            "> 투자 결정의 근거로 사용하지 마시고, 투자 손익의 책임은 투자자 본인에게 있습니다.",
            "",
            "---",
            "",
        ]

        sections = [
            ("📈 수출입 총괄 트렌드 분석",       "summary_trend"),
            ("🌍 국가별 무역 현황 분석",          "country_trade"),
            ("🏭 품목별·섹터별 분석 (투자 관점)", "sector_items"),
            ("🔗 통합 분석 보고서",               "integrated"),
        ]

        for title, key in sections:
            lines.append(f"## {title}")
            lines.append("")
            lines.append(analyses.get(key, "(분석 없음)"))
            lines.append("")
            lines.append("---")
            lines.append("")

        path.write_text("\n".join(lines), encoding="utf-8")
        logger.info(f"✅ Markdown 리포트 저장: {path}")
        return path

    def save_excel(self, data: dict) -> Path:
        """수집 데이터를 Excel로 저장"""
        now   = datetime.now()
        fname = f"trade_data_{now.strftime('%Y%m%d_%H%M')}.xlsx"
        path  = self.output_dir / fname

        with pd.ExcelWriter(path, engine="openpyxl") as writer:
            if not data["summary"].empty:
                data["summary"].to_excel(writer, sheet_name="월별총괄", index=False)
            if not data["countries"].empty:
                data["countries"].to_excel(writer, sheet_name="국가별", index=False)
            if not data["items"].empty:
                data["items"].to_excel(writer, sheet_name="품목별", index=False)

        logger.info(f"✅ Excel 데이터 저장: {path}")
        return path

    def print_summary(self, data: dict):
        """터미널 요약 출력"""
        print("\n" + "="*60)
        print("  한국 수출입통계 수집 결과 요약")
        print("="*60)

        meta = data.get("meta", {})
        print(f"  기준월: {meta.get('ref_month', '-')}")
        print(f"  수집 범위: 최근 {meta.get('months', '-')}개월")
        print()

        if not data["summary"].empty:
            df = data["summary"]
            print(f"  📊 총괄 데이터: {len(df)}개월 수집")
            for col in ["expDlr", "impDlr", "balDlr"]:
                if col in df.columns:
                    latest = df.iloc[0].get(col, 0)
                    label  = {"expDlr":"수출","impDlr":"수입","balDlr":"무역수지"}[col]
                    try:
                        print(f"     최신월 {label}: ${float(latest):,.0f}천")
                    except Exception:
                        pass

        if not data["countries"].empty:
            df = data["countries"]
            print(f"\n  🌍 국가별 데이터: {len(df)}개국")
            if "수출액" in df.columns:
                top = df.nlargest(3, "수출액")[["국가","수출액","무역수지"]]
                print("     수출 상위 3개국:")
                for _, row in top.iterrows():
                    print(f"       {row['국가']}: ${row['수출액']:,.0f}천")

        if not data["items"].empty:
            df = data["items"]
            print(f"\n  🏭 품목별 데이터: {len(df)}개 품목")
            if "수출액" in df.columns:
                top = df.nlargest(3, "수출액")[["섹터","수출액","수출증가율"]]
                print("     수출 상위 3개 품목:")
                for _, row in top.iterrows():
                    grw = row.get("수출증가율", 0)
                    sign = "+" if float(grw) >= 0 else ""
                    print(f"       {row['섹터']}: ${row['수출액']:,.0f}천 ({sign}{grw}%)")

        print("="*60 + "\n")


# ─────────────────────────────────────────────────────────────────────────────
# 4. 메인 실행
# ─────────────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="한국 수출입통계 수집 및 AI 분석")
    parser.add_argument("--api-key",    help="공공데이터포털 API 키 (선택)")
    parser.add_argument("--gemini-key", help="Gemini API 키 (분석용)")
    parser.add_argument("--months",     type=int, default=12, help="수집 개월 수 (기본: 12)")
    parser.add_argument("--no-cache",   action="store_true",  help="캐시 무시하고 새로 수집")
    parser.add_argument("--no-analyze", action="store_true",  help="AI 분석 건너뜀")
    parser.add_argument("--no-excel",   action="store_true",  help="Excel 저장 건너뜀")
    args = parser.parse_args()

    # 환경변수에서도 API 키 로드
    from dotenv import load_dotenv
    load_dotenv()
    public_api_key = args.api_key    or os.getenv("PUBLIC_DATA_API_KEY")
    gemini_api_key = args.gemini_key or os.getenv("GEMINI_API_KEY")

    print("\n🇰🇷 한국 수출입통계 분석 프로그램")
    print(f"   공공데이터 API: {'✅ 있음' if public_api_key else '❌ 없음 (KITA 대체 사용)'}")
    print(f"   Gemini AI:      {'✅ 있음' if gemini_api_key else '❌ 없음 (분석 건너뜀)'}")
    print()

    # ── Step 1: 데이터 수집 ──────────────────────────────────────────────────
    print("━"*50)
    print("Step 1: 데이터 수집")
    print("━"*50)

    collector = TradeDataCollector(api_key=public_api_key)
    reporter  = ReportGenerator()

    # 캐시 확인
    data = None
    if not args.no_cache:
        data = collector.load_cached()

    if data is None:
        data = collector.collect_months(months=args.months)

    reporter.print_summary(data)

    # Excel 저장
    if not args.no_excel:
        reporter.save_excel(data)

    # ── Step 2: AI 분석 ──────────────────────────────────────────────────────
    if args.no_analyze or not gemini_api_key:
        print("⏩ AI 분석 건너뜀 (--no-analyze 또는 GEMINI_API_KEY 없음)")
        return

    print("━"*50)
    print("Step 2: AI 분석")
    print("━"*50)

    analyzer  = TradeAnalyzer(gemini_api_key=gemini_api_key)
    ref_month = data["meta"].get("ref_month", "")
    analyses  = {}

    # 분석 1: 총괄 트렌드
    if not data["summary"].empty:
        analyses["summary_trend"] = analyzer.analyze_summary_trend(data["summary"])

    # 분석 2: 국가별
    if not data["countries"].empty:
        analyses["country_trade"] = analyzer.analyze_country_trade(
            data["countries"], ref_month
        )

    # 분석 3: 품목별
    if not data["items"].empty:
        analyses["sector_items"] = analyzer.analyze_sector_items(
            data["items"], ref_month
        )

    # 분석 4: 통합 인사이트
    analyses["integrated"] = analyzer.analyze_integrated(
        data["summary"], data["countries"], data["items"], ref_month
    )

    # ── Step 3: 리포트 저장 ──────────────────────────────────────────────────
    print("━"*50)
    print("Step 3: 리포트 저장")
    print("━"*50)

    report_path = reporter.save_markdown(analyses, data["meta"])

    print(f"\n🎉 완료!")
    print(f"   📄 리포트: {report_path}")
    print(f"   📁 데이터: {DATA_DIR}")
    print(f"   📊 결과물: {OUTPUT_DIR}")

    # 통합 분석 결과 터미널 출력
    if "integrated" in analyses:
        print("\n" + "="*60)
        print("  📋 통합 분석 결과 (요약)")
        print("="*60)
        # 처음 500자만 미리보기
        preview = analyses["integrated"][:500]
        print(preview)
        if len(analyses["integrated"]) > 500:
            print(f"\n  ... (전체 내용은 리포트 파일에서 확인하세요)")
        print("="*60)


if __name__ == "__main__":
    main()