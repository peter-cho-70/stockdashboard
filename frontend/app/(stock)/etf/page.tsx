"use client";

import { useEffect, useState, useCallback, useRef, useMemo, Fragment } from "react";
import { useRouter } from "next/navigation";
import {
  Loader2, Search, ArrowUpDown, ListFilter, Video,
  Plus, Trash2, Sparkles, ChevronDown, ChevronUp, Pin, Star,
} from "lucide-react";
import {
  etfApi,
  type EtfCategoriesResponse,
  type EtfChannel,
  type EtfRankingItem,
  type EtfSearchByStockResponse,
  type EtfVideoAnalysis,
} from "@/lib/api";
import { krChangeClass } from "@/lib/krMarketColors";

const THREE_MONTHS_MS = 90 * 24 * 60 * 60 * 1000;

function isNewEtf(listingDate: string | null | undefined): boolean {
  if (!listingDate) return false;
  try {
    const normalized = listingDate.replace(/\./g, "-");
    return Date.now() - new Date(normalized).getTime() < THREE_MONTHS_MS;
  } catch {
    return false;
  }
}

function sentimentLabel(s: string | null | undefined): { text: string; cls: string } {
  if (s === "POSITIVE") return { text: "긍정", cls: "text-red-600 dark:text-red-400" };
  if (s === "NEGATIVE") return { text: "부정", cls: "text-blue-600 dark:text-blue-400" };
  if (s === "NEUTRAL") return { text: "중립", cls: "text-neutral-400" };
  return { text: "—", cls: "text-neutral-400" };
}

function fmtVideoDate(s: string | null): string {
  if (!s) return "";
  try {
    return new Date(s).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" });
  } catch {
    return "";
  }
}

function fmtPrice(n: number | null): string {
  return n != null ? n.toLocaleString("ko-KR") : "—";
}

function fmtPercent(n: number | null): string {
  if (n == null) return "—";
  return `${n > 0 ? "+" : ""}${n.toFixed(2)}%`;
}

function fmtMarketCap(n: number | null): string {
  if (n == null) return "—";
  return `${n.toLocaleString("ko-KR")}억`;
}

function ReverseSearchBox() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<EtfSearchByStockResponse | null>(null);
  const [error, setError] = useState("");

  async function search() {
    const q = query.trim();
    if (!q) return;
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const res = await etfApi.searchByStock(q);
      setResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "검색 실패");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Search size={15} className="text-violet-500" />
        <h2 className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">종목→ETF 역검색</h2>
      </div>
      <p className="text-xs text-neutral-400">
        보유·관심 종목이 어떤 ETF에 담겨 있는지 찾아보세요 (시가총액 상위권 ETF 기준).
      </p>
      <div className="flex items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && search()}
          placeholder="종목명 또는 종목코드 (예: 삼성전자)"
          className="w-56 rounded-md border border-[var(--border-subtle)] bg-[var(--background)] px-3 py-2 text-sm"
        />
        <button
          type="button"
          onClick={search}
          disabled={loading || !query.trim()}
          className="flex items-center gap-1.5 rounded-md border border-[var(--border-subtle)] px-3 py-2 text-sm font-medium hover:bg-[var(--surface-elevated)] disabled:opacity-50"
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
          검색
        </button>
      </div>

      {error && <p className="text-xs text-red-500">{error}</p>}

      {result && (
        result.etfs.length === 0 ? (
          <p className="text-xs text-neutral-400">
            &quot;{result.query}&quot;를 담고 있는 주요 ETF를 찾지 못했습니다.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {result.etfs.map((e) => (
              <button
                key={e.etf_code}
                type="button"
                onClick={() => router.push(`/etf/${e.etf_code}`)}
                className="flex items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-2.5 py-1.5 text-left text-xs hover:border-violet-300 dark:hover:border-violet-700"
              >
                <span className="font-medium text-neutral-800 dark:text-neutral-200">{e.etf_name}</span>
                {e.weight != null && (
                  <span className="tabular-nums text-neutral-400">{e.weight.toFixed(2)}%</span>
                )}
              </button>
            ))}
          </div>
        )
      )}
    </div>
  );
}

