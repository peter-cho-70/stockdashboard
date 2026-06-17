"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { GraduationCap, Highlighter, Pencil, Star, TrendingDown, TrendingUp, Minus, X, Plus } from "lucide-react";
import type { MacroAnalysis, SectorAnalysisItem, StockIssueItem } from "@/lib/api";
import {
  intelHighlightsApi,
  normalizeKeyPoints,
  normalizeUserHighlights,
  newSnippetId,
  type HighlightSnippet,
  type UserHighlights,
} from "@/lib/intelHighlights";
import {
  HIGHLIGHT_COLORS,
  HIGHLIGHT_COLOR_LABELS,
  HIGHLIGHT_MARK_CLASS,
  HIGHLIGHT_PIN_BG,
  normalizeHighlightColor,
  type HighlightColor,
} from "@/lib/highlightColors";
import { renderAnalysisText, type SnippetMark } from "@/lib/renderAnalysisText";
import { studyApi } from "@/lib/studyApi";

export interface IntelDetailData {
  id?: number;
  source_type: string;
  source_url?: string | null;
  summary?: string | null;
  key_points?: (string | KeyPointItem)[];
  mentioned_stocks?: string[];
  mentioned_sectors?: string[];
  keywords?: string[];
  sentiment?: string | null;
  analyzed_at?: string | null;
  stock_issues?: StockIssueItem[];
  macro_analysis?: MacroAnalysis;
  sector_analysis?: SectorAnalysisItem[];
  source_document?: string | null;
  content_scope?: "knowledge" | "market" | string;
  user_highlights?: UserHighlights;
}

type DetailTab = "analysis" | "document" | "source";

function SentDot({ s }: { s: string }) {
  if (s === "POSITIVE") return <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />;
  if (s === "NEGATIVE") return <span className="h-1.5 w-1.5 rounded-full bg-red-500 shrink-0" />;
  return <span className="h-1.5 w-1.5 rounded-full bg-neutral-400 shrink-0" />;
}

