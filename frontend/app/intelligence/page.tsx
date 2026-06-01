"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import {
  Video, Newspaper, FileText, Send, Loader2,
  TrendingUp, TrendingDown, Minus,
  ChevronDown, ChevronUp, Plus, Trash2,
  RefreshCw, PlayCircle, CheckCircle2,
  Tv, ExternalLink, AlertCircle,
  Globe, BarChart2, Bell, CalendarDays, Star,
} from "lucide-react";
import { api, signalApi, type AnalysisResult, type IntelContent, type StockIssueItem, type AnalysisLog, type MacroAnalysis, type SectorAnalysisItem, type AnalysisProvider, type DailyBriefing, type MacroHub, type SectorHub, type PortfolioReminder, type StockRecommendation } from "@/lib/api";
import {
  WatchlistRegisterModal,
  type WatchlistRegisterDraft,
} from "@/components/watchlist-register-modal";
import { streamAnalyze, AnalyzeStreamError } from "@/lib/analyzeStream";
import { IntelDetailPanel, type IntelDetailData } from "@/components/intel-detail-panel";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api";

const SOURCE_TABS = [
  { id: "ALL",     label: "전체" },
  { id: "YOUTUBE", label: "유튜브" },
  { id: "NEWS",    label: "뉴스" },
  { id: "TEXT",    label: "텍스트" },
] as const;

const PAGE_TABS = [
  { id: "analyze",  label: "분석 요청" },
  { id: "channels", label: "채널 구독" },
  { id: "history",  label: "분석 이력" },
  { id: "briefing", label: "일별 브리핑" },
  { id: "macro",    label: "매크로" },
  { id: "sectors",  label: "섹터" },
  { id: "remind",   label: "리마인드" },
] as const;

// ─── 타입 ────────────────────────────────────────
interface YTChannel { id: number; channel_id: string; channel_name: string; channel_url: string; last_checked_at: string | null; }
interface YTVideo   { video_id: string; title: string; description: string; published_at: string; thumbnail: string; url: string; already_analyzed: boolean; }
interface VideoAnalysis extends IntelDetailData {
  logs?: AnalysisLog[];
}

const ANALYSIS_PROVIDER_OPTIONS: { id: AnalysisProvider; label: string; hint: string }[] = [
  { id: "gemini", label: "Gemini (기본)", hint: "gemini-3.1-flash-lite · YouTube 추출·구조화" },
  { id: "openai", label: "GPT", hint: "gpt-4o-mini · 텍스트 분석" },
  { id: "claude", label: "Claude", hint: "Anthropic API 크레dit 필요" },
];

function parseApiError(e: unknown): { message: string; logs: AnalysisLog[] } {
  if (e instanceof AnalyzeStreamError) {
    return { message: e.message, logs: e.logs };
  }
  const msg = e instanceof Error ? e.message : String(e);
  try {
    const parsed = JSON.parse(msg);
    const detail = parsed.detail;
    if (typeof detail === "object" && detail !== null) {
      return {
        message: detail.message || "분석 실패",
        logs: detail.logs || [],
      };
    }
    return { message: typeof detail === "string" ? detail : msg, logs: [] };
  } catch {
    if (msg.includes("429") || msg.toLowerCase().includes("quota")) {
      return { message: "AI API 사용 한도 초과입니다. 다른 AI를 선택하거나 잠시 후 재시도하세요.", logs: [] };
    }
    return { message: msg, logs: [] };
  }
}

function AnalysisProviderSelect({
  value,
  onChange,
}: {
  value: AnalysisProvider;
  onChange: (v: AnalysisProvider) => void;
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-neutral-600 dark:text-neutral-400">구조화 분석 AI</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as AnalysisProvider)}
        className="w-full rounded-md border border-[var(--border-subtle)] bg-[var(--background)] px-3 py-2 text-sm focus:outline-none"
      >
        {ANALYSIS_PROVIDER_OPTIONS.map((o) => (
          <option key={o.id} value={o.id}>{o.label}</option>
        ))}
      </select>
      <p className="text-[10px] text-neutral-400">
        YouTube는 Gemini로 추출 → {ANALYSIS_PROVIDER_OPTIONS.find((o) => o.id === value)?.hint}
        {" · "}선택한 AI 1회만 시도 (재시도·fallback 없음)
      </p>
    </div>
  );
}

function SentDot({ s }: { s: string }) {
  if (s === "POSITIVE") return <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />;
  if (s === "NEGATIVE") return <span className="h-1.5 w-1.5 rounded-full bg-red-500 shrink-0" />;
  return <span className="h-1.5 w-1.5 rounded-full bg-neutral-400 shrink-0" />;
}

function AnalysisLogPanel({ logs, analyzing }: { logs: AnalysisLog[]; analyzing: boolean }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !stickToBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [logs.length, analyzing]);

  const levelColor = (l: string) =>
    l === "error" ? "text-red-400" : l === "warn" ? "text-amber-400" : "text-emerald-400";

  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-950 overflow-hidden">
      <div className="flex items-center gap-2 border-b border-neutral-800 px-3 py-2">
        <span className="text-xs text-neutral-400 font-mono">분석 로그 (실시간)</span>
        {analyzing && <span className="ml-auto flex items-center gap-1 text-[10px] text-amber-400"><Loader2 size={10} className="animate-spin" /> 진행 중</span>}
        {!analyzing && logs.length > 0 && <span className="ml-auto text-[10px] text-emerald-400">완료</span>}
      </div>
      <div
        ref={scrollRef}
        onScroll={() => {
          const el = scrollRef.current;
          if (!el) return;
          stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}
        className="p-3 font-mono text-[10px] space-y-0.5 max-h-48 overflow-y-auto"
      >
        {analyzing && logs.length === 0 && (
          <div className="text-amber-300 animate-pulse">서버 연결 중...</div>
        )}
        {logs.map((l, i) => (
          <div key={`${l.ts}-${i}`} className="flex gap-2">
            <span className="text-neutral-600 shrink-0">{l.ts}</span>
            <span className={levelColor(l.level)}>{l.msg}</span>
          </div>
        ))}
        {!analyzing && logs.length === 0 && <span className="text-neutral-600">—</span>}
      </div>
    </div>
  );
}

