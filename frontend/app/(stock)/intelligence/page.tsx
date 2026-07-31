"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import {
  Video, Newspaper, FileText, Send, Loader2,
  TrendingUp, TrendingDown, Minus,
  ChevronDown, ChevronUp, Plus, Trash2,
  RefreshCw, PlayCircle, CheckCircle2,
  Tv, ExternalLink, AlertCircle,
  Globe, BarChart2, Bell, CalendarDays, Star,
} from "lucide-react";
import { api, signalApi, scoreApi, type AnalysisResult, type IntelContent, type StockIssueItem, type AnalysisLog, type MacroAnalysis, type SectorAnalysisItem, type AnalysisProvider, type DailyBriefing, type MacroHub, type SectorHub, type PortfolioReminder, type StockRecommendation, type SignalAccuracyResponse, type LeadLagSummary, type RiskRadarResult, type SignalGapCandidatesResponse, type SignalGapCandidate, type PatternLibraryItem, type ProviderAccuracyResponse, type SectorRotationResponse, type ScenarioSimulationResult, type InvestmentThesisItem, type StockItem } from "@/lib/api";
import {
  WatchlistRegisterModal,
  type WatchlistRegisterDraft,
} from "@/components/watchlist-register-modal";
import { streamAnalyze, AnalyzeStreamError } from "@/lib/analyzeStream";
import { IntelDetailPanel, type IntelDetailData } from "@/components/intel-detail-panel";
import { IntelCalendarHub } from "@/components/intelligence/intel-calendar-hub";
import { knowledgeApi, type KnowledgeDomain } from "@/lib/knowledgeApi";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api";

const SOURCE_TABS = [
  { id: "ALL",     label: "전체" },
  { id: "YOUTUBE", label: "유튜브" },
  { id: "NEWS",    label: "뉴스" },
  { id: "TEXT",    label: "텍스트" },
] as const;

const PAGE_TABS = [
  { id: "calendar", label: "캘린더" },
  { id: "analyze",  label: "분석 요청" },
  { id: "channels", label: "채널 구독" },
  { id: "history",  label: "분석 이력" },
  { id: "briefing", label: "일별 브리핑" },
  { id: "macro",    label: "매크로" },
  { id: "sectors",  label: "섹터" },
  { id: "remind",   label: "리마인드" },
  { id: "forecast", label: "예측·리스크" },
  { id: "thesis",   label: "투자 가설" },
] as const;

// ─── 타입 ────────────────────────────────────────
interface YTChannel {
  id: number;
  channel_id: string;
  channel_name: string;
  channel_url: string;
  default_market_impact: boolean;
  domain_id: number | null;
  last_checked_at: string | null;
}
interface YTVideo   { video_id: string; title: string; description: string; published_at: string; thumbnail: string; url: string; already_analyzed: boolean; }
interface VideoAnalysis extends IntelDetailData {
  logs?: AnalysisLog[];
}

const ANALYSIS_PROVIDER_OPTIONS: { id: AnalysisProvider; label: string; hint: string }[] = [
  { id: "gemini", label: "Gemini (기본)", hint: "gemini-3.1-flash-lite · YouTube 추출·구조화" },
  { id: "openai", label: "GPT", hint: "gpt-4o-mini · 텍스트 분석" },
  { id: "claude", label: "Claude", hint: "Anthropic API 크레dit 필요" },
];

const PROVIDER_LABEL: Record<string, string> = { gemini: "Gemini", openai: "GPT", claude: "Claude" };

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
      <IntelDetailPanel data={analysis} contentId={analysis.id} compact />
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