function MacroSectorBlock({ macro, sectors }: { macro?: MacroAnalysis; sectors?: SectorAnalysisItem[] }) {
  const hasMacro = macro && (macro.summary || (macro.topics?.length ?? 0) > 0);
  const hasSector = sectors && sectors.length > 0;
  if (!hasMacro && !hasSector) return null;

  return (
    <div className="space-y-2">
      {hasMacro && (
        <div className="rounded-md border border-purple-200 bg-purple-50 dark:border-purple-800 dark:bg-purple-900/15 p-2.5">
          <p className="text-[10px] font-semibold text-purple-700 dark:text-purple-400 mb-1">🌍 매크로 분석</p>
          {macro!.summary && (
            <p className="text-xs text-neutral-600 dark:text-neutral-400 mb-1.5 whitespace-pre-wrap">
              {macro!.summary}
            </p>
          )}
          {macro!.topics?.map((t, i) => (
            <div key={i} className="flex gap-2 items-start mb-1.5">
              <SentDot s={t.sentiment} />
              <div>
                <span className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">{t.topic}</span>
                <p className="text-xs text-neutral-600 dark:text-neutral-400 whitespace-pre-wrap">{t.summary}</p>
                {t.impact && <p className="text-[10px] text-neutral-400">→ {t.impact}</p>}
              </div>
            </div>
          ))}
        </div>
      )}
      {hasSector && (
        <div className="rounded-md border border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-900/15 p-2.5">
          <p className="text-[10px] font-semibold text-blue-700 dark:text-blue-400 mb-1.5">📊 섹터별 분석</p>
          <div className="space-y-2">
            {sectors!.map((s, i) => (
              <div key={i} className="flex gap-2 items-start">
                <SentDot s={s.sentiment} />
                <div>
                  <span className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">{s.sector}</span>
                  <p className="text-xs text-neutral-600 dark:text-neutral-400 whitespace-pre-wrap">{s.summary}</p>
                  {s.outlook && <p className="text-[10px] text-neutral-400">전망: {s.outlook}</p>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SelectableTextBlock({
  text,
  field,
  editMode,
  keywords,
  snippetMarks,
  onAddSnippet,
}: {
  text: string;
  field: string;
  editMode: boolean;
  keywords: string[];
  snippetMarks: SnippetMark[];
  onAddSnippet: (field: string, selected: string, color: HighlightColor) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [popup, setPopup] = useState<{ x: number; y: number; sel: string } | null>(null);
  const [pickColor, setPickColor] = useState<HighlightColor>("amber");

  const handleMouseUp = useCallback(() => {
    if (!editMode) return;
    const sel = window.getSelection();
    const selected = sel?.toString().trim() ?? "";
    if (!selected || selected.length < 4) {
      setPopup(null);
      return;
    }
    const range = sel?.getRangeAt(0);
    const rect = range?.getBoundingClientRect();
    if (!rect) return;
    setPopup({ x: rect.left, y: rect.top - 36, sel: selected });
  }, [editMode]);

  return (
    <div className="relative">
      <div
        ref={ref}
        onMouseUp={handleMouseUp}
        className={`text-xs leading-relaxed whitespace-pre-wrap ${
          editMode ? "cursor-text select-text ring-1 ring-amber-300/50 rounded-md p-2" : ""
        } text-neutral-700 dark:text-neutral-300`}
      >
        {renderAnalysisText(text, { keywords, snippetMarks })}
      </div>
      {popup && editMode && (
        <div
          className="fixed z-50 flex flex-col gap-1 rounded-md border border-amber-300 bg-amber-50 px-2 py-1.5 shadow-lg dark:border-amber-700 dark:bg-amber-950"
          style={{ left: popup.x, top: popup.y }}
        >
          <div className="flex items-center gap-0.5">
            {HIGHLIGHT_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                title={HIGHLIGHT_COLOR_LABELS[c]}
                onClick={() => setPickColor(c)}
                className={`h-4 w-4 rounded-full border-2 ${
                  pickColor === c ? "border-neutral-800 dark:border-white scale-110" : "border-transparent"
                } ${HIGHLIGHT_MARK_CLASS[c].split(" ")[0]}`}
              />
            ))}
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="text-[11px] font-medium text-amber-900 dark:text-amber-200 flex items-center gap-1"
              onClick={() => {
                onAddSnippet(field, popup.sel, pickColor);
                setPopup(null);
                window.getSelection()?.removeAllRanges();
              }}
            >
              <Highlighter size={12} />
              강조 추가
            </button>
            <button type="button" onClick={() => setPopup(null)} className="text-amber-700">
              <X size={12} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function DocumentBlock({
  text,
  emptyLabel,
  field,
  editMode,
  keywords,
  snippetMarks,
  onAddSnippet,
}: {
  text?: string | null;
  emptyLabel: string;
  field: string;
  editMode: boolean;
  keywords: string[];
  snippetMarks: SnippetMark[];
  onAddSnippet: (field: string, selected: string, color: HighlightColor) => void;
}) {
  if (!text?.trim()) {
    return <p className="text-xs text-neutral-400 py-4 text-center">{emptyLabel}</p>;
  }
  return (
    <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--background)] p-3 max-h-96 overflow-y-auto">
      <p className="text-[10px] text-neutral-400 mb-2">{text.length.toLocaleString()}자</p>
      <SelectableTextBlock
        text={text}
        field={field}
        editMode={editMode}
        keywords={keywords}
        snippetMarks={snippetMarks}
        onAddSnippet={onAddSnippet}
      />
    </div>
  );
}

export function IntelDetailPanel({
  data,
  compact = false,
  contentId,
  onHighlightsSaved,
}: {
  data: IntelDetailData;
  compact?: boolean;
  contentId?: number;
  onHighlightsSaved?: (highlights: UserHighlights) => void;
}) {
  const router = useRouter();
  const resolvedId = contentId ?? data.id;
  const isKnowledge = data.content_scope === "knowledge";
  const isYoutube = data.source_type === "YOUTUBE";
  const isTextOrNews = data.source_type === "TEXT" || data.source_type === "NEWS";

  const keyPoints = useMemo(() => normalizeKeyPoints(data.key_points), [data.key_points]);
  const keywords = data.keywords ?? [];

  const [highlights, setHighlights] = useState<UserHighlights>(() =>
    normalizeUserHighlights(data.user_highlights),
  );
  const highlightsRef = useRef(highlights);
  highlightsRef.current = highlights;

  const [editMode, setEditMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [newUserPoint, setNewUserPoint] = useState("");
  const [studyLoading, setStudyLoading] = useState(false);
  const [studyError, setStudyError] = useState<string | null>(null);
  const [studyCardId, setStudyCardId] = useState<number | null>(null);

  useEffect(() => {
    setHighlights(normalizeUserHighlights(data.user_highlights));
    setDirty(false);
    setSaveError(null);
  }, [data.user_highlights, resolvedId]);

  useEffect(() => {
    setStudyCardId(null);
    setStudyError(null);
  }, [resolvedId]);

  useEffect(() => {
    if (!resolvedId) return;
    let cancelled = false;
    intelHighlightsApi
      .get(resolvedId)
      .then((h) => {
        if (!cancelled) setHighlights(normalizeUserHighlights(h));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [resolvedId]);

  const snippetMarks = useMemo<SnippetMark[]>(
    () =>
      highlights.snippets.map((s) => ({
        text: s.text,
        color: normalizeHighlightColor(s.color),
      })),
    [highlights.snippets],
  );

  const applyLocal = useCallback((next: UserHighlights) => {
    highlightsRef.current = next;
    setHighlights(next);
    setDirty(true);
    setSaveError(null);
  }, []);

  const saveHighlights = useCallback(async () => {
    if (!resolvedId) return;
    const payload = highlightsRef.current;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await intelHighlightsApi.save(resolvedId, payload);
      const saved = normalizeUserHighlights(res.user_highlights);
      setHighlights(saved);
      setDirty(false);
      onHighlightsSaved?.(saved);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "저장 실패");
    } finally {
      setSaving(false);
    }
  }, [resolvedId, onHighlightsSaved]);

  const createStudyCard = useCallback(async () => {
    if (!resolvedId) return;
    setStudyLoading(true);
    setStudyError(null);
    try {
      const card = await studyApi.createCardFromContent(resolvedId);
      setStudyCardId(card.id);
      router.push(`/learn/card/${card.id}`);
    } catch (e) {
      setStudyError(e instanceof Error ? e.message : "학습 카드 생성 실패");
    } finally {
      setStudyLoading(false);
    }
  }, [resolvedId, router]);

  const togglePin = (index: number) => {
    setHighlights((prev) => {
      const pins = new Set(prev.pinned_key_point_indexes);
      const pin_colors = { ...(prev.pin_colors ?? {}) };
      const key = String(index);
      if (pins.has(index)) {
        pins.delete(index);
        delete pin_colors[key];
      } else {
        pins.add(index);
        pin_colors[key] = pin_colors[key] || "amber";
      }
      const next = {
        ...prev,
        pinned_key_point_indexes: [...pins].sort((a, b) => a - b),
        pin_colors,
      };
      highlightsRef.current = next;
      setDirty(true);
      return next;
    });
  };

  const cyclePinColor = (index: number) => {
    setHighlights((prev) => {
      const pin_colors = { ...(prev.pin_colors ?? {}) };
      const key = String(index);
      const cur = normalizeHighlightColor(pin_colors[key]);
      const i = HIGHLIGHT_COLORS.indexOf(cur);
      pin_colors[key] = HIGHLIGHT_COLORS[(i + 1) % HIGHLIGHT_COLORS.length];
      const next = { ...prev, pin_colors };
      highlightsRef.current = next;
      setDirty(true);
      return next;
    });
  };

  const addSnippet = (field: string, selected: string, color: HighlightColor) => {
    const sn: HighlightSnippet = {
      id: newSnippetId(),
      field,
      text: selected,
      note: "",
      color,
      created_at: new Date().toISOString(),
    };
    applyLocal({ ...highlightsRef.current, snippets: [sn, ...highlightsRef.current.snippets] });
  };

  const removeSnippet = (id: string) => {
    applyLocal({
      ...highlightsRef.current,
      snippets: highlightsRef.current.snippets.filter((s) => s.id !== id),
    });
  };

  const addUserPoint = () => {
    const t = newUserPoint.trim();
    if (!t) return;
    applyLocal({
      ...highlightsRef.current,
      user_key_points: [t, ...highlightsRef.current.user_key_points],
    });
    setNewUserPoint("");
  };

  const removeUserPoint = (idx: number) => {
    const next = [...highlightsRef.current.user_key_points];
    next.splice(idx, 1);
    applyLocal({ ...highlightsRef.current, user_key_points: next });
  };

  const sortedKeyPointEntries = useMemo(() => {
    const pins = new Set(highlights.pinned_key_point_indexes);
    const entries = keyPoints.map((kp, index) => ({ kp, index }));
    return entries.sort((a, b) => {
      const ap = pins.has(a.index) ? 0 : 1;
      const bp = pins.has(b.index) ? 0 : 1;
      if (ap !== bp) return ap - bp;
      const ah = a.kp.importance === "high" ? 0 : 1;
      const bh = b.kp.importance === "high" ? 0 : 1;
      if (ah !== bh) return ah - bh;
      return a.index - b.index;
    });
  }, [keyPoints, highlights.pinned_key_point_indexes]);

  const tabs = [
    { id: "analysis" as const, label: "구조화 분석", show: true },
    { id: "document" as const, label: "추출 문서", show: isYoutube && !!data.source_document },
    { id: "source" as const, label: "원본 텍스트", show: isTextOrNews && !!data.source_document },
  ].filter((t) => t.show);

  const [tab, setTab] = useState<DetailTab>("analysis");

  const sentLabel: Record<string, string> = { POSITIVE: "긍정", NEGATIVE: "부정", NEUTRAL: "중립" };
  const s = data.sentiment ?? "NEUTRAL";

  return (
    <div className={`space-y-3 ${compact ? "text-xs" : "text-sm"}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        {tabs.length > 1 && (
          <div className="flex gap-1 rounded-md border border-[var(--border-subtle)] p-0.5 bg-[var(--surface-elevated)] flex-1 min-w-0">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`flex-1 rounded px-2 py-1 text-[10px] font-medium transition-colors ${
                  tab === t.id
                    ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                    : "text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}
        <div className="flex items-center gap-1 shrink-0">
          {resolvedId && (
            studyCardId ? (
              <Link
                href={`/learn/card/${studyCardId}`}
                className="flex items-center gap-1 rounded-md border border-emerald-300 bg-emerald-50 px-2 py-1 text-[10px] font-medium text-emerald-800 dark:border-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200"
              >
                <GraduationCap size={11} />
                학습 카드
              </Link>
            ) : (
              <button
                type="button"
                disabled={studyLoading}
                onClick={() => createStudyCard()}
                className="flex items-center gap-1 rounded-md border border-violet-300 bg-violet-50 px-2 py-1 text-[10px] font-medium text-violet-800 disabled:opacity-50 dark:border-violet-800 dark:bg-violet-900/30 dark:text-violet-200"
              >
                <GraduationCap size={11} />
                {studyLoading ? "생성 중…" : "학습용으로 만들기"}
              </button>
            )
          )}
          {editMode && resolvedId && (
            <button
              type="button"
              disabled={saving || !dirty}
              onClick={() => saveHighlights()}
              className="rounded-md bg-neutral-900 text-white px-2 py-1 text-[10px] font-medium disabled:opacity-40 dark:bg-neutral-100 dark:text-neutral-900"
            >
              {saving ? "저장 중…" : dirty ? "저장" : "저장됨"}
            </button>
          )}
          <button
            type="button"
            onClick={() => setEditMode((v) => !v)}
            className={`flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-medium ${
              editMode
                ? "border-amber-400 bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200"
                : "border-[var(--border-subtle)] text-neutral-500"
            }`}
          >
            <Pencil size={11} />
            {editMode ? "편집 중" : "강조 편집"}
          </button>
        </div>
      </div>

      {editMode && (
        <p className="text-[10px] text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 rounded-md px-2 py-1.5">
          ☆ 고정 · 색 클릭으로 핀 색 변경 · 드래그 후 색 선택·강조 추가 · 변경 후 「저장」
          {!resolvedId && " (저장하려면 분석 완료 후 ID 필요)"}
        </p>
      )}
      {saveError && (
        <p className="text-[10px] text-red-600 bg-red-50 dark:bg-red-900/20 rounded-md px-2 py-1">{saveError}</p>
      )}
      {studyError && (
        <p className="text-[10px] text-red-600 bg-red-50 dark:bg-red-900/20 rounded-md px-2 py-1">{studyError}</p>
      )}

      {(highlights.snippets.length > 0 || highlights.user_key_points.length > 0) && tab === "analysis" && (
        <div className="rounded-md border border-amber-200/80 bg-amber-50/50 dark:border-amber-800/50 dark:bg-amber-900/10 p-2.5 space-y-2">
          <p className="text-[10px] font-semibold text-amber-800 dark:text-amber-300 flex items-center gap-1">
            <Highlighter size={12} />
            내가 표시한 강조
          </p>
          {highlights.user_key_points.map((p, i) => (
            <div
              key={`ukp-${i}`}
              className="flex gap-2 items-start text-xs rounded-md bg-amber-100/80 dark:bg-amber-900/25 px-2 py-1.5"
            >
              <span className="shrink-0 text-amber-600">✎</span>
              <span className="flex-1 text-neutral-800 dark:text-neutral-200">{p}</span>
              {editMode && (
                <button type="button" onClick={() => removeUserPoint(i)} className="text-neutral-400 hover:text-red-500">
                  <X size={12} />
                </button>
              )}
            </div>
          ))}
          {highlights.snippets.map((sn) => {
            const c = normalizeHighlightColor(sn.color);
            return (
              <div
                key={sn.id}
                className={`text-xs border-t border-amber-200/50 dark:border-amber-800/40 pt-2 first:border-0 first:pt-0 rounded-md px-1 ${HIGHLIGHT_MARK_CLASS[c]}`}
              >
                <div className="flex justify-between gap-1">
                  <span className="text-[9px] opacity-70 uppercase">{sn.field}</span>
                  {editMode && (
                    <button type="button" onClick={() => removeSnippet(sn.id)} className="opacity-60 hover:text-red-500">
                      <X size={11} />
                    </button>
                  )}
                </div>
                <p className="mt-0.5 line-clamp-3">{sn.text}</p>
              </div>
            );
          })}
        </div>
      )}

      {tab === "analysis" && (
        <div className="space-y-3">
          {isKnowledge && (
            <p className="rounded-md border border-violet-200 bg-violet-50 px-2.5 py-2 text-[10px] text-violet-800 dark:border-violet-800 dark:bg-violet-900/15 dark:text-violet-300">
              📚 지식 콘텐츠 — 요약·문서만 저장되며 매크로·시그널·캘린더 주가 이벤트에는 포함되지 않습니다.
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${
                s === "POSITIVE"
                  ? "text-emerald-700 dark:text-emerald-400"
                  : s === "NEGATIVE"
                    ? "text-red-700 dark:text-red-400"
                    : "text-neutral-600 dark:text-neutral-400"
              }`}
            >
              {s === "POSITIVE" ? <TrendingUp size={11} /> : s === "NEGATIVE" ? <TrendingDown size={11} /> : <Minus size={11} />}
              {sentLabel[s] ?? s}
            </span>
            {data.analyzed_at && (
              <span className="text-[10px] text-neutral-400">
                {new Date(data.analyzed_at).toLocaleString("ko-KR")}
              </span>
            )}
          </div>

          {data.summary && (
            <div>
              <p className="text-[10px] font-semibold text-neutral-500 mb-1">요약</p>
              <SelectableTextBlock
                text={data.summary}
                field="summary"
                editMode={editMode}
                keywords={keywords}
                snippetMarks={snippetMarks}
                onAddSnippet={addSnippet}
              />
            </div>
          )}

          {keyPoints.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-neutral-500 mb-1">핵심 포인트</p>
              <ul className="space-y-1.5">
                {sortedKeyPointEntries.map(({ kp, index }) => {
                  const pinned = highlights.pinned_key_point_indexes.includes(index);
                  const pinColor = normalizeHighlightColor(highlights.pin_colors?.[String(index)]);
                  const isHigh = kp.importance === "high" || pinned;
                  return (
                    <li
                      key={index}
                      className={`flex gap-2 text-xs rounded-md px-2 py-1.5 border ${
                        pinned
                          ? HIGHLIGHT_PIN_BG[pinColor]
                          : isHigh
                            ? "bg-neutral-100/80 border-transparent dark:bg-neutral-800/50"
                            : "border-transparent text-neutral-600 dark:text-neutral-400"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => editMode && togglePin(index)}
                        onContextMenu={(e) => {
                          if (!editMode || !pinned) return;
                          e.preventDefault();
                          cyclePinColor(index);
                        }}
                        disabled={!editMode}
                        className={`shrink-0 mt-0.5 ${editMode ? "cursor-pointer" : "cursor-default"} ${
                          pinned ? "text-amber-500" : "text-neutral-300"
                        }`}
                        title={editMode ? (pinned ? "클릭: 고정 해제 · 우클릭: 색 변경" : "고정") : pinned ? "고정됨" : ""}
                      >
                        <Star size={12} className={pinned ? "fill-current" : ""} />
                      </button>
                      <span
                        className={`flex-1 whitespace-pre-wrap ${
                          isHigh ? "font-medium text-neutral-800 dark:text-neutral-200" : ""
                        }`}
                      >
                        {renderAnalysisText(kp.text, { keywords, snippetMarks })}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {editMode && (
            <div className="flex gap-2">
              <input
                type="text"
                value={newUserPoint}
                onChange={(e) => setNewUserPoint(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addUserPoint()}
                placeholder="직접 추가할 핵심 포인트"
                className="flex-1 rounded-md border border-[var(--border-subtle)] px-2 py-1.5 text-xs bg-[var(--surface)]"
              />
              <button
                type="button"
                onClick={addUserPoint}
                className="rounded-md bg-neutral-900 text-white px-2.5 py-1.5 dark:bg-neutral-100 dark:text-neutral-900"
              >
                <Plus size={14} />
              </button>
            </div>
          )}

          {!isKnowledge && (data.stock_issues?.length ?? 0) > 0 && (
            <div className="rounded-md border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/15 p-2.5">
              <p className="text-[10px] font-semibold text-amber-700 dark:text-amber-400 mb-1.5">
                📌 내 보유 종목 ({data.stock_issues!.length}개)
              </p>
              <div className="space-y-2">
                {data.stock_issues!.map((iss, i) => (
                  <div key={i} className="flex gap-2">
                    <SentDot s={iss.sentiment} />
                    <div>
                      <span className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">{iss.name}</span>
                      <p className="text-xs text-neutral-600 dark:text-neutral-400 whitespace-pre-wrap">
                        {iss.issue_summary}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {!isKnowledge && <MacroSectorBlock macro={data.macro_analysis} sectors={data.sector_analysis} />}

          {((data.keywords?.length ?? 0) > 0 ||
            (data.mentioned_stocks?.length ?? 0) > 0 ||
            (data.mentioned_sectors?.length ?? 0) > 0) && (
            <div className="flex flex-wrap gap-1">
              {data.mentioned_sectors?.map((sec) => (
                <span
                  key={sec}
                  className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] text-blue-700 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-400"
                >
                  {sec}
                </span>
              ))}
              {data.mentioned_stocks?.map((st) => (
                <span
                  key={st}
                  className="rounded-full border border-[var(--border-subtle)] px-2 py-0.5 text-[10px] text-neutral-600 dark:text-neutral-400"
                >
                  {st}
                </span>
              ))}
              {data.keywords?.map((kw) => (
                <span
                  key={kw}
                  className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] text-neutral-500 dark:bg-neutral-800"
                >
                  #{kw}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "document" && (
        <DocumentBlock
          text={data.source_document}
          emptyLabel={isYoutube ? "추출 문서가 없습니다. 영상을 다시 분석하세요." : "저장된 문서가 없습니다."}
          field="source_document"
          editMode={editMode}
          keywords={keywords}
          snippetMarks={snippetMarks}
          onAddSnippet={addSnippet}
        />
      )}

      {tab === "source" && (
        <>
          {isTextOrNews ? (
            <DocumentBlock
              text={data.source_document}
              emptyLabel="원본 텍스트가 없습니다."
              field="source_document"
              editMode={editMode}
              keywords={keywords}
              snippetMarks={snippetMarks}
              onAddSnippet={addSnippet}
            />
          ) : isYoutube && data.source_url ? (
            <p className="text-xs text-neutral-500">
              YouTube 원본은 영상 링크에서 확인하세요.{" "}
              <a href={data.source_url} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">
                영상 열기
              </a>
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
