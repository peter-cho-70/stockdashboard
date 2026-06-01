"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Star,
  Trash2,
  Loader2,
  BarChart,
  RefreshCw,
  Sparkles,
  Target,
  ExternalLink,
  Plus,
  Search,
} from "lucide-react";
import {
  watchlistApi,
  signalApi,
  type WatchlistItem,
  type StockRecommendation,
  type WatchlistDetail,
  type SymbolLookup,
} from "@/lib/api";
import {
  WatchlistRegisterModal,
  type WatchlistRegisterDraft,
} from "@/components/watchlist-register-modal";

function SentBadge({ s }: { s: string | null }) {
  if (s === "POSITIVE")
    return (
      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
        긍정
      </span>
    );
  if (s === "NEGATIVE")
    return (
      <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] text-red-700 dark:bg-red-900/30 dark:text-red-400">
        부정
      </span>
    );
  return (
    <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] text-neutral-500 dark:bg-neutral-800">
      중립
    </span>
  );
}

function formatDate(iso: string | null) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString("ko-KR");
  } catch {
    return iso.slice(0, 10);
  }
}

function AddBySymbolForm({ onAdded }: { onAdded: () => void }) {
  const [symbol, setSymbol] = useState("");
  const [name, setName] = useState("");
  const [lookup, setLookup] = useState<SymbolLookup | null>(null);
  const [looking, setLooking] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");

  async function doLookup() {
    const sym = symbol.trim();
    if (sym.length !== 6) {
      setError("6자리 종목코드를 입력하세요.");
      return;
    }
    setLooking(true);
    setError("");
    try {
      const r = await watchlistApi.lookupSymbol(sym);
      setLookup(r);
      setName(r.stock_name);
    } catch (e) {
      setLookup(null);
      setError(e instanceof Error ? e.message : "조회 실패");
    } finally {
      setLooking(false);
    }
  }

  async function doAdd() {
    const sym = symbol.trim();
    if (sym.length !== 6) return;
    setAdding(true);
    setError("");
    try {
      await watchlistApi.addBySymbol({
        symbol: sym,
        stock_name: name.trim() || lookup?.stock_name,
      });
      setSymbol("");
      setName("");
      setLookup(null);
      onAdded();
    } catch (e) {
      setError(e instanceof Error ? e.message : "등록 실패");
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="border-b border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-4 py-3">
      <p className="text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-2">종목코드로 등록</p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-[10px] text-neutral-400">
          종목코드
          <input
            value={symbol}
            onChange={(e) => setSymbol(e.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="005930"
            className="mt-0.5 block w-24 rounded-md border border-[var(--border-subtle)] bg-[var(--background)] px-2 py-1.5 text-sm font-mono"
          />
        </label>
        <button
          type="button"
          onClick={doLookup}
          disabled={looking || symbol.length !== 6}
          className="flex items-center gap-1 rounded-md border border-[var(--border-subtle)] px-2.5 py-1.5 text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:opacity-50"
        >
          {looking ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />}
          조회
        </button>
        <label className="flex-1 min-w-[120px] text-[10px] text-neutral-400">
          종목명
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="조회 후 자동 입력"
            className="mt-0.5 block w-full rounded-md border border-[var(--border-subtle)] bg-[var(--background)] px-2 py-1.5 text-sm"
          />
        </label>
        <button
          type="button"
          onClick={doAdd}
          disabled={adding || symbol.length !== 6}
          className="flex items-center gap-1 rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
        >
          {adding ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
          관심 등록
        </button>
      </div>
      {lookup && (
        <p className="mt-2 text-xs text-emerald-600 dark:text-emerald-400">
          ✓ {lookup.stock_name} {lookup.sector && `· ${lookup.sector}`}
          {lookup.current_price != null && ` · ${lookup.current_price.toLocaleString()}원`}
        </p>
      )}
      {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
    </div>
  );
}

function WatchlistDetailPanel({ itemId, symbol }: { itemId: number; symbol: string }) {
  const [detail, setDetail] = useState<WatchlistDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setDetail(await watchlistApi.getDetail(itemId, 90));
    } catch (e) {
      setError(e instanceof Error ? e.message : "상세 정보를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [itemId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-12 text-sm text-neutral-400">
        <Loader2 size={16} className="animate-spin" /> 종목 상세 불러오는 중...
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="py-8 text-center text-sm text-red-500">
        {error}
        <button type="button" onClick={load} className="ml-2 underline">
          재시도
        </button>
      </div>
    );
  }

  const cs = detail.chart_summary;
  const retUp = cs.period_return_pct >= 0;

  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold text-neutral-900 dark:text-neutral-100">
            {detail.profile.name}
            <span className="ml-2 text-sm font-normal text-neutral-400">{detail.profile.symbol}</span>
          </h3>
          {detail.profile.sector && (
            <span className="mt-1 inline-block rounded bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600 dark:bg-neutral-800">
              {detail.profile.sector}
            </span>
          )}
          <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400 leading-relaxed">{detail.profile.intro}</p>
        </div>
        <Link
          href={`/chart?symbol=${symbol}`}
          className="flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-700"
        >
          <BarChart size={14} /> 차트 분석 열기
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-lg border border-[var(--border-subtle)] p-3">
          <p className="text-[10px] text-neutral-400">3개월 수익률</p>
          <p className={`text-lg font-bold ${retUp ? "text-emerald-600" : "text-red-500"}`}>
            {cs.period_return_pct >= 0 ? "+" : ""}
            {cs.period_return_pct.toFixed(2)}%
          </p>
        </div>
        <div className="rounded-lg border border-[var(--border-subtle)] p-3">
          <p className="text-[10px] text-neutral-400">현재가</p>
          <p className="text-lg font-bold">{cs.end_close.toLocaleString()}원</p>
        </div>
        <div className="rounded-lg border border-[var(--border-subtle)] p-3">
          <p className="text-[10px] text-neutral-400">구간 고가</p>
          <p className="text-lg font-bold">{cs.high.toLocaleString()}원</p>
        </div>
        <div className="rounded-lg border border-[var(--border-subtle)] p-3">
          <p className="text-[10px] text-neutral-400">구간 저가</p>
          <p className="text-lg font-bold">{cs.low.toLocaleString()}원</p>
        </div>
      </div>

      <div className="rounded-lg border border-violet-200 bg-violet-50/40 p-4 dark:border-violet-800 dark:bg-violet-900/10">
        <div className="flex items-center gap-2 mb-2">
          <Sparkles size={16} className="text-violet-500" />
          <h4 className="text-sm font-semibold text-violet-800 dark:text-violet-300">매수 타이밍 · AI 신호</h4>
        </div>
        <p className="text-sm">
          <span className="font-bold text-2xl text-violet-700 dark:text-violet-300">{detail.buy_score.score}</span>
          <span className="text-neutral-500 ml-2">/ 100 · {detail.buy_score.grade_label}</span>
        </p>
        {detail.buy_score.components.length > 0 && (
          <ul className="mt-2 space-y-1 text-xs text-neutral-600 dark:text-neutral-400">
            {detail.buy_score.components.slice(0, 4).map((c, i) => (
              <li key={i}>
                <span className="font-medium">{c.label}</span> ({c.score}점) — {c.reason}
              </li>
            ))}
          </ul>
        )}
        {detail.buy_score.warnings.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {detail.buy_score.warnings.map((w, i) => (
              <span key={i} className="rounded bg-amber-100 px-2 py-0.5 text-[10px] text-amber-800 dark:bg-amber-900/30">
                {w}
              </span>
            ))}
          </div>
        )}
      </div>

      <div>
        <h4 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300 mb-2">
          최근 3개월 주요 사항
          <span className="ml-2 text-xs font-normal text-neutral-400">{detail.timeline.length}건</span>
        </h4>
        {detail.timeline.length === 0 ? (
          <p className="text-xs text-neutral-400 py-4">
            AI 분석 이슈나 ±5% 급등·급락이 없습니다. 인텔리전스에서 분석하거나 차트에서 확인하세요.
          </p>
        ) : (
          <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
            {detail.timeline.map((ev, i) => (
              <div
                key={`${ev.kind}-${ev.date}-${i}`}
                className={`rounded-lg border px-3 py-2.5 ${
                  ev.kind === "price_move"
                    ? ev.sentiment === "POSITIVE"
                      ? "border-emerald-200 bg-emerald-50/50 dark:border-emerald-800 dark:bg-emerald-900/10"
                      : "border-red-200 bg-red-50/50 dark:border-red-800 dark:bg-red-900/10"
                    : "border-[var(--border-subtle)] bg-[var(--surface-elevated)]"
                }`}
              >
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <span className="text-xs font-bold text-neutral-700 dark:text-neutral-300">{ev.date}</span>
                  <span className="text-[10px] rounded bg-neutral-200 px-1.5 py-0.5 dark:bg-neutral-700">
                    {ev.kind === "price_move" ? "주가 급변" : "AI 이슈"}
                  </span>
                  <SentBadge s={ev.sentiment} />
                  <span className="text-xs font-medium">{ev.title}</span>
                </div>
                <p className="text-xs text-neutral-600 dark:text-neutral-400 leading-relaxed">{ev.summary}</p>
                {ev.source_url && (
                  <a
                    href={ev.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 inline-flex items-center gap-0.5 text-[10px] text-blue-500 hover:underline"
                  >
                    {ev.source_title || "원문"} <ExternalLink size={9} />
                  </a>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <button type="button" onClick={load} className="text-xs text-neutral-400 hover:text-neutral-600">
        상세 정보 새로고침
      </button>
    </div>
  );
}

function WatchlistRow({
  item,
  selected,
  onSelectDetail,
  onRemove,
  onUpdate,
}: {
  item: WatchlistItem;
  selected: boolean;
  onRemove: (id: number) => void;
  onUpdate: (item: WatchlistItem) => void;
  onSelectDetail: () => void;
}) {
  const router = useRouter();
  const [targetInput, setTargetInput] = useState(
    item.target_buy_price ? String(item.target_buy_price) : "",
  );
  const [savingTarget, setSavingTarget] = useState(false);

  async function saveTarget() {
    const n = Number(targetInput.replace(/,/g, ""));
    setSavingTarget(true);
    try {
      const updated = await watchlistApi.update(item.id, {
        target_buy_price: targetInput.trim() === "" || !Number.isFinite(n) || n <= 0 ? null : n,
      });
      onUpdate(updated);
    } finally {
      setSavingTarget(false);
    }
  }

  function openChart() {
    if (item.symbol) {
      router.push(`/chart?symbol=${encodeURIComponent(item.symbol)}`);
    }
  }

  return (
    <div
      className={`border-b border-[var(--border-subtle)] last:border-0 ${
        selected
          ? "bg-blue-50/60 dark:bg-blue-900/15 ring-1 ring-inset ring-blue-300 dark:ring-blue-700"
          : item.target_hit
            ? "bg-sky-50/80 dark:bg-sky-900/10"
            : ""
      }`}
    >
      <div
        className="flex items-start gap-3 px-4 py-3 cursor-pointer hover:bg-[var(--surface-elevated)]"
        role="button"
        tabIndex={0}
        onClick={() => {
          if (item.symbol) openChart();
          else onSelectDetail();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            if (item.symbol) openChart();
            else onSelectDetail();
          }
        }}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">{item.stock_name}</span>
            {item.symbol && <span className="text-xs font-mono text-neutral-400">{item.symbol}</span>}
            {item.sector && (
              <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-500 dark:bg-neutral-800">
                {item.sector}
              </span>
            )}
            {item.target_hit && (
              <span className="inline-flex items-center gap-0.5 rounded-full bg-sky-600 px-2 py-0.5 text-[10px] font-bold text-white">
                <Target size={10} /> 희망가 도달
              </span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral-500">
            <span>등록 {formatDate(item.created_at)}</span>
            {item.current_price != null && (
              <span>
                현재 {item.current_price.toLocaleString()}원
                {item.change_rate != null && (
                  <span className={item.change_rate >= 0 ? " text-emerald-600 ml-1" : " text-red-500 ml-1"}>
                    {item.change_rate >= 0 ? "+" : ""}
                    {item.change_rate.toFixed(2)}%
                  </span>
                )}
              </span>
            )}
          </div>
          <p className="mt-1 text-[10px] text-blue-600 dark:text-blue-400">
            {item.symbol ? "클릭 → 차트 보기" : "클릭 → 상세 (종목코드 필요)"}
          </p>
        </div>
        <div className="flex shrink-0 gap-1" onClick={(e) => e.stopPropagation()}>
          {item.symbol && (
            <button
              type="button"
              onClick={onSelectDetail}
              className="rounded-md border border-[var(--border-subtle)] px-2 py-1 text-[10px] text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
              title="3개월 상세"
            >
              상세
            </button>
          )}
          <button
            type="button"
            onClick={() => onRemove(item.id)}
            className="rounded p-1.5 text-neutral-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
      <div className="px-4 pb-3 pl-4 flex flex-wrap items-end gap-2" onClick={(e) => e.stopPropagation()}>
        <label className="text-[10px] text-neutral-400">
          매수 희망가
          <input
            type="number"
            value={targetInput}
            onChange={(e) => setTargetInput(e.target.value)}
            className="mt-0.5 block w-28 rounded-md border border-[var(--border-subtle)] bg-[var(--background)] px-2 py-1 text-xs"
          />
        </label>
        <button
          type="button"
          onClick={saveTarget}
          disabled={savingTarget}
          className="rounded-md bg-sky-600 px-2.5 py-1 text-[10px] font-medium text-white disabled:opacity-50"
        >
          저장
        </button>
      </div>
    </div>
  );
}

export default function WatchlistPage() {
  const router = useRouter();
  const [items, setItems] = useState<WatchlistItem[]>([]);
  const [recommendations, setRecommendations] = useState<StockRecommendation[]>([]);
  const [loading, setLoading] = useState(true);
  const [sectorFilter, setSectorFilter] = useState<string>("");
  const [registerDraft, setRegisterDraft] = useState<WatchlistRegisterDraft | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const [wl, rec] = await Promise.all([
        watchlistApi.getAll(),
        signalApi.getRecommendations(30, sectorFilter || undefined),
      ]);
      setItems(wl.items);
      setRecommendations(rec.recommendations);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [sectorFilter]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  const sortedItems = useMemo(
    () => [...items].sort((a, b) => (b.created_at || "").localeCompare(a.created_at || "")),
    [items],
  );

  const sortedRecommendations = useMemo(
    () => [...recommendations].sort((a, b) => (b.latest_date || "").localeCompare(a.latest_date || "")),
    [recommendations],
  );

  const selectedItem = useMemo(
    () => items.find((i) => i.id === selectedId) ?? null,
    [items, selectedId],
  );

  const targetHitCount = useMemo(() => items.filter((i) => i.target_hit).length, [items]);

  function openRegister(rec: StockRecommendation) {
    const src = rec.sources?.[0];
    setRegisterDraft({
      stock_name: rec.stock_name,
      symbol: rec.symbol,
      sector: rec.sector || undefined,
      source_type: src?.type ?? "sector",
      source_id: src?.id,
    });
  }

  async function handleRemove(id: number) {
    await watchlistApi.remove(id);
    setItems((prev) => prev.filter((i) => i.id !== id));
    if (selectedId === id) setSelectedId(null);
  }

  const watchedNames = useMemo(() => new Set(items.map((i) => i.stock_name)), [items]);

  const SECTORS = ["", "반도체", "AI·빅테크", "2차전지", "자동차", "바이오·헬스케어", "금융", "에너지"];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">관심 종목</h1>
        <p className="mt-0.5 text-xs text-neutral-400">
          종목코드 등록 · 클릭 시 3개월 소개·주요 사항 · 매수 희망가 알림
        </p>
        {targetHitCount > 0 && (
          <p className="mt-1 text-xs font-medium text-sky-600 dark:text-sky-400">
            🎯 매수 희망가 도달 {targetHitCount}종목
          </p>
        )}
      </div>

      {/* AI 추천 */}
      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-4 py-3">
          <div className="flex items-center gap-2">
            <Sparkles size={14} className="text-amber-500" />
            <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">AI 추천 · 언급 종목</h2>
            <span className="text-xs text-neutral-400">최신순</span>
          </div>
          <select
            value={sectorFilter}
            onChange={(e) => setSectorFilter(e.target.value)}
            className="rounded-md border border-[var(--border-subtle)] bg-[var(--background)] px-2 py-1 text-xs"
          >
            <option value="">전체 섹터</option>
            {SECTORS.filter(Boolean).map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-neutral-400">
            <Loader2 size={14} className="animate-spin" /> 불러오는 중...
          </div>
        ) : sortedRecommendations.length === 0 ? (
          <div className="py-10 text-center text-sm text-neutral-400">추천 종목이 없습니다.</div>
        ) : (
          <div className="divide-y divide-[var(--border-subtle)]">
            {sortedRecommendations.map((rec) => (
              <div
                key={rec.stock_name}
                role={rec.symbol ? "button" : undefined}
                tabIndex={rec.symbol ? 0 : undefined}
                onClick={() => rec.symbol && router.push(`/chart?symbol=${rec.symbol}`)}
                onKeyDown={(e) => {
                  if (rec.symbol && (e.key === "Enter" || e.key === " ")) {
                    e.preventDefault();
                    router.push(`/chart?symbol=${rec.symbol}`);
                  }
                }}
                className={`flex items-start gap-3 px-4 py-3 hover:bg-[var(--surface-elevated)] ${
                  rec.symbol ? "cursor-pointer" : ""
                }`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold">{rec.stock_name}</span>
                    {rec.symbol && <span className="text-xs font-mono text-neutral-400">{rec.symbol}</span>}
                    <SentBadge s={rec.latest_sentiment} />
                    <span className="text-[10px] text-neutral-400">
                      {rec.latest_date} · {rec.mention_count}회
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-400 line-clamp-3">{rec.latest_summary}</p>
                </div>
                <div className="flex shrink-0 gap-1" onClick={(e) => e.stopPropagation()}>
                  {watchedNames.has(rec.stock_name) ? (
                    <span className="rounded-md bg-amber-100 px-2 py-1.5 text-[10px] text-amber-800">등록됨</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => openRegister(rec)}
                      className="flex items-center gap-1 rounded-md bg-neutral-900 px-2 py-1.5 text-[10px] text-white dark:bg-neutral-100 dark:text-neutral-900"
                    >
                      <Star size={12} />
                      지켜보기
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 내 관심 목록 */}
      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] overflow-hidden">
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-4 py-3">
          <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">
            내 관심 목록 <span className="text-xs font-normal text-neutral-400">최신순 · {sortedItems.length}건</span>
          </h2>
          <button onClick={load} className="flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-700">
            <RefreshCw size={11} /> 새로고침
          </button>
        </div>

        <AddBySymbolForm
          onAdded={async () => {
            await load();
          }}
        />

        {sortedItems.length === 0 ? (
          <div className="py-10 text-center text-sm text-neutral-400">
            위에서 종목코드를 입력하거나 AI 추천에서 추가하세요.
          </div>
        ) : (
          <div>
            {sortedItems.map((item) => (
              <WatchlistRow
                key={item.id}
                item={item}
                selected={selectedId === item.id}
                onSelectDetail={() => setSelectedId((id) => (id === item.id ? null : item.id))}
                onRemove={handleRemove}
                onUpdate={(updated) =>
                  setItems((prev) => prev.map((i) => (i.id === updated.id ? updated : i)))
                }
              />
            ))}
          </div>
        )}
      </div>

      {selectedItem?.symbol && selectedId != null && (
        <div className="rounded-lg border border-blue-200 bg-[var(--surface)] overflow-hidden dark:border-blue-800">
          <div className="border-b border-blue-200 bg-blue-50/50 px-4 py-2 dark:border-blue-800 dark:bg-blue-900/20">
            <h2 className="text-sm font-semibold text-blue-800 dark:text-blue-300">종목 상세 · 최근 3개월</h2>
          </div>
          <WatchlistDetailPanel itemId={selectedId} symbol={selectedItem.symbol} />
        </div>
      )}

      {selectedItem && !selectedItem.symbol && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
          이 항목에는 종목코드가 없습니다. 삭제 후 「종목코드로 등록」으로 다시 추가해 주세요.
        </div>
      )}

      <WatchlistRegisterModal
        draft={registerDraft}
        open={registerDraft !== null}
        onClose={() => setRegisterDraft(null)}
        onRegistered={load}
      />
    </div>
  );
}
