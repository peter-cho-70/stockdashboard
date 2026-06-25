"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Loader2, Sparkles, RefreshCw, PieChart, Video, StickyNote, Check, X, Star } from "lucide-react";
import { etfApi, type EtfHoldingsResponse, type EtfYoutubeInsight } from "@/lib/api";
import { krChangeClass } from "@/lib/krMarketColors";

function fmtPrice(n: number | null): string {
  return n != null ? n.toLocaleString("ko-KR") : "—";
}

function fmtPercent(n: number | null | undefined): string {
  if (n == null) return "—";
  return `${n > 0 ? "+" : ""}${n.toFixed(2)}%`;
}

function fmtDate(s: string | null): string {
  if (!s) return "";
  try {
    return new Date(s).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" });
  } catch {
    return "";
  }
}

function sentimentLabel(s: string | null | undefined): { text: string; cls: string } {
  if (s === "POSITIVE") return { text: "긍정", cls: "text-red-600 dark:text-red-400" };
  if (s === "NEGATIVE") return { text: "부정", cls: "text-blue-600 dark:text-blue-400" };
  if (s === "NEUTRAL") return { text: "중립", cls: "text-neutral-400" };
  return { text: "—", cls: "text-neutral-400" };
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mb-2 flex items-center gap-1.5 rounded-md border border-[var(--border-subtle)] px-3 py-1.5 text-sm font-medium text-neutral-600 transition-colors hover:border-violet-300 hover:text-violet-600 dark:text-neutral-400 dark:hover:border-violet-700 dark:hover:text-violet-400"
    >
      <ArrowLeft size={15} />
      뒤로가기
    </button>
  );
}

function InsightCard({ insight: v }: { insight: EtfYoutubeInsight }) {
  const s = sentimentLabel(v.matched_sentiment);
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--surface)] p-3 space-y-1.5">
      <div className="flex items-center gap-1.5 text-[11px] text-neutral-400">
        <span className="font-medium text-neutral-500">{v.channel_name}</span>
        <span
          className={`rounded-full px-1.5 py-0.5 text-[10px] ${
            v.source === "etf_channel"
              ? "bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400"
              : "bg-violet-50 text-violet-600 dark:bg-violet-900/20 dark:text-violet-400"
          }`}
        >
          {v.source === "etf_channel" ? "ETF 채널" : "AI 분석"}
        </span>
        <span className="ml-auto">{fmtDate(v.published_at)}</span>
      </div>
      <a
        href={v.url}
        target="_blank"
        rel="noopener noreferrer"
        className="block text-sm font-medium text-neutral-800 hover:text-red-600 dark:text-neutral-200 dark:hover:text-red-400 line-clamp-2"
      >
        {v.title}
      </a>
      <p className={`text-xs font-medium ${s.cls}`}>
        이 ETF에 대한 언급: {s.text}
        {v.matched_reason ? ` — ${v.matched_reason}` : ""}
      </p>
      {v.summary && (
        <div className="space-y-1">
          <p className={`text-xs text-neutral-500 ${expanded ? "" : "line-clamp-2"}`}>{v.summary}</p>
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            className="text-[10px] font-medium text-violet-600 hover:underline dark:text-violet-400"
          >
            {expanded ? "접기" : "전체 분석 보기"}
          </button>
        </div>
      )}
    </div>
  );
}

