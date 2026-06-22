"""
core/auction_pdf_parser.py
경매허브 — 경매정보지 PDF 원문 텍스트에서 사건 정보를 추출하는 파서.

원본: github.com/peter-cho-70/Auctionhub (src/lib/pdf/*.ts)의 정규식 추출 로직을
이 프로젝트의 백엔드(FastAPI/Python)로 그대로 옮긴 것. 스피드옥션·대장경매 PDF의
텍스트 레이아웃에 맞춘 정규식이므로, 사이트가 레이아웃을 바꾸면 패턴도 손봐야 한다.
"""
from __future__ import annotations

import re
from typing import Any, Optional


def clean(s: Optional[str]) -> str:
    if not s:
        return ""
    return re.sub(r"\s+", " ", s).strip()


def parse_krw_amount(raw: Optional[str]) -> Optional[float]:
    if not raw:
        return None
    digits = re.sub(r"[^\d]", "", raw)
    if not digits:
        return None
    try:
        return float(digits)
    except ValueError:
        return None


def parse_number(raw: Optional[str]) -> Optional[float]:
    if not raw:
        return None
    try:
        return float(str(raw).replace(",", "").strip())
    except ValueError:
        return None


def parse_iso_date_flexible(raw: Optional[str]) -> Optional[str]:
    if not raw:
        return None
    m = re.search(r"(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})", raw)
    if not m:
        return None
    y, mo, d = m.group(1), m.group(2).zfill(2), m.group(3).zfill(2)
    return f"{y}-{mo}-{d}"


# ── 층/세대 추론 (floor-unit-inference.ts) ─────────────────────────

def parse_unit_count_from_use_label(use_label: str) -> int:
    m = re.search(r"(\d+)\s*개호", use_label)
    if m:
        return max(1, int(m.group(1)))
    ho = re.search(r"(\d+)\s*호", use_label)
    if ho:
        return max(1, int(ho.group(1)))
    return 1


def classify_use_label(use_label: str) -> str:
    if re.search(r"근린|상가|점포|소매|사무|의원|음식|근린생활", use_label):
        return "commercial"
    if re.search(r"주택|다가구|다중|도시형|원룸|공동주택|주거", use_label):
        return "residential"
    return "other"


def infer_units_from_appraisal_floors(floors: list[dict[str, Any]]) -> dict[str, int]:
    residential_units = 0
    commercial_units = 0
    for row in floors:
        use_label = str(row.get("use_type") or "").strip()
        if not use_label:
            continue
        use_type = classify_use_label(use_label)
        unit_count = parse_unit_count_from_use_label(use_label)
        if use_type == "residential":
            residential_units += unit_count
        elif use_type == "commercial":
            commercial_units += unit_count
    return {
        "residential_units": residential_units,
        "commercial_units": commercial_units,
        "total_units": residential_units + commercial_units,
    }


def sum_household_from_text(raw_text: str) -> Optional[int]:
    total = sum(int(m.group(1)) for m in re.finditer(r"(\d+)\s*개호", raw_text))
    return total if total > 0 else None


def parse_parking_from_text(raw_text: str) -> Optional[int]:
    patterns = [
        r"(?:총|합계)?\s*주차\s*(?:대수|장)?\s*[:：]?\s*(\d+)",
        r"주차\s*(\d+)\s*대",
        r"주차장\s*[:：]?\s*(\d+)",
        r"옥(?:내|외)?\s*주차[^\d]*(\d+)",
    ]
    for pattern in patterns:
        m = re.search(pattern, raw_text)
        if m:
            n = int(m.group(1))
            if n >= 0:
                return n
    return None


def parse_coverage_ratios_from_text(raw_text: str) -> dict[str, Optional[float]]:
    def find_pct(*patterns: str) -> Optional[float]:
        for pattern in patterns:
            m = re.search(pattern, raw_text)
            if m:
                try:
                    return float(m.group(1).replace(",", ""))
                except ValueError:
                    continue
        return None

    return {
        "building_coverage_pct": find_pct(r"건\s*폐\s*율\s*[:：]?\s*([\d,.]+)\s*%", r"건폐율\s*[:：]?\s*([\d,.]+)\s*%"),
        "floor_area_pct": find_pct(r"용\s*적\s*률\s*[:：]?\s*([\d,.]+)\s*%", r"용적률?\s*[:：]?\s*([\d,.]+)\s*%"),
    }


def enrich_auction_extract_metrics(
    raw_text: str, building_floors: list[dict[str, Any]], tenant_row_count: int
) -> dict[str, Any]:
    parking_unit_count = parse_parking_from_text(raw_text)
    ratios = parse_coverage_ratios_from_text(raw_text)
    from_floors = infer_units_from_appraisal_floors(
        [{"use_type": f.get("use_type")} for f in building_floors]
    )
    from_text = sum_household_from_text(raw_text)

    household_count_hint = max(tenant_row_count, from_floors["total_units"], from_text or 0)

    return {
        "parking_unit_count": parking_unit_count,
        "building_coverage_ratio_pct": ratios["building_coverage_pct"],
        "floor_area_ratio_pct": ratios["floor_area_pct"],
        "household_count_hint": household_count_hint if household_count_hint > 0 else None,
        "residential_unit_hint": from_floors["residential_units"] or None,
        "commercial_unit_hint": from_floors["commercial_units"] or None,
    }


