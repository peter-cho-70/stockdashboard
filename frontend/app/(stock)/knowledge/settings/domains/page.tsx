"use client";

/**
 * frontend/app/knowledge/settings/domains/page.tsx
 * 관심 분야 관리 설정 페이지
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  knowledgeApi,
  type KnowledgeDomain,
} from "@/lib/knowledgeApi";

const EMOJI_OPTIONS = ["🤖", "📊", "🏥", "📚", "🏢", "💊", "⚡", "🌍", "🎯", "💡", "🔬", "🎓"];
const COLOR_OPTIONS = [
  "#6366f1", "#0ea5e9", "#10b981", "#f59e0b",
  "#f97316", "#ef4444", "#8b5cf6", "#ec4899",
];

const DEFAULT_TEMPLATES = [
  { name: "AI·기술",   slug: "ai-tech",     emoji: "🤖", color: "#6366f1", keywords: ["AI", "ChatGPT", "LLM", "반도체", "엔비디아"] },
  { name: "거시경제",  slug: "macro",       emoji: "📊", color: "#0ea5e9", keywords: ["금리", "인플레이션", "FOMC", "달러", "환율"] },
  { name: "건강·바이오",slug:"health",      emoji: "🏥", color: "#10b981", keywords: ["바이오", "신약", "헬스케어", "임상", "FDA"] },
  { name: "자기계발",  slug: "growth",      emoji: "📚", color: "#f59e0b", keywords: ["독서", "습관", "생산성", "리더십"] },
  { name: "부동산·경매",slug:"real-estate", emoji: "🏢", color: "#f97316", keywords: ["경매", "임대", "부동산", "다가구"] },
];

interface DomainFormState {
  name:        string;
  slug:        string;
  emoji:       string;
  color:       string;
  description: string;
  keywords:    string;   // 쉼표 구분 문자열
}

function emptyForm(): DomainFormState {
  return { name: "", slug: "", emoji: "📁", color: "#6b7280", description: "", keywords: "" };
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\w-가-힣]/g, "")
    .replace(/--+/g, "-");
}

export default function DomainSettingsPage() {
  const [domains, setDomains]   = useState<KnowledgeDomain[]>([]);
  const [form, setForm]         = useState<DomainFormState>(emptyForm());
  const [editId, setEditId]     = useState<number | null>(null);
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState("");
  const [loading, setLoading]   = useState(true);

  const loadDomains = async () => {
    const data = await knowledgeApi.getDomains(true);
    setDomains(data.filter((d) => d.slug !== "uncategorized"));
    setLoading(false);
  };

  useEffect(() => { loadDomains(); }, []);

  const handleSubmit = async () => {
    if (!form.name.trim() || !form.slug.trim()) {
      setError("분야 이름과 슬러그는 필수입니다.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const keywords = form.keywords
        .split(",")
        .map((k) => k.trim())
        .filter(Boolean);

      if (editId) {
        await knowledgeApi.updateDomain(editId, { ...form, keywords });
      } else {
        await knowledgeApi.createDomain({ ...form, keywords });
      }
      setForm(emptyForm());
      setEditId(null);
      await loadDomains();
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장 실패");
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (d: KnowledgeDomain) => {
    setEditId(d.id);
    setForm({
      name:        d.name,
      slug:        d.slug,
      emoji:       d.emoji || "📁",
      color:       d.color || "#6b7280",
      description: d.description || "",
      keywords:    d.keywords.join(", "),
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleDelete = async (id: number) => {
    if (!confirm("이 분야를 비활성화하시겠습니까?")) return;
    await knowledgeApi.deleteDomain(id);
    await loadDomains();
  };

  const handleToggleActive = async (d: KnowledgeDomain) => {
    await knowledgeApi.updateDomain(d.id, { is_active: !d.is_active });
    await loadDomains();
  };

  const applyTemplate = (t: typeof DEFAULT_TEMPLATES[0]) => {
    setForm({
      name:        t.name,
      slug:        t.slug,
      emoji:       t.emoji,
      color:       t.color,
      description: "",
      keywords:    t.keywords.join(", "),
    });
    setEditId(null);
  };

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      {/* 헤더 */}
      <div>
        <Link href="/knowledge" className="text-sm text-neutral-400 hover:text-neutral-600">
          ← 지식 허브
        </Link>
        <h1 className="text-xl font-bold mt-2 text-neutral-900 dark:text-neutral-100">
          관심 분야 관리
        </h1>
      </div>

      {/* 분야 등록/수정 폼 */}
      <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5 space-y-4">
        <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">
          {editId ? "분야 수정" : "새 분야 추가"}
        </h2>

        {/* 템플릿 버튼 */}
        {!editId && (
          <div>
            <p className="text-xs text-neutral-400 mb-2">템플릿으로 시작:</p>
            <div className="flex flex-wrap gap-2">
              {DEFAULT_TEMPLATES.map((t) => (
                <button
                  key={t.slug}
                  onClick={() => applyTemplate(t)}
                  className="text-xs px-2.5 py-1.5 rounded-full border border-neutral-300 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
                >
                  {t.emoji} {t.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 이모지 선택 */}
        <div>
          <label className="text-xs font-medium text-neutral-600 dark:text-neutral-400 block mb-1.5">
            이모지
          </label>
          <div className="flex flex-wrap gap-2">
            {EMOJI_OPTIONS.map((e) => (
              <button
                key={e}
                onClick={() => setForm((f) => ({ ...f, emoji: e }))}
                className={`text-xl p-1.5 rounded-lg transition-colors ${
                  form.emoji === e
                    ? "bg-neutral-900 dark:bg-neutral-100"
                    : "hover:bg-neutral-100 dark:hover:bg-neutral-800"
                }`}
              >
                {e}
              </button>
            ))}
          </div>
        </div>

        {/* 색상 선택 */}
        <div>
          <label className="text-xs font-medium text-neutral-600 dark:text-neutral-400 block mb-1.5">
            색상
          </label>
          <div className="flex gap-2">
            {COLOR_OPTIONS.map((c) => (
              <button
                key={c}
                onClick={() => setForm((f) => ({ ...f, color: c }))}
                style={{ backgroundColor: c }}
                className={`w-7 h-7 rounded-full transition-transform ${
                  form.color === c ? "scale-125 ring-2 ring-offset-2 ring-neutral-400" : ""
                }`}
              />
            ))}
          </div>
        </div>

        {/* 이름 */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-neutral-600 dark:text-neutral-400 block mb-1">
              분야 이름 *
            </label>
            <input
              value={form.name}
              onChange={(e) => {
                const name = e.target.value;
                setForm((f) => ({
                  ...f,
                  name,
                  slug: editId ? f.slug : slugify(name),
                }));
              }}
              placeholder="예: AI·기술"
              className="w-full rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-neutral-600 dark:text-neutral-400 block mb-1">
              슬러그 *
            </label>
            <input
              value={form.slug}
              onChange={(e) => setForm((f) => ({ ...f, slug: slugify(e.target.value) }))}
              placeholder="예: ai-tech"
              className="w-full rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>
        </div>

        {/* 설명 */}
        <div>
          <label className="text-xs font-medium text-neutral-600 dark:text-neutral-400 block mb-1">
            설명 (선택)
          </label>
          <input
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            placeholder="분야 설명..."
            className="w-full rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
        </div>

        {/* 키워드 */}
        <div>
          <label className="text-xs font-medium text-neutral-600 dark:text-neutral-400 block mb-1">
            뉴스 수집 키워드 (쉼표로 구분)
          </label>
          <input
            value={form.keywords}
            onChange={(e) => setForm((f) => ({ ...f, keywords: e.target.value }))}
            placeholder="예: AI, ChatGPT, 반도체, 엔비디아"
            className="w-full rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
          <p className="text-xs text-neutral-400 mt-1">
            입력한 키워드로 Google 뉴스를 자동 수집합니다.
          </p>
        </div>

        {error && <p className="text-xs text-red-500">{error}</p>}

        <div className="flex gap-2">
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="flex-1 rounded-lg bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 py-2 text-sm font-medium disabled:opacity-50"
          >
            {saving ? "저장 중..." : editId ? "수정 완료" : "분야 추가"}
          </button>
          {editId && (
            <button
              onClick={() => { setEditId(null); setForm(emptyForm()); }}
              className="rounded-lg border border-neutral-300 dark:border-neutral-700 px-4 py-2 text-sm"
            >
              취소
            </button>
          )}
        </div>
      </div>

      {/* 등록된 분야 목록 */}
      <div>
        <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300 mb-3">
          등록된 분야 ({domains.length}개)
        </h2>
        {loading ? (
          <div className="space-y-2">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-14 animate-pulse rounded-xl bg-neutral-100 dark:bg-neutral-800" />
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            {domains.map((d) => (
              <div
                key={d.id}
                className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${
                  d.is_active
                    ? "border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900"
                    : "border-neutral-100 dark:border-neutral-900 bg-neutral-50 dark:bg-neutral-950 opacity-60"
                }`}
              >
                <span className="text-xl">{d.emoji}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                    {d.name}
                    {!d.is_active && (
                      <span className="ml-2 text-xs text-neutral-400">(비활성)</span>
                    )}
                  </p>
                  {d.keywords.length > 0 && (
                    <p className="text-xs text-neutral-400 truncate">
                      {d.keywords.slice(0, 4).join(", ")}
                    </p>
                  )}
                </div>
                <div className="flex gap-1.5">
                  <button
                    onClick={() => handleToggleActive(d)}
                    className="text-xs px-2 py-1 rounded border border-neutral-300 dark:border-neutral-700 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                  >
                    {d.is_active ? "숨기기" : "활성화"}
                  </button>
                  <button
                    onClick={() => handleEdit(d)}
                    className="text-xs px-2 py-1 rounded border border-neutral-300 dark:border-neutral-700 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                  >
                    수정
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}


// ─────────────────────────────────────────────────────────────────────────────
// app-shell.tsx 수정 패치
// ─────────────────────────────────────────────────────────────────────────────

/**
 * frontend/components/app-shell.tsx 의 menuGroups에 아래 항목을 추가하세요:
 *
 * 기존 "인텔리전스" 그룹 뒤에 새 그룹 추가:
 *
 * {
 *   title: "지식",
 *   links: [
 *     { href: "/knowledge", label: "지식 허브" },
 *   ],
 * },
 *
 * 전체 menuGroups 예시:
 *
 * const menuGroups = [
 *   {
 *     title: "포트폴리오",
 *     links: [
 *       { href: "/", label: "대시보드" },
 *       { href: "/portfolio", label: "종목 현황" },
 *       { href: "/chart", label: "차트 분석" },
 *     ],
 *   },
 *   {
 *     title: "인텔리전스",
 *     links: [
 *       { href: "/intelligence", label: "AI 분석" },
 *       { href: "/watchlist", label: "관심 종목" },
 *       { href: "/alerts", label: "알림" },
 *     ],
 *   },
 *   {
 *     title: "지식",           // ← 신규 추가
 *     links: [
 *       { href: "/knowledge", label: "지식 허브" },
 *     ],
 *   },
 *   {
 *     title: "수익",
 *     links: [{ href: "/gains", label: "총수익" }],
 *   },
 *   {
 *     title: "관리",
 *     links: [{ href: "/settings", label: "설정" }],
 *   },
 * ];
 */
export {};