export default function EtfDetailPage() {
  const params = useParams<{ code: string }>();
  const router = useRouter();
  const code = params.code;

  const [data, setData] = useState<EtfHoldingsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [outlook, setOutlook] = useState<string | null>(null);
  const [outlookDate, setOutlookDate] = useState<string | null>(null);
  const [outlookLoading, setOutlookLoading] = useState(false);
  const [outlookError, setOutlookError] = useState("");

  const [insights, setInsights] = useState<EtfYoutubeInsight[]>([]);
  const [insightsLoading, setInsightsLoading] = useState(true);

  const [memo, setMemo] = useState("");
  const [memoEditing, setMemoEditing] = useState(false);
  const [memoDraft, setMemoDraft] = useState("");
  const [memoSaving, setMemoSaving] = useState(false);

  const [isFavorite, setIsFavorite] = useState(false);

  const load = useCallback(async () => {
    if (!code) return;
    setLoading(true);
    setError(null);
    try {
      const res = await etfApi.getHoldings(code);
      setData(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "ETF 정보를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [code]);

  const loadInsights = useCallback(async () => {
    if (!code) return;
    setInsightsLoading(true);
    try {
      const res = await etfApi.getYoutubeInsights(code);
      setInsights(res.insights);
    } catch {
      /* ignore */
    } finally {
      setInsightsLoading(false);
    }
  }, [code]);

  useEffect(() => {
    load();
    loadInsights();
    etfApi.getMemo(code).then((r) => setMemo(r.memo)).catch(() => {});
    etfApi.getFavorites().then((r) => setIsFavorite(r.codes.includes(code))).catch(() => {});
  }, [load, loadInsights, code]);

  async function handleToggleFavorite() {
    const res = await etfApi.toggleFavorite(code, data?.name ?? undefined).catch(() => null);
    if (res) setIsFavorite(res.favorited);
  }

  async function saveMemo() {
    setMemoSaving(true);
    try {
      await etfApi.setMemo(code, memoDraft);
      setMemo(memoDraft);
      setMemoEditing(false);
    } finally {
      setMemoSaving(false);
    }
  }

  async function loadOutlook(force: boolean) {
    if (!code) return;
    setOutlookLoading(true);
    setOutlookError("");
    try {
      const res = await etfApi.getOutlook(code, force);
      if (res.error) {
        setOutlookError(res.error);
      } else {
        setOutlook(res.outlook);
        setOutlookDate(res.report_date);
      }
    } catch (e) {
      setOutlookError(e instanceof Error ? e.message : "AI 전망을 불러오지 못했습니다.");
    } finally {
      setOutlookLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-20 text-sm text-neutral-400">
        <Loader2 size={16} className="animate-spin" /> 불러오는 중...
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="space-y-3">
        <BackButton onClick={() => router.back()} />
        <p className="text-sm text-red-500">{error ?? "ETF를 찾을 수 없습니다."}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <BackButton onClick={() => router.back()} />
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">
            {data.name ?? code}
          </h1>
          <span className="text-xs text-neutral-400">{code}</span>
          <button
            type="button"
            onClick={handleToggleFavorite}
            title={isFavorite ? "즐겨찾기 해제" : "즐겨찾기 추가"}
            className="rounded-md p-1 transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            <Star
              size={18}
              className={isFavorite ? "fill-amber-400 text-amber-400" : "text-neutral-300 dark:text-neutral-600"}
            />
          </button>
        </div>
        <div className="mt-1 flex items-center gap-2">
          <span className="text-lg font-semibold tabular-nums text-neutral-800 dark:text-neutral-200">
            {fmtPrice(data.current_price)}
          </span>
          <span className={`text-sm tabular-nums ${krChangeClass(data.change_rate ?? 0)}`}>
            {fmtPercent(data.change_rate)}
          </span>
        </div>
      </div>

      {/* 메모 */}
      <section className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] p-4 space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <StickyNote size={15} className="text-amber-500" />
            <h2 className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">메모</h2>
          </div>
          {!memoEditing && (
            <button
              type="button"
              onClick={() => { setMemoDraft(memo); setMemoEditing(true); }}
              className="text-xs text-neutral-400 hover:text-violet-600 dark:hover:text-violet-400"
            >
              {memo ? "수정" : "작성"}
            </button>
          )}
        </div>

        {memoEditing ? (
          <div className="space-y-2">
            <textarea
              value={memoDraft}
              onChange={(e) => setMemoDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Escape") setMemoEditing(false); }}
              rows={4}
              autoFocus
              placeholder="이 ETF에 대한 메모를 남겨보세요..."
              className="w-full resize-none rounded-md border border-violet-400 bg-[var(--background)] p-2.5 text-sm leading-relaxed focus:outline-none focus:ring-1 focus:ring-violet-400"
            />
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={saveMemo}
                disabled={memoSaving}
                className="flex items-center gap-1.5 rounded-md bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-700 disabled:opacity-50"
              >
                {memoSaving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                저장
              </button>
              <button
                type="button"
                onClick={() => setMemoEditing(false)}
                className="flex items-center gap-1.5 rounded-md border border-[var(--border-subtle)] px-3 py-1.5 text-xs font-medium text-neutral-600 hover:bg-[var(--surface-elevated)] dark:text-neutral-400"
              >
                <X size={12} /> 취소
              </button>
            </div>
          </div>
        ) : memo ? (
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-neutral-700 dark:text-neutral-300">
            {memo}
          </p>
        ) : (
          <p className="text-xs text-neutral-400">
            작성 버튼을 눌러 이 ETF에 대한 메모를 남겨보세요.
          </p>
        )}
      </section>

      {/* AI 전망 */}
      <section className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Sparkles size={15} className="text-violet-500" />
            <h2 className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">AI 전망</h2>
            {outlookDate && <span className="text-[10px] text-neutral-400">{outlookDate}</span>}
          </div>
          <button
            type="button"
            onClick={() => loadOutlook(outlook != null)}
            disabled={outlookLoading}
            className="flex items-center gap-1.5 rounded-md border border-[var(--border-subtle)] px-2.5 py-1 text-xs font-medium hover:bg-[var(--surface-elevated)] disabled:opacity-50"
          >
            {outlookLoading ? (
              <Loader2 size={12} className="animate-spin" />
            ) : outlook != null ? (
              <RefreshCw size={12} />
            ) : (
              <Sparkles size={12} />
            )}
            {outlook != null ? "다시 생성" : "전망 생성"}
          </button>
        </div>
        {outlookError && <p className="text-xs text-red-500">{outlookError}</p>}
        {outlook ? (
          <p className="whitespace-pre-line text-sm leading-relaxed text-neutral-700 dark:text-neutral-300">
            {outlook}
          </p>
        ) : (
          !outlookLoading && (
            <p className="text-xs text-neutral-400">
              버튼을 눌러 이 ETF의 구성종목·수익률 기반 AI 전망을 생성하세요.
            </p>
          )
        )}
      </section>

      <section className="space-y-2">
        <div className="flex items-center gap-2">
          <Video size={15} className="text-red-500" />
          <h2 className="text-sm font-semibold text-neutral-600 dark:text-neutral-400">유튜브 분석</h2>
        </div>
        {insightsLoading ? (
          <div className="flex items-center gap-2 py-4 text-sm text-neutral-400">
            <Loader2 size={14} className="animate-spin" /> 불러오는 중...
          </div>
        ) : insights.length === 0 ? (
          <p className="text-xs text-neutral-400">
            등록된 ETF 분석 채널에서 이 ETF를 언급한 영상이 아직 없습니다.
          </p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {insights.map((v) => (
              <InsightCard key={v.id} insight={v} />
            ))}
          </div>
        )}
      </section>

      <section className="space-y-2">
        <div className="flex items-center gap-2">
          <PieChart size={15} className="text-sky-500" />
          <h2 className="text-sm font-semibold text-neutral-600 dark:text-neutral-400">
            구성종목{data.total_count != null ? ` (${data.total_count}종목)` : ""}
          </h2>
        </div>
        {data.holdings.length === 0 ? (
          <p className="text-xs text-neutral-400">구성종목 정보를 찾을 수 없습니다.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-[var(--border-subtle)]">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border-subtle)] bg-[var(--surface-elevated)] text-left text-xs text-neutral-400">
                  <th className="px-3 py-2 font-medium">종목명</th>
                  <th className="px-3 py-2 text-right font-medium">비중</th>
                </tr>
              </thead>
              <tbody>
                {data.holdings.map((h, i) => (
                  <tr
                    key={`${h.symbol ?? h.name}-${i}`}
                    onClick={() => h.symbol && router.push(`/chart?symbol=${h.symbol}`)}
                    className={`border-b border-[var(--border-subtle)] last:border-0 ${
                      h.symbol ? "cursor-pointer hover:bg-[var(--surface-elevated)]" : ""
                    }`}
                  >
                    <td className="px-3 py-2 font-medium text-neutral-800 dark:text-neutral-200">
                      {h.name ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-neutral-700 dark:text-neutral-300">
                      {h.weight != null ? `${h.weight.toFixed(2)}%` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