# ── 스피드옥션 포맷 ──────────────────────────────────────────────

def detect_auction_pdf_format(text: str) -> str:
    if re.search(r"스피드옥션|speedauction\.co\.kr", text, re.IGNORECASE):
        return "speedauction"
    if re.search(r"매각기일[^0-9]*\d{4}-\d{2}-\d{2}", text) and re.search(
        r"용도[\s\t]+[^\n\t]+[\s\t]+채권자", text
    ):
        return "speedauction"
    if re.search(r"물건종별\s*[^\n]+\s*감\s*정\s*가", text) and re.search(r"소\s*재\s*지", text):
        return "auctionone"
    return "speedauction"


def _parse_speed_auction_bid_schedules(text: str) -> list[dict[str, Any]]:
    block_m = re.search(
        r"회차\s+매각기일\s+최저매각금액\s+결과([\s\S]*?)(?=모의입찰|감정평가현황)", text
    )
    if not block_m:
        return []
    block = block_m.group(1)

    schedules: list[dict[str, Any]] = []
    for line in [clean(l) for l in block.split("\n") if clean(l)]:
        with_round = re.match(
            r"^(?:(\d+)차|신건)\s+(\d{4}-\d{2}-\d{2})\s+([\d,]+)\s*원(?:\s+(.+))?$", line
        )
        if with_round:
            schedules.append({
                "round": "신건" if with_round.group(1) is None else f"{with_round.group(1)}차",
                "date": with_round.group(2),
                "minimum_price": parse_krw_amount(with_round.group(3)),
                "result": clean(with_round.group(4)) if with_round.group(4) else None,
                "is_current": False,
            })
            continue
        date_only = re.match(r"^(\d{4}-\d{2}-\d{2})\s+([\d,]+)\s*원(?:\s+(.+))?$", line)
        if date_only:
            schedules.append({
                "round": None,
                "date": date_only.group(1),
                "minimum_price": parse_krw_amount(date_only.group(2)),
                "result": clean(date_only.group(3)) if date_only.group(3) else None,
                "is_current": False,
            })

    current = re.search(r"(\d+)차\s+(\d{4}-\d{2}-\d{2})\s+([\d,]+)\s*원", text)
    if current:
        date = current.group(2)
        price = parse_krw_amount(current.group(3))
        idx = next(
            (i for i, s in enumerate(schedules) if s["date"] == date and s["minimum_price"] == price),
            None,
        )
        if idx is not None:
            schedules[idx]["is_current"] = True
            schedules[idx]["round"] = f"{current.group(1)}차"
        else:
            schedules.append({
                "round": f"{current.group(1)}차",
                "date": date,
                "minimum_price": price,
                "result": None,
                "is_current": True,
            })
    return schedules


def _parse_appraisal_breakdown(text: str) -> dict[str, Optional[float]]:
    block_m = re.search(r"감정평가현황[\s\S]*?합계\s*\n[^\n]+", text)
    if not block_m:
        return {"land": None, "building": None, "ancillary": None, "total": None}
    block = block_m.group(0)
    last_line = block.split("\n")[-1] if block.split("\n") else ""
    if re.match(r"^[\sΧ\t]+$", last_line.replace("원", "")):
        return {"land": None, "building": None, "ancillary": None, "total": None}
    amounts = [parse_krw_amount(m.group(1)) for m in re.finditer(r"([\d,]+)\s*원", last_line)]
    if len(amounts) >= 4:
        return {"land": amounts[0], "building": amounts[1], "ancillary": amounts[2], "total": amounts[-1]}
    if len(amounts) == 3:
        return {"land": amounts[0], "building": amounts[1], "ancillary": None, "total": amounts[2]}
    if len(amounts) == 2:
        return {"land": amounts[0], "building": amounts[1], "ancillary": None, "total": None}
    if len(amounts) == 1:
        return {"land": None, "building": None, "ancillary": None, "total": amounts[0]}
    return {"land": None, "building": None, "ancillary": None, "total": None}


def _parse_ancillary_structures(text: str) -> list[dict[str, Any]]:
    block_m = re.search(
        r"제시외건물현황[\s\S]*?(?=임차인현황|건물소멸기준|건물\s*등기\s*사항|$)", text
    )
    if not block_m:
        return []
    block = block_m.group(0)
    rows = []
    for m in re.finditer(
        r"(\d+)\s+([^\n\t]+?)\s+([^\t\n]+?)\s+([^\t\n]+?)\s+([\d.]+)㎡[\s\S]*?(매각포함|매각제외)", block
    ):
        rows.append({
            "seq": int(m.group(1)),
            "jibun": clean(m.group(2)),
            "floor": clean(m.group(3)),
            "structure": None,
            "use_type": clean(m.group(4)),
            "area_sqm": parse_number(m.group(5)),
            "appraisal_price": None,
            "included_in_sale": m.group(6) == "매각포함",
        })
    return rows


