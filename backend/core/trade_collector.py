"""
core/trade_collector.py — 한국 수출입 통계 수집 (KITA / 관세청)
"""
from __future__ import annotations

import json
import logging
import time
import xml.etree.ElementTree as ET
from collections import defaultdict
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

import pandas as pd
import requests

logger = logging.getLogger(__name__)
DATA_DIR = Path(__file__).resolve().parent.parent / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)

# 공공데이터포털 관세청 API
CUSTOMS_API_BASE = "https://apis.data.go.kr/1220000"
ITEMTRADE_URL = f"{CUSTOMS_API_BASE}/Itemtrade/getItemtradeList"

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

def _to_float(val: object) -> float:
    try:
        if val is None or val == "":
            return 0.0
        return float(val)
    except (TypeError, ValueError):
        return 0.0


def _pick_amount(row: dict, *keys: str) -> float:
    for key in keys:
        if key in row and row[key] is not None:
            v = _to_float(row[key])
            if v != 0:
                return v
    for key in keys:
        if key in row and row[key] is not None:
            return _to_float(row[key])
    return 0.0


def normalize_summary_row(row: dict, yyyymm: str) -> dict:
    """프론트·AI 공통 필드명으로 통일"""
    year, month = int(yyyymm[:4]), int(yyyymm[4:6])
    exp = _pick_amount(row, "수출액", "expAmt", "expDlr", "expDlrAmt", "export")
    imp = _pick_amount(row, "수입액", "impAmt", "impDlr", "import")
    bal = _pick_amount(row, "무역수지", "balAmt", "balDlr", "balance")
    if bal == 0 and (exp or imp):
        bal = exp - imp
    return {
        "yyyymm": yyyymm,
        "year": year,
        "month": month,
        "수출액": exp,
        "수입액": imp,
        "무역수지": bal,
        "수출증가율": _pick_amount(row, "수출증가율", "expGrwRt"),
        "수입증가율": _pick_amount(row, "수입증가율", "impGrwRt"),
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
            "User-Agent": "Mozilla/5.0 (compatible; StockMind/1.0)",
            "Accept": "*/*",
        })

    # ── 총괄 수출입 (API 키 불필요) ──────────────────────────────────────────

    def get_monthly_summary(self, year: int, month: int) -> Optional[dict]:
        """
        월별 수출입 총괄 통계 수집
        관세청 유니패스 통계 엔드포인트 사용 (인증 불필요)
        """
        yyyymm = f"{year}{month:02d}"
        logger.info(f"  수출입 총괄 조회: {yyyymm}")

        row: Optional[dict] = None
        if self.api_key:
            agg = self._fetch_itemtrade_monthly_totals(yyyymm, yyyymm)
            totals = agg.get(yyyymm)
            if totals and (totals["exp"] or totals["imp"]):
                row = {
                    "expDlr": totals["exp"],
                    "impDlr": totals["imp"],
                    "balDlr": totals["bal"],
                }
        if not row:
            row = self._fetch_from_kita(yyyymm)
        if row:
            return normalize_summary_row(row, yyyymm)
        return None

    def _parse_itemtrade_yyyymm(self, year_field: str) -> Optional[str]:
        """API year 필드 예: 2025.01 → 202501"""
        raw = (year_field or "").strip().replace(".", "").replace("-", "")
        if len(raw) >= 6 and raw[:6].isdigit():
            return raw[:6]
        return None

    def _fetch_itemtrade_monthly_totals(
        self, strt_yyyymm: str, end_yyyymm: str
    ) -> dict[str, dict[str, float]]:
        """품목별 무역 API 응답을 월별 수출·수입·수지로 집계"""
        aggregates: dict[str, dict[str, float]] = defaultdict(
            lambda: {"exp": 0.0, "imp": 0.0, "bal": 0.0}
        )
        page = 1
        total_pages = 1
        try:
            while page <= total_pages:
                resp = self.session.get(
                    ITEMTRADE_URL,
                    params={
                        "serviceKey": self.api_key,
                        "strtYymm": strt_yyyymm,
                        "endYymm": end_yyyymm,
                        "pageNo": page,
                        "numOfRows": 5000,
                    },
                    timeout=90,
                )
                resp.raise_for_status()
                root = ET.fromstring(resp.text)
                rc = root.findtext(".//resultCode")
                if rc != "00":
                    logger.warning(
                        "Itemtrade API %s: %s",
                        rc,
                        root.findtext(".//resultMsg"),
                    )
                    break
                total_count = int(root.findtext(".//totalCount") or 0)
                num_rows = int(root.findtext(".//numOfRows") or 5000) or 5000
                total_pages = max(1, (total_count + num_rows - 1) // num_rows)

                for item in root.findall(".//item"):
                    yyyymm = self._parse_itemtrade_yyyymm(item.findtext("year") or "")
                    if not yyyymm:
                        continue
                    exp = _to_float(item.findtext("expDlr"))
                    imp = _to_float(item.findtext("impDlr"))
                    aggregates[yyyymm]["exp"] += exp
                    aggregates[yyyymm]["imp"] += imp
                    aggregates[yyyymm]["bal"] = aggregates[yyyymm]["exp"] - aggregates[yyyymm]["imp"]

                page += 1
                if page <= total_pages:
                    time.sleep(0.15)
        except Exception as e:
            logger.warning("Itemtrade 집계 실패: %s", e)
        return dict(aggregates)

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
                        "yyyymm": yyyymm,
                        "expAmt": row.get("expAmt", 0),
                        "impAmt": row.get("impAmt", 0),
                        "balAmt": row.get("balAmt", 0),
                        "expGrwRt": row.get("expGrwRt", 0),
                        "impGrwRt": row.get("impGrwRt", 0),
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

        # 국가별·품목별은 KITA 보조 (공공 API 경로 미지원 시)
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

        records = self._fetch_items_from_itemtrade(yyyymm, hs_to_sector)
        if not records:
            records = self._fetch_items_kita(yyyymm, hs_to_sector)

        return pd.DataFrame(records) if records else pd.DataFrame()

    def _fetch_items_from_itemtrade(
        self, yyyymm: str, hs_to_sector: dict[str, str]
    ) -> list[dict]:
        """품목별 API를 HS 2단위·섹터별로 집계"""
        if not self.api_key:
            return []
        by_hs: dict[str, dict[str, float]] = defaultdict(
            lambda: {"exp": 0.0, "imp": 0.0}
        )
        page = 1
        total_pages = 1
        try:
            while page <= total_pages:
                resp = self.session.get(
                    ITEMTRADE_URL,
                    params={
                        "serviceKey": self.api_key,
                        "strtYymm": yyyymm,
                        "endYymm": yyyymm,
                        "pageNo": page,
                        "numOfRows": 5000,
                    },
                    timeout=90,
                )
                resp.raise_for_status()
                root = ET.fromstring(resp.text)
                if root.findtext(".//resultCode") != "00":
                    break
                total_count = int(root.findtext(".//totalCount") or 0)
                num_rows = int(root.findtext(".//numOfRows") or 5000) or 5000
                total_pages = max(1, (total_count + num_rows - 1) // num_rows)
                for item in root.findall(".//item"):
                    hs = (item.findtext("hsCode") or "")[:2]
                    if not hs:
                        continue
                    by_hs[hs]["exp"] += _to_float(item.findtext("expDlr"))
                    by_hs[hs]["imp"] += _to_float(item.findtext("impDlr"))
                page += 1
                if page <= total_pages:
                    time.sleep(0.1)
        except Exception as e:
            logger.warning("Itemtrade 품목 집계 실패: %s", e)
            return []

        records = []
        seen_sector_hs: set[tuple[str, str]] = set()
        for sector, codes in SECTORS.items():
            for code in codes:
                key = (sector, code)
                if key in seen_sector_hs:
                    continue
                seen_sector_hs.add(key)
                totals = by_hs.get(code)
                if not totals or (not totals["exp"] and not totals["imp"]):
                    continue
                records.append({
                    "섹터": sector,
                    "HS코드": code,
                    "품목명": f"HS{code}",
                    "수출액": totals["exp"],
                    "수입액": totals["imp"],
                    "수출증가율": 0.0,
                    "수입증가율": 0.0,
                })
        return records

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

    def collect_for_month(self, year: int, month: int, history_months: int = 12) -> dict:
        """특정 기준월(YYYY-MM) 기준 총괄·국가·품목 수집"""
        history_months = min(max(1, history_months), 12)
        ref = datetime(year, month, 1)
        logger.info(f"📦 수출입 수집 기준월: {year}-{month:02d} (총괄 {history_months}개월)")

        summary_records: list[dict] = []
        months: list[datetime] = []
        for i in range(history_months):
            d = ref.replace(day=1) - timedelta(days=i * 28)
            months.append(d.replace(day=1))

        if self.api_key and months:
            end_yyyymm = f"{year}{month:02d}"
            start_yyyymm = f"{months[-1].year}{months[-1].month:02d}"
            logger.info(f"  Itemtrade 일괄 조회: {start_yyyymm}~{end_yyyymm}")
            agg = self._fetch_itemtrade_monthly_totals(start_yyyymm, end_yyyymm)
            for d in months:
                yyyymm = f"{d.year}{d.month:02d}"
                totals = agg.get(yyyymm)
                if totals and (totals["exp"] or totals["imp"]):
                    summary_records.append(
                        normalize_summary_row(
                            {
                                "expDlr": totals["exp"],
                                "impDlr": totals["imp"],
                                "balDlr": totals["bal"],
                            },
                            yyyymm,
                        )
                    )
                else:
                    row = self.get_monthly_summary(d.year, d.month)
                    if row:
                        summary_records.append(row)

        if not summary_records:
            for d in months:
                row = self.get_monthly_summary(d.year, d.month)
                if row:
                    summary_records.append(row)
                time.sleep(0.15)

        country_df = self.get_country_stats(year, month)
        item_df = self.get_item_stats(year, month)
        summary_df = pd.DataFrame(summary_records)

        return {
            "summary": summary_df,
            "countries": country_df,
            "items": item_df,
            "meta": {"ref_month": f"{year}-{month:02d}", "months": history_months},
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