function MacroSectorPanel({ macro, sectors }: { macro?: MacroAnalysis; sectors?: SectorAnalysisItem[] }) {
  const hasMacro = macro && (macro.summary || (macro.topics?.length ?? 0) > 0);
  const hasSector = sectors && sectors.length > 0;
  if (!hasMacro && !hasSector) return null;

  return (
    <div className="space-y-2 mt-2">
      {hasMacro && (
        <div className="rounded-md border border-purple-200 bg-purple-50 dark:border-purple-800 dark:bg-purple-900/15 p-2.5">
          <p className="text-[10px] font-semibold text-purple-700 dark:text-purple-400 mb-1">🌍 매크로 분석</p>
          {macro!.summary && <p className="text-[10px] text-neutral-600 dark:text-neutral-400 mb-1.5">{macro!.summary}</p>}
          {macro!.topics?.map((t, i) => (
            <div key={i} className="flex gap-2 items-start mb-1">
              <SentDot s={t.sentiment} />
              <div>
                <span className="text-[10px] font-semibold text-neutral-700 dark:text-neutral-300">{t.topic}</span>
                <p className="text-[10px] text-neutral-600 dark:text-neutral-400">{t.summary}</p>
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
                  <span className="text-[10px] font-semibold text-neutral-700 dark:text-neutral-300">{s.sector}</span>
                  <p className="text-[10px] text-neutral-600 dark:text-neutral-400">{s.summary}</p>
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

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${BASE}${path}`, { headers: { "Content-Type": "application/json" }, ...init });
  if (!r.ok) { const e = await r.text(); throw new Error(e || `HTTP ${r.status}`); }
  return r.json();
}

// ─── 인라인 분석 결과 패널 ──────────────────────────
function InlineAnalysisPanel({ analysis }: { analysis: VideoAnalysis }) {
  const sentColors: Record<string, string> = {
    POSITIVE: "bg-emerald-50 border-emerald-200 dark:bg-emerald-900/15 dark:border-emerald-800",
    NEGATIVE: "bg-red-50 border-red-200 dark:bg-red-900/15 dark:border-red-800",
    NEUTRAL:  "bg-neutral-50 border-neutral-200 dark:bg-neutral-800/40 dark:border-neutral-700",
  };
  const s = analysis.sentiment ?? "NEUTRAL";

  return (
    <div className={`mt-2 rounded-lg border p-3 ${sentColors[s] ?? sentColors.NEUTRAL}`}>
      <IntelDetailPanel data={analysis} compact />
    </div>
  );
}

// ─── 서브 컴포넌트 ────────────────────────────────
function SentimentBadge({ sentiment }: { sentiment: string | null }) {
  if (sentiment === "POSITIVE") return (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
      <TrendingUp size={10} /> 긍정
    </span>
  );
  if (sentiment === "NEGATIVE") return (
    <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-900/30 dark:text-red-400">
      <TrendingDown size={10} /> 부정
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
      <Minus size={10} /> 중립
    </span>
  );
}

function SourceIcon({ type }: { type: string }) {
  if (type === "YOUTUBE") return <Video size={14} className="text-red-500" />;
  if (type === "NEWS")    return <Newspaper size={14} className="text-blue-500" />;
  return <FileText size={14} className="text-neutral-500" />;
}

function ContentCard({ content }: { content: IntelContent }) {
  const [expanded, setExpanded] = useState(false);
  const [detail, setDetail] = useState<IntelContent | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  async function toggleExpand() {
    const next = !expanded;
    setExpanded(next);
    if (next && !detail && content.id) {
      setLoadingDetail(true);
      try {
        const full = await api.getIntelContent(content.id);
        setDetail(full);
      } catch {
        setDetail(content);
      } finally {
        setLoadingDetail(false);
      }
    }
  }

  const display = detail ?? content;

  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] p-4 hover:border-neutral-300 dark:hover:border-neutral-600 transition-colors">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 shrink-0"><SourceIcon type={content.source_type} /></div>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            {content.channel_name && <span className="text-xs font-medium text-neutral-600 dark:text-neutral-400">{content.channel_name}</span>}
            <SentimentBadge sentiment={content.sentiment} />
            {content.analyzed_at && <span className="text-xs text-neutral-400 ml-auto">{new Date(content.analyzed_at).toLocaleDateString("ko-KR")}</span>}
          </div>
          {content.source_title && <p className="text-sm font-medium text-neutral-800 dark:text-neutral-200">{content.source_title}</p>}
          {content.summary && !expanded && (
            <p className="text-sm text-neutral-600 dark:text-neutral-400 line-clamp-2">{content.summary}</p>
          )}
          {!expanded && (
            <div className="flex flex-wrap gap-1.5">
              {content.mentioned_sectors?.map((s) => (
                <span key={s} className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] text-blue-700 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-400">{s}</span>
              ))}
              {content.mentioned_stocks?.slice(0, 5).map((s) => (
                <span key={s} className="rounded-full border border-[var(--border-subtle)] px-2 py-0.5 text-[11px] text-neutral-600 dark:text-neutral-400">{s}</span>
              ))}
            </div>
          )}
          {expanded && (
            loadingDetail ? (
              <div className="flex items-center gap-2 py-4 text-xs text-neutral-400">
                <Loader2 size={14} className="animate-spin" /> 상세 불러오는 중...
              </div>
            ) : (
              <IntelDetailPanel data={{ ...display, source_type: display.source_type, source_url: display.source_url }} />
            )
          )}
          <div className="flex items-center gap-3">
            {content.source_url && (
              <a href={content.source_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-blue-500 hover:underline">
                원문 링크 <ExternalLink size={10} />
              </a>
            )}
            <button onClick={toggleExpand} className="flex items-center gap-1 text-xs text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300">
              {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              {expanded ? "접기" : "상세 보기 (분석·추출·원문)"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── 채널 패널 ────────────────────────────────────
function ChannelPanel({
  onAnalyzeDone,
  analysisProvider,
  enableBulkYoutubeAnalyze,
}: {
  onAnalyzeDone?: (id: number) => void;
  analysisProvider: AnalysisProvider;
  enableBulkYoutubeAnalyze: boolean;
}) {
  const [channels, setChannels]     = useState<YTChannel[]>([]);
  const [handle, setHandle]         = useState("");
  const [customName, setCustomName] = useState("");
  const [adding, setAdding]         = useState(false);
  const [error, setError]           = useState("");
  const [selectedCh, setSelectedCh] = useState<YTChannel | null>(null);
  const [videos, setVideos]         = useState<YTVideo[]>([]);
  const [loadingVids, setLoadingVids] = useState(false);
  const [analyzingId, setAnalyzingId] = useState<string | null>(null);
  const [bulkAnalyzing, setBulkAnalyzing] = useState(false);
  const [bulkMsg, setBulkMsg]       = useState("");
  const [channelAnalyzeLogs, setChannelAnalyzeLogs] = useState<AnalysisLog[]>([]);
  const [channelAnalyzeError, setChannelAnalyzeError] = useState("");

  // 영상별 분석 결과 & 펼침 상태
  const [analysisMap, setAnalysisMap] = useState<Record<string, VideoAnalysis>>({});
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  const MAX_VIDEOS = 30;

  const loadChannels = useCallback(async () => {
    try { setChannels(await fetchJson<YTChannel[]>("/youtube/channels")); }
    catch { /* ignore */ }
  }, []);

  useEffect(() => { loadChannels(); }, [loadChannels]);

  async function addChannel() {
    if (!handle.trim()) return;
    setAdding(true); setError("");
    try {
      await fetchJson<YTChannel>("/youtube/channels", {
        method: "POST",
        body: JSON.stringify({ handle: handle.trim(), custom_name: customName.trim() || null }),
      });
      setHandle(""); setCustomName("");
      await loadChannels();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      try { setError(JSON.parse(msg).detail || msg); } catch { setError(msg); }
    } finally { setAdding(false); }
  }

  async function removeChannel(id: number) {
    if (!confirm("채널을 삭제할까요?")) return;
    await fetchJson(`/youtube/channels/${id}`, { method: "DELETE" });
    if (selectedCh?.id === id) {
      setSelectedCh(null);
      setVideos([]);
      setNextPageToken(null);
    }
    loadChannels();
  }

  function preloadAnalyzed(vids: YTVideo[], autoExpand: boolean) {
    const analyzed = vids.filter((v) => v.already_analyzed);
    if (autoExpand && analyzed.length > 0) {
      setExpandedIds((prev) => {
        const next = new Set(prev);
        analyzed.forEach((v) => next.add(v.video_id));
        return next;
      });
    }
    analyzed.forEach((v) => {
      fetchJson<VideoAnalysis>(`/intel/by-url?url=${encodeURIComponent(v.url)}`)
        .then((r) =>
          setAnalysisMap((p) => (p[v.video_id] ? p : { ...p, [v.video_id]: r })),
        )
        .catch(() => {/* ignore */});
    });
  }

  function mergeVideos(prev: YTVideo[], incoming: YTVideo[]) {
    const seen = new Set(prev.map((v) => v.video_id));
    const merged = [...prev];
    for (const v of incoming) {
      if (!seen.has(v.video_id)) {
        seen.add(v.video_id);
        merged.push(v);
      }
    }
    return merged.slice(0, MAX_VIDEOS);
  }

  async function loadVideos(ch: YTChannel, opts: { forceRefresh?: boolean; append?: boolean } = {}) {
    const append = opts.append === true;
    if (!append) {
      setSelectedCh(ch);
      setVideos([]);
      setNextPageToken(null);
      setAnalysisMap({});
      setExpandedIds(new Set());
    } else {
      setSelectedCh(ch);
      if (videos.length >= MAX_VIDEOS) {
        setBulkMsg(`최대 ${MAX_VIDEOS}개까지 불러올 수 있습니다.`);
        return;
      }
      if (!nextPageToken) {
        setBulkMsg("더 이상 불러올 이전 영상이 없습니다.");
        return;
      }
    }

    setLoadingVids(true);
    if (!append) setBulkMsg("");
    try {
      const batch = append ? Math.min(10, MAX_VIDEOS - videos.length) : 10;
      let url = `/youtube/channels/${ch.id}/videos?max_results=${batch}`;
      if (opts.forceRefresh) url += "&force_refresh=true";
      if (append && nextPageToken) url += `&page_token=${encodeURIComponent(nextPageToken)}`;

      const data = await fetchJson<{
        channel: YTChannel;
        videos: YTVideo[];
        from_cache?: boolean;
        next_page_token?: string | null;
        has_more?: boolean;
      }>(url);

      setNextPageToken(data.next_page_token ?? null);
      const merged = append
        ? mergeVideos(videos, data.videos)
        : data.videos.slice(0, MAX_VIDEOS);
      setVideos(merged);
      preloadAnalyzed(data.videos, true);

      if (!append && data.from_cache) {
        setBulkMsg("캐시에서 불러왔습니다 · 채널을 다시 누르면 이전 영상 추가 (최대 30개)");
      } else if (append) {
        setBulkMsg(`${data.videos.length}개 추가 · 총 ${merged.length}개`);
      } else if (data.has_more) {
        setBulkMsg("채널을 한 번 더 누르면 이전 영상 10개를 더 불러옵니다 (최대 30개)");
      }
    } catch {
      if (!append) setVideos([]);
    } finally {
      setLoadingVids(false);
    }
  }

  function handleChannelClick(ch: YTChannel) {
    if (selectedCh?.id === ch.id && videos.length > 0) {
      if (videos.length >= MAX_VIDEOS) {
        setBulkMsg(`최대 ${MAX_VIDEOS}개까지 불러왔습니다.`);
        return;
      }
      if (nextPageToken) {
        loadVideos(ch, { append: true });
      } else {
        setBulkMsg("더 이상 불러올 이전 영상이 없습니다.");
      }
      return;
    }
    loadVideos(ch);
  }

  // 분석 완료된 영상 결과를 펼치거나 분석되지 않은 영상을 분석 시작
  async function toggleOrAnalyze(v: YTVideo, channelName: string) {
    if (v.already_analyzed) {
      // 이미 분석됨 → 결과 토글
      setExpandedIds((prev) => {
        const next = new Set(prev);
        next.has(v.video_id) ? next.delete(v.video_id) : next.add(v.video_id);
        return next;
      });
      // 결과가 없으면 로드
      if (!analysisMap[v.video_id]) {
        try {
          const r = await fetchJson<VideoAnalysis>(`/intel/by-url?url=${encodeURIComponent(v.url)}`);
          setAnalysisMap((prev) => ({ ...prev, [v.video_id]: r }));
        } catch { /* ignore */ }
      }
    } else {
      setAnalyzingId(v.video_id);
      setChannelAnalyzeLogs([]);
      setChannelAnalyzeError("");
      try {
        const r = await streamAnalyze<VideoAnalysis>(
          "/youtube/analyze/stream",
          { url: v.url, channel_name: channelName, analysis_provider: analysisProvider },
          (log) => setChannelAnalyzeLogs((prev) => [...prev, log]),
        );
        setVideos((prev) => prev.map((x) => x.video_id === v.video_id ? { ...x, already_analyzed: true } : x));
        setAnalysisMap((prev) => ({ ...prev, [v.video_id]: r }));
        setChannelAnalyzeLogs(r.logs || []);
        setExpandedIds((prev) => new Set(prev).add(v.video_id));
        if (onAnalyzeDone && r.id) onAnalyzeDone(r.id);
      } catch (e: unknown) {
        const { message, logs } = parseApiError(e);
        setChannelAnalyzeError(message);
        setChannelAnalyzeLogs((prev) => (logs.length ? logs : prev));
      } finally {
        setAnalyzingId(null);
      }
    }
  }

  async function bulkAnalyze(ch: YTChannel) {
    setBulkAnalyzing(true); setBulkMsg("");
    try {
      const r = await fetchJson<{ message: string; count: number }>(`/youtube/channels/${ch.id}/analyze-latest?max_results=5`, { method: "POST" });
      setBulkMsg(r.message);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setBulkMsg(msg);
    } finally { setBulkAnalyzing(false); }
  }

  return (
    <div className="space-y-5">
      {/* 채널 추가 폼 */}
      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] overflow-hidden">
        <div className="border-b border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-4 py-3">
          <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">채널 등록</h2>
          <p className="mt-0.5 text-xs text-neutral-400">YouTube API 키가 필요합니다 · @핸들 또는 채널 URL로 등록</p>
        </div>
        <div className="p-4 space-y-3">
          <div className="flex gap-2">
            <input
              value={handle} onChange={(e) => setHandle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addChannel()}
              placeholder="@3protv  또는  채널ID"
              className="flex-1 rounded-md border border-[var(--border-subtle)] bg-[var(--background)] px-3 py-2 text-sm placeholder:text-neutral-400 focus:outline-none"
            />
            <input
              value={customName} onChange={(e) => setCustomName(e.target.value)}
              placeholder="표시 이름 (선택)"
              className="w-36 rounded-md border border-[var(--border-subtle)] bg-[var(--background)] px-3 py-2 text-sm placeholder:text-neutral-400 focus:outline-none"
            />
            <button
              onClick={addChannel} disabled={adding || !handle.trim()}
              className="flex items-center gap-1.5 rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
            >
              {adding ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
              {adding ? "추가 중..." : "추가"}
            </button>
          </div>
          {error && (
            <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
              <AlertCircle size={13} /> {error}
            </div>
          )}
        </div>
      </div>

      {/* 등록된 채널 목록 */}
      {channels.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[var(--border-subtle)] py-10 text-center text-sm text-neutral-400">
          등록된 채널이 없습니다. 위에서 @핸들로 추가해 보세요.
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {channels.map((ch) => (
            <div
              key={ch.id}
              className={`rounded-lg border bg-[var(--surface)] p-4 cursor-pointer transition-colors hover:border-neutral-400 dark:hover:border-neutral-500 ${selectedCh?.id === ch.id ? "border-blue-400 dark:border-blue-600 bg-blue-50/30 dark:bg-blue-900/10" : "border-[var(--border-subtle)]"}`}
              onClick={() => handleChannelClick(ch)}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <Tv size={16} className="shrink-0 text-red-500" />
                  <span className="font-medium text-sm text-neutral-800 dark:text-neutral-200 truncate">{ch.channel_name}</span>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); removeChannel(ch.id); }}
                  className="shrink-0 rounded p-1 text-neutral-300 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20 transition-colors"
                >
                  <Trash2 size={13} />
                </button>
              </div>
              <a href={ch.channel_url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
                className="mt-1 block text-xs text-blue-500 hover:underline truncate">{ch.channel_url}</a>
              {ch.last_checked_at && (
                <p className="mt-1.5 text-xs text-neutral-400">
                  마지막 확인: {new Date(ch.last_checked_at).toLocaleDateString("ko-KR")}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 선택된 채널의 영상 목록 */}
      {selectedCh && (
        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">
                {selectedCh.channel_name} · 최신 영상
              </h2>
              <p className="text-xs text-neutral-400 mt-0.5">
                영상 클릭으로 개별 분석 · 채널 재클릭 또는 더보기로 이전 영상 (최대 30개) · 분석 완료 영상은 결과 자동 표시
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => loadVideos(selectedCh, { forceRefresh: true })}
                className="flex items-center gap-1.5 rounded-md border border-[var(--border-subtle)] px-3 py-1.5 text-xs font-medium text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
              >
                <RefreshCw size={12} /> YouTube에서 새로고침
              </button>
              {nextPageToken && videos.length < MAX_VIDEOS && (
                <button
                  onClick={() => loadVideos(selectedCh, { append: true })}
                  disabled={loadingVids}
                  className="flex items-center gap-1.5 rounded-md border border-[var(--border-subtle)] px-3 py-1.5 text-xs font-medium text-neutral-600 hover:bg-neutral-100 disabled:opacity-50 dark:text-neutral-400 dark:hover:bg-neutral-800"
                >
                  이전 영상 더보기 ({videos.length}/{MAX_VIDEOS})
                </button>
              )}
              {enableBulkYoutubeAnalyze && (
              <button
                onClick={() => bulkAnalyze(selectedCh)}
                disabled={bulkAnalyzing}
                className="flex items-center gap-1.5 rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-700 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
              >
                {bulkAnalyzing ? <Loader2 size={12} className="animate-spin" /> : <PlayCircle size={12} />}
                {bulkAnalyzing ? "분석 중..." : "최신 5개 일괄 분석"}
              </button>
              )}
            </div>
          </div>

          {bulkMsg && (
            <div className="border-b border-[var(--border-subtle)] bg-emerald-50 dark:bg-emerald-900/15 px-4 py-2 text-xs text-emerald-700 dark:text-emerald-400">
              ✅ {bulkMsg}
            </div>
          )}

          {(analyzingId || channelAnalyzeLogs.length > 0 || channelAnalyzeError) && (
            <div className="border-b border-[var(--border-subtle)] px-4 py-3 space-y-2">
              {channelAnalyzeError && (
                <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
                  <AlertCircle size={13} /> {channelAnalyzeError}
                </div>
              )}
              <AnalysisLogPanel logs={channelAnalyzeLogs} analyzing={!!analyzingId} />
            </div>
          )}

          {loadingVids ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-neutral-400">
              <Loader2 size={16} className="animate-spin" /> 영상 목록 불러오는 중...
            </div>
          ) : videos.length === 0 ? (
            <div className="py-10 text-center text-sm text-neutral-400">영상 없음</div>
          ) : (
            <div className="divide-y divide-[var(--border-subtle)]">
              {videos.map((v) => {
                const isExpanded  = expandedIds.has(v.video_id);
                const isAnalyzing = analyzingId === v.video_id;
                const analysis    = analysisMap[v.video_id];

                return (
                  <div key={v.video_id} className="p-4 transition-colors hover:bg-[var(--surface-elevated)]">
                    {/* ── 영상 행 ── */}
                    <div className="flex items-start gap-3">
                      {v.thumbnail && (
                        <a href={v.url} target="_blank" rel="noopener noreferrer" className="shrink-0">
                          <img src={v.thumbnail} alt={v.title} className="h-16 w-28 rounded object-cover" />
                        </a>
                      )}
                      <div className="min-w-0 flex-1">
                        <a href={v.url} target="_blank" rel="noopener noreferrer"
                          className="text-sm font-medium text-neutral-800 dark:text-neutral-200 hover:text-blue-600 dark:hover:text-blue-400 line-clamp-2 transition-colors">
                          {v.title}
                        </a>
                        <p className="mt-1 text-xs text-neutral-400">
                          {new Date(v.published_at).toLocaleDateString("ko-KR")}
                        </p>
                      </div>
                      {/* 분석 버튼 */}
                      <div className="shrink-0">
                        {v.already_analyzed ? (
                          <button
                            onClick={() => toggleOrAnalyze(v, selectedCh.channel_name)}
                            className="flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400 dark:hover:bg-emerald-900/50 transition-colors"
                          >
                            <CheckCircle2 size={11} />
                            분석 완료
                            {isExpanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                          </button>
                        ) : (
                          <button
                            onClick={() => toggleOrAnalyze(v, selectedCh.channel_name)}
                            disabled={isAnalyzing}
                            className="flex items-center gap-1 rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-60 transition-colors"
                          >
                            {isAnalyzing ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />}
                            {isAnalyzing ? "분석 중..." : "AI 분석"}
                          </button>
                        )}
                      </div>
                    </div>

                    {/* ── 인라인 분석 결과 ── */}
                    {isAnalyzing && (
                      <div className="mt-2 flex items-center gap-2 rounded-lg border border-blue-100 bg-blue-50/50 dark:border-blue-800 dark:bg-blue-900/10 px-3 py-2.5 text-xs text-blue-600 dark:text-blue-400">
                        <Loader2 size={13} className="animate-spin shrink-0" />
                        Gemini→GPT 분석 중... (1~3분)
                      </div>
                    )}
                    {isExpanded && analysis && <InlineAnalysisPanel analysis={analysis} />}
                    {isExpanded && !analysis && !isAnalyzing && (
                      <div className="mt-2 flex items-center gap-2 text-xs text-neutral-400 px-1">
                        <Loader2 size={12} className="animate-spin" /> 분석 결과 불러오는 중...
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── 분석 요청 패널 ───────────────────────────────
function AnalyzePanel({
  onDone,
  onGoToHistory,
  analysisProvider,
}: {
  onDone: (id?: number) => void;
  onGoToHistory: (id: number) => void;
  analysisProvider: AnalysisProvider;
}) {
  const [inputUrl,     setInputUrl]     = useState("");
  const [inputText,    setInputText]    = useState("");
  const [inputTitle,   setInputTitle]   = useState("");
  const [inputChannel, setInputChannel] = useState("");
  const [inputMode,    setInputMode]    = useState<"url" | "text">("text");
  const [analyzing,    setAnalyzing]    = useState(false);
  const [lastResult,   setLastResult]   = useState<AnalysisResult | null>(null);
  const [lastLogs,     setLastLogs]     = useState<AnalysisLog[]>([]);
  const [error,        setError]        = useState("");

  async function handleAnalyze() {
    if (inputMode === "url" && !inputUrl.trim()) return;
    if (inputMode === "text" && !inputText.trim()) return;
    setAnalyzing(true); setError(""); setLastResult(null); setLastLogs([]);
    try {
      const payload =
        inputMode === "url"
          ? { url: inputUrl.trim(), channel_name: inputChannel.trim() || undefined, analysis_provider: analysisProvider }
          : { text: inputText.trim(), title: inputTitle.trim() || undefined, analysis_provider: analysisProvider };

      const result = await streamAnalyze<AnalysisResult>(
        "/intel/analyze/stream",
        payload,
        (log) => setLastLogs((prev) => [...prev, log]),
      );
      setLastResult(result);
      setLastLogs(result.logs || []);
      setInputUrl(""); setInputText(""); setInputTitle(""); setInputChannel("");
      onDone(result.id);
      // 결과는 현재 탭에 표시 — 이력 이동은 사용자가 선택
    } catch (e: unknown) {
      const { message, logs } = parseApiError(e);
      setError(message);
      setLastLogs(logs);
    } finally { setAnalyzing(false); }
  }

  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] overflow-hidden">
      <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-4 py-3">
        <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">새 분석 요청</h2>
        <div className="flex gap-1 rounded-md border border-[var(--border-subtle)] p-0.5">
          {(["text", "url"] as const).map((m) => (
            <button key={m} onClick={() => setInputMode(m)}
              className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${inputMode === m ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900" : "text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"}`}>
              {m === "text" ? "텍스트" : "URL"}
            </button>
          ))}
        </div>
      </div>
      <div className="p-4 space-y-3">
        {inputMode === "url" ? (
          <>
            <input type="url" value={inputUrl} onChange={(e) => setInputUrl(e.target.value)}
              placeholder="YouTube URL 또는 뉴스 기사 URL"
              className="w-full rounded-md border border-[var(--border-subtle)] bg-[var(--background)] px-3 py-2 text-sm placeholder:text-neutral-400 focus:outline-none" />
            <input type="text" value={inputChannel} onChange={(e) => setInputChannel(e.target.value)}
              placeholder="채널명 (선택 · YouTube일 때)"
              className="w-full rounded-md border border-[var(--border-subtle)] bg-[var(--background)] px-3 py-2 text-sm placeholder:text-neutral-400 focus:outline-none" />
          </>
        ) : (
          <>
            <input type="text" value={inputTitle} onChange={(e) => setInputTitle(e.target.value)}
              placeholder="제목 (선택)"
              className="w-full rounded-md border border-[var(--border-subtle)] bg-[var(--background)] px-3 py-2 text-sm placeholder:text-neutral-400 focus:outline-none" />
            <textarea value={inputText} onChange={(e) => setInputText(e.target.value)} rows={5}
              placeholder="분석할 텍스트를 입력하세요 (뉴스 본문, 시황 메모 등)"
              className="w-full resize-none rounded-md border border-[var(--border-subtle)] bg-[var(--background)] px-3 py-2 text-sm placeholder:text-neutral-400 focus:outline-none" />
          </>
        )}
        {error && (
          <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
            <AlertCircle size={13} /> {error}
          </div>
        )}
        <button onClick={handleAnalyze} disabled={analyzing}
          className="flex items-center gap-2 rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900">
          {analyzing ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          {analyzing ? "분석 중 (Gemini→AI)..." : "AI 분석 시작"}
        </button>
        {(analyzing || lastLogs.length > 0) && (
          <AnalysisLogPanel logs={lastLogs} analyzing={analyzing} />
        )}
      </div>

      {lastResult && (
        <div className="border-t border-[var(--border-subtle)] bg-[var(--surface-elevated)] p-4 space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">✅ 분석 완료</span>
              <SentimentBadge sentiment={lastResult.sentiment} />
            </div>
            <button
              type="button"
              onClick={() => onGoToHistory(lastResult.id)}
              className="text-xs text-blue-500 hover:underline"
            >
              분석 이력에서 보기 →
            </button>
          </div>
          <IntelDetailPanel data={lastResult} />
        </div>
      )}
    </div>
  );
}

// ─── 신호 패널 공통 ───────────────────────────────
function SentBadge({ s }: { s: string | null }) {
  if (!s) return null;
  if (s === "POSITIVE") return <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">긍정</span>;
  if (s === "NEGATIVE") return <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-medium text-red-700 dark:bg-red-900/30 dark:text-red-400">부정</span>;
  return <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-medium text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">중립</span>;
}

// ─── 일별 브리핑 패널 ─────────────────────────────
function BriefingPanel() {
  const [briefings, setBriefings] = useState<DailyBriefing[]>([]);
  const [loading, setLoading]     = useState(true);
  const [days, setDays]           = useState(7);
  const [backfilling, setBackfilling] = useState(false);
  const [expanded, setExpanded]   = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    signalApi.getDaily(days).then((r) => {
      setBriefings(r.briefings);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [days]);

  async function handleBackfill() {
    setBackfilling(true);
    try { await signalApi.backfill(); } catch { /* ignore */ }
    signalApi.getDaily(days).then((r) => setBriefings(r.briefings)).catch(() => {}).finally(() => setBackfilling(false));
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CalendarDays size={14} className="text-neutral-400" />
          <span className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">일별 분석 브리핑</span>
        </div>
        <div className="flex items-center gap-2">
          <select value={days} onChange={(e) => setDays(Number(e.target.value))}
            className="rounded-md border border-[var(--border-subtle)] bg-[var(--background)] px-2 py-1 text-xs">
            {[3, 7, 14, 30].map((d) => <option key={d} value={d}>{d}일</option>)}
          </select>
          <button onClick={handleBackfill} disabled={backfilling}
            className="flex items-center gap-1 rounded-md border border-[var(--border-subtle)] px-2 py-1 text-xs text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:opacity-50">
            {backfilling ? <Loader2 size={10} className="animate-spin" /> : <RefreshCw size={10} />}
            백필
          </button>
        </div>
      </div>
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-neutral-400"><Loader2 size={14} className="animate-spin" /> 불러오는 중...</div>
      ) : briefings.length === 0 ? (
        <div className="rounded-lg border border-dashed py-10 text-center text-sm text-neutral-400">
          분석 이력이 없습니다. 영상/텍스트를 분석한 후 백필을 실행하세요.
        </div>
      ) : (
        <div className="space-y-2">
          {briefings.map((b) => (
            <div key={b.date} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface)] overflow-hidden">
              <button
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[var(--surface-elevated)] transition-colors"
                onClick={() => setExpanded(expanded === b.date ? null : b.date)}
              >
                <span className="text-sm font-semibold text-neutral-800 dark:text-neutral-200 w-24 shrink-0">{b.date}</span>
                <div className="flex flex-wrap gap-2 flex-1 text-xs text-neutral-500">
                  <span className="flex items-center gap-1"><Video size={10} /> 분석 {b.content_count}건</span>
                  <span className="flex items-center gap-1"><Globe size={10} /> 매크로 {b.macro_count}</span>
                  <span className="flex items-center gap-1"><BarChart2 size={10} /> 섹터 {b.sector_count}</span>
                </div>
                <div className="flex gap-1 shrink-0">
                  {b.top_topics.slice(0, 3).map((t) => (
                    <span key={t.topic} className="rounded-full bg-purple-50 px-2 py-0.5 text-[10px] text-purple-700 dark:bg-purple-900/20 dark:text-purple-400">{t.topic}</span>
                  ))}
                </div>
                {expanded === b.date ? <ChevronUp size={14} className="shrink-0 text-neutral-400" /> : <ChevronDown size={14} className="shrink-0 text-neutral-400" />}
              </button>
              {expanded === b.date && (
                <div className="border-t border-[var(--border-subtle)] px-4 py-3 space-y-2">
                  {b.contents.map((c) => (
                    <div key={c.id} className="flex items-start gap-2 text-xs text-neutral-600 dark:text-neutral-400">
                      <SentDot s={c.sentiment || "NEUTRAL"} />
                      <div className="flex-1 min-w-0">
                        <p className="truncate font-medium text-neutral-700 dark:text-neutral-300">{c.source_title || c.summary?.slice(0, 60)}</p>
                        <p className="text-[10px] text-neutral-400">{c.channel_name} · {c.analyzed_at}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── 매크로 신호 패널 ─────────────────────────────
function MacroHubPanel() {
  const [data, setData]         = useState<MacroHub | null>(null);
  const [loading, setLoading]   = useState(true);
  const [days, setDays]         = useState(30);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    signalApi.getMacro(days).then((r) => { setData(r); setLoading(false); }).catch(() => setLoading(false));
  }, [days]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Globe size={14} className="text-neutral-400" />
          <span className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">매크로 신호</span>
          {data && <span className="text-xs text-neutral-400">({data.total}건)</span>}
        </div>
        <select value={days} onChange={(e) => setDays(Number(e.target.value))}
          className="rounded-md border border-[var(--border-subtle)] bg-[var(--background)] px-2 py-1 text-xs">
          {[7, 14, 30, 60, 90].map((d) => <option key={d} value={d}>{d}일</option>)}
        </select>
      </div>
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-neutral-400"><Loader2 size={14} className="animate-spin" /> 불러오는 중...</div>
      ) : !data || data.topics.length === 0 ? (
        <div className="rounded-lg border border-dashed py-10 text-center text-sm text-neutral-400">매크로 신호가 없습니다.</div>
      ) : (
        <div className="space-y-2">
          {data.topics.map((tg) => (
            <div key={tg.topic} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface)] overflow-hidden">
              <button
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[var(--surface-elevated)] transition-colors"
                onClick={() => setExpanded(expanded === tg.topic ? null : tg.topic)}
              >
                <span className="rounded-full bg-purple-100 px-2.5 py-1 text-xs font-semibold text-purple-800 dark:bg-purple-900/30 dark:text-purple-300">{tg.topic}</span>
                <span className="text-xs text-neutral-500">{tg.count}건</span>
                <div className="flex gap-1 flex-1 justify-end">
                  {tg.signals.slice(0, 2).map((s) => <SentBadge key={s.id} s={s.sentiment} />)}
                </div>
                {expanded === tg.topic ? <ChevronUp size={14} className="shrink-0 text-neutral-400" /> : <ChevronDown size={14} className="shrink-0 text-neutral-400" />}
              </button>
              {expanded === tg.topic && (
                <div className="border-t border-[var(--border-subtle)] divide-y divide-[var(--border-subtle)]">
                  {tg.signals.map((sig) => (
                    <div key={sig.id} className="px-4 py-3 space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-neutral-400">{sig.event_date}</span>
                        <SentBadge s={sig.sentiment} />
                      </div>
                      <p className="text-xs text-neutral-700 dark:text-neutral-300">{sig.summary}</p>
                      {sig.impact && <p className="text-[10px] text-neutral-400">→ {sig.impact}</p>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── 섹터 추천 종목 (지켜보기) ─────────────────────
function SectorRecommendations({ sector, days }: { sector: string; days: number }) {
  const [recs, setRecs] = useState<StockRecommendation[]>([]);
  const [registerDraft, setRegisterDraft] = useState<WatchlistRegisterDraft | null>(null);

  useEffect(() => {
    signalApi.getRecommendations(days, sector).then((r) => setRecs(r.recommendations)).catch(() => setRecs([]));
  }, [sector, days]);

  if (recs.length === 0) return null;

  return (
    <>
      <div className="border-b border-[var(--border-subtle)] bg-amber-50/50 dark:bg-amber-900/10 px-4 py-2">
        <p className="text-[10px] font-semibold text-amber-800 dark:text-amber-400 mb-1.5">📌 AI 언급 종목</p>
        <div className="flex flex-wrap gap-1.5">
          {recs.slice(0, 8).map((rec) => (
            <button
              key={rec.stock_name}
              type="button"
              onClick={() => {
                const src = rec.sources?.[0];
                setRegisterDraft({
                  stock_name: rec.stock_name,
                  symbol: rec.symbol,
                  sector,
                  source_type: src?.type ?? "sector",
                  source_id: src?.id,
                });
              }}
              className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-white px-2 py-0.5 text-[10px] text-amber-900 hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-200"
              title={rec.latest_summary}
            >
              <Star size={10} />
              {rec.stock_name}
              <SentBadge s={rec.latest_sentiment} />
            </button>
          ))}
        </div>
      </div>
      <WatchlistRegisterModal
        draft={registerDraft}
        open={registerDraft !== null}
        onClose={() => setRegisterDraft(null)}
        onRegistered={() => setRegisterDraft(null)}
      />
    </>
  );
}

// ─── 섹터 허브 패널 ───────────────────────────────
function SectorHubPanel() {
  const [data, setData]         = useState<SectorHub | null>(null);
  const [loading, setLoading]   = useState(true);
  const [days, setDays]         = useState(30);
  const [expanded, setExpanded] = useState<string | null>(null);

  const sentColor = (s: string | null) =>
    s === "POSITIVE" ? "text-emerald-600 dark:text-emerald-400"
    : s === "NEGATIVE" ? "text-red-600 dark:text-red-400"
    : "text-neutral-500";

  useEffect(() => {
    setLoading(true);
    signalApi.getSectors(days).then((r) => { setData(r); setLoading(false); }).catch(() => setLoading(false));
  }, [days]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BarChart2 size={14} className="text-neutral-400" />
          <span className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">섹터별 신호</span>
          {data && <span className="text-xs text-neutral-400">({data.total}건)</span>}
        </div>
        <select value={days} onChange={(e) => setDays(Number(e.target.value))}
          className="rounded-md border border-[var(--border-subtle)] bg-[var(--background)] px-2 py-1 text-xs">
          {[7, 14, 30, 60, 90].map((d) => <option key={d} value={d}>{d}일</option>)}
        </select>
      </div>
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-neutral-400"><Loader2 size={14} className="animate-spin" /> 불러오는 중...</div>
      ) : !data || data.sectors.length === 0 ? (
        <div className="rounded-lg border border-dashed py-10 text-center text-sm text-neutral-400">섹터 신호가 없습니다.</div>
      ) : (
        <div className="space-y-2">
          {data.sectors.map((sg) => (
            <div key={sg.sector} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface)] overflow-hidden">
              <button
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[var(--surface-elevated)] transition-colors"
                onClick={() => setExpanded(expanded === sg.sector ? null : sg.sector)}
              >
                <span className="text-sm font-semibold text-neutral-800 dark:text-neutral-200 w-28 shrink-0 text-left">{sg.sector}</span>
                <div className="flex gap-2 text-[11px]">
                  <span className="text-emerald-600 dark:text-emerald-400">▲{sg.positive}</span>
                  <span className="text-neutral-400">━{sg.neutral}</span>
                  <span className="text-red-500">▼{sg.negative}</span>
                </div>
                <div className="flex-1" />
                <span className="text-xs text-neutral-400">{sg.count}건</span>
                {expanded === sg.sector ? <ChevronUp size={14} className="shrink-0 text-neutral-400" /> : <ChevronDown size={14} className="shrink-0 text-neutral-400" />}
              </button>
              {expanded === sg.sector && (
                <>
                  <SectorRecommendations sector={sg.sector} days={days} />
                <div className="border-t border-[var(--border-subtle)] divide-y divide-[var(--border-subtle)]">
                  {sg.signals.map((sig) => (
                    <div key={sig.id} className="px-4 py-3 space-y-1.5">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-neutral-400">{sig.event_date}</span>
                        <SentBadge s={sig.sentiment} />
                      </div>
                      <p className="text-xs text-neutral-700 dark:text-neutral-300">{sig.summary}</p>
                      {sig.outlook && <p className="text-[10px] text-neutral-400">전망: {sig.outlook}</p>}
                      {Array.isArray(sig.mentioned_stocks) && sig.mentioned_stocks.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {sig.mentioned_stocks.map((s) => (
                            <span key={s} className="rounded-full border border-[var(--border-subtle)] px-1.5 py-0.5 text-[10px] text-neutral-500">{s}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── 포트폴리오 리마인드 패널 ─────────────────────
function RemindPanel() {
  const [reminders, setReminders] = useState<PortfolioReminder[]>([]);
  const [loading, setLoading]     = useState(true);
  const [days, setDays]           = useState(30);
  const [expanded, setExpanded]   = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    signalApi.getReminders(days).then((r) => { setReminders(r.reminders); setLoading(false); }).catch(() => setLoading(false));
  }, [days]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bell size={14} className="text-neutral-400" />
          <span className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">내 종목 리마인드</span>
          <span className="text-xs text-neutral-400">보유 종목에 관련된 분석 신호</span>
        </div>
        <select value={days} onChange={(e) => setDays(Number(e.target.value))}
          className="rounded-md border border-[var(--border-subtle)] bg-[var(--background)] px-2 py-1 text-xs">
          {[7, 14, 30, 60, 90].map((d) => <option key={d} value={d}>{d}일</option>)}
        </select>
      </div>
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-neutral-400"><Loader2 size={14} className="animate-spin" /> 불러오는 중...</div>
      ) : reminders.length === 0 ? (
        <div className="rounded-lg border border-dashed py-10 text-center text-sm text-neutral-400">
          보유 종목 관련 신호가 없습니다.<br />
          <span className="text-xs">영상을 분석하고 백필을 실행하면 자동으로 연결됩니다.</span>
        </div>
      ) : (
        <div className="space-y-2">
          {reminders.map((r) => (
            <div key={r.symbol} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface)] overflow-hidden">
              <button
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[var(--surface-elevated)] transition-colors"
                onClick={() => setExpanded(expanded === r.symbol ? null : r.symbol)}
              >
                <div className="flex-1 flex items-center gap-3 text-left min-w-0">
                  <div>
                    <p className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">{r.stock_name}</p>
                    <p className="text-[10px] text-neutral-400">{r.symbol}</p>
                  </div>
                  {r.change_rate != null && (
                    <span className={`text-xs font-medium ${r.change_rate >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-500"}`}>
                      {r.change_rate >= 0 ? "+" : ""}{r.change_rate.toFixed(2)}%
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <SentBadge s={r.latest_sentiment} />
                  <span className="text-xs text-neutral-400">{r.signal_count}건 · {r.latest_date}</span>
                  {expanded === r.symbol ? <ChevronUp size={14} className="text-neutral-400" /> : <ChevronDown size={14} className="text-neutral-400" />}
                </div>
              </button>
              {expanded === r.symbol && (
                <div className="border-t border-[var(--border-subtle)] divide-y divide-[var(--border-subtle)]">
                  {r.signals.map((sig) => (
                    <div key={sig.id} className="px-4 py-2.5 space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-neutral-400">{sig.event_date}</span>
                        <SentBadge s={sig.sentiment} />
                      </div>
                      <p className="text-xs text-neutral-600 dark:text-neutral-400">{sig.summary}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── 메인 페이지 ──────────────────────────────────
export default function IntelligencePage() {
  const [pageTab,        setPageTab]      = useState<"analyze" | "channels" | "history" | "briefing" | "macro" | "sectors" | "remind">("analyze");
  const [contents,       setContents]     = useState<IntelContent[]>([]);
  const [sourceFilter,   setSourceFilter] = useState<"ALL" | "YOUTUBE" | "NEWS" | "TEXT">("ALL");
  const [loading,        setLoading]      = useState(true);
  const [highlightId,    setHighlightId]  = useState<number | null>(null);
  const [analysisProvider, setAnalysisProvider] = useState<AnalysisProvider>("gemini");
  const [enableBulkYoutubeAnalyze, setEnableBulkYoutubeAnalyze] = useState(false);

  const loadContents = useCallback(async () => {
    try {
      const data = await api.getIntelContents(sourceFilter === "ALL" ? undefined : sourceFilter);
      setContents(data);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [sourceFilter]);

  useEffect(() => { loadContents(); }, [loadContents]);

  useEffect(() => {
    api.getAnalysisProviders().then((r) => {
      setAnalysisProvider(r.default);
      setEnableBulkYoutubeAnalyze(r.enable_bulk_youtube_analyze);
    }).catch(() => {});
  }, []);

  // 분석 완료 → 이력 탭 이동 + 해당 항목 스크롤 (분석 요청 탭에서만 사용)
  function handleGoToHistory(id: number) {
    setHighlightId(id);
    setSourceFilter("ALL");
    setPageTab("history");
    setTimeout(() => {
      const el = document.getElementById(`intel-item-${id}`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
      setTimeout(() => setHighlightId(null), 3000);
    }, 150);
  }

  // 채널 탭: 분석 완료 후 탭 이동 없이 데이터만 갱신
  function handleChannelAnalyzeDone(_id: number) {
    loadContents();
  }

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div>
        <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">AI 인텔리전스 허브</h1>
        <p className="mt-0.5 text-xs text-neutral-400">텍스트 분석 기본 · GPT 구조화 분석 (YouTube/URL은 Gemini 추출)</p>
      </div>

      <AnalysisProviderSelect value={analysisProvider} onChange={setAnalysisProvider} />

      {/* 탭 */}
      <div className="flex gap-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] p-1 w-fit">
        {PAGE_TABS.map((t) => (
          <button key={t.id} onClick={() => setPageTab(t.id)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${pageTab === t.id ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900" : "text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* 탭 콘텐츠 */}
      {pageTab === "analyze" && (
        <AnalyzePanel
          onDone={() => loadContents()}
          onGoToHistory={handleGoToHistory}
          analysisProvider={analysisProvider}
        />
      )}

      {pageTab === "channels" && (
        <ChannelPanel
          onAnalyzeDone={handleChannelAnalyzeDone}
          analysisProvider={analysisProvider}
          enableBulkYoutubeAnalyze={enableBulkYoutubeAnalyze}
        />
      )}

      {pageTab === "briefing" && <BriefingPanel />}
      {pageTab === "macro"    && <MacroHubPanel />}
      {pageTab === "sectors"  && <SectorHubPanel />}
      {pageTab === "remind"   && <RemindPanel />}

      {pageTab === "history" && (
        <div>
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">
              분석 이력 <span className="text-xs font-normal text-neutral-400">({contents.length}건)</span>
            </h2>
            <div className="flex gap-1">
              {SOURCE_TABS.map((tab) => (
                <button key={tab.id} onClick={() => setSourceFilter(tab.id)}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${sourceFilter === tab.id ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900" : "text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"}`}>
                  {tab.label}
                </button>
              ))}
            </div>
            <button onClick={loadContents} className="ml-auto flex items-center gap-1 rounded-md border border-[var(--border-subtle)] px-2.5 py-1 text-xs text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800">
              <RefreshCw size={11} /> 새로고침
            </button>
          </div>

          {loading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-neutral-400"><Loader2 size={16} className="animate-spin" /> 불러오는 중...</div>
          ) : contents.length === 0 ? (
            <div className="rounded-lg border border-dashed border-[var(--border-subtle)] py-12 text-center text-sm text-neutral-400">
              분석 이력이 없습니다.
            </div>
          ) : (
            <div className="space-y-3">
              {contents.map((c) => (
                <div
                  key={c.id}
                  id={`intel-item-${c.id}`}
                  className={`rounded-xl transition-all duration-700 ${highlightId === c.id ? "ring-2 ring-blue-400 ring-offset-2 dark:ring-offset-neutral-900" : ""}`}
                >
                  <ContentCard content={c} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