def _parse_speed_auction_floors(text: str) -> list[dict[str, Any]]:
    floors = []
    pattern = (
        r"(\d+)층\s+철근콘크리트조\s+([^\t\n]+?)\s+([\d.]+)㎡(?:\([^)]+\))?\s+[\d,]+원\s+([\d,]+)원"
    )
    for m in re.finditer(pattern, text):
        floors.append({
            "floor": f"{m.group(1)}층",
            "structure": "철근콘크리트조",
            "use_type": clean(m.group(2)),
            "area_sqm": parse_number(m.group(3)),
            "appraisal_price": parse_krw_amount(m.group(4)),
        })
    return floors


def _parse_nearby_stats(text: str) -> list[dict[str, Any]]:
    block_m = re.search(r"인근\s*통계[\s\S]*?(?=계획고시공고|$)", text)
    if not block_m:
        return []
    block = block_m.group(0)
    stats = []
    pattern = (
        r"(\d+개월)\s+(\d+)건\s+([\d,]+)원\s+([\d,]+)원\s+([\d.]+)%\s+([\d.]+)회\s+([\d,]+)원"
    )
    for m in re.finditer(pattern, block):
        stats.append({
            "period": m.group(1),
            "sale_count": int(m.group(2)),
            "avg_appraisal": parse_krw_amount(m.group(3)),
            "avg_sale_price": parse_krw_amount(m.group(4)),
            "sale_rate_pct": parse_number(m.group(5)),
            "fail_count_avg": parse_number(m.group(6)),
            "estimated_price": parse_krw_amount(m.group(7)),
        })
    return stats


def _build_speed_auction_notes(text: str, extra: list[str]) -> str:
    picked = [e for e in extra if e]
    remark_m = re.search(r"비고\s*\n([\s\S]*?)(?=다성감정|건물현황)", text)
    if remark_m:
        for line in [clean(l) for l in remark_m.group(1).split("\n") if clean(l)]:
            if len(line) > 2:
                picked.append(line)
    caution_m = re.search(r"주의사항\s*/\s*법원문건접수\s*요약\s*\n([\s\S]*?)(?=부동산종합공부|$)", text)
    if caution_m:
        picked.append(clean(caution_m.group(1)[:500]))
    return "\n".join(picked[:30])


def _count_household_hint(text: str) -> Optional[int]:
    from_floors = sum_household_from_text(text)
    m = re.search(
        r"다중주택\s*\((\d+)개호[^)]*\)[^)]*다중주택\s*\((\d+)개호[^)]*\)[^)]*다중주택\s*\((\d+)개호",
        text,
    )
    if m:
        return int(m.group(1)) + int(m.group(2)) + int(m.group(3))
    units = {x.group(1) for x in re.finditer(r"(\d{3})호", text)}
    from_units = len(units) if units else None
    if from_floors is not None and from_units is not None:
        return max(from_floors, from_units)
    return from_floors if from_floors is not None else from_units