function ScopeBadge({ scope }: { scope?: string | null }) {
  const isKnowledge = scope === "knowledge";
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
        isKnowledge
          ? "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300"
          : "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300"
      }`}
    >
      {isKnowledge ? "📚 지식" : "📈 주가 반영"}
    </span>
  );
}

function ContentCard({
  content,
  onScopeChange,
}: {
  content: IntelContent;
  onScopeChange?: (updated: IntelContent) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [detail, setDetail] = useState<IntelContent | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [scopeBusy, setScopeBusy] = useState(false);

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
  const scope = display.content_scope || "market";

  async function changeScope(next: "knowledge" | "market") {
    if (!content.id) return;
    const label = next === "knowledge" ? "주가 반영에서 제외" : "주가 반영 적용";
    if (!confirm(`${label}할까요?`)) return;
    setScopeBusy(true);
    try {
      const r = await api.setIntelContentScope(content.id, next);
      setDetail(r.content);
      onScopeChange?.(r.content);
    } catch (e) {
      alert(e instanceof Error ? e.message : "변경 실패");
    } finally {
      setScopeBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] p-4 hover:border-neutral-300 dark:hover:border-neutral-600 transition-colors">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 shrink-0"><SourceIcon type={content.source_type} /></div>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            {content.channel_name && <span className="text-xs font-medium text-neutral-600 dark:text-neutral-400">{content.channel_name}</span>}
            <ScopeBadge scope={scope} />
            <SentimentBadge sentiment={content.sentiment} />
            {content.analyzed_at && (
              <span className="text-xs text-neutral-400 ml-auto tabular-nums" title="분석 요청 시각">
                {new Date(content.analyzed_at).toLocaleString("ko-KR", {
                  year: "numeric", month: "2-digit", day: "2-digit",
                  hour: "2-digit", minute: "2-digit", hour12: false,
                })}
              </span>
            )}
          </div>
          {content.source_title && <p className="text-sm font-medium text-neutral-800 dark:text-neutral-200">{content.source_title}</p>}
          {content.summary && !expanded && (
            <p className="text-sm text-neutral-600 dark:text-neutral-400 line-clamp-2">{content.summary}</p>
          )}
          {!expanded && scope !== "knowledge" && (
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
              <IntelDetailPanel
                data={{ ...display, source_type: display.source_type, source_url: display.source_url }}
                contentId={display.id}
                onHighlightsSaved={(h) => {
                  const patched = { ...display, user_highlights: h };
                  setDetail(patched);
                  onScopeChange?.(patched);
                }}
              />
            )
          )}
          <div className="flex items-center gap-3 flex-wrap">
            {scope === "market" ? (
              <button
                type="button"
                disabled={scopeBusy}
                onClick={() => changeScope("knowledge")}
                className="text-xs text-violet-600 hover:underline disabled:opacity-50"
              >
                주가 반영 제외
              </button>
            ) : (
              <button
                type="button"
                disabled={scopeBusy}
                onClick={() => changeScope("market")}
                className="text-xs text-emerald-600 hover:underline disabled:opacity-50"
              >
                주가 반영 적용
              </button>
            )}
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
  const [marketImpactOnAdd, setMarketImpactOnAdd] = useState(false);
  const [domainIdOnAdd, setDomainIdOnAdd] = useState<number | null>(null);
  const [knowledgeDomains, setKnowledgeDomains] = useState<KnowledgeDomain[]>([]);
  const [videoMarketImpact, setVideoMarketImpact] = useState<Record<string, boolean>>({});
  const [detailedExtract, setDetailedExtract] = useState(false);

  // 영상별 분석 결과 & 펼침 상태
  const [analysisMap, setAnalysisMap] = useState<Record<string, VideoAnalysis>>({});
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  const MAX_VIDEOS = 50;

  const loadChannels = useCallback(async () => {
    try { setChannels(await fetchJson<YTChannel[]>("/youtube/channels")); }
    catch { /* ignore */ }
  }, []);

  useEffect(() => { loadChannels(); }, [loadChannels]);

  useEffect(() => {
    knowledgeApi.getDomains().then((list) => {
      const visible = list.filter((d) => d.slug !== "uncategorized");
      setKnowledgeDomains(visible);
      if (visible[0] && domainIdOnAdd == null) setDomainIdOnAdd(visible[0].id);
    }).catch(() => {});
  }, [domainIdOnAdd]);

  async function addChannel() {
    if (!handle.trim()) return;
    setAdding(true); setError(""); setBulkMsg("");
    try {
      const r = await fetchJson<
        YTChannel & {
          reactivated?: boolean;
          knowledge_conversion?: { matched: number; converted: number; already_knowledge: number };
          knowledge_hub?: {
            domain_id: number;
            domain: { id: number; name: string; slug: string; emoji?: string };
            domain_created: boolean;
            hub_url: string;
          };
        }
      >("/youtube/channels", {
        method: "POST",
        body: JSON.stringify({
          handle: handle.trim(),
          custom_name: customName.trim() || null,
          default_market_impact: marketImpactOnAdd,
          domain_id: marketImpactOnAdd ? undefined : domainIdOnAdd ?? undefined,
        }),
      });
      if (!marketImpactOnAdd && r.knowledge_hub) {
        const hub = r.knowledge_hub;
        let msg = hub.domain_created
          ? `지식 허브에 「${hub.domain.name}」 분야가 자동 생성되었습니다.`
          : `지식 허브 「${hub.domain.name}」 분야에 연결되었습니다.`;
        if (r.reactivated) {
          const kc = r.knowledge_conversion;
          msg = "채널을 다시 등록했습니다. " + msg;
          if (kc && kc.converted > 0) {
            msg += ` 기존 분석 ${kc.converted}건을 지식으로 전환했습니다.`;
          }
        }
        msg += ` → ${hub.hub_url}`;
        setBulkMsg(msg);
        knowledgeApi.getDomains().then((list) => {
          setKnowledgeDomains(list.filter((d) => d.slug !== "uncategorized"));
        }).catch(() => {});
      } else if (r.reactivated) {
        const kc = r.knowledge_conversion;
        let msg = "채널을 다시 등록했습니다. 등록 폼 설정이 적용되었습니다.";
        if (!marketImpactOnAdd && kc && kc.converted > 0) {
          msg += ` 기존 분석 ${kc.converted}건을 지식(주가 미반영)으로 전환했습니다.`;
        }
        setBulkMsg(msg);
      }
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
        setBulkMsg(`캐시에서 불러왔습니다 · 채널을 다시 누르면 이전 영상 추가 (최대 ${MAX_VIDEOS}개)`);
      } else if (append) {
        setBulkMsg(`${data.videos.length}개 추가 · 총 ${merged.length}개`);
      } else if (data.has_more) {
        setBulkMsg(`채널을 한 번 더 누르면 이전 영상 10개를 더 불러옵니다 (최대 ${MAX_VIDEOS}개)`);
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
  function videoMarketFlag(videoId: string): boolean {
    if (videoId in videoMarketImpact) return videoMarketImpact[videoId];
    return selectedCh?.default_market_impact ?? false;
  }

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
          {
            url: v.url,
            channel_name: channelName,
            channel_db_id: selectedCh?.id,
            analysis_provider: analysisProvider,
            market_impact: videoMarketFlag(v.video_id),
            detailed_extract: detailedExtract,
            domain_id: videoMarketFlag(v.video_id) ? undefined : (selectedCh?.domain_id ?? domainIdOnAdd ?? undefined),
          },
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
          <label className="flex items-center gap-2 text-xs text-neutral-600 dark:text-neutral-400 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={marketImpactOnAdd}
              onChange={(e) => setMarketImpactOnAdd(e.target.checked)}
              className="rounded border-neutral-300"
            />
            <span>
              <span className="font-medium text-emerald-700 dark:text-emerald-400">주가 반영</span>
              {" "}채널 — 체크 시 영상 분석이 매크로·시그널에 반영됩니다 (미체크 시 📚 지식만 저장)
            </span>
          </label>
          {!marketImpactOnAdd && knowledgeDomains.length > 0 && (
            <label className="flex items-center gap-2 text-xs text-neutral-600 dark:text-neutral-400">
              <span className="shrink-0">관심 분야</span>
              <select
                value={domainIdOnAdd ?? ""}
                onChange={(e) => setDomainIdOnAdd(Number(e.target.value))}
                className="flex-1 rounded-md border border-[var(--border-subtle)] bg-[var(--background)] px-2 py-1.5 text-xs"
              >
                {knowledgeDomains.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.emoji} {d.name}
                  </option>
                ))}
              </select>
            </label>
          )}
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
                  {ch.default_market_impact ? (
                    <span className="shrink-0 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[9px] font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">주가</span>
                  ) : (
                    <span className="shrink-0 rounded-full bg-violet-100 px-1.5 py-0.5 text-[9px] font-medium text-violet-700 dark:bg-violet-900/30 dark:text-violet-400">지식</span>
                  )}
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
                영상 클릭으로 개별 분석 · 채널 재클릭 또는 더보기로 이전 영상 (최대 {MAX_VIDEOS}개) · 분석 완료 영상은 결과 자동 표시
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

          <div className="border-b border-[var(--border-subtle)] px-4 py-2.5 flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-neutral-600 dark:text-neutral-400 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={detailedExtract}
                onChange={(e) => setDetailedExtract(e.target.checked)}
                className="rounded border-neutral-300"
              />
              <span>
                <span className="font-medium text-neutral-800 dark:text-neutral-200">상세 추출</span>
                {" "}(기본 대비 약 3배 · Gemini · 시간·토큰 더 사용)
              </span>
            </label>
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
                      <div className="shrink-0 flex flex-col items-end gap-1.5">
                        {!v.already_analyzed && (
                          <label
                            className="flex items-center gap-1 text-[10px] text-neutral-500 cursor-pointer select-none"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <input
                              type="checkbox"
                              checked={videoMarketFlag(v.video_id)}
                              onChange={(e) =>
                                setVideoMarketImpact((prev) => ({
                                  ...prev,
                                  [v.video_id]: e.target.checked,
                                }))
                              }
                              className="rounded border-neutral-300"
                            />
                            주가 반영
                          </label>
                        )}
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
                        {detailedExtract ? "상세 추출·분석 중... (3~5분)" : "Gemini→AI 분석 중... (1~3분)"}
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
  const [analyzeScope, setAnalyzeScope] = useState<"knowledge" | "market">("knowledge");
  const [knowledgeDomains, setKnowledgeDomains] = useState<KnowledgeDomain[]>([]);
  const [selectedDomainId, setSelectedDomainId] = useState<number | null>(null);
  const [detailedExtract, setDetailedExtract] = useState(false);
  const [forceReanalyze, setForceReanalyze] = useState(false);
  const [analyzing,    setAnalyzing]    = useState(false);
  const [lastResult,   setLastResult]   = useState<AnalysisResult | null>(null);
  const [lastLogs,     setLastLogs]     = useState<AnalysisLog[]>([]);
  const [error,        setError]        = useState("");

  useEffect(() => {
    if (analyzeScope !== "knowledge") return;
    knowledgeApi
      .getDomains()
      .then((list) => {
        const visible = list.filter((d) => d.slug !== "uncategorized");
        setKnowledgeDomains(visible);
        if (visible[0] && selectedDomainId == null) setSelectedDomainId(visible[0].id);
      })
      .catch(() => {});
  }, [analyzeScope, selectedDomainId]);

  async function handleAnalyze() {
    if (inputMode === "url" && !inputUrl.trim()) return;
    if (inputMode === "text" && !inputText.trim()) return;
    if (analyzeScope === "knowledge" && !selectedDomainId) {
      setError("지식 분석에는 관심 분야를 선택하세요. /knowledge 에서 분야를 추가할 수 있습니다.");
      return;
    }
    setAnalyzing(true); setError(""); setLastResult(null); setLastLogs([]);
    try {
      const marketImpact = analyzeScope === "market";
      const isYoutubeUrl =
        inputMode === "url" &&
        /youtube\.com|youtu\.be/i.test(inputUrl.trim());
      const payload =
        inputMode === "url"
          ? {
              url: inputUrl.trim(),
              channel_name: inputChannel.trim() || undefined,
              analysis_provider: marketImpact ? analysisProvider : undefined,
              market_impact: marketImpact,
              force_reanalyze: forceReanalyze,
              ...(isYoutubeUrl ? { detailed_extract: detailedExtract } : {}),
              ...(marketImpact ? {} : { domain_id: selectedDomainId }),
            }
          : {
              text: inputText.trim(),
              title: inputTitle.trim() || undefined,
              analysis_provider: marketImpact ? analysisProvider : undefined,
              market_impact: marketImpact,
              force_reanalyze: forceReanalyze,
              ...(marketImpact ? {} : { domain_id: selectedDomainId }),
            };

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
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-subtle)] px-4 py-3">
        <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">새 분석 요청</h2>
        <div className="flex flex-wrap gap-2">
          <div className="flex gap-1 rounded-md border border-[var(--border-subtle)] p-0.5">
            {(
              [
                { id: "knowledge" as const, label: "📚 지식" },
                { id: "market" as const, label: "📈 주가 반영" },
              ] as const
            ).map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setAnalyzeScope(s.id)}
                className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                  analyzeScope === s.id
                    ? s.id === "market"
                      ? "bg-emerald-700 text-white dark:bg-emerald-600"
                      : "bg-violet-700 text-white dark:bg-violet-600"
                    : "text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
          <div className="flex gap-1 rounded-md border border-[var(--border-subtle)] p-0.5">
            {(["text", "url"] as const).map((m) => (
              <button key={m} type="button" onClick={() => setInputMode(m)}
                className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${inputMode === m ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900" : "text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"}`}>
                {m === "text" ? "텍스트" : "URL"}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="p-4 space-y-3">
        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          {analyzeScope === "market"
            ? "매크로·섹터·시그널·시장 캘린더에 반영됩니다."
            : "요약·핵심 포인트만 저장합니다. 시장 Signal·캘린더에는 포함되지 않습니다. (Gemini 요약)"}
        </p>
        {analyzeScope === "knowledge" && (
          <label className="flex items-center gap-2 text-xs text-neutral-600 dark:text-neutral-400">
            <span className="shrink-0 font-medium">관심 분야</span>
            {knowledgeDomains.length === 0 ? (
              <Link href="/knowledge/settings/domains" className="text-violet-600 hover:underline">
                분야를 먼저 추가하세요 →
              </Link>
            ) : (
              <select
                value={selectedDomainId ?? ""}
                onChange={(e) => setSelectedDomainId(Number(e.target.value))}
                className="flex-1 rounded-md border border-[var(--border-subtle)] bg-[var(--background)] px-2 py-1.5"
              >
                {knowledgeDomains.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.emoji} {d.name}
                  </option>
                ))}
              </select>
            )}
          </label>
        )}
        {inputMode === "url" ? (
          <>
            <input type="url" value={inputUrl} onChange={(e) => setInputUrl(e.target.value)}
              placeholder="YouTube URL 또는 뉴스 기사 URL"
              className="w-full rounded-md border border-[var(--border-subtle)] bg-[var(--background)] px-3 py-2 text-sm placeholder:text-neutral-400 focus:outline-none" />
            <input type="text" value={inputChannel} onChange={(e) => setInputChannel(e.target.value)}
              placeholder="채널명 (선택 · YouTube일 때)"
              className="w-full rounded-md border border-[var(--border-subtle)] bg-[var(--background)] px-3 py-2 text-sm placeholder:text-neutral-400 focus:outline-none" />
            {/youtube\.com|youtu\.be/i.test(inputUrl.trim()) && (
              <label className="flex items-center gap-2 text-xs text-neutral-600 dark:text-neutral-400 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={detailedExtract}
                  onChange={(e) => setDetailedExtract(e.target.checked)}
                  className="rounded border-neutral-300"
                />
                <span>
                  <span className="font-medium text-neutral-800 dark:text-neutral-200">YouTube 상세 추출</span>
                  {" "}— 문서·요약을 기본 대비 약 3배 길게 (Gemini, 분석 시간 증가)
                </span>
              </label>
            )}
            <label className="flex items-center gap-2 text-xs text-neutral-600 dark:text-neutral-400 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={forceReanalyze}
                onChange={(e) => setForceReanalyze(e.target.checked)}
                className="rounded border-neutral-300"
              />
              <span>
                <span className="font-medium text-neutral-800 dark:text-neutral-200">재분석 강제 실행</span>
                {" "}— 이전에 분석한 URL이라도 다시 크롤링·분석
              </span>
            </label>
          </>
        ) : (
          <>
            <input type="text" value={inputTitle} onChange={(e) => setInputTitle(e.target.value)}
              placeholder="제목 (선택)"
              className="w-full rounded-md border border-[var(--border-subtle)] bg-[var(--background)] px-3 py-2 text-sm placeholder:text-neutral-400 focus:outline-none" />
            <textarea value={inputText} onChange={(e) => setInputText(e.target.value)} rows={5}
              placeholder="분석할 텍스트를 입력하세요 (뉴스 본문, 시황 메모 등)"
              className="w-full resize-none rounded-md border border-[var(--border-subtle)] bg-[var(--background)] px-3 py-2 text-sm placeholder:text-neutral-400 focus:outline-none" />
            <label className="flex items-center gap-2 text-xs text-neutral-600 dark:text-neutral-400 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={forceReanalyze}
                onChange={(e) => setForceReanalyze(e.target.checked)}
                className="rounded border-neutral-300"
              />
              <span>
                <span className="font-medium text-neutral-800 dark:text-neutral-200">재분석 강제 실행</span>
                {" "}— 이전에 분석한 URL이라도 다시 크롤링·분석
              </span>
            </label>
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
          {analyzing
            ? analyzeScope === "market"
              ? detailedExtract
                ? "상세 추출·분석 중..."
                : "분석 중 (Gemini→AI)..."
              : detailedExtract
                ? "상세 추출·지식 요약 중..."
                : "분석 중 (지식 요약)..."
            : analyzeScope === "market"
              ? "주가 반영 분석 시작"
              : "지식 분석 시작"}
        </button>
        {(analyzing || lastLogs.length > 0) && (
          <AnalysisLogPanel logs={lastLogs} analyzing={analyzing} />
        )}
      </div>

      {lastResult && (
        <div className="border-t border-[var(--border-subtle)] bg-[var(--surface-elevated)] p-4 space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">✅ 분석 완료</span>
              <ScopeBadge scope={lastResult.content_scope || (analyzeScope === "market" ? "market" : "knowledge")} />
              {analyzeScope === "market" && <SentimentBadge sentiment={lastResult.sentiment} />}
              {lastResult.analyzed_at && (
                <span className="text-xs text-neutral-400 tabular-nums">
                  {new Date(lastResult.analyzed_at).toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => onGoToHistory(lastResult.id)}
              className="text-xs text-blue-500 hover:underline"
            >
              분석 이력에서 보기 →
            </button>
          </div>
          <IntelDetailPanel data={lastResult} contentId={lastResult.id} />
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
                        <p className="text-[10px] text-neutral-400">
                          {c.channel_name && <>{c.channel_name} · </>}
                          {c.analyzed_at ? new Date(c.analyzed_at).toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }) : "—"}
                        </p>
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

// ─── 예측·리스크 패널 (Signal 적중률 · Lead-Lag · 리스크 레이더) ──
// 세 API 모두 이미 백엔드에 있었지만(core/signal_tracker.py, core/lead_lag.py, buy_score.py의
// risk-radar) 프론트에서 아무도 호출하지 않아 계산만 되고 안 보이던 것을 여기서 처음 노출한다.
function HitRateRow({ label, block }: { label: string; block: SignalAccuracyResponse["sector"] | undefined }) {
  if (!block) return null;
  const rate = block.overall_hit_rate;
  const insufficient = block.insufficient_data || block.sample_count === 0;
  return (
    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface)] px-4 py-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">{label}</span>
        <span className="text-xs text-neutral-400">{block.sample_count}건</span>
      </div>
      {insufficient || rate == null ? (
        <p className="mt-1 text-xs text-neutral-400">데이터 부족</p>
      ) : (
        <div className="mt-1 flex items-baseline gap-2">
          <span
            className={`text-xl font-bold ${
              rate >= 0.55
                ? "text-emerald-600 dark:text-emerald-400"
                : rate >= 0.4
                  ? "text-amber-600 dark:text-amber-400"
                  : "text-red-600 dark:text-red-400"
            }`}
          >
            {(rate * 100).toFixed(0)}%
          </span>
          {block.best_check_days != null && (
            <span className="text-[10px] text-neutral-400">최적 {block.best_check_days}일 창</span>
          )}
        </div>
      )}
    </div>
  );
}

// 재분석 실패 시 서버가 { detail: { message, logs: [...] } } 형태로 응답하므로
// 화면엔 마지막 error 로그(진짜 원인, 예: "Claude 크레딧 부족")를 뽑아서 보여준다.
function extractReanalyzeError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  try {
    const parsed = JSON.parse(raw) as { detail?: { message?: string; logs?: { level: string; msg: string }[] } };
    const logs = parsed.detail?.logs;
    if (logs?.length) {
      // 맨 처음 error 로그가 근본 원인(예: "Claude 실패: 크레딧 부족")이고,
      // 그 뒤는 보통 "분석 AI 실패" 같은 일반화된 래핑 메시지라 첫 번째를 우선한다.
      const firstError = logs.find((l) => l.level === "error");
      if (firstError?.msg) return firstError.msg;
    }
    if (parsed.detail?.message) return parsed.detail.message;
  } catch {
    /* JSON이 아니면 원문 그대로 사용 */
  }
  return raw;
}

// 6/2~ 프롬프트 버그(감성 필드 누락)로 저장된 콘텐츠를 하나씩 재분석하는 패널.
// 저장된 source_document를 재사용하므로 YouTube 재추출은 없고, 구조화 분석 AI만 다시 호출한다.
// 재분석하면 자연히 후보 목록에서 빠지므로 별도 진행상태 저장 없이 그때그때 다시 불러오면 된다.
function GapFillPanel() {
  const [data, setData] = useState<SignalGapCandidatesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [reanalyzingId, setReanalyzingId] = useState<number | null>(null);
  const [initialTotal, setInitialTotal] = useState<number | null>(null);
  const [completed, setCompleted] = useState<SignalGapCandidate[]>([]);
  const [showCompleted, setShowCompleted] = useState(false);
  const [errors, setErrors] = useState<Record<number, string>>({});

  const load = useCallback(() => {
    setLoading(true);
    signalApi
      .getGapCandidates(10, 0)
      .then((res) => {
        setData(res);
        setInitialTotal((prev) => (prev == null ? res.total : Math.max(prev, res.total)));
      })
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const [batchTarget, setBatchTarget] = useState<{ done: number; total: number } | null>(null);

  async function handleReanalyze(c: SignalGapCandidate) {
    setReanalyzingId(c.id);
    setErrors((prev) => {
      const next = { ...prev };
      delete next[c.id];
      return next;
    });
    try {
      await api.reanalyzeContent(c.id, "gemini");
      setCompleted((prev) => [c, ...prev]);
      load();
    } catch (e) {
      setErrors((prev) => ({ ...prev, [c.id]: extractReanalyzeError(e) }));
    } finally {
      setReanalyzingId(null);
    }
  }

  // 지금 화면에 보이는 후보 중 앞에서부터 N개를 순서대로(동시 호출 없이) 처리.
  // 목록 스냅샷을 미리 떠서 진행 중 재정렬/새로고침에 영향받지 않게 한다.
  async function handleBatch(count: number) {
    if (!data) return;
    const batch = data.items.slice(0, count);
    if (batch.length === 0) return;
    setBatchTarget({ done: 0, total: batch.length });
    for (let i = 0; i < batch.length; i++) {
      await handleReanalyze(batch[i]);
      setBatchTarget({ done: i + 1, total: batch.length });
    }
    setBatchTarget(null);
  }

  if (loading && !data) {
    return (
      <div className="flex items-center gap-2 py-3 text-xs text-neutral-400">
        <Loader2 size={12} className="animate-spin" /> 재분석 후보 확인 중...
      </div>
    );
  }

  if (!data || (data.total === 0 && completed.length === 0)) return null;

  const doneCount = completed.length;
  const progressTotal = initialTotal ?? data.total + doneCount;
  const progressPct = progressTotal > 0 ? Math.min(100, Math.round((doneCount / progressTotal) * 100)) : 0;

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-4 dark:border-amber-900/40 dark:bg-amber-900/10">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-amber-900 dark:text-amber-300">매크로/섹터 감성 공백 메우기</span>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => handleBatch(7)}
            disabled={reanalyzingId != null || data.items.length === 0}
            className="rounded-md border border-amber-300 bg-white px-2.5 py-1 text-[11px] font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-50 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
          >
            {batchTarget ? `일괄 처리 중 (${batchTarget.done}/${batchTarget.total})` : "7개씩 일괄 처리"}
          </button>
          <button type="button" onClick={load} disabled={reanalyzingId != null} className="text-[11px] text-amber-700 hover:underline disabled:opacity-50 dark:text-amber-400">
            새로고침
          </button>
        </div>
      </div>
      <p className="mb-1.5 text-[11px] text-amber-700 dark:text-amber-400">
        이번 세션 {doneCount}건 완료 · {data.total}건 남음 — Gemini로 재분석하면(저장된 원문 재사용, YouTube 재추출 없음)
        매크로/섹터 Signal이 채워집니다. 한 건씩 또는 7개씩 일괄로 처리할 수 있습니다.
      </p>
      {doneCount > 0 && (
        <div className="mb-3 h-1.5 w-full overflow-hidden rounded-full bg-amber-200/60 dark:bg-amber-900/40">
          <div
            className="h-full rounded-full bg-amber-500 transition-all dark:bg-amber-400"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      )}
      <div className="space-y-1.5">
        {data.items.map((c) => {
          const isActive = reanalyzingId === c.id;
          const errMsg = errors[c.id];
          return (
            <div key={c.id} className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] px-3 py-2">
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs text-neutral-700 dark:text-neutral-300">{c.source_title || "(제목 없음)"}</p>
                  <p className="text-[10px] text-neutral-400">{c.channel_name} · {c.published_at || c.analyzed_at}</p>
                </div>
                <button
                  type="button"
                  onClick={() => handleReanalyze(c)}
                  disabled={reanalyzingId != null}
                  className="flex shrink-0 items-center gap-1 rounded-md border border-amber-300 bg-white px-2.5 py-1 text-[11px] font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-50 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
                >
                  {isActive ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
                  {isActive ? "재분석 중..." : "재분석"}
                </button>
              </div>
              {errMsg && (
                <p className="mt-1.5 text-[10px] text-red-600 dark:text-red-400">{errMsg}</p>
              )}
            </div>
          );
        })}
      </div>
      {doneCount > 0 && (
        <div className="mt-3 border-t border-amber-200/60 pt-2 dark:border-amber-900/40">
          <button
            type="button"
            onClick={() => setShowCompleted((v) => !v)}
            className="flex items-center gap-1 text-[11px] font-medium text-emerald-700 hover:underline dark:text-emerald-400"
          >
            {showCompleted ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            ✅ 완료됨 ({doneCount}건)
          </button>
          {showCompleted && (
            <div className="mt-1.5 space-y-1">
              {completed.map((c) => (
                <div key={c.id} className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-1.5 dark:bg-emerald-900/10">
                  <span className="text-emerald-600 dark:text-emerald-400">✓</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs text-neutral-600 dark:text-neutral-400">{c.source_title || "(제목 없음)"}</p>
                    <p className="text-[10px] text-neutral-400">{c.channel_name} · {c.published_at || c.analyzed_at}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ForecastHubPanel() {
  const [accuracy, setAccuracy] = useState<SignalAccuracyResponse | null>(null);
  const [leadLag, setLeadLag]   = useState<LeadLagSummary | null>(null);
  const [riskRadar, setRiskRadar] = useState<RiskRadarResult | null>(null);
  const [patterns, setPatterns] = useState<PatternLibraryItem[] | null>(null);
  const [providerAcc, setProviderAcc] = useState<ProviderAccuracyResponse | null>(null);
  const [rotation, setRotation] = useState<SectorRotationResponse | null>(null);
  const [loading, setLoading]   = useState(true);
  const [scenarioKey, setScenarioKey] = useState<string>("");
  const [scenarioResult, setScenarioResult] = useState<ScenarioSimulationResult | null>(null);
  const [scenarioLoading, setScenarioLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    Promise.allSettled([
      signalApi.getSignalAccuracy(),
      signalApi.getLeadLag(),
      scoreApi.getRiskRadar(),
      signalApi.getPatterns(),
      signalApi.getProviderAccuracy(),
      signalApi.getSectorRotation(),
    ]).then(([a, l, r, p, pa, sr]) => {
      setAccuracy(a.status === "fulfilled" ? a.value : null);
      setLeadLag(l.status === "fulfilled" ? l.value : null);
      setRiskRadar(r.status === "fulfilled" ? r.value : null);
      setPatterns(p.status === "fulfilled" ? p.value.patterns : null);
      setProviderAcc(pa.status === "fulfilled" ? pa.value : null);
      setRotation(sr.status === "fulfilled" ? sr.value : null);
      setLoading(false);
    });
  }, []);

  const scenarioOptions = (() => {
    const seen = new Map<string, { key: string; topic: string; sentiment: string; label: string }>();
    (patterns ?? []).forEach((p) => {
      const key = `${p.trigger_topic}|${p.trigger_sentiment}`;
      if (!seen.has(key)) {
        seen.set(key, {
          key,
          topic: p.trigger_topic,
          sentiment: p.trigger_sentiment,
          label: `${p.trigger_topic} ${p.trigger_sentiment === "POSITIVE" ? "긍정" : "부정"}`,
        });
      }
    });
    return Array.from(seen.values());
  })();

  const runSimulation = useCallback((key: string) => {
    setScenarioKey(key);
    const opt = scenarioOptions.find((o) => o.key === key);
    if (!opt) { setScenarioResult(null); return; }
    setScenarioLoading(true);
    signalApi.simulateScenario(opt.topic, opt.sentiment)
      .then((r) => setScenarioResult(r))
      .catch(() => setScenarioResult(null))
      .finally(() => setScenarioLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patterns]);

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-10 text-sm text-neutral-400">
        <Loader2 size={14} className="animate-spin" /> 불러오는 중...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <GapFillPanel />

      <div>
        <div className="flex items-center gap-2 mb-2">
          <BarChart2 size={14} className="text-neutral-400" />
          <span className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">Signal 적중률</span>
        </div>
        {accuracy ? (
          <div className="grid gap-2 sm:grid-cols-3">
            <HitRateRow label="섹터" block={accuracy.sector} />
            <HitRateRow label="매크로" block={accuracy.macro} />
            <HitRateRow label="종목 언급" block={accuracy.stock} />
          </div>
        ) : (
          <p className="text-xs text-neutral-400">데이터를 불러올 수 없습니다.</p>
        )}
        {accuracy?.disclaimer && (
          <p className="mt-2 text-[10px] text-neutral-400">{accuracy.disclaimer}</p>
        )}
      </div>

      <div>
        <div className="flex items-center gap-2 mb-2">
          <TrendingUp size={14} className="text-neutral-400" />
          <span className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">Lead-Lag (선행·후행)</span>
          {leadLag && <span className="text-xs text-neutral-400">({leadLag.total_pairs}쌍)</span>}
        </div>
        {leadLag && leadLag.insights.length > 0 ? (
          <ul className="space-y-1">
            {leadLag.insights.map((line, i) => (
              <li key={i} className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] px-3 py-2 text-xs text-neutral-700 dark:text-neutral-300">
                {line}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-neutral-400">유의미한 선행/후행 패턴을 찾을 만큼 데이터가 쌓이지 않았습니다.</p>
        )}
        {leadLag && (
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            {(["macro", "sector", "stock"] as const).map((st) => {
              const b = leadLag.by_type[st];
              if (!b || b.sample_count === 0) return null;
              const label = st === "macro" ? "매크로" : st === "sector" ? "섹터" : "종목 언급";
              return (
                <div key={st} className="rounded-lg border border-[var(--border-subtle)] px-3 py-2 text-xs">
                  <div className="flex justify-between text-neutral-500">
                    <span>{label}</span>
                    <span className="text-neutral-400">{b.sample_count}건</span>
                  </div>
                  {b.avg_lead_days != null && (
                    <p className="mt-1 text-neutral-700 dark:text-neutral-300">
                      평균 {b.avg_lead_days > 0 ? `${b.avg_lead_days.toFixed(1)}일 선행` : `${Math.abs(b.avg_lead_days).toFixed(1)}일 후행`}
                      {b.pct_signal_leads != null && ` · 선행 비율 ${(b.pct_signal_leads * 100).toFixed(0)}%`}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {leadLag?.disclaimer && (
          <p className="mt-2 text-[10px] text-neutral-400">{leadLag.disclaimer}</p>
        )}
      </div>

      <div>
        <div className="flex items-center gap-2 mb-2">
          <BarChart2 size={14} className="text-neutral-400" />
          <span className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">패턴 라이브러리</span>
          {patterns && <span className="text-xs text-neutral-400">({patterns.length}개)</span>}
        </div>
        {patterns && patterns.length > 0 ? (
          <div className="space-y-1.5">
            {patterns.map((p) => (
              <div key={p.id} className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-neutral-700 dark:text-neutral-300">{p.pattern_name}</span>
                  {p.insufficient_data ? (
                    <span className="text-[10px] font-medium text-neutral-400">데이터 부족 ({p.total_count}건)</span>
                  ) : (
                    <span
                      className={`text-xs font-bold ${
                        (p.hit_rate ?? 0) >= 0.6
                          ? "text-red-600 dark:text-red-400"
                          : (p.hit_rate ?? 0) >= 0.4
                            ? "text-amber-600 dark:text-amber-400"
                            : "text-blue-600 dark:text-blue-400"
                      }`}
                    >
                      {p.hit_count}/{p.total_count} ({((p.hit_rate ?? 0) * 100).toFixed(0)}%)
                    </span>
                  )}
                </div>
                <p className="mt-1 text-[11px] text-neutral-500">
                  {p.trigger_topic} {p.trigger_sentiment === "POSITIVE" ? "긍정" : "부정"} Signal → {p.target_sector}
                  {p.avg_move_pct != null && ` · 평균 ${p.avg_move_pct >= 0 ? "+" : ""}${p.avg_move_pct.toFixed(1)}%`}
                  {" "}({p.check_days}일 후) · 최근 발생 {p.last_occurred ?? "-"}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-neutral-400">아직 추출된 패턴이 없습니다.</p>
        )}
        <p className="mt-2 text-[10px] text-neutral-400">
          과거 매크로 Signal 발생 후 5거래일 뒤 해당 섹터 실제 평균 변동률 기준 — 표본 3건 미만은 신뢰도를 매기지 않습니다.
        </p>
      </div>

      <div>
        <div className="flex items-center gap-2 mb-2">
          <BarChart2 size={14} className="text-neutral-400" />
          <span className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">시나리오 시뮬레이터</span>
        </div>
        {scenarioOptions.length > 0 ? (
          <>
            <select
              value={scenarioKey}
              onChange={(e) => runSimulation(e.target.value)}
              className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] px-3 py-2 text-xs text-neutral-700 dark:text-neutral-300"
            >
              <option value="">트리거 선택...</option>
              {scenarioOptions.map((o) => (
                <option key={o.key} value={o.key}>{o.label}</option>
              ))}
            </select>
            {scenarioLoading && (
              <div className="mt-2 flex items-center gap-2 text-xs text-neutral-400">
                <Loader2 size={12} className="animate-spin" /> 시뮬레이션 중...
              </div>
            )}
            {!scenarioLoading && scenarioResult && (
              <div className="mt-2 space-y-2">
                <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] px-3 py-3 flex items-center justify-between">
                  <div>
                    <p className="text-[11px] text-neutral-500">추정 포트폴리오 등락률</p>
                    <p className={`text-lg font-bold ${
                      scenarioResult.estimated_total_change_pct > 0
                        ? "text-red-600 dark:text-red-400"
                        : scenarioResult.estimated_total_change_pct < 0
                          ? "text-blue-600 dark:text-blue-400"
                          : "text-neutral-500"
                    }`}>
                      {scenarioResult.estimated_total_change_pct >= 0 ? "+" : ""}{scenarioResult.estimated_total_change_pct.toFixed(2)}%
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-[11px] text-neutral-500">추정 손익</p>
                    <p className={`text-sm font-semibold ${
                      scenarioResult.estimated_pnl > 0
                        ? "text-red-600 dark:text-red-400"
                        : scenarioResult.estimated_pnl < 0
                          ? "text-blue-600 dark:text-blue-400"
                          : "text-neutral-500"
                    }`}>
                      {scenarioResult.estimated_pnl >= 0 ? "+" : ""}{Math.round(scenarioResult.estimated_pnl).toLocaleString()}원
                    </p>
                  </div>
                </div>
                {scenarioResult.no_pattern_found ? (
                  <p className="text-xs text-neutral-400">이 트리거와 일치하는 패턴이 없습니다.</p>
                ) : (
                  <>
                    <div className="space-y-1">
                      {scenarioResult.matched_patterns.map((mp) => (
                        <p key={mp.pattern_name} className="text-[11px] text-neutral-500">
                          {mp.pattern_name} · 평균 {mp.avg_move_pct != null ? `${mp.avg_move_pct >= 0 ? "+" : ""}${mp.avg_move_pct.toFixed(1)}%` : "-"}
                          {mp.insufficient_data ? " (데이터 부족)" : ` · 적중률 ${((mp.hit_rate ?? 0) * 100).toFixed(0)}% (${mp.total_count}건)`}
                        </p>
                      ))}
                    </div>
                    <div className="space-y-1">
                      {scenarioResult.contributions.filter((c) => c.contribution_pct !== 0).slice(0, 8).map((c) => (
                        <div key={c.symbol} className="flex items-center justify-between rounded-lg border border-[var(--border-subtle)] px-3 py-1.5 text-xs">
                          <span className="text-neutral-700 dark:text-neutral-300">{c.name}</span>
                          <span className="text-neutral-400">비중 {c.weight_pct.toFixed(1)}%</span>
                          <span className={c.contribution_pct >= 0 ? "text-red-600 dark:text-red-400" : "text-blue-600 dark:text-blue-400"}>
                            {c.contribution_pct >= 0 ? "+" : ""}{c.contribution_pct.toFixed(2)}%p
                          </span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
          </>
        ) : (
          <p className="text-xs text-neutral-400">아직 시뮬레이션 가능한 패턴이 없습니다.</p>
        )}
        <p className="mt-2 text-[10px] text-neutral-400">{scenarioResult?.disclaimer}</p>
      </div>

      <div>
        <div className="flex items-center gap-2 mb-2">
          <BarChart2 size={14} className="text-neutral-400" />
          <span className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">AI 분석 정확도</span>
          {providerAcc?.recommended_provider && (
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
              추천: {PROVIDER_LABEL[providerAcc.recommended_provider] ?? providerAcc.recommended_provider}
            </span>
          )}
        </div>
        {providerAcc ? (
          <div className="grid gap-2 sm:grid-cols-3">
            {(["claude", "openai", "gemini"] as const).map((p) => {
              const bucket = providerAcc.providers[p];
              if (!bucket) return null;
              return (
                <div key={p} className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] px-3 py-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">{PROVIDER_LABEL[p]}</span>
                    <span className="text-xs text-neutral-400">{bucket.sample_count}건</span>
                  </div>
                  {bucket.insufficient_data || bucket.hit_rate == null ? (
                    <p className="mt-1 text-xs text-neutral-400">데이터 부족</p>
                  ) : (
                    <span
                      className={`text-xl font-bold ${
                        bucket.hit_rate >= 0.55
                          ? "text-red-600 dark:text-red-400"
                          : bucket.hit_rate >= 0.4
                            ? "text-amber-600 dark:text-amber-400"
                            : "text-blue-600 dark:text-blue-400"
                      }`}
                    >
                      {(bucket.hit_rate * 100).toFixed(0)}%
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-xs text-neutral-400">데이터를 불러올 수 없습니다.</p>
        )}
        <p className="mt-2 text-[10px] text-neutral-400">
          {providerAcc?.disclaimer ?? "과거 Signal 적중률 기준 참고 지표이며, 미래 분석 품질을 보장하지 않습니다."}
          {" "}표본 {providerAcc?.min_sample_for_recommend ?? 10}건 미만은 추천 후보에서 제외됩니다.
        </p>
      </div>

      <div>
        <div className="flex items-center gap-2 mb-2">
          <BarChart2 size={14} className="text-neutral-400" />
          <span className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">섹터 로테이션</span>
          {rotation && <span className="text-xs text-neutral-400">(최근 {rotation.window_days}일)</span>}
        </div>
        {rotation ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <p className="mb-1 flex items-center gap-1 text-[11px] font-medium text-red-600 dark:text-red-400">
                  <TrendingUp size={12} /> 상승 섹터
                </p>
                {rotation.rising_sectors.length > 0 ? (
                  <div className="space-y-1.5">
                    {rotation.rising_sectors.map((s) => (
                      <div key={s.sector} className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] px-3 py-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-medium text-neutral-700 dark:text-neutral-300">{s.sector}</span>
                          <span className="text-xs font-bold text-red-600 dark:text-red-400">
                            {s.delta >= 0 ? "+" : ""}{s.delta.toFixed(2)}
                          </span>
                        </div>
                        <p className="mt-0.5 text-[10px] text-neutral-400">
                          {s.early_score.toFixed(2)} → {s.late_score.toFixed(2)} · {s.signal_count}건
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-neutral-400">뚜렷한 상승 섹터 없음</p>
                )}
              </div>
              <div>
                <p className="mb-1 flex items-center gap-1 text-[11px] font-medium text-blue-600 dark:text-blue-400">
                  <TrendingDown size={12} /> 하락 섹터
                </p>
                {rotation.falling_sectors.length > 0 ? (
                  <div className="space-y-1.5">
                    {rotation.falling_sectors.map((s) => (
                      <div key={s.sector} className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] px-3 py-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-medium text-neutral-700 dark:text-neutral-300">{s.sector}</span>
                          <span className="text-xs font-bold text-blue-600 dark:text-blue-400">
                            {s.delta.toFixed(2)}
                          </span>
                        </div>
                        <p className="mt-0.5 text-[10px] text-neutral-400">
                          {s.early_score.toFixed(2)} → {s.late_score.toFixed(2)} · {s.signal_count}건
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-neutral-400">뚜렷한 하락 섹터 없음</p>
                )}
              </div>
            </div>
            {rotation.warnings.length > 0 && (
              <div className="mt-2 space-y-1">
                {rotation.warnings.map((w, i) => (
                  <div key={i} className="flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-300">
                    <AlertCircle size={12} className="mt-0.5 shrink-0" /> {w}
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <p className="text-xs text-neutral-400">데이터를 불러올 수 없습니다.</p>
        )}
        <p className="mt-2 text-[10px] text-neutral-400">{rotation?.disclaimer}</p>
      </div>

      <div>
        <div className="flex items-center gap-2 mb-2">
          <AlertCircle size={14} className="text-neutral-400" />
          <span className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">포트폴리오 리스크 레이더</span>
          {riskRadar && <span className="text-xs text-neutral-400">({riskRadar.stock_count}종목)</span>}
        </div>
        {riskRadar && riskRadar.axes.length > 0 ? (
          <div className="grid gap-2 sm:grid-cols-2">
            {riskRadar.axes.map((ax) => (
              <div key={ax.axis} className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] px-3 py-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-neutral-700 dark:text-neutral-300">{ax.axis}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                      ax.risk_level === "높음"
                        ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                        : ax.risk_level === "보통"
                          ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                          : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                    }`}
                  >
                    {ax.risk_level}
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-neutral-500">{ax.description}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-neutral-400">보유 종목이 없거나 데이터가 부족합니다.</p>
        )}
      </div>
    </div>
  );
}

// ─── 투자 가설 추적 패널 ─────────────────────
const THESIS_CATEGORY_LABEL: Record<string, string> = {
  macro: "매크로", sector: "섹터", product: "상품/이슈", earnings: "실적",
};
const THESIS_HORIZON_LABEL: Record<string, string> = { short: "단기", mid: "중기", long: "장기" };
const THESIS_STATUS_LABEL: Record<string, string> = {
  active: "진행중", confirmed: "확인됨", invalidated: "반박됨", expired: "만료",
};
const THESIS_STATUS_CLASS: Record<string, string> = {
  active: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  confirmed: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  invalidated: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  expired: "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400",
};

function ThesisPanel() {
  const [theses, setTheses] = useState<InvestmentThesisItem[]>([]);
  const [stocks, setStocks] = useState<StockItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [validating, setValidating] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [stockId, setStockId] = useState<number | "">("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [category, setCategory] = useState<string>("sector");
  const [timeHorizon, setTimeHorizon] = useState<string>("mid");

  const reload = useCallback(() => {
    setLoading(true);
    Promise.allSettled([signalApi.getTheses(), api.getStocks()]).then(([t, s]) => {
      setTheses(t.status === "fulfilled" ? t.value.theses : []);
      setStocks(s.status === "fulfilled" ? s.value : []);
      setLoading(false);
    });
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const stocksForPicker = [...stocks].sort((a, b) => a.name.localeCompare(b.name, "ko"));

  const counts = theses.reduce(
    (acc, t) => { acc[t.status] = (acc[t.status] ?? 0) + 1; return acc; },
    {} as Record<string, number>,
  );

  const handleValidate = () => {
    setValidating(true);
    signalApi.validateTheses()
      .then((r) => setTheses(r.theses))
      .finally(() => setValidating(false));
  };

  const handleExpire = (id: number) => {
    signalApi.updateThesisStatus(id, "expired").then(() => reload());
  };

  const handleSubmit = () => {
    setFormError(null);
    if (!stockId || !title.trim()) {
      setFormError("종목과 제목은 필수입니다.");
      return;
    }
    setSubmitting(true);
    signalApi.createThesis({
      stock_id: stockId as number,
      title: title.trim(),
      body: body.trim() || undefined,
      category,
      time_horizon: timeHorizon,
    })
      .then(() => {
        setShowForm(false);
        setStockId(""); setTitle(""); setBody(""); setCategory("sector"); setTimeHorizon("mid");
        reload();
      })
      .catch((e) => setFormError(e instanceof Error ? e.message : "생성 실패"))
      .finally(() => setSubmitting(false));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-10 text-sm text-neutral-400">
        <Loader2 size={14} className="animate-spin" /> 불러오는 중...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {(["active", "confirmed", "invalidated", "expired"] as const).map((s) => (
            <span key={s} className={`rounded-full px-2.5 py-1 text-xs font-medium ${THESIS_STATUS_CLASS[s]}`}>
              {THESIS_STATUS_LABEL[s]} {counts[s] ?? 0}
            </span>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleValidate}
            disabled={validating}
            className="flex items-center gap-1 rounded-md border border-[var(--border-subtle)] px-3 py-1.5 text-xs font-medium text-neutral-600 hover:bg-neutral-50 disabled:opacity-50 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            {validating ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} 지금 검증
          </button>
          <button
            onClick={() => setShowForm((v) => !v)}
            className="flex items-center gap-1 rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900"
          >
            <Plus size={12} /> 새 가설
          </button>
        </div>
      </div>

      {showForm && (
        <div className="space-y-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] p-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <select
              value={stockId}
              onChange={(e) => setStockId(e.target.value ? Number(e.target.value) : "")}
              className="rounded-md border border-[var(--border-subtle)] bg-transparent px-2 py-1.5 text-xs"
            >
              <option value="">종목 선택...</option>
              {stocksForPicker.map((s) => (
                <option key={s.id} value={s.id}>{s.name} ({s.symbol})</option>
              ))}
            </select>
            <div className="flex gap-2">
              <select value={category} onChange={(e) => setCategory(e.target.value)} className="flex-1 rounded-md border border-[var(--border-subtle)] bg-transparent px-2 py-1.5 text-xs">
                {Object.entries(THESIS_CATEGORY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <select value={timeHorizon} onChange={(e) => setTimeHorizon(e.target.value)} className="flex-1 rounded-md border border-[var(--border-subtle)] bg-transparent px-2 py-1.5 text-xs">
                {Object.entries(THESIS_HORIZON_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
          </div>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="가설 제목 (예: HBM 수요 확대로 실적 턴어라운드)"
            className="w-full rounded-md border border-[var(--border-subtle)] bg-transparent px-2 py-1.5 text-xs"
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="근거 (선택)"
            rows={2}
            className="w-full rounded-md border border-[var(--border-subtle)] bg-transparent px-2 py-1.5 text-xs"
          />
          {formError && <p className="text-xs text-red-500">{formError}</p>}
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowForm(false)} className="rounded-md px-3 py-1.5 text-xs text-neutral-500">취소</button>
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
            >
              {submitting ? "생성 중..." : "생성"}
            </button>
          </div>
        </div>
      )}

      {theses.length > 0 ? (
        <div className="space-y-2">
          {theses.map((t) => (
            <div key={t.id} className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] p-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">{t.stock_name}</span>
                    <span className="text-[10px] text-neutral-400">{t.symbol}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${THESIS_STATUS_CLASS[t.status]}`}>
                      {THESIS_STATUS_LABEL[t.status]}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-neutral-700 dark:text-neutral-300">{t.title}</p>
                  {t.body && <p className="mt-0.5 text-[11px] text-neutral-500">{t.body}</p>}
                </div>
                {t.status !== "expired" && (
                  <button
                    onClick={() => handleExpire(t.id)}
                    className="shrink-0 rounded-md border border-[var(--border-subtle)] px-2 py-1 text-[10px] text-neutral-500 hover:bg-neutral-50 dark:hover:bg-neutral-800"
                  >
                    만료 처리
                  </button>
                )}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-neutral-400">
                <span className="rounded-full border border-[var(--border-subtle)] px-2 py-0.5">{THESIS_CATEGORY_LABEL[t.category]}</span>
                <span className="rounded-full border border-[var(--border-subtle)] px-2 py-0.5">{THESIS_HORIZON_LABEL[t.time_horizon]}</span>
                {t.validation_score != null ? (
                  <span>검증 점수 {(t.validation_score * 100).toFixed(0)}% (지지 {t.support_count} · 반박 {t.contradict_count})</span>
                ) : (
                  <span>검증 데이터 없음</span>
                )}
                {t.last_validated_at && <span>최근 검증 {t.last_validated_at.slice(0, 16).replace("T", " ")}</span>}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-neutral-400">등록된 투자 가설이 없습니다. &quot;새 가설&quot;로 첫 가설을 만들어 보세요.</p>
      )}
      <p className="text-[10px] text-neutral-400">
        최근 7일 Signal과 대조해 자동 검증됩니다(매일 16:00) — 표본 3건 이상에서 지지 비율 80% 이상이면 확인됨, 20% 이하면 반박됨으로 전환됩니다.
      </p>
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
  const [pageTab,        setPageTab]      = useState<"calendar" | "analyze" | "channels" | "history" | "briefing" | "macro" | "sectors" | "remind" | "forecast" | "thesis">("calendar");
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
        <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">AI 분석</h1>
        <p className="mt-0.5 text-xs text-neutral-400">캘린더·경제 일정·이슈·Signal을 날짜별로 보고 분석 도구를 실행합니다</p>
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
      {pageTab === "calendar" && <IntelCalendarHub />}

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
      {pageTab === "forecast" && <ForecastHubPanel />}
      {pageTab === "thesis"   && <ThesisPanel />}

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
                  <ContentCard
                    content={c}
                    onScopeChange={(updated) =>
                      setContents((prev) => prev.map((x) => (x.id === updated.id ? { ...x, ...updated } : x)))
                    }
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
