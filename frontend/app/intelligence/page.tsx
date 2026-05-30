"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Video, Newspaper, FileText, Send, Loader2,
  TrendingUp, TrendingDown, Minus,
  ChevronDown, ChevronUp, Plus, Trash2,
  RefreshCw, PlayCircle, CheckCircle2,
  Tv, ExternalLink, AlertCircle,
} from "lucide-react";
import { api, type AnalysisResult, type IntelContent, type StockIssueItem, type AnalysisLog, type MacroAnalysis, type SectorAnalysisItem } from "@/lib/api";

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
] as const;

// ─── 타입 ────────────────────────────────────────
interface YTChannel { id: number; channel_id: string; channel_name: string; channel_url: string; last_checked_at: string | null; }
interface YTVideo   { video_id: string; title: string; description: string; published_at: string; thumbnail: string; url: string; already_analyzed: boolean; }
interface VideoAnalysis {
  id: number;
  summary: string;
  key_points: string[];
  mentioned_stocks: string[];
  mentioned_sectors: string[];
  keywords: string[];
  sentiment: string;
  analyzed_at: string | null;
  stock_issues?: StockIssueItem[];
  macro_analysis?: MacroAnalysis;
  sector_analysis?: SectorAnalysisItem[];
  logs?: AnalysisLog[];
}

const LOG_STEPS = [
  "🔍 분석 준비 중...",
  "📋 보유 종목 목록 로드...",
  "🎬 Gemini: YouTube 문서 추출 (또는 본문 수집)...",
  "🤖 GPT: 종목·매크로·섹터 분석 요청...",
  "⏳ GPT 응답 대기 중...",
  "🗂️ 보유 종목 매핑 및 DB 저장...",
];

function SentDot({ s }: { s: string }) {
  if (s === "POSITIVE") return <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />;
  if (s === "NEGATIVE") return <span className="h-1.5 w-1.5 rounded-full bg-red-500 shrink-0" />;
  return <span className="h-1.5 w-1.5 rounded-full bg-neutral-400 shrink-0" />;
}