def parse_speed_auction_pdf_text(text: str) -> dict[str, Any]:
    t = text or ""

    case_number_m = re.search(r"(\d{4}\s*타경\s*\d+)", t)
    case_number = re.sub(r"\s+", "", case_number_m.group(1)) if case_number_m else None

    court_m = re.search(r"^([^\n]+지방법원)", t, re.MULTILINE)
    court = court_m.group(1).strip() if court_m else None

    header_line_m = re.search(r"\d{4}\s*타경\s*\d+[^\n]*", t)
    header_line = header_line_m.group(0) if header_line_m else None
    auction_type = None
    auction_division = None
    contact_phone = None
    if header_line:
        m = re.search(r"\(([^)]+)\)", header_line)
        auction_type = m.group(1) if m else None
        m = re.search(r"경매\d+계", header_line)
        auction_division = m.group(0) if m else None
        m = re.search(r"(\d{2,3}-\d{3,4}-\d{4})", header_line)
        contact_phone = m.group(1) if m else None

    m = re.search(r"\(\d{5}\)\s*([^\n\[]+)", t)
    address_jibun = clean(m.group(1)) if m else None
    address_jibun = address_jibun or None
    m = re.search(r"\[도로명주소\]\s*([^\n]+)", t)
    address_road = clean(m.group(1)) if m else None
    address_road = address_road or None
    address = address_road or address_jibun
    m = re.search(r"\((\d{5})\)", t)
    zip_code = m.group(1) if m else None

    m = re.search(r"용도\s+([^\t\n]+)", t)
    property_type = clean(m.group(1)) if m else None
    property_type = property_type or None

    m = re.search(r"감정가\s+([\d,]+)\s*원", t)
    appraisal_price = parse_krw_amount(m.group(1)) if m else None

    min_price_m = re.search(r"최저가\s+\((\d+)%\)\s*([\d,]+)\s*원", t)
    min_price = parse_krw_amount(min_price_m.group(2)) if min_price_m else None
    min_price_rate_pct = int(min_price_m.group(1)) if min_price_m else None

    deposit_m = re.search(r"보증금\s+\((\d+)%\)\s*([\d,]+)\s*원", t)
    deposit_amount = parse_krw_amount(deposit_m.group(2)) if deposit_m else None
    deposit_rate_pct = int(deposit_m.group(1)) if deposit_m else None

    claim_m = re.search(r"청구금액\s+([\d,]+)\s*원", t)
    claim_amount = parse_krw_amount(claim_m.group(1)) if claim_m else None

    m = re.search(r"소유자\s+([^\t\n]+)", t)
    owner = clean(m.group(1)) if m else None
    owner = owner or None
    m = re.search(r"채무자\s+([^\t\n]+)", t)
    debtor = clean(m.group(1)) if m else None
    debtor = debtor or None
    m = re.search(r"채권자\s+([^\t\n]+)", t)
    creditor = clean(m.group(1)) if m else None
    creditor = creditor or None
    m = re.search(r"매각대상\s+([^\t\n]+)", t)
    sale_target = clean(m.group(1)) if m else None
    sale_target = sale_target or None

    m = re.search(r"매각기일[^0-9]*(\d{4}-\d{2}-\d{2})", t)
    bid_date = parse_iso_date_flexible(m.group(1)) if m else None

    m = re.search(r"토지면적\s+([\d.]+)\s*㎡", t)
    land_area_sqm = parse_number(m.group(1)) if m else None
    m = re.search(r"건물면적\s+([\d.]+)\s*㎡", t)
    building_area_sqm = parse_number(m.group(1)) if m else None

    breakdown = _parse_appraisal_breakdown(t)
    land_appraisal = breakdown["land"]
    building_appraisal = breakdown["building"]
    if land_appraisal is None or building_appraisal is None:
        fallback = re.search(
            r"감정평가현황[\s\S]*?토지\s+건물[\s\S]*?\n([\d,]+)원\s+([\d,]+)원", t
        )
        if fallback:
            land_appraisal = land_appraisal if land_appraisal is not None else parse_krw_amount(fallback.group(1))
            building_appraisal = building_appraisal if building_appraisal is not None else parse_krw_amount(fallback.group(2))
    ancillary_appraisal = breakdown["ancillary"]
    appraisal_from_breakdown = breakdown["total"]

    registry_m = re.search(r"소유권\s*보존등기일\s*:\s*(\d{4}-\d{2}-\d{2})", t)
    approval_m = re.search(r"사용승인일\s*[:\s]*(\d{4}[.\-/]\d{1,2}[.\-/]\d{1,2})", t)
    built_year = (
        parse_iso_date_flexible(registry_m.group(1)) if registry_m
        else parse_iso_date_flexible(approval_m.group(1)) if approval_m
        else None
    )
    built_year_source = "소유권 보존등기일" if registry_m else ("사용승인일" if approval_m else None)

    price_point_m = re.search(r"가격시점\s*:\s*(\d{4}-\d{2}-\d{2})", t)
    appraisal_date = parse_iso_date_flexible(price_point_m.group(1)) if price_point_m else None
    m = re.search(r"([^\n,]+감정)\s*,\s*가격시점", t)
    appraisal_company = clean(m.group(1)) if m else None
    appraisal_company = appraisal_company or None

    case_received_m = re.search(r"사건접수\s+(\d{4}-\d{2}-\d{2})", t)
    case_received_date = parse_iso_date_flexible(case_received_m.group(1)) if case_received_m else None
    auction_start_m = re.search(r"개시결정\s+(\d{4}-\d{2}-\d{2})", t)
    auction_start_date = parse_iso_date_flexible(auction_start_m.group(1)) if auction_start_m else None
    dividend_deadline_m = re.search(r"배당종기일\s+(\d{4}-\d{2}-\d{2})", t)
    dividend_deadline = parse_iso_date_flexible(dividend_deadline_m.group(1)) if dividend_deadline_m else None

    bid_schedules = _parse_speed_auction_bid_schedules(t)
    current_round_m = re.search(r"(\d+)차\s+\d{4}-\d{2}-\d{2}\s+[\d,]+원", t)
    current_round = int(current_round_m.group(1)) if current_round_m else None

    winning_price = None
    winning_rate = None
    win_m = re.search(r"매각\s*:\s*([\d,]+)\s*원\s*\(([\d.]+)\s*%\)", t) or re.search(
        r"매각가\s*([\d,]+)\s*원\s*\(([\d.]+)\s*%\)", t
    )
    if win_m:
        winning_price = parse_krw_amount(win_m.group(1))
        winning_rate = parse_number(win_m.group(2))

    sold_round = current_round if winning_price is not None else None
    auction_status = "sold" if winning_price is not None else "ongoing"

    m = re.search(r"토지이용계획\s+([^\t\n]+)", t) or re.search(r"(제\d+종[^\n*]+)", t)
    zoning = clean(m.group(1)) if m else None
    zoning = zoning or None
    m = re.search(r"지목/면적\s+([^(]+)", t)
    land_category = clean(m.group(1)) if m else None
    land_category = land_category or None

    m = re.search(r"공시지가[^\n→]*→\s*([\d,]+)원\s*/\s*㎡", t)
    official_land_price_per_sqm = parse_krw_amount(m.group(1)) if m else None
    m = re.search(r"기준일\s*:\s*(\d{4}/\d{2})", t)
    official_land_price_date = m.group(1) if m else None

    m = re.search(r"보증금합계\s*:\s*\n?\s*([\d,]+)\s*원", t)
    tenant_deposit_total = parse_krw_amount(m.group(1)) if m else None
    m = re.search(r"월세합계\s*:\s*([\d,]+)\s*원", t)
    tenant_monthly_rent_total = parse_krw_amount(m.group(1)) if m else None

    building_floors = _parse_speed_auction_floors(t)
    ancillary_structures = _parse_ancillary_structures(t)
    nearby_stats = _parse_nearby_stats(t)
    m = re.search(r"https://www\.speedauction\.co\.kr[^\s)]+", t)
    source_url = m.group(0) if m else None
    tenant_row_count = len(re.findall(r"보증금\s*:\s*[\d,]+\s*원", t))
    metrics = enrich_auction_extract_metrics(t, building_floors, tenant_row_count)
    household_count_hint = max(
        metrics["household_count_hint"] or 0, _count_household_hint(t) or 0
    ) or None

    parking_unit_count = metrics["parking_unit_count"]
    if parking_unit_count is None:
        m = re.search(r"총주차대수\s*(\d+)\s*대", t) or re.search(r"주차\s*대수\s*(\d+)\s*대", t)
        parking_unit_count = int(m.group(1)) if m else None

    notes = _build_speed_auction_notes(
        t,
        [
            f"※ 진행 중 경매 (다음 기일 {bid_date or '미상'})" if auction_status == "ongoing" else "",
            f"임차 보증금 합계 {int(tenant_deposit_total):,}원" if tenant_deposit_total else "",
        ],
    )

    return {
        "format": "speedauction",
        "case_number": case_number,
        "address": address,
        "address_jibun": address_jibun,
        "address_road": address_road,
        "zip_code": zip_code,
        "court": court,
        "auction_type": auction_type,
        "auction_division": auction_division,
        "contact_phone": contact_phone,
        "property_type": property_type,
        "appraisal_price": appraisal_price if appraisal_price is not None else appraisal_from_breakdown,
        "min_price": min_price,
        "min_price_rate_pct": min_price_rate_pct,
        "deposit_amount": deposit_amount,
        "deposit_rate_pct": deposit_rate_pct,
        "claim_amount": claim_amount,
        "owner": owner,
        "debtor": debtor,
        "creditor": creditor,
        "sale_target": sale_target,
        "bid_date": bid_date,
        "land_area_sqm": land_area_sqm,
        "building_area_sqm": building_area_sqm,
        "land_appraisal": land_appraisal,
        "building_appraisal": building_appraisal,
        "ancillary_appraisal": ancillary_appraisal,
        "source_url": source_url,
        "parking_unit_count": parking_unit_count,
        "built_year": built_year,
        "built_year_source": built_year_source,
        "appraisal_date": appraisal_date,
        "appraisal_company": appraisal_company,
        "case_received_date": case_received_date,
        "auction_start_date": auction_start_date,
        "dividend_deadline": dividend_deadline,
        "current_round": current_round,
        "auction_status": auction_status,
        "winning_bid_price": winning_price,
        "bid_rate_pct": winning_rate,
        "sold_round": sold_round,
        "zoning": zoning,
        "land_category": land_category,
        "official_land_price_per_sqm": official_land_price_per_sqm,
        "official_land_price_date": official_land_price_date,
        "tenant_deposit_total": tenant_deposit_total,
        "tenant_monthly_rent_total": tenant_monthly_rent_total,
        "household_count_hint": household_count_hint,
        "building_coverage_ratio_pct": metrics["building_coverage_ratio_pct"],
        "floor_area_ratio_pct": metrics["floor_area_ratio_pct"],
        "residential_unit_hint": metrics["residential_unit_hint"],
        "commercial_unit_hint": metrics["commercial_unit_hint"],
        "bid_schedules": bid_schedules,
        "building_floors": building_floors,
        "ancillary_structures": ancillary_structures,
        "nearby_stats": nearby_stats,
        "notes": notes,
    }


