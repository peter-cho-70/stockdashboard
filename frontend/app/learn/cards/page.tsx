"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ExternalLink,
  FolderPlus,
  Globe,
  Link2,
  Loader2,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
  Video,
} from "lucide-react";
import {
  studyApi,
  type LinkPreview,
  type StudyCard,
  type StudyCategory,
} from "@/lib/studyApi";

function SourceBadge({ type }: { type: string | null }) {
  if (type === "YOUTUBE") {
    return (
      <span className="inline-flex items-center gap-0.5 text-[10px] text-red-600 dark:text-red-400">
        <Video size={10} /> YouTube
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-0.5 text-[10px] text-blue-600 dark:text-blue-400">
      <Globe size={10} /> Web
    </span>
  );
}

export function StudyLibraryPanel() {
  const [categories, setCategories] = useState<StudyCategory[]>([]);
  const [cards, setCards] = useState<StudyCard[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showAddLink, setShowAddLink] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const [preview, setPreview] = useState<LinkPreview | null>(null);
  const [fetching, setFetching] = useState(false);
  const [saving, setSaving] = useState(false);

  const [showAddCategory, setShowAddCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [editingCategoryId, setEditingCategoryId] = useState<number | null>(null);
  const [editCategoryName, setEditCategoryName] = useState("");

  const defaultCategory = useMemo(
    () => categories.find((c) => c.is_default) ?? categories[0] ?? null,
    [categories],
  );

  const activeCategoryId = selectedCategoryId ?? defaultCategory?.id ?? null;

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const catRes = await studyApi.listCategories();
      setCategories(catRes.items);
      const catId = selectedCategoryId ?? catRes.items.find((c) => c.is_default)?.id ?? catRes.items[0]?.id;
      if (catId != null) {
        const cardRes = await studyApi.listCards({ categoryId: catId });
        setCards(cardRes.items);
        if (selectedCategoryId == null) setSelectedCategoryId(catId);
      } else {
        const cardRes = await studyApi.listCards();
        setCards(cardRes.items);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "불러오기 실패");
    } finally {
      setLoading(false);
    }
  }, [selectedCategoryId]);

  const loadCards = useCallback(async (categoryId: number) => {
    try {
      const cardRes = await studyApi.listCards({ categoryId });
      setCards(cardRes.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "카드 불러오기 실패");
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const selectCategory = async (id: number) => {
    setSelectedCategoryId(id);
    await loadCards(id);
  };

  const fetchPreview = async () => {
    const raw = urlInput.trim();
    if (!raw) {
      setError("URL을 입력하세요.");
      return;
    }
    setFetching(true);
    setError(null);
    setPreview(null);
    try {
      const meta = await studyApi.previewLink(raw);
      setPreview(meta);
      setUrlInput(meta.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "제목 가져오기 실패");
    } finally {
      setFetching(false);
    }
  };

  const saveLink = async () => {
    const raw = (preview?.url || urlInput).trim();
    if (!raw) return;
    setSaving(true);
    setError(null);
    try {
      const item = await studyApi.createManualCard({
        url: raw,
        category_id: activeCategoryId ?? undefined,
        title: preview?.title,
      });
      if (item.category_id === activeCategoryId) {
        setCards((prev) => {
          const without = prev.filter((c) => c.id !== item.id);
          return [...without, item];
        });
      }
      setShowAddLink(false);
      setUrlInput("");
      setPreview(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장 실패");
    } finally {
      setSaving(false);
    }
  };

  const createCategory = async () => {
    const name = newCategoryName.trim();
    if (!name) return;
    try {
      const cat = await studyApi.createCategory(name);
      setCategories((prev) => [...prev, cat]);
      setNewCategoryName("");
      setShowAddCategory(false);
      await selectCategory(cat.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "카테고리 생성 실패");
    }
  };

  const saveCategoryEdit = async (id: number) => {
    try {
      const cat = await studyApi.updateCategory(id, { name: editCategoryName });
      setCategories((prev) => prev.map((c) => (c.id === id ? cat : c)));
      setEditingCategoryId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "수정 실패");
    }
  };

  const removeCategory = async (cat: StudyCategory) => {
    if (cat.is_default) return;
    if (!confirm(`「${cat.name}」 카테고리를 삭제할까요? 항목은 미분류로 이동합니다.`)) return;
    try {
      await studyApi.deleteCategory(cat.id, defaultCategory?.id);
      setCategories((prev) => prev.filter((c) => c.id !== cat.id));
      if (activeCategoryId === cat.id && defaultCategory) {
        await selectCategory(defaultCategory.id);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "삭제 실패");
    }
  };

  const moveCardToCategory = async (cardId: number, categoryId: number) => {
    try {
      await studyApi.moveCard(cardId, categoryId);
      setCards((prev) => prev.filter((c) => c.id !== cardId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "이동 실패");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold">내 학습 서재</h1>
          <p className="text-sm text-neutral-500 mt-0.5">
            유튜브·웹 링크를 모아 두고 간단 분석까지 할 수 있습니다.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setShowAddCategory(true)}
            className="inline-flex items-center gap-1 rounded-lg border border-[var(--border-subtle)] px-3 py-1.5 text-xs hover:bg-[var(--surface-elevated)]"
          >
            <FolderPlus size={13} /> 카테고리
          </button>
          <button
            type="button"
            onClick={() => setShowAddLink(true)}
            className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700"
          >
            <Plus size={13} /> 링크 추가
          </button>
        </div>
      </div>

      {error && (
        <p className="text-xs text-red-600 bg-red-50 dark:bg-red-900/20 rounded-md px-3 py-2">{error}</p>
      )}

      <div className="grid gap-4 lg:grid-cols-[200px_1fr]">
        <aside className="space-y-1">
          {categories.map((cat) => (
            <div key={cat.id} className="group flex items-center gap-1">
              {editingCategoryId === cat.id ? (
                <div className="flex flex-1 gap-1">
                  <input
                    value={editCategoryName}
                    onChange={(e) => setEditCategoryName(e.target.value)}
                    className="flex-1 rounded border border-[var(--border-subtle)] px-2 py-1 text-xs"
                    onKeyDown={(e) => e.key === "Enter" && saveCategoryEdit(cat.id)}
                  />
                  <button type="button" onClick={() => saveCategoryEdit(cat.id)} className="text-xs text-emerald-600">
                    저장
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => selectCategory(cat.id)}
                  className={`flex-1 text-left rounded-lg px-3 py-2 text-sm transition-colors ${
                    activeCategoryId === cat.id
                      ? "bg-emerald-50 text-emerald-800 font-medium dark:bg-emerald-900/30 dark:text-emerald-300"
                      : "text-neutral-600 hover:bg-[var(--surface-elevated)] dark:text-neutral-400"
                  }`}
                >
                  {cat.name}
                </button>
              )}
              {!cat.is_default && editingCategoryId !== cat.id && (
                <div className="flex opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    type="button"
                    onClick={() => {
                      setEditingCategoryId(cat.id);
                      setEditCategoryName(cat.name);
                    }}
                    className="p-1 text-neutral-400 hover:text-neutral-600"
                    title="이름 수정"
                    aria-label="카테고리 이름 수정"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => removeCategory(cat)}
                    className="p-1 text-neutral-400 hover:text-red-600"
                    title="삭제"
                    aria-label="카테고리 삭제"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              )}
            </div>
          ))}
        </aside>

        <section className="space-y-2 min-h-[200px]">
          {loading ? (
            <p className="text-sm text-neutral-500">불러오는 중…</p>
          ) : cards.length === 0 ? (
            <p className="text-sm text-neutral-500 rounded-xl border border-dashed border-[var(--border-subtle)] p-8 text-center">
              이 카테고리에 항목이 없습니다. 링크를 추가해 보세요.
            </p>
          ) : (
            cards.map((card) => (
              <div
                key={card.id}
                className="flex gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface)] p-3 hover:border-emerald-300 dark:hover:border-emerald-700 transition-colors"
              >
                {card.thumbnail ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={card.thumbnail}
                    alt=""
                    className="h-14 w-24 shrink-0 rounded object-cover bg-neutral-100 dark:bg-neutral-900"
                  />
                ) : (
                  <div className="flex h-14 w-24 shrink-0 items-center justify-center rounded bg-neutral-100 dark:bg-neutral-900">
                    {card.source_type === "YOUTUBE" ? (
                      <Video size={20} className="text-red-500" />
                    ) : (
                      <Globe size={20} className="text-blue-500" />
                    )}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 mb-0.5">
                    <SourceBadge type={card.source_type} />
                    {card.origin === "ai" && (
                      <span className="inline-flex items-center gap-0.5 text-[10px] text-violet-600 dark:text-violet-400">
                        <Sparkles size={10} /> AI 카드
                      </span>
                    )}
                    {card.analysis_status === "done" && (
                      <span className="text-[10px] text-emerald-600 dark:text-emerald-400">분석됨</span>
                    )}
                  </div>
                  <Link href={`/learn/card/${card.id}`} className="text-sm font-medium line-clamp-2 hover:text-emerald-700 dark:hover:text-emerald-300">
                    {card.title}
                  </Link>
                  {card.summary && (
                    <p className="text-xs text-neutral-500 mt-1 line-clamp-2">{card.summary}</p>
                  )}
                  <div className="flex flex-wrap items-center gap-2 mt-2">
                    {card.source_url && (
                      <a
                        href={card.source_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-0.5 text-[11px] text-neutral-500 hover:text-neutral-700"
                        onClick={(e) => e.stopPropagation()}
                      >
                        원본 <ExternalLink size={10} />
                      </a>
                    )}
                    {categories.length > 1 && (
                      <select
                        value={card.category_id ?? ""}
                        onChange={(e) => moveCardToCategory(card.id, Number(e.target.value))}
                        className="text-[11px] rounded border border-[var(--border-subtle)] bg-transparent px-1.5 py-0.5"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {categories.map((c) => (
                          <option key={c.id} value={c.id}>
                            → {c.name}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </section>
      </div>

      {showAddCategory && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-xl bg-[var(--surface)] p-5 shadow-xl border border-[var(--border-subtle)]">
            <h3 className="text-sm font-semibold mb-3">카테고리 추가</h3>
            <input
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              placeholder="예: 캔들 패턴"
              className="w-full rounded-lg border border-[var(--border-subtle)] px-3 py-2 text-sm mb-3"
              onKeyDown={(e) => e.key === "Enter" && createCategory()}
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowAddCategory(false)} className="text-sm px-3 py-1.5 text-neutral-500">
                취소
              </button>
              <button type="button" onClick={createCategory} className="text-sm px-3 py-1.5 rounded-lg bg-emerald-600 text-white">
                추가
              </button>
            </div>
          </div>
        </div>
      )}

      {showAddLink && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-xl bg-[var(--surface)] p-5 shadow-xl border border-[var(--border-subtle)] space-y-3">
            <h3 className="text-sm font-semibold">링크 추가</h3>
            <div className="flex gap-2">
              <div className="relative flex-1 min-w-0">
                <Link2 size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
                <input
                  type="url"
                  value={urlInput}
                  onChange={(e) => {
                    setUrlInput(e.target.value);
                    setPreview(null);
                  }}
                  onKeyDown={(e) => e.key === "Enter" && fetchPreview()}
                  placeholder="YouTube 또는 웹페이지 URL"
                  className="w-full rounded-lg border border-[var(--border-subtle)] pl-9 pr-3 py-2 text-sm"
                  autoFocus
                />
              </div>
              <button
                type="button"
                onClick={fetchPreview}
                disabled={fetching}
                className="shrink-0 rounded-lg border border-[var(--border-subtle)] px-3 py-2 text-xs disabled:opacity-50"
              >
                {fetching ? <Loader2 size={14} className="animate-spin" /> : "제목 가져오기"}
              </button>
            </div>
            {preview && (
              <div className="flex gap-3 rounded-lg border border-emerald-200 bg-emerald-50/50 p-3 dark:border-emerald-800 dark:bg-emerald-950/20">
                {preview.thumbnail && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={preview.thumbnail} alt="" className="h-14 w-24 rounded object-cover" />
                )}
                <div className="min-w-0">
                  <p className="text-sm font-medium line-clamp-2">{preview.title}</p>
                  <p className="text-[11px] text-neutral-500 mt-0.5">{preview.channel_name}</p>
                  <SourceBadge type={preview.source_type} />
                </div>
              </div>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  setShowAddLink(false);
                  setPreview(null);
                  setUrlInput("");
                }}
                className="text-sm px-3 py-1.5 text-neutral-500"
              >
                취소
              </button>
              <button
                type="button"
                onClick={saveLink}
                disabled={saving || (!preview && !urlInput.trim())}
                className="text-sm px-4 py-1.5 rounded-lg bg-emerald-600 text-white disabled:opacity-50"
              >
                {saving ? "저장 중…" : "저장"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function LearnCardsPage() {
  return (
    <div className="space-y-4 max-w-5xl">
      <Link href="/learn" className="inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-emerald-600">
        <ArrowLeft size={14} /> 주식공부하기
      </Link>
      <StudyLibraryPanel />
    </div>
  );
}