function AnalysisLogPanel({ logs, analyzing }: { logs: AnalysisLog[]; analyzing: boolean }) {
  const [stepIdx, setStepIdx] = useState(0);
  useEffect(() => {
    if (!analyzing) { setStepIdx(0); return; }
    const timers = [0, 1500, 4000, 8000, 12000].map((d, i) => setTimeout(() => setStepIdx(i), d));
    return () => timers.forEach(clearTimeout);
  }, [analyzing]);

  const levelColor = (l: string) =>
    l === "error" ? "text-red-400" : l === "warn" ? "text-amber-400" : "text-emerald-400";

  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-950 overflow-hidden">
      <div className="flex items-center gap-2 border-b border-neutral-800 px-3 py-2">
        <span className="text-xs text-neutral-400 font-mono">분석 로그</span>
        {analyzing && <span className="ml-auto flex items-center gap-1 text-[10px] text-amber-400"><Loader2 size={10} className="animate-spin" /> 진행 중</span>}
        {!analyzing && logs.length > 0 && <span className="ml-auto text-[10px] text-emerald-400">완료</span>}
      </div>
      <div className="p-3 font-mono text-[10px] space-y-0.5 max-h-40 overflow-y-auto">
        {analyzing && LOG_STEPS.slice(0, stepIdx + 1).map((s, i) => (
          <div key={i} className={i === stepIdx ? "text-amber-300 animate-pulse" : "text-neutral-500"}>{s}</div>
        ))}
        {!analyzing && logs.map((l, i) => (
          <div key={i} className="flex gap-2">
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
          <p className="text-[10px] font-semibold text-purple-700 dark:text-purple-400 mb-1">🌍 매크로 분석 (GPT)</p>
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
          <p className="text-[10px] font-semibold text-blue-700 dark:text-blue-400 mb-1.5">📊 섹터별 분석 (GPT)</p>
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
  const sentLabel: Record<string, string> = { POSITIVE: "긍정", NEGATIVE: "부정", NEUTRAL: "중립" };
  const sentText: Record<string, string> = {
    POSITIVE: "text-emerald-700 dark:text-emerald-400",
    NEGATIVE: "text-red-700 dark:text-red-400",
    NEUTRAL:  "text-neutral-600 dark:text-neutral-400",
  };
  const s = analysis.sentiment ?? "NEUTRAL";

  return (
    <div className={`mt-2 rounded-lg border p-3 text-sm ${sentColors[s] ?? sentColors.NEUTRAL}`}>
      {/* 상단 메타 */}
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${sentText[s]}`}>
          {s === "POSITIVE" ? <TrendingUp size={11} /> : s === "NEGATIVE" ? <TrendingDown size={11} /> : <Minus size={11} />}
          {sentLabel[s]}
        </span>
        {analysis.analyzed_at && (
          <span className="text-xs text-neutral-400">{new Date(analysis.analyzed_at).toLocaleDateString("ko-KR")}</span>
        )}
      </div>

      {/* 요약 */}
      {analysis.summary && (
        <p className="text-xs text-neutral-700 dark:text-neutral-300 leading-relaxed mb-2 line-clamp-2">{analysis.summary}</p>
      )}

      {/* 핵심 포인트 최대 5개 */}
      {analysis.key_points.length > 0 && (
        <ul className="space-y-1 mb-2">
          {analysis.key_points.slice(0, 5).map((p, i) => (
            <li key={i} className="flex gap-2 text-xs text-neutral-600 dark:text-neutral-400">
              <span className="shrink-0 mt-0.5 text-neutral-300 dark:text-neutral-600">•</span>
              <span>{p}</span>
            </li>
          ))}
        </ul>
      )}

      {/* 보유 종목 매핑 */}
      {analysis.stock_issues && analysis.stock_issues.length > 0 && (
        <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/15 p-2.5">
          <p className="text-[10px] font-semibold text-amber-700 dark:text-amber-400 mb-1.5">
            📌 내 보유 종목 (GPT) ({analysis.stock_issues.length}개)
          </p>
          <div className="space-y-2">
            {analysis.stock_issues.map((iss, i) => (
              <div key={i} className="flex gap-2">
                <div className="flex items-start gap-1.5 shrink-0 mt-0.5">
                  <SentDot s={iss.sentiment} />
                  <span className="text-[10px] font-semibold text-neutral-700 dark:text-neutral-300 whitespace-nowrap">
                    {iss.name}
                  </span>
                </div>
                <p className="text-[10px] text-neutral-600 dark:text-neutral-400 leading-relaxed line-clamp-2">
                  {iss.issue_summary}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      <MacroSectorPanel macro={analysis.macro_analysis} sectors={analysis.sector_analysis} />

      {/* 태그 */}
      <div className="flex flex-wrap gap-1">
        {analysis.mentioned_sectors.map((s) => (
          <span key={s} className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] text-blue-700 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-400">{s}</span>
        ))}
        {analysis.mentioned_stocks.slice(0, 6).map((s) => (
          <span key={s} className="rounded-full border border-[var(--border-subtle)] bg-[var(--surface)] px-2 py-0.5 text-[10px] text-neutral-600 dark:text-neutral-400">{s}</span>
        ))}
      </div>
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
          {content.source_title && <p className="text-sm font-medium text-neutral-800 dark:text-neutral-200 line-clamp-2">{content.source_title}</p>}
          {content.summary && (
            <p className={`text-sm text-neutral-600 dark:text-neutral-400 ${expanded ? "" : "line-clamp-2"}`}>{content.summary}</p>
          )}
          <div className="flex flex-wrap gap-1.5">
            {content.mentioned_sectors?.map((s) => (
              <span key={s} className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] text-blue-700 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-400">{s}</span>
            ))}
            {content.mentioned_stocks?.slice(0, 5).map((s) => (
              <span key={s} className="rounded-full border border-[var(--border-subtle)] px-2 py-0.5 text-[11px] text-neutral-600 dark:text-neutral-400">{s}</span>
            ))}
          </div>
          <div className="flex items-center gap-3">
            {content.source_url && (
              <a href={content.source_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-blue-500 hover:underline">
                원문 보기 <ExternalLink size={10} />
              </a>
            )}
            <button onClick={() => setExpanded(!expanded)} className="flex items-center gap-1 text-xs text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300">
              {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              {expanded ? "접기" : "더 보기"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── 채널 패널 ────────────────────────────────────
function ChannelPanel({ onAnalyzeDone }: { onAnalyzeDone?: (id: number) => void }) {
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

  // 영상별 분석 결과 & 펼침 상태
  const [analysisMap, setAnalysisMap] = useState<Record<string, VideoAnalysis>>({});
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

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
    if (selectedCh?.id === id) { setSelectedCh(null); setVideos([]); }
    loadChannels();
  }

  async function loadVideos(ch: YTChannel, forceRefresh = false) {
    setSelectedCh(ch); setLoadingVids(true); setVideos([]);
    setBulkMsg(""); setAnalysisMap({}); setExpandedIds(new Set());
    try {
      const url = `/youtube/channels/${ch.id}/videos?max_results=10${forceRefresh ? "&force_refresh=true" : ""}`;
      const data = await fetchJson<{ channel: YTChannel; videos: YTVideo[]; from_cache?: boolean }>(url);
      setVideos(data.videos);
      if (data.from_cache) setBulkMsg("캐시에서 불러왔습니다 (1시간 유효 · 새로고침으로 갱신)");
      // 이미 분석된 영상 결과를 백그라운드로 미리 로드
      data.videos.filter((v) => v.already_analyzed).forEach((v) => {
        fetchJson<VideoAnalysis>(`/intel/by-url?url=${encodeURIComponent(v.url)}`)
          .then((r) => setAnalysisMap((prev) => ({ ...prev, [v.video_id]: r })))
          .catch(() => {/* ignore */});
      });
    } catch { setVideos([]); }
    finally { setLoadingVids(false); }
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
      // 미분석 → AI 분석 시작
      setAnalyzingId(v.video_id);
      try {
        const r = await fetchJson<VideoAnalysis>("/youtube/analyze", {
          method: "POST",
          body: JSON.stringify({ url: v.url, channel_name: channelName }),
        });
        setVideos((prev) => prev.map((x) => x.video_id === v.video_id ? { ...x, already_analyzed: true } : x));
        setAnalysisMap((prev) => ({ ...prev, [v.video_id]: r }));
        setExpandedIds((prev) => new Set(prev).add(v.video_id));
        // 이력 탭으로 이동
        if (onAnalyzeDone && r.id) onAnalyzeDone(r.id);
      } catch { /* ignore */ }
      finally { setAnalyzingId(null); }
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
              onClick={() => loadVideos(ch)}
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
              <p className="text-xs text-neutral-400 mt-0.5">클릭하면 개별 분석, 일괄 분석은 미분석 영상만 처리</p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => loadVideos(selectedCh, true)} className="flex items-center gap-1.5 rounded-md border border-[var(--border-subtle)] px-3 py-1.5 text-xs font-medium text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800">
                <RefreshCw size={12} /> YouTube에서 새로고침
              </button>
              <button
                onClick={() => bulkAnalyze(selectedCh)}
                disabled={bulkAnalyzing}
                className="flex items-center gap-1.5 rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-700 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
              >
                {bulkAnalyzing ? <Loader2 size={12} className="animate-spin" /> : <PlayCircle size={12} />}
                {bulkAnalyzing ? "분석 중..." : "최신 5개 일괄 분석"}
              </button>
            </div>
          </div>

          {bulkMsg && (
            <div className="border-b border-[var(--border-subtle)] bg-emerald-50 dark:bg-emerald-900/15 px-4 py-2 text-xs text-emerald-700 dark:text-emerald-400">
              ✅ {bulkMsg}
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
function AnalyzePanel({ onDone, onGoToHistory }: { onDone: (id?: number) => void; onGoToHistory: (id: number) => void }) {
  const [inputUrl,     setInputUrl]     = useState("");
  const [inputText,    setInputText]    = useState("");
  const [inputTitle,   setInputTitle]   = useState("");
  const [inputChannel, setInputChannel] = useState("");
  const [inputMode,    setInputMode]    = useState<"url" | "text">("url");
  const [analyzing,    setAnalyzing]    = useState(false);
  const [lastResult,   setLastResult]   = useState<AnalysisResult | null>(null);
  const [lastLogs,     setLastLogs]     = useState<AnalysisLog[]>([]);
  const [error,        setError]        = useState("");

  async function handleAnalyze() {
    if (inputMode === "url" && !inputUrl.trim()) return;
    if (inputMode === "text" && !inputText.trim()) return;
    setAnalyzing(true); setError(""); setLastResult(null); setLastLogs([]);
    try {
      const result = await api.analyzeContent(
        inputMode === "url"
          ? { url: inputUrl.trim(), channel_name: inputChannel.trim() || undefined }
          : { text: inputText.trim(), title: inputTitle.trim() || undefined }
      );
      setLastResult(result);
      setLastLogs(result.logs || []);
      setInputUrl(""); setInputText(""); setInputTitle(""); setInputChannel("");
      // 이력 탭으로 이동 + 해당 항목 스크롤
      onDone(result.id);
      onGoToHistory(result.id);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      try {
        const parsed = JSON.parse(msg);
        setError(parsed.detail || msg);
      } catch {
        // HTTP 429 body는 이미 JSON이므로 다시 시도
        if (msg.includes("429") || msg.toLowerCase().includes("quota")) {
          setError("Gemini API 사용 한도 초과입니다. 잠시 후(1분) 다시 시도해 주세요.");
        } else {
          setError(msg);
        }
      }
    } finally { setAnalyzing(false); }
  }

  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] overflow-hidden">
      <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-4 py-3">
        <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">새 분석 요청</h2>
        <div className="flex gap-1 rounded-md border border-[var(--border-subtle)] p-0.5">
          {(["url", "text"] as const).map((m) => (
            <button key={m} onClick={() => setInputMode(m)}
              className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${inputMode === m ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900" : "text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"}`}>
              {m === "url" ? "URL" : "텍스트"}
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
          {analyzing ? "분석 중 (Gemini→GPT)..." : "AI 분석 시작"}
        </button>
        {(analyzing || lastLogs.length > 0) && (
          <AnalysisLogPanel logs={lastLogs} analyzing={analyzing} />
        )}
      </div>

      {lastResult && (
        <div className="border-t border-[var(--border-subtle)] bg-[var(--surface-elevated)] p-4 space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">✅ 분석 완료</span>
            <SentimentBadge sentiment={lastResult.sentiment} />
          </div>
          <p className="text-sm text-neutral-700 dark:text-neutral-300">{lastResult.summary}</p>
          <div>
            <p className="text-xs font-medium text-neutral-500 mb-1.5">핵심 포인트</p>
            <ul className="space-y-1">
              {lastResult.key_points.map((p, i) => (
                <li key={i} className="flex gap-2 text-xs text-neutral-600 dark:text-neutral-400">
                  <span className="text-neutral-300 dark:text-neutral-600">•</span>{p}
                </li>
              ))}
            </ul>
          </div>

          {/* 보유 종목 매핑 결과 */}
          {lastResult.stock_issues && lastResult.stock_issues.length > 0 ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/15 p-3">
              <p className="text-xs font-semibold text-amber-700 dark:text-amber-400 mb-2">
                📌 내 보유 종목 관련 분석 ({lastResult.stock_issues.length}개)
              </p>
              <div className="space-y-2.5">
                {lastResult.stock_issues.map((iss, i) => (
                  <div key={i} className="flex gap-2.5 items-start">
                    <div className="shrink-0 flex items-center gap-1.5 mt-0.5">
                      {iss.sentiment === "POSITIVE" && <span className="h-2 w-2 rounded-full bg-emerald-500" />}
                      {iss.sentiment === "NEGATIVE" && <span className="h-2 w-2 rounded-full bg-red-500" />}
                      {iss.sentiment === "NEUTRAL"  && <span className="h-2 w-2 rounded-full bg-neutral-400" />}
                      <span className="text-xs font-semibold text-neutral-800 dark:text-neutral-200 whitespace-nowrap">
                        {iss.name}
                      </span>
                    </div>
                    <p className="text-xs text-neutral-600 dark:text-neutral-400 leading-relaxed">
                      {iss.issue_summary}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-xs text-neutral-400">보유 종목 중 이 콘텐츠에서 언급된 종목이 없습니다.</p>
          )}

          <MacroSectorPanel macro={lastResult.macro_analysis} sectors={lastResult.sector_analysis} />

          <div className="flex flex-wrap gap-1.5">
            {lastResult.mentioned_sectors.map((s) => (
              <span key={s} className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] text-blue-700 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-400">{s}</span>
            ))}
            {lastResult.mentioned_stocks.map((s) => (
              <span key={s} className="rounded-full border border-[var(--border-subtle)] px-2 py-0.5 text-[11px] text-neutral-600 dark:text-neutral-400">{s}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── 메인 페이지 ──────────────────────────────────
export default function IntelligencePage() {
  const [pageTab,        setPageTab]      = useState<"analyze" | "channels" | "history">("analyze");
  const [contents,       setContents]     = useState<IntelContent[]>([]);
  const [sourceFilter,   setSourceFilter] = useState<"ALL" | "YOUTUBE" | "NEWS" | "TEXT">("ALL");
  const [loading,        setLoading]      = useState(true);
  const [highlightId,    setHighlightId]  = useState<number | null>(null);

  const loadContents = useCallback(async () => {
    try {
      const data = await api.getIntelContents(sourceFilter === "ALL" ? undefined : sourceFilter);
      setContents(data);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [sourceFilter]);

  useEffect(() => { loadContents(); }, [loadContents]);

  // 분석 완료 → 이력 탭 이동 + 해당 항목 스크롤
  function handleGoToHistory(id: number) {
    setHighlightId(id);
    setSourceFilter("ALL");
    setPageTab("history");
    // DOM이 렌더링된 후 스크롤
    setTimeout(() => {
      const el = document.getElementById(`intel-item-${id}`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      // 3초 후 하이라이트 해제
      setTimeout(() => setHighlightId(null), 3000);
    }, 150);
  }

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div>
        <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">AI 인텔리전스 허브</h1>
        <p className="mt-0.5 text-xs text-neutral-400">YouTube→Gemini 문서 추출 · GPT 종목·매크로·섹터 분석</p>
      </div>

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
      {pageTab === "analyze" && <AnalyzePanel onDone={() => loadContents()} onGoToHistory={handleGoToHistory} />}

      {pageTab === "channels" && <ChannelPanel onAnalyzeDone={handleGoToHistory} />}

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