# ── 대장경매 포맷 ────────────────────────────────────────────────

def _parse_spaced_field(text: str, label: str) -> Optional[str]:
    m = re.search(rf"{label}\s+([^\t\n]+)", text, re.IGNORECASE)
    return clean(m.group(1)) if m else None


def _parse_daejang_bid_schedules(text: str) -> list[dict[str, Any]]:
    block_m = re.search(
        r"구분\s+입찰기일\s+최저매각가격\s+결과([\s\S]*?)(?=정정취하공고|매각물건현황|임차인\s*현황)", text
    )
    if not block_m:
        return []
    block = block_m.group(1)

    schedules: list[dict[str, Any]] = []
    last_round = "신건"
    for line in [clean(l) for l in block.split("\n") if clean(l)]:
        if re.match(r"^\d+%↓", line):
            continue
        with_round = re.match(
            r"^(?:(\d+)차|신건)\s+(\d{4}-\d{2}-\d{2})\s+([\d,]+)(?:\s*(유찰|변경|예정|매각|취하))?$", line
        )
        if with_round:
            last_round = f"{with_round.group(1)}차" if with_round.group(1) else "신건"
            schedules.append({
                "round": last_round,
                "date": with_round.group(2),
                "minimum_price": parse_krw_amount(with_round.group(3)),
                "result": clean(with_round.group(4)) if with_round.group(4) else None,
                "is_current": False,
            })
            continue
        date_only = re.match(
            r"^(\d{4}-\d{2}-\d{2})\s+([\d,]+)(?:\s*(유찰|변경|예정|매각|취하))?$", line
        )
        if date_only:
            schedules.append({
                "round": last_round,
                "date": date_only.group(1),
                "minimum_price": parse_krw_amount(date_only.group(2)),
                "result": clean(date_only.group(3)) if date_only.group(3) else None,
                "is_current": False,
            })

    header_bid = re.search(r"매각기일\s+(\d{4}-\d{2}-\d{2})", text)
    if header_bid and schedules:
        date = header_bid.group(1)
        idx = next((i for i, s in enumerate(schedules) if s["date"] == date), None)
        if idx is not None:
            schedules[idx]["is_current"] = True
    return schedules