function VideoAnalysisCard({ video }: { video: EtfVideoAnalysis }) {
  const overall = sentimentLabel(video.sentiment);
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--surface)] p-3 space-y-1.5">
      <div className="flex items-start justify-between gap-2">
        <a
          href={video.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm font-medium text-neutral-800 hover:text-red-600 dark:text-neutral-200 dark:hover:text-red-400 line-clamp-2"
        >
          {video.title}
        </a>
        <span className="shrink-0 text-[10px] text-neutral-400">{fmtVideoDate(video.published_at)}</span>
      </div>
      {video.summary && (
        <div className="space-y-1">
          <p className={`text-xs text-neutral-600 dark:text-neutral-400 ${expanded ? "" : "line-clamp-3"}`}>
            {video.summary}
          </p>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="text-[10px] font-medium text-violet-600 hover:underline dark:text-violet-400"
          >
            {expanded ? "접기" : "전체 분석 보기"}
          </button>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={`text-[10px] font-medium ${overall.cls}`}>전체 톤: {overall.text}</span>
        {video.mentioned_etfs.map((m, i) => {
          const s = sentimentLabel(m.sentiment);
          return (
            <span
              key={`${m.name}-${i}`}
              title={m.reason ?? undefined}
              className="rounded-full border border-[var(--border-subtle)] px-2 py-0.5 text-[10px] text-neutral-500"
            >
              {m.name} <span className={s.cls}>{s.text}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

function ChannelRow({ channel, onRemove }: { channel: EtfChannel; onRemove: (id: number) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [videos, setVideos] = useState<EtfVideoAnalysis[]>([]);
  const [videosLoaded, setVideosLoaded] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function loadVideos() {
    try {
      const res = await etfApi.getChannelVideos(channel.id);
      setVideos(res.videos);
      setVideosLoaded(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "영상 목록을 불러오지 못했습니다.");
    }
  }

  async function toggleExpand() {
    const next = !expanded;
    setExpanded(next);
    if (next && !videosLoaded) await loadVideos();
  }

  async function analyzeLatest() {
    setAnalyzing(true);
    setError("");
    setMessage("");
    try {
      const res = await etfApi.analyzeChannelLatest(channel.id, 5);
      setMessage(res.count > 0 ? `새 영상 ${res.count}건 분석 완료` : "분석할 새 영상이 없습니다.");
      if (res.count > 0) {
        setVideos((prev) => [...res.analyzed, ...prev]);
        setVideosLoaded(true);
        setExpanded(true);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "영상 분석 실패");
    } finally {
      setAnalyzing(false);
    }
  }

  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-elevated)]">
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs">
        <a
          href={channel.channel_url}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-neutral-800 hover:text-red-600 dark:text-neutral-200 dark:hover:text-red-400"
        >
          {channel.channel_name}
        </a>
        <button
          type="button"
          onClick={analyzeLatest}
          disabled={analyzing}
          className="flex items-center gap-1 rounded-md border border-[var(--border-subtle)] px-1.5 py-0.5 text-[10px] font-medium hover:bg-[var(--surface)] disabled:opacity-50"
        >
          {analyzing ? <Loader2 size={10} className="animate-spin" /> : <Sparkles size={10} />}
          최신 영상 분석
        </button>
        <button type="button" onClick={toggleExpand} className="flex items-center gap-0.5 text-[10px] text-neutral-400">
          영상 {expanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
        </button>
        <button
          type="button"
          onClick={() => onRemove(channel.id)}
          className="ml-auto text-neutral-300 hover:text-red-500"
        >
          <Trash2 size={11} />
        </button>
      </div>
      {message && <p className="px-2.5 pb-1.5 text-[10px] text-emerald-600">{message}</p>}
      {error && <p className="px-2.5 pb-1.5 text-[10px] text-red-500">{error}</p>}
      {expanded && (
        <div className="space-y-2 border-t border-[var(--border-subtle)] p-2.5">
          {videos.length === 0 ? (
            <p className="text-xs text-neutral-400">분석된 영상이 없습니다. &quot;최신 영상 분석&quot;을 눌러보세요.</p>
          ) : (
            videos.map((v) => <VideoAnalysisCard key={v.id} video={v} />)
          )}
        </div>
      )}
    </div>
  );
}

function LinkAnalyzer() {
  const [url, setUrl] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState<EtfVideoAnalysis | null>(null);
  const [error, setError] = useState("");
  const [history, setHistory] = useState<EtfVideoAnalysis[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);

  useEffect(() => {
    etfApi.getLinkAnalyzed()
      .then((res) => setHistory(res.videos))
      .catch(() => {})
      .finally(() => setHistoryLoaded(true));
  }, []);

  async function analyze() {
    const u = url.trim();
    if (!u) return;
    setAnalyzing(true);
    setError("");
    setResult(null);
    try {
      const res = await etfApi.analyzeVideoUrl(u);
      setResult(res);
      setHistory((prev) => [res, ...prev.filter((v) => v.video_id !== res.video_id)]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "영상 분석 실패");
    } finally {
      setAnalyzing(false);
    }
  }

  return (
    <div className="flex h-[420px] flex-col rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)]">
      {/* 고정 헤더 */}
      <div className="flex-none space-y-2.5 border-b border-[var(--border-subtle)] p-4">
        <div className="flex items-center gap-2">
          <Sparkles size={15} className="text-violet-500" />
          <h2 className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">링크로 영상 분석</h2>
        </div>
        <div className="flex items-center gap-2">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && analyze()}
            placeholder="YouTube 링크 붙여넣기..."
            className="min-w-0 flex-1 rounded-md border border-[var(--border-subtle)] bg-[var(--background)] px-3 py-1.5 text-sm"
          />
          <button
            type="button"
            onClick={analyze}
            disabled={analyzing || !url.trim()}
            className="shrink-0 flex items-center gap-1.5 rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
          >
            {analyzing ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
            분석
          </button>
        </div>
        {error && <p className="text-xs text-red-500">{error}</p>}
      </div>

      {/* 스크롤 영역: 최신 결과 + 기록 */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {result && (
          <div className="space-y-1">
            {result.already_analyzed && (
              <p className="text-[11px] text-neutral-400">이미 분석된 영상입니다.</p>
            )}
            <VideoAnalysisCard video={result} />
          </div>
        )}
        {historyLoaded && history.length > 0 && (
          <>
            {result && <div className="border-t border-[var(--border-subtle)] pt-1" />}
            <p className="text-[11px] font-medium text-neutral-400">
              분석 기록 ({history.length})
            </p>
            {history.map((v) => (
              <VideoAnalysisCard key={v.id} video={v} />
            ))}
          </>
        )}
        {historyLoaded && history.length === 0 && !result && (
          <p className="py-6 text-center text-xs text-neutral-300 dark:text-neutral-600">
            아직 분석한 영상이 없습니다.
          </p>
        )}
        {!historyLoaded && (
          <div className="flex justify-center py-6">
            <Loader2 size={14} className="animate-spin text-neutral-300" />
          </div>
        )}
      </div>
    </div>
  );
}

function ChannelManager() {
  const [channels, setChannels] = useState<EtfChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [handle, setHandle] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await etfApi.getChannels();
      setChannels(res.channels);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function addChannel() {
    const h = handle.trim();
    if (!h) return;
    setAdding(true);
    setError("");
    try {
      const ch = await etfApi.addChannel({ handle: h });
      setChannels((prev) => [ch, ...prev]);
      setHandle("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "채널 추가 실패");
    } finally {
      setAdding(false);
    }
  }

  async function removeChannel(id: number) {
    await etfApi.removeChannel(id);
    setChannels((prev) => prev.filter((c) => c.id !== id));
  }

  return (
    <div className="flex h-[420px] flex-col rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)]">
      {/* 고정 헤더 */}
      <div className="flex-none space-y-2.5 border-b border-[var(--border-subtle)] p-4">
        <div className="flex items-center gap-2">
          <Video size={15} className="text-red-500" />
          <h2 className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">ETF 분석 채널 관리</h2>
        </div>
        <div className="flex items-center gap-2">
          <input
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addChannel()}
            placeholder="채널 핸들 (예: @3protv)..."
            className="min-w-0 flex-1 rounded-md border border-[var(--border-subtle)] bg-[var(--background)] px-3 py-1.5 text-sm"
          />
          <button
            type="button"
            onClick={addChannel}
            disabled={adding || !handle.trim()}
            className="shrink-0 flex items-center gap-1.5 rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
          >
            {adding ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
            추가
          </button>
        </div>
        {error && <p className="text-xs text-red-500">{error}</p>}
      </div>

      {/* 스크롤 영역: 채널 목록 */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {loading ? (
          <div className="flex justify-center py-6">
            <Loader2 size={14} className="animate-spin text-neutral-300" />
          </div>
        ) : channels.length === 0 ? (
          <p className="py-6 text-center text-xs text-neutral-300 dark:text-neutral-600">
            아직 등록된 채널이 없습니다.
          </p>
        ) : (
          channels.map((ch) => (
            <ChannelRow key={ch.id} channel={ch} onRemove={removeChannel} />
          ))
        )}
      </div>
    </div>
  );
}

// ─── 정렬 헤더 버튼 ──────────────────────────────────────────────
function SortBtn({
  col,
  label,
  currentSort,
  currentOrder,
  onToggle,
}: {
  col: string;
  label: string;
  currentSort: string;
  currentOrder: "asc" | "desc";
  onToggle: (col: string) => void;
}) {
  const active = currentSort === col;
  return (
    <button
      type="button"
      onClick={() => onToggle(col)}
      className={`inline-flex items-center gap-0.5 transition-colors ${active ? "text-violet-600 dark:text-violet-400" : ""}`}
    >
      {label}
      <ArrowUpDown size={10} className={active ? "opacity-100" : "opacity-40"} />
    </button>
  );
}

export default function EtfPage() {
  const router = useRouter();
  const [meta, setMeta] = useState<EtfCategoriesResponse | null>(null);
  const [category, setCategory] = useState(0);
  const [sort, setSort] = useState("market_sum");
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const [items, setItems] = useState<EtfRankingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [ownedCodes, setOwnedCodes] = useState<Set<string>>(new Set());
  const [ownedQty, setOwnedQty] = useState<Record<string, number>>({});
  const [myHoldings, setMyHoldings] = useState<{ code: string; name: string; qty: number; avg_price: number; current_price: number; change_rate: number; market_cap: number | null; return_3m: number | null }[]>([]);
  const [favoriteCodes, setFavoriteCodes] = useState<Set<string>>(new Set());
  const [listingDates, setListingDates] = useState<Record<string, string | null>>({});
  const scrollRestored = useRef(false);

  useEffect(() => {
    etfApi.getCategories().then(setMeta).catch(() => {});
    etfApi.getMyHoldings().then((r) => {
      setOwnedCodes(new Set(r.codes));
      const qtyMap: Record<string, number> = {};
      for (const h of r.holdings ?? []) qtyMap[h.code] = h.qty;
      setOwnedQty(qtyMap);
      setMyHoldings(r.holdings ?? []);
    }).catch(() => {});
    etfApi.getFavorites().then((r) => setFavoriteCodes(new Set(r.codes))).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await etfApi.getRankings({ category, sort, order, limit: 100 });
      setItems(res.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "ETF 랭킹을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [category, sort, order]);

  useEffect(() => {
    load();
  }, [load]);

  // 상장일을 백그라운드로 조회 (New 태그 표시용)
  useEffect(() => {
    if (items.length === 0) return;
    const codes = items.map((it) => it.code).join(",");
    etfApi.getListingDates(codes).then((res) => setListingDates(res.dates)).catch(() => {});
  }, [items]);

  // 상세 페이지에서 돌아왔을 때 스크롤 위치 복원
  useEffect(() => {
    if (scrollRestored.current || items.length === 0) return;
    const saved = sessionStorage.getItem("etf-scroll");
    if (!saved) return;
    sessionStorage.removeItem("etf-scroll");
    scrollRestored.current = true;
    requestAnimationFrame(() => window.scrollTo(0, Number(saved)));
  }, [items]);

  function toggleSort(col: string) {
    if (sort === col) {
      setOrder((o) => (o === "desc" ? "asc" : "desc"));
    } else {
      setSort(col);
      setOrder("desc");
    }
  }

  async function toggleFavorite(code: string, name: string, e: React.MouseEvent) {
    e.stopPropagation();
    const res = await etfApi.toggleFavorite(code, name).catch(() => null);
    if (!res) return;
    setFavoriteCodes((prev) => {
      const next = new Set(prev);
      res.favorited ? next.add(code) : next.delete(code);
      return next;
    });
  }

  function handleEtfClick(code: string) {
    sessionStorage.setItem("etf-scroll", String(window.scrollY));
    router.push(`/etf/${code}`);
  }

  // 보유 → 즐겨찾기(비보유) → 나머지 순서로 정렬
  // 랭킹에 없는 보유 종목도 상단에 포함
  const sortedItems = useMemo(() => {
    const itemCodes = new Set(items.map((it) => it.code));
    const missingOwned: EtfRankingItem[] = myHoldings
      .filter((h) => !itemCodes.has(h.code))
      .map((h) => ({
        code: h.code,
        name: h.name,
        category: 0,
        current_price: h.current_price || null,
        change_value: null,
        change_rate: h.change_rate || null,
        nav: null,
        return_3m: h.return_3m ?? null,
        volume: null,
        trading_value: null,
        market_cap: h.market_cap ?? null,
        listing_date: null,
      }));
    const owned: EtfRankingItem[] = [...missingOwned];
    const favOnly: EtfRankingItem[] = [];
    const rest: EtfRankingItem[] = [];
    for (const it of items) {
      if (ownedCodes.has(it.code)) owned.push(it);
      else if (favoriteCodes.has(it.code)) favOnly.push(it);
      else rest.push(it);
    }
    return [...owned, ...favOnly, ...rest];
  }, [items, favoriteCodes, ownedCodes, myHoldings]);

  const ownedCount = useMemo(
    () => sortedItems.filter((it) => ownedCodes.has(it.code)).length,
    [sortedItems, ownedCodes],
  );
  const favOnlyCount = useMemo(
    () => sortedItems.filter((it) => !ownedCodes.has(it.code) && favoriteCodes.has(it.code)).length,
    [sortedItems, favoriteCodes, ownedCodes],
  );
  const pinnedCount = ownedCount + favOnlyCount;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">ETF</h1>
          <p className="mt-0.5 text-xs text-neutral-400">
            국내 상장 ETF 랭킹, 구성종목, AI 전망을 확인하세요.
          </p>
        </div>
        <button
          type="button"
          onClick={() => router.push("/etf/guide")}
          className="shrink-0 rounded-md border border-[var(--border-subtle)] px-2.5 py-1.5 text-xs font-medium text-neutral-600 hover:bg-[var(--surface-elevated)] dark:text-neutral-400"
        >
          ETF 이름 읽는 법 →
        </button>
      </div>

      <ReverseSearchBox />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <LinkAnalyzer />
        <ChannelManager />
      </div>

      <div className="space-y-3">
        {/* 내 보유 ETF */}
        {myHoldings.length > 0 && (
          <div className="rounded-lg border border-violet-200 bg-violet-50/50 dark:border-violet-800/50 dark:bg-violet-950/20">
            <div className="flex items-center gap-2 border-b border-violet-200 px-4 py-2.5 dark:border-violet-800/50">
              <Pin size={13} className="text-violet-500" />
              <span className="text-sm font-semibold text-violet-800 dark:text-violet-300">
                내 보유 ETF ({myHoldings.length}종목)
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-neutral-400">
                    <th className="px-4 py-2 font-medium">종목</th>
                    <th className="px-4 py-2 text-right font-medium">보유수량</th>
                    <th className="px-4 py-2 text-right font-medium">평균단가</th>
                    <th className="px-4 py-2 text-right font-medium">현재가</th>
                    <th className="px-4 py-2 text-right font-medium">등락률</th>
                    <th className="px-4 py-2 text-right font-medium">3개월수익률</th>
                    <th className="px-4 py-2 text-right font-medium">시가총액</th>
                    <th className="px-4 py-2 text-right font-medium">평가손익</th>
                  </tr>
                </thead>
                <tbody>
                  {myHoldings.map((h) => {
                    const pnl = (h.current_price - h.avg_price) * h.qty;
                    const pnlRate = h.avg_price > 0 ? ((h.current_price - h.avg_price) / h.avg_price) * 100 : 0;
                    const pnlCls = pnl > 0 ? "text-red-600 dark:text-red-400" : pnl < 0 ? "text-blue-600 dark:text-blue-400" : "text-neutral-400";
                    return (
                      <tr
                        key={h.code}
                        onClick={() => { sessionStorage.setItem("etf-scroll", String(window.scrollY)); router.push(`/etf/${h.code}`); }}
                        className="cursor-pointer border-t border-violet-100 transition-colors hover:bg-violet-100/60 dark:border-violet-800/30 dark:hover:bg-violet-900/20"
                      >
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-1.5">
                            <span className="font-medium text-violet-900 dark:text-violet-100">{h.name}</span>
                            <span className="text-[10px] text-neutral-400">{h.code}</span>
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-violet-700 dark:text-violet-300">
                          {h.qty.toLocaleString("ko-KR")}주
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-neutral-500 dark:text-neutral-400">
                          {h.avg_price > 0 ? Math.round(h.avg_price).toLocaleString("ko-KR") : "—"}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-neutral-700 dark:text-neutral-300">
                          {h.current_price > 0 ? h.current_price.toLocaleString("ko-KR") : "—"}
                        </td>
                        <td className={`px-4 py-2.5 text-right tabular-nums font-medium ${krChangeClass(h.change_rate)}`}>
                          {h.change_rate !== 0 ? `${h.change_rate > 0 ? "+" : ""}${h.change_rate.toFixed(2)}%` : "—"}
                        </td>
                        <td className={`px-4 py-2.5 text-right tabular-nums font-medium ${h.return_3m != null ? krChangeClass(h.return_3m) : "text-neutral-400"}`}>
                          {h.return_3m != null ? `${h.return_3m > 0 ? "+" : ""}${h.return_3m.toFixed(2)}%` : "—"}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-neutral-600 dark:text-neutral-400">
                          {h.market_cap != null ? `${h.market_cap.toLocaleString("ko-KR")}억` : "—"}
                        </td>
                        <td className={`px-4 py-2.5 text-right tabular-nums font-medium ${pnlCls}`}>
                          {h.avg_price > 0 && h.current_price > 0
                            ? `${pnl > 0 ? "+" : ""}${Math.round(pnl).toLocaleString("ko-KR")} (${pnlRate > 0 ? "+" : ""}${pnlRate.toFixed(2)}%)`
                            : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 카테고리 필터 */}
        <div className="flex flex-wrap items-center gap-1.5">
          <ListFilter size={13} className="text-neutral-400" />
          {(meta?.categories ?? [{ code: 0, label: "전체" }]).map((c) => (
            <button
              key={c.code}
              type="button"
              onClick={() => setCategory(c.code)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                category === c.code
                  ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                  : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>

        {/* 범례 */}
        <div className="flex flex-wrap items-center gap-3 text-[11px] text-neutral-400">
          {ownedCount > 0 && (
            <span className="flex items-center gap-1">
              <Pin size={10} className="text-violet-500" />
              보유 {ownedCount}종목 상단 고정
            </span>
          )}
          {favOnlyCount > 0 && (
            <span className="flex items-center gap-1">
              <Star size={10} className="fill-amber-400 text-amber-400" />
              즐겨찾기 {favOnlyCount}종목
            </span>
          )}
          <span className="flex items-center gap-1">
            <span className="inline-block rounded-full bg-amber-100 px-1.5 text-[10px] font-bold text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
              NEW
            </span>
            최근 3개월 이내 상장
          </span>
        </div>

        {error && <p className="text-xs text-red-500">{error}</p>}

        <div className="overflow-x-auto rounded-lg border border-[var(--border-subtle)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border-subtle)] bg-[var(--surface-elevated)] text-left text-xs text-neutral-400">
                <th className="w-8 px-2 py-2.5" />
                <th className="px-3 py-2.5 font-medium">
                  <span className="flex items-center gap-1.5">
                    이름
                    {loading && sortedItems.length > 0 && <Loader2 size={10} className="animate-spin text-neutral-300" />}
                  </span>
                </th>
                <th className="px-3 py-2.5 text-right font-medium">
                  <SortBtn col="now_val" label="현재가" currentSort={sort} currentOrder={order} onToggle={toggleSort} />
                </th>
                <th className="px-3 py-2.5 text-right font-medium">
                  <SortBtn col="change_rate" label="등락률" currentSort={sort} currentOrder={order} onToggle={toggleSort} />
                </th>
                <th className="px-3 py-2.5 text-right font-medium">
                  <SortBtn col="3month_earn_rate" label="3개월수익률" currentSort={sort} currentOrder={order} onToggle={toggleSort} />
                </th>
                <th className="px-3 py-2.5 text-right font-medium">
                  <SortBtn col="market_sum" label="시가총액" currentSort={sort} currentOrder={order} onToggle={toggleSort} />
                </th>
              </tr>
            </thead>
            <tbody className={loading && sortedItems.length > 0 ? "opacity-50 pointer-events-none" : ""}>
              {loading && sortedItems.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-sm text-neutral-400">
                    <Loader2 size={18} className="mx-auto animate-spin" />
                  </td>
                </tr>
              ) : sortedItems.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-sm text-neutral-400">
                    표시할 ETF가 없습니다.
                  </td>
                </tr>
              ) : (
                sortedItems.map((it, idx) => {
                  const isFavorite = favoriteCodes.has(it.code);
                  const owned = ownedCodes.has(it.code);
                  const qty = owned ? (ownedQty[it.code] ?? 0) : 0;
                  const listingDate = listingDates[it.code] ?? it.listing_date;
                  const isNew = isNewEtf(listingDate);

                  // 섹션 헤더 표시 조건 (보유 → 즐겨찾기(비보유) → 전체)
                  const showOwnedHeader = idx === 0 && owned;
                  const showFavHeader = idx === ownedCount && favOnlyCount > 0;
                  const showDivider = idx === pinnedCount && pinnedCount > 0 && sortedItems.length > pinnedCount;

                  return (
                    <Fragment key={it.code}>
                      {showOwnedHeader && (
                        <tr className="bg-violet-50/70 dark:bg-violet-950/30">
                          <td colSpan={6} className="px-3 py-1.5">
                            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-violet-700 dark:text-violet-300">
                              <Pin size={11} />
                              보유 ETF ({ownedCount}종목)
                            </div>
                          </td>
                        </tr>
                      )}
                      {showFavHeader && (
                        <tr className="bg-amber-50/60 dark:bg-amber-950/20">
                          <td colSpan={6} className="px-3 py-1.5">
                            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-700 dark:text-amber-400">
                              <Star size={11} className="fill-amber-500 text-amber-500" />
                              즐겨찾기 ({favOnlyCount}종목)
                            </div>
                          </td>
                        </tr>
                      )}
                      {showDivider && (
                        <tr className="bg-neutral-50/80 dark:bg-neutral-900/40">
                          <td colSpan={6} className="px-3 py-1.5">
                            <span className="text-[11px] font-medium text-neutral-400">전체 랭킹</span>
                          </td>
                        </tr>
                      )}
                      <tr
                        onClick={() => handleEtfClick(it.code)}
                        className={`cursor-pointer border-b border-[var(--border-subtle)] last:border-0 transition-colors hover:bg-[var(--surface-elevated)] ${
                          owned
                            ? "bg-violet-50/40 dark:bg-violet-950/15"
                            : isFavorite
                            ? "bg-amber-50/30 dark:bg-amber-950/10"
                            : ""
                        }`}
                      >
                        {/* 즐겨찾기 버튼 열 */}
                        <td className="w-8 px-2 py-2.5" onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            onClick={(e) => toggleFavorite(it.code, it.name, e)}
                            className="flex items-center justify-center rounded p-0.5 transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800"
                            title={isFavorite ? "즐겨찾기 해제" : "즐겨찾기 추가"}
                          >
                            <Star
                              size={14}
                              className={
                                isFavorite
                                  ? "fill-amber-400 text-amber-400"
                                  : "text-neutral-300 hover:text-amber-400 dark:text-neutral-600"
                              }
                            />
                          </button>
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex flex-wrap items-center gap-1.5">
                            {owned && (
                              <Pin size={11} className="shrink-0 text-violet-500 dark:text-violet-400" />
                            )}
                            <span className={`font-medium ${
                              owned
                                ? "text-violet-900 dark:text-violet-100"
                                : isFavorite
                                ? "text-amber-900 dark:text-amber-100"
                                : "text-neutral-800 dark:text-neutral-200"
                            }`}>
                              {it.name}
                            </span>
                            {owned && (
                              <span className="rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700 dark:bg-violet-900/50 dark:text-violet-300">
                                보유 {qty.toLocaleString("ko-KR")}주
                              </span>
                            )}
                            {isNew && (
                              <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                                NEW
                              </span>
                            )}
                            <span className="text-[10px] text-neutral-400">{it.code}</span>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-neutral-700 dark:text-neutral-300">
                          {fmtPrice(it.current_price)}
                        </td>
                        <td className={`px-3 py-2.5 text-right tabular-nums font-medium ${krChangeClass(it.change_rate ?? 0)}`}>
                          {fmtPercent(it.change_rate)}
                        </td>
                        <td className={`px-3 py-2.5 text-right tabular-nums ${krChangeClass(it.return_3m ?? 0)}`}>
                          {fmtPercent(it.return_3m)}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-neutral-700 dark:text-neutral-300">
                          {fmtMarketCap(it.market_cap)}
                        </td>
                      </tr>
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
