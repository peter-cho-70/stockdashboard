"""지식 허브 공통 헬퍼 (분야·domain_id)."""
from __future__ import annotations

import json
import re
import unicodedata

from sqlalchemy.orm import Session

from config.database import KnowledgeDomain

DEFAULT_DOMAIN_TEMPLATES = [
    {
        "name": "AI·기술",
        "slug": "ai-tech",
        "emoji": "🤖",
        "keywords": ["AI", "ChatGPT", "LLM", "반도체", "엔비디아", "딥러닝"],
    },
    {
        "name": "거시경제",
        "slug": "macro",
        "emoji": "📊",
        "keywords": ["금리", "인플레이션", "FOMC", "달러", "환율", "GDP"],
    },
    {
        "name": "건강·바이오",
        "slug": "health",
        "emoji": "🏥",
        "keywords": ["바이오", "신약", "헬스케어", "임상", "FDA"],
    },
    {
        "name": "자기계발",
        "slug": "growth",
        "emoji": "📚",
        "keywords": ["독서", "습관", "생산성", "리더십", "커리어"],
    },
    {
        "name": "부동산·경매",
        "slug": "real-estate",
        "emoji": "🏢",
        "keywords": ["경매", "임대", "부동산", "공시가", "리모델링"],
    },
]


def slugify(name: str) -> str:
    s = unicodedata.normalize("NFKC", name.strip().lower())
    s = re.sub(r"[^\w\s-]", "", s, flags=re.UNICODE)
    s = re.sub(r"[\s_]+", "-", s).strip("-")
    return s[:48] or "domain"


def ensure_uncategorized_domain(db: Session) -> KnowledgeDomain:
    row = db.query(KnowledgeDomain).filter(KnowledgeDomain.slug == "uncategorized").first()
    if row:
        return row
    row = KnowledgeDomain(
        name="미분류",
        slug="uncategorized",
        emoji="📁",
        sort_order=999,
        keywords=json.dumps([], ensure_ascii=False),
        is_active=True,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def resolve_knowledge_domain_id(db: Session, domain_id: int | None) -> int:
    if domain_id:
        found = db.get(KnowledgeDomain, domain_id)
        if found and found.is_active:
            return found.id
    return ensure_uncategorized_domain(db).id


def _domain_keywords(domain: KnowledgeDomain) -> list[str]:
    if not domain.keywords:
        return []
    try:
        return json.loads(domain.keywords)
    except Exception:
        return []


def match_domain_for_channel(db: Session, channel_name: str) -> KnowledgeDomain | None:
    """채널명·키워드로 기존 분야 매칭."""
    name_lower = channel_name.strip().lower()
    if not name_lower:
        return None

    domains = (
        db.query(KnowledgeDomain)
        .filter(KnowledgeDomain.is_active == True, KnowledgeDomain.slug != "uncategorized")
        .all()
    )
    best: KnowledgeDomain | None = None
    best_score = 0
    for d in domains:
        score = 0
        if name_lower in d.name.lower() or d.name.lower() in name_lower:
            score += 3
        for kw in _domain_keywords(d):
            kl = kw.lower()
            if kl in name_lower or name_lower in kl:
                score += 2
        if score > best_score:
            best_score = score
            best = d
    return best if best_score > 0 else None


def ensure_domain_for_knowledge_channel(
    db: Session,
    channel_name: str,
    domain_id: int | None = None,
) -> tuple[int, KnowledgeDomain, bool]:
    """
    지식 채널을 지식 허브 분야에 연결.
    domain_id가 있으면 사용, 없으면 키워드 매칭 → 없으면 채널명으로 분야 자동 생성.

    Returns: (domain_id, domain_row, created_new_domain)
    """
    ensure_uncategorized_domain(db)
    seed_domain_templates(db)

    if domain_id:
        resolved = resolve_knowledge_domain_id(db, domain_id)
        return resolved, db.get(KnowledgeDomain, resolved), False

    matched = match_domain_for_channel(db, channel_name)
    if matched:
        return matched.id, matched, False

    base_slug = slugify(channel_name)[:40] or "channel"
    slug = base_slug
    n = 1
    while db.query(KnowledgeDomain).filter(KnowledgeDomain.slug == slug).first():
        slug = f"{base_slug}-{n}"
        n += 1

    domain = KnowledgeDomain(
        name=channel_name.strip()[:50] or "YouTube 채널",
        slug=slug,
        emoji="📺",
        color="#8b5cf6",
        description=f"YouTube 지식 채널 「{channel_name}」에서 자동 생성",
        keywords=json.dumps([channel_name.strip()], ensure_ascii=False),
        sort_order=100,
        is_active=True,
    )
    db.add(domain)
    db.commit()
    db.refresh(domain)
    return domain.id, domain, True


def register_knowledge_channel(
    db: Session,
    channel_name: str,
    domain_id: int | None = None,
) -> dict:
    """지식 채널 등록 시 허브 분야 자동 연결 결과."""
    did, domain, created = ensure_domain_for_knowledge_channel(db, channel_name, domain_id)
    return {
        "domain_id": did,
        "domain": {
            "id": domain.id,
            "name": domain.name,
            "slug": domain.slug,
            "emoji": domain.emoji,
        },
        "domain_created": created,
        "hub_url": f"/knowledge/{domain.slug}",
    }


def seed_domain_templates(db: Session) -> list[KnowledgeDomain]:
    created: list[KnowledgeDomain] = []
    for i, tpl in enumerate(DEFAULT_DOMAIN_TEMPLATES):
        if db.query(KnowledgeDomain).filter(KnowledgeDomain.slug == tpl["slug"]).first():
            continue
        d = KnowledgeDomain(
            name=tpl["name"],
            slug=tpl["slug"],
            emoji=tpl.get("emoji", "📁"),
            color="#6b7280",
            keywords=json.dumps(tpl.get("keywords", []), ensure_ascii=False),
            sort_order=i,
            is_active=True,
        )
        db.add(d)
        created.append(d)
    if created:
        db.commit()
        for d in created:
            db.refresh(d)
    return created