def _parse_daejang_floors(text: str) -> list[dict[str, Any]]:
    floors: list[dict[str, Any]] = []
    block_m = re.search(
        r"구분\s+소재지\s+층/현황/구조[\s\S]*?(?=감정가\s+합계|물건비고|임차인)", text
    )
    if not block_m:
        return floors
    block = block_m.group(0)
    pattern = r"(\d+)층\s+([^\n]+?)\s+철근콘크리트[\s\S]*?([\d.]+)㎡[\s\S]*?([\d,]+)원"
    for m in re.finditer(pattern, block):
        floors.append({
            "floor": f"{m.group(1)}층",
            "structure": "철근콘크리트구조",
            "use_type": clean(m.group(2)),
            "area_sqm": parse_number(m.group(3)),
            "appraisal_price": parse_krw_amount(m.group(4)),
        })
    return floors


def _parse_daejang_appraisal(text: str) -> dict[str, Optional[float]]:
    land_m = re.search(r"토지\s*\(\)[\s\S]*?\([\d,]+원\)\s*([\d,]+)원", text) or re.search(
        r"토지\s*\(\)[\s\S]*?([\d,]{8,})원", text
    )
    land = parse_krw_amount(land_m.group(1)) if land_m else None
    building_m = re.search(r"소계\s+([\d,]+)원", text)
    building = parse_krw_amount(building_m.group(1)) if building_m else None
    total = parse_krw_amount(_parse_spaced_field(text, r"감\s*정\s*가"))
    if total is None:
        total_m = re.search(r"감정가\s+합계\s+([\d,]+)원", text)
        total = parse_krw_amount(total_m.group(1)) if total_m else None
    return {"land": land, "building": building, "total": total}


def parse_daejang_auction_tenants(raw_text: str) -> dict[str, Any]:
    rows: list[dict[str, Any]] = []
    seen: set[str] = set()

    pattern = (
        r"([가-힣㈜A-Za-z()]+)\s+(?:주거|상가)?임차인\s*\n\s*(\d{3}호|E?\d?동?\d{3}호)"
        r"[\s\S]*?보증금\s*:\s*([\d,]+)\s*원(?:[\s\S]*?월세\s*:\s*([\d,]+)\s*원)?"
    )
    for m in re.finditer(pattern, raw_text):
        name = clean(m.group(1))
        unit_raw = m.group(2)
        unit = unit_raw if unit_raw.endswith("호") else f"{unit_raw}호"
        key = f"{name}|{unit}"
        if key in seen:
            continue
        seen.add(key)

        chunk = m.group(0)
        move_in = re.search(r"전입\s*:\s*(\d{4}-\d{2}-\d{2})", chunk)
        confirmed = re.search(r"확정\s*:\s*(\d{4}-\d{2}-\d{2})", chunk)
        dividend = re.search(r"배당\s*:\s*(\d{4}-\d{2}-\d{2})", chunk)
        rows.append({
            "rank": len(rows) + 1,
            "name": name,
            "unit": unit,
            "use": "commercial" if re.search(r"상가", chunk) else "residential",
            "deposit": parse_krw_amount(m.group(3)),
            "monthly_rent": parse_krw_amount(m.group(4)) if m.group(4) else None,
            "move_in_date": parse_iso_date_flexible(move_in.group(1)) if move_in else None,
            "confirmed_date": parse_iso_date_flexible(confirmed.group(1)) if confirmed else None,
            "dividend_request_date": parse_iso_date_flexible(dividend.group(1)) if dividend else None,
            "notes": "현황조사" if re.search(r"현황조사", chunk) else None,
        })

    deposit_total = sum(r["deposit"] or 0 for r in rows)
    rent_total = sum(r["monthly_rent"] or 0 for r in rows)
    return {
        "rows": rows,
        "deposit_total": deposit_total if deposit_total > 0 else None,
        "monthly_rent_total": rent_total if rent_total > 0 else None,
    }


