"""
주식공부하기 — chart.md 커리큘럼 파싱
"""
from __future__ import annotations

import re
from functools import lru_cache
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent.parent
CHART_MD_PATH = ROOT / "chart.md"

LESSON_META: list[dict[str, Any]] = [
    {
        "id": "candle-101",
        "order": 0,
        "title": "캔들차트 기초",
        "subtitle": "양봉·음봉·꼬리 — 패턴 읽기 전 필수",
        "match": r"^0\.\s*캔들",
        "chart_link": "/chart",
    },
    {
        "id": "patterns-bear",
        "order": 1,
        "title": "하락 신호 패턴",
        "subtitle": "쌍봉·하락깃발·다이아몬드·박스권",
        "match": r"^1\.\s*하락",
        "chart_link": "/chart",
    },
    {
        "id": "patterns-bull",
        "order": 2,
        "title": "상승 신호 패턴",
        "subtitle": "역삼중바닥·상승깃발·상승삼각형",
        "match": r"^2\.\s*상승",
        "chart_link": "/chart",
    },
    {
        "id": "patterns-summary",
        "order": 3,
        "title": "패턴 비교 요약",
        "subtitle": "한눈에 보는 방향·모양·메모",
        "match": r"^3\.\s*전체",
        "chart_link": "/chart",
    },
    {
        "id": "patterns-context",
        "order": 4,
        "title": "패턴 + 거래량·추세",
        "subtitle": "모양만으로 매매하지 않기",
        "match": r"^4\.\s*패턴",
        "chart_link": "/chart",
    },
    {
        "id": "ma-basics",
        "order": 5,
        "title": "이동평균선",
        "subtitle": "골든크로스·정배열·역배열",
        "match": r"^5\.\s*이동평균",
        "chart_link": "/chart",
    },
    {
        "id": "valuation",
        "order": 6,
        "title": "PER · PBR · EPS",
        "subtitle": "기업가치 지표 함께 보기",
        "match": r"^6\.\s*PER",
        "chart_link": "/chart",
    },
    {
        "id": "danger-10",
        "order": 7,
        "title": "조심해야 할 차트 자리 10",
        "subtitle": "좋은 종목보다 좋은 자리",
        "match": r"^7\.\s*매수",
        "chart_link": "/chart",
    },
    {
        "id": "sources",
        "order": 8,
        "title": "출처 및 한계",
        "subtitle": "면책·신뢰도 구분",
        "match": r"^8\.\s*출처",
        "chart_link": None,
    },
]

TOPIC_KEYWORDS: dict[str, list[str]] = {
    "candle-101": ["캔들", "양봉", "음봉", "꼬리", "도지", "장대"],
    "patterns-bear": ["쌍봉", "하락깃발", "다이아몬드", "박스권", "하락 패턴", "M자"],
    "patterns-bull": ["역삼중", "상승깃발", "상승삼각", "삼중바닥", "상승 패턴"],
    "patterns-summary": ["패턴", "비교", "요약"],
    "patterns-context": ["거래량", "추세", "시간프레임", "이동평균"],
    "ma-basics": ["이동평균", "골든크로스", "데드크로스", "정배열", "역배열", "MA"],
    "valuation": ["PER", "PBR", "EPS", "밸류", "목표주가", "컨센서스", "배당"],
    "danger-10": ["위험", "손절", "추격", "과열", "저항", "역배열", "윗꼬리"],
    "sources": ["출처", "면책", "한계"],
}


def _read_chart_md() -> str:
    if not CHART_MD_PATH.is_file():
        return ""
    return CHART_MD_PATH.read_text(encoding="utf-8")


def _match_lesson_id(section_title: str) -> str | None:
    title = section_title.strip()
    for meta in LESSON_META:
        if re.search(meta["match"], title, re.IGNORECASE):
            return meta["id"]
    return None


def _split_sections(md: str) -> list[tuple[str, str]]:
    if not md.strip():
        return []
    parts = re.split(r"\n(?=## )", md.strip())
    sections: list[tuple[str, str]] = []
    for part in parts:
        if part.startswith("# "):
            continue
        if not part.startswith("## "):
            continue
        lines = part.split("\n", 1)
        title = lines[0].lstrip("#").strip()
        body = lines[1].strip() if len(lines) > 1 else ""
        sections.append((title, body))
    return sections


@lru_cache(maxsize=1)
def load_curriculum() -> dict[str, Any]:
    md = _read_chart_md()
    intro = ""
    if md.startswith("# "):
        first_split = md.split("\n## ", 1)
        intro = first_split[0].strip()

    meta_by_id = {m["id"]: dict(m) for m in LESSON_META}
    for title, body in _split_sections(md):
        lesson_id = _match_lesson_id(title)
        if not lesson_id or lesson_id not in meta_by_id:
            continue
        meta_by_id[lesson_id]["section_title"] = title
        meta_by_id[lesson_id]["body_markdown"] = body

    lessons = sorted(meta_by_id.values(), key=lambda x: x["order"])
    for lesson in lessons:
        lesson.setdefault("body_markdown", "")
        lesson["topic_keywords"] = TOPIC_KEYWORDS.get(lesson["id"], [])

    return {
        "title": "주식공부하기",
        "source": "chart.md",
        "intro_markdown": intro,
        "disclaimer": "SNS·참고 자료와 공식 교육 보강 구간이 섞여 있습니다. 투자 판단의 근거로 삼지 마세요.",
        "lessons": lessons,
    }


def get_lesson(lesson_id: str) -> dict[str, Any] | None:
    for lesson in load_curriculum()["lessons"]:
        if lesson["id"] == lesson_id:
            return lesson
    return None


def all_lesson_ids() -> list[str]:
    return [m["id"] for m in LESSON_META]