def parse_daejang_auction_pdf_text(text: str) -> dict[str, Any]:
    t = text or ""

    case_number_m = re.search(r"(\d{4}\s*타경\s*\d+)", t)
    case_number = re.sub(r"\s+", "", case_number_m.group(1)) if case_number_m else None

    court = None
    m = re.search(r"([^\n]+지방법원)[^\n]*경매\d+계", t)
    if m:
        court = m.group(1).strip()
    else:
        m = re.search(r"^([^\n]+지방법원)", t, re.MULTILINE)
        court = m.group(1).strip() if m else None

    m = re.search(r"경매\d+계", t)
    auction_division = m.group(0) if m else None
    m = re.search(r"\((\d{3}-\d{4}-\d{4})", t) or re.search(r"(\d{2,3}-\d{3,4}-\d{4})", t)
    contact_phone = m.group(1) if m else None

    m = re.search(r"소재지\s+([^\t\n]+?)(?:\s+주소복사|$)", t)
    address_jibun = clean(m.group(1)) if m else ""
    address_jibun = address_jibun or None

    address_road = None
    m = re.search(r"도로명주\s*\n?\s*소\s*([^\t\n]+?)(?:\s+주소복사|$)", t)
    if m:
        address_road = clean(m.group(1))
    else:
        m = re.search(r"\[도로명주소\]\s*([^\n]+)", t)
        if m:
            address_road = clean(m.group(1))

    address = address_jibun or address_road

    property_type = _parse_spaced_field(t, "물건종별")
    auction_type = _parse_spaced_field(t, "경매구분")

    owner = _parse_spaced_field(t, r"소\s*유\s*자")
    debtor = _parse_spaced_field(t, r"채\s*무\s*자")
    creditor = _parse_spaced_field(t, r"채\s*권\s*자")

    appraisal_parts = _parse_daejang_appraisal(t)
    appraisal_price = parse_krw_amount(_parse_spaced_field(t, r"감\s*정\s*가"))
    if appraisal_price is None:
        appraisal_price = appraisal_parts["total"]

    min_price_m = re.search(r"최\s*저\s*가\s+\((\d+)%\)\s*([\d,]+)", t)
    min_price = parse_krw_amount(min_price_m.group(2)) if min_price_m else None
    min_price_rate_pct = int(min_price_m.group(1)) if min_price_m else None

    deposit_m = re.search(r"보\s*증\s*금\s+\((\d+)%\)\s*([\d,]+)", t)
    deposit_amount = parse_krw_amount(deposit_m.group(2)) if deposit_m else None
    deposit_rate_pct = int(deposit_m.group(1)) if deposit_m else None

    claim_m = re.search(r"임의경매\s+[^\n]+?\s+([\d,]+)\s*원\s+말소", t)
    claim_amount = parse_krw_amount(claim_m.group(1)) if claim_m else None

    bid_date_m = re.search(r"매각기일\s+(\d{4}-\d{2}-\d{2})", t)
    bid_date = parse_iso_date_flexible(bid_date_m.group(1)) if bid_date_m else None

    m = re.search(r"토지면적\s+([\d.]+)\s*㎡", t)
    land_area_sqm = parse_number(m.group(1)) if m else None
    m = re.search(r"건물면적\s+([\d.]+)\s*㎡", t)
    building_area_sqm = parse_number(m.group(1)) if m else None

    land_appraisal = appraisal_parts["land"]
    building_appraisal = appraisal_parts["building"]

    case_received_m = re.search(r"사건접수\s+(\d{4}\.\d{1,2}\.\d{1,2})", t)
    case_received_date = parse_iso_date_flexible(case_received_m.group(1)) if case_received_m else None
    dividend_m = re.search(r"배당종기\s*\n?\s*일\s+(\d{4}-\d{2}-\d{2})", t) or re.search(
        r"배당요구종기\s*:\s*(\d{4}-\d{2}-\d{2})", t
    )
    dividend_deadline = parse_iso_date_flexible(dividend_m.group(1)) if dividend_m else None

    bid_schedules = _parse_daejang_bid_schedules(t)
    current_schedule = next(
        (s for s in reversed(bid_schedules) if s["is_current"] or s["date"] == bid_date), None
    )
    current_round = None
    if current_schedule and current_schedule.get("round"):
        digits = re.sub(r"\D", "", current_schedule["round"])
        current_round = int(digits) if digits else None

    building_floors = _parse_daejang_floors(t)
    tenants = parse_daejang_auction_tenants(t)
    metrics = enrich_auction_extract_metrics(t, building_floors, len(tenants["rows"]))

    lien_baseline_m = re.search(r"말소기준권리\s*:\s*(\d{4}-\d{2}-\d{2})", t)
    lien_baseline = lien_baseline_m.group(1) if lien_baseline_m else None

    built_year = None
    m = re.search(r"사용승인:(\d{4}\.\d{1,2}\.\d{1,2})", t)
    if m:
        built_year = parse_iso_date_flexible(m.group(1))

    zoning = None
    m = re.search(r"용도지역지구\s+([^\n]+)", t)
    if m:
        zoning = clean(m.group(1).split(",")[0])
        zoning = zoning or None

    sale_condition_m = re.search(r"매각조건\s+([^\t\n]+)", t)
    remark_m = re.search(r"물건비고\s+([^\n]+)", t)
    notes_parts = [
        clean(remark_m.group(1)) if remark_m else "",
        clean(sale_condition_m.group(1)) if sale_condition_m else "",
        f"말소기준권리: {lien_baseline}" if lien_baseline else "",
    ]
    notes = "\n".join(p for p in notes_parts if p)

    return {
        "format": "daejangauction",
        "case_number": case_number,
        "address": address,
        "address_jibun": address_jibun,
        "address_road": address_road,
        "zip_code": None,
        "court": court,
        "auction_type": auction_type,
        "auction_division": auction_division,
        "contact_phone": contact_phone,
        "property_type": property_type,
        "appraisal_price": appraisal_price,
        "min_price": min_price,
        "min_price_rate_pct": min_price_rate_pct,
        "deposit_amount": deposit_amount,
        "deposit_rate_pct": deposit_rate_pct,
        "claim_amount": claim_amount,
        "owner": owner,
        "debtor": debtor,
        "creditor": creditor,
        "sale_target": clean(sale_condition_m.group(1)) if sale_condition_m else None,
        "bid_date": bid_date,
        "land_area_sqm": land_area_sqm,
        "building_area_sqm": building_area_sqm,
        "land_appraisal": land_appraisal,
        "building_appraisal": building_appraisal,
        "ancillary_appraisal": None,
        "source_url": None,
        "parking_unit_count": metrics["parking_unit_count"],
        "built_year": built_year,
        "built_year_source": "사용승인일" if built_year else None,
        "appraisal_date": None,
        "appraisal_company": None,
        "case_received_date": case_received_date,
        "auction_start_date": None,
        "dividend_deadline": dividend_deadline,
        "current_round": current_round,
        "auction_status": "ongoing",
        "winning_bid_price": None,
        "bid_rate_pct": None,
        "sold_round": None,
        "zoning": zoning,
        "land_category": None,
        "official_land_price_per_sqm": None,
        "official_land_price_date": None,
        "tenant_deposit_total": tenants["deposit_total"],
        "tenant_monthly_rent_total": tenants["monthly_rent_total"],
        "household_count_hint": metrics["household_count_hint"],
        "building_coverage_ratio_pct": metrics["building_coverage_ratio_pct"],
        "floor_area_ratio_pct": metrics["floor_area_ratio_pct"],
        "residential_unit_hint": metrics["residential_unit_hint"],
        "commercial_unit_hint": metrics["commercial_unit_hint"],
        "bid_schedules": bid_schedules,
        "building_floors": building_floors,
        "ancillary_structures": [],
        "nearby_stats": [],
        "notes": notes,
        # 대장경매 PDF는 임차인현황 표가 본문에 포함되어 있어 세입자 레코드까지 함께 추출한다
        "tenant_rows": tenants["rows"],
    }


# ── 디스패처 ──────────────────────────────────────────────────────

def parse_auction_pdf_by_kind(text: str, kind: str) -> dict[str, Any]:
    if kind in ("speedauction-pdf", "auctionone-pdf"):
        return parse_speed_auction_pdf_text(text)
    if kind == "daejangauction-pdf":
        return parse_daejang_auction_pdf_text(text)
    return parse_daejang_auction_pdf_text(text)


def detect_format_for_auto_parse(text: str) -> str:
    """
    원본 Auctionhub는 PDF 포맷(스피드옥션/대장경매)을 사용자가 직접 선택했지만,
    이 기능에서는 PDF만으로 바로 등록해야 하므로 자동 판별이 필요하다.
    대장경매 PDF에만 나타나는 입찰기일표 헤더("구분 입찰기일 최저매각가격 결과")와
    "말소기준권리" 표기를 우선 확인하고, 그 외에는 detect_auction_pdf_format()으로
    스피드옥션/온비드 계열을 가른다.
    """
    if re.search(r"구분\s+입찰기일\s+최저매각가격\s+결과", text) or re.search(r"말소기준권리", text):
        return "daejangauction"
    return detect_auction_pdf_format(text)


def detect_and_parse(text: str) -> dict[str, Any]:
    """포맷을 자동 감지해서 적합한 파서로 추출한다."""
    fmt = detect_format_for_auto_parse(text)
    if fmt in ("speedauction", "auctionone"):
        return parse_speed_auction_pdf_text(text)
    return parse_daejang_auction_pdf_text(text)
