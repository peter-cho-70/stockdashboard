"use client";

import { Fragment, useEffect, useState, useCallback, useMemo, useRef } from "react";
import { ArrowUpRight, ArrowDownRight, ChevronDown, ChevronUp, NotebookPen, AlertTriangle } from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  api,
  type JournalTradeItem,
  type JournalOptions,
  type JournalAnalysis,
  type JournalEntryUpdate,
  type JournalGroupStat,
  type StockChartBar,
} from "@/lib/api";
import { useRoutineStore, findStockPlan, type StockPlan } from "@/lib/routineStore";

const BIG_MOVE_THRESHOLD = 5; // % — 대시보드 급등락 알림 기준(ALERT_THRESHOLD)과 동일

function pctRaw(n: number) {
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

function addDaysToYmd(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + days);
  return formatYmd(d);
}

type SideFilter = "ALL" | "BUY" | "SELL";
type TabId = "list" | "analysis";

function fmt(n: number) {
  return Math.round(n).toLocaleString("ko-KR");
}

function pct(n: number | null | undefined, digits = 1) {
  if (n == null) return "—";
  return `${n >= 0 ? "+" : ""}${(n * 100).toFixed(digits)}%`;
}

function formatYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function monthsAgo(n: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return formatYmd(d);
}

function Badge({ children, tone }: { children: React.ReactNode; tone: "good" | "bad" | "warn" | "neutral" }) {
  const cls = {
    good: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
    bad: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
    warn: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
    neutral: "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400",
  }[tone];
  return <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap ${cls}`}>{children}</span>;
}

function stopDisciplineBadge(v: JournalTradeItem["stop_discipline"]) {
  if (!v) return null;
  if (v === "손절지연") return <Badge tone="bad">손절 지연</Badge>;
  if (v === "손절이행") return <Badge tone="good">손절 이행</Badge>;
  if (v === "미설정") return <Badge tone="neutral">손절가 미설정</Badge>;
  return <Badge tone="neutral">해당없음</Badge>;
}

function exitTimingBadge(v: JournalTradeItem["exit_timing"]) {
  if (!v) return null;
  if (v === "목표달성") return <Badge tone="good">목표 달성</Badge>;
  if (v === "조기익절") return <Badge tone="warn">조기 익절</Badge>;
  if (v === "미설정") return <Badge tone="neutral">목표가 미설정</Badge>;
  return <Badge tone="neutral">해당없음</Badge>;
}

function hasJournalData(t: JournalTradeItem): boolean {
  return Boolean(
    t.buy_reason || t.conviction || t.entry_emotion || t.target_price != null ||
    t.stop_price != null || t.sell_reason || t.note,
  );
}

// ─── 그날의 주가 흐름 — 체결일 전후 차트 + 큰 변동일 표시 ───
function TradeDayContext({ symbol, tradedAt }: { symbol: string; tradedAt: string }) {
  const [bars, setBars] = useState<StockChartBar[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const windowEnd = addDaysToYmd(tradedAt, 10); // 체결일 이후 흐름도 조금 보이도록 여유를 둠
    api
      .getStockChart(symbol, "1M", windowEnd)
      .then((res) => {
        if (cancelled) return;
        if (!res.data || res.data.length === 0) {
          setError("주가 데이터를 불러오지 못했습니다.");
        } else {
          setBars(res.data);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "주가 데이터를 불러오지 못했습니다.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [symbol, tradedAt]);

  const tradeDayBar = useMemo(() => bars?.find((b) => b.date === tradedAt) ?? null, [bars, tradedAt]);
  const bigMoveDays = useMemo(
    () => (bars ?? []).filter((b) => Math.abs(b.change_rate) >= BIG_MOVE_THRESHOLD),
    [bars],
  );

  const { min, max, pad } = useMemo(() => {
    if (!bars || bars.length === 0) return { min: 0, max: 0, pad: 0 };
    const closes = bars.map((b) => b.close);
    const mn = Math.min(...closes);
    const mx = Math.max(...closes);
    return { min: mn, max: mx, pad: (mx - mn) * 0.1 || mx * 0.01 };
  }, [bars]);

  if (loading) {
    return <p className="text-xs text-neutral-400">그날 주가 흐름 불러오는 중...</p>;
  }
  if (error || !bars) {
    return <p className="text-xs text-neutral-400">{error ?? "주가 데이터 없음"}</p>;
  }

  return (
    <div className="space-y-2 rounded-md border border-[var(--border-subtle)] bg-[var(--surface)] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-medium text-neutral-600 dark:text-neutral-300">
          {tradedAt} 전후 주가 흐름
        </span>
        {tradeDayBar && (
          <span
            className={`text-xs font-semibold tabular-nums ${
              tradeDayBar.change_rate >= 0 ? "text-red-600 dark:text-red-400" : "text-blue-600 dark:text-blue-400"
            }`}
          >
            그날 종가 {fmt(tradeDayBar.close)} ({pctRaw(tradeDayBar.change_rate)})
            {Math.abs(tradeDayBar.change_rate) >= BIG_MOVE_THRESHOLD && (
              <span className="ml-1 inline-flex items-center gap-0.5 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                <AlertTriangle size={10} />
                {tradeDayBar.change_rate >= 0 ? "당일 급등" : "당일 급락"}
              </span>
            )}
          </span>
        )}
      </div>

      <div className="h-[120px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={bars} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="tradeDayFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#6366f1" stopOpacity={0.25} />
                <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 9, fill: "#a3a3a3" }}
              tickFormatter={(v: string) => v.slice(5)}
              interval="preserveStartEnd"
              minTickGap={30}
            />
            <YAxis domain={[min - pad, max + pad]} hide />
            <Tooltip
              contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid var(--border-subtle)" }}
              formatter={(value, name, item) => [
                `${fmt(Number(value ?? 0))} (${pctRaw(item?.payload?.change_rate ?? 0)})`,
                "종가",
              ]}
            />
            <Area type="monotone" dataKey="close" stroke="#6366f1" strokeWidth={1.5} fill="url(#tradeDayFill)" dot={false} isAnimationActive={false} />
            {tradeDayBar && (
              <ReferenceDot x={tradeDayBar.date} y={tradeDayBar.close} r={4} fill="#f59e0b" stroke="#fff" strokeWidth={1.5} />
            )}
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {bigMoveDays.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] text-neutral-400">이 기간 중 ±{BIG_MOVE_THRESHOLD}% 이상 변동일:</span>
          {bigMoveDays.map((b) => (
            <span
              key={b.date}
              className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                b.date === tradedAt
                  ? "ring-1 ring-amber-500"
                  : ""
              } ${b.change_rate >= 0 ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300" : "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"}`}
            >
              {b.date.slice(5)} {pctRaw(b.change_rate)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── 체결 1건 편집 폼 (매수: 근거·확신도·감정·목표/손절가 / 매도: 사유·복기) ───
function JournalEditForm({
  trade,
  options,
  siblingBuys,
  onCancel,
  onSaved,
}: {
  trade: JournalTradeItem;
  options: JournalOptions;
  siblingBuys: JournalTradeItem[];
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<JournalEntryUpdate>({
    buy_reason: trade.buy_reason,
    conviction: trade.conviction,
    entry_emotion: trade.entry_emotion,
    target_price: trade.target_price,
    stop_price: trade.stop_price,
    sell_reason: trade.sell_reason,
    note: trade.note,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [planDismissed, setPlanDismissed] = useState(false);
  const [shareWithSiblings, setShareWithSiblings] = useState(false);
  const siblingsWithData = useMemo(() => siblingBuys.filter(hasJournalData), [siblingBuys]);

  const routineStore = useRoutineStore();
  const morningPlan: StockPlan | null = useMemo(
    () =>
      trade.side === "BUY"
        ? findStockPlan({ today: routineStore.today, archive: routineStore.archive }, trade.traded_at, trade.symbol)
        : null,
    [routineStore.today, routineStore.archive, trade.side, trade.traded_at, trade.symbol],
  );
  const planAlreadyApplied =
    morningPlan != null &&
    draft.target_price === morningPlan.targetPrice &&
    draft.stop_price === morningPlan.stopLossPrice;
  const showPlanBanner = morningPlan != null && !planDismissed && !planAlreadyApplied;

  function applyMorningPlan() {
    if (!morningPlan) return;
    setDraft((d) => ({
      ...d,
      target_price: morningPlan.targetPrice ?? d.target_price,
      stop_price: morningPlan.stopLossPrice ?? d.stop_price,
    }));
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await api.updateTradeJournalEntry(trade.id, draft);
      if (shareWithSiblings && siblingBuys.length > 0) {
        // 매수 관련 필드만 공유 — 매도사유/복기 메모는 매수 체결에 의미가 없으므로 제외
        const sharedFields: JournalEntryUpdate = {
          buy_reason: draft.buy_reason,
          conviction: draft.conviction,
          entry_emotion: draft.entry_emotion,
          target_price: draft.target_price,
          stop_price: draft.stop_price,
        };
        await Promise.all(siblingBuys.map((s) => api.updateTradeJournalEntry(s.id, sharedFields)));
      }
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장 실패");
    } finally {
      setSaving(false);
    }
  }

  const inputCls =
    "rounded-md border border-[var(--border-subtle)] bg-[var(--background)] px-2 py-1 text-xs focus:outline-none";

  return (
    <div className="space-y-3 bg-[var(--surface-elevated)] p-4">
      <TradeDayContext symbol={trade.symbol} tradedAt={trade.traded_at} />
      {showPlanBanner && morningPlan && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs dark:border-blue-900 dark:bg-blue-950/30">
          <span className="text-blue-800 dark:text-blue-300">
            📋 {trade.traded_at} 아침 계획과 일치 — 목표가 {morningPlan.targetPrice != null ? fmt(morningPlan.targetPrice) : "미설정"} · 손절가{" "}
            {morningPlan.stopLossPrice != null ? fmt(morningPlan.stopLossPrice) : "미설정"}
            {morningPlan.entryCondition && <span className="text-blue-600 dark:text-blue-400"> ({morningPlan.entryCondition})</span>}
            을(를) 이것으로 채울까요?
          </span>
          <div className="flex shrink-0 gap-1.5">
            <button
              type="button"
              onClick={applyMorningPlan}
              className="rounded bg-blue-600 px-2.5 py-1 font-medium text-white hover:bg-blue-700"
            >
              예, 가져오기
            </button>
            <button
              type="button"
              onClick={() => setPlanDismissed(true)}
              className="rounded border border-blue-300 px-2.5 py-1 text-blue-700 hover:bg-blue-100 dark:border-blue-800 dark:text-blue-300 dark:hover:bg-blue-900/40"
            >
              아니오, 직접 입력
            </button>
          </div>
        </div>
      )}
      {trade.side === "BUY" ? (
        <div className="flex flex-wrap gap-4">
          <label className="flex flex-col gap-1 text-xs text-neutral-500">
            매수사유
            <select
              value={draft.buy_reason ?? ""}
              onChange={(e) => setDraft((d) => ({ ...d, buy_reason: e.target.value || null }))}
              className={inputCls}
            >
              <option value="">선택 안함</option>
              {options.buy_reasons.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </label>
          <div className="flex flex-col gap-1 text-xs text-neutral-500">
            확신도 (1=충동 · 5=강한 확신)
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setDraft((d) => ({ ...d, conviction: v }))}
                  className={`h-7 w-7 rounded-md text-xs font-medium ${
                    draft.conviction === v
                      ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                      : "border border-[var(--border-subtle)] text-neutral-500"
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>
          <label className="flex flex-col gap-1 text-xs text-neutral-500">
            진입감정
            <select
              value={draft.entry_emotion ?? ""}
              onChange={(e) => setDraft((d) => ({ ...d, entry_emotion: e.target.value || null }))}
              className={inputCls}
            >
              <option value="">선택 안함</option>
              {options.entry_emotions.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-neutral-500">
            목표가 (익절 계획)
            <input
              type="number"
              value={draft.target_price ?? ""}
              onChange={(e) => setDraft((d) => ({ ...d, target_price: e.target.value ? Number(e.target.value) : null }))}
              className={`${inputCls} w-28`}
              placeholder="사기 전에 정하세요"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-neutral-500">
            손절가 (계획)
            <input
              type="number"
              value={draft.stop_price ?? ""}
              onChange={(e) => setDraft((d) => ({ ...d, stop_price: e.target.value ? Number(e.target.value) : null }))}
              className={`${inputCls} w-28`}
              placeholder="사기 전에 정하세요"
            />
          </label>
          {siblingBuys.length > 0 && (
            <label className="flex w-full items-start gap-2 rounded-md border border-dashed border-[var(--border-subtle)] bg-[var(--surface)] px-3 py-2 text-xs text-neutral-500">
              <input
                type="checkbox"
                checked={shareWithSiblings}
                onChange={(e) => setShareWithSiblings(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                같은 날 매수한 {trade.name} 다른 체결 {siblingBuys.length}건에도 위 매수사유·확신도·진입감정·목표가·손절가를 동일하게 적용
                <span className="mt-0.5 block text-[10px] text-neutral-400">
                  {siblingBuys.map((s) => `${s.qty.toLocaleString()}주 @ ${fmt(s.price)}원`).join(" · ")}
                </span>
                {shareWithSiblings && siblingsWithData.length > 0 && (
                  <span className="mt-0.5 block text-[10px] font-medium text-amber-600 dark:text-amber-400">
                    ⚠ 이 중 {siblingsWithData.length}건은 이미 기록이 있어 지금 입력한 내용으로 덮어씁니다.
                  </span>
                )}
              </span>
            </label>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-neutral-500">
            {trade.matched_buy_date && (
              <span>매수일 <strong className="text-neutral-800 dark:text-neutral-200">{trade.matched_buy_date}</strong> (보유 {trade.holding_days}일)</span>
            )}
            <span>계획 목표가 <strong className="text-neutral-800 dark:text-neutral-200">{trade.plan_target_price != null ? fmt(trade.plan_target_price) : "미설정"}</strong></span>
            <span>계획 손절가 <strong className="text-neutral-800 dark:text-neutral-200">{trade.plan_stop_price != null ? fmt(trade.plan_stop_price) : "미설정"}</strong></span>
            {stopDisciplineBadge(trade.stop_discipline)}
            {exitTimingBadge(trade.exit_timing)}
          </div>
          <div className="flex flex-wrap gap-4">
            <label className="flex flex-col gap-1 text-xs text-neutral-500">
              매도사유
              <select
                value={draft.sell_reason ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, sell_reason: e.target.value || null }))}
                className={inputCls}
              >
                <option value="">선택 안함</option>
                {options.sell_reasons.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-1 min-w-[220px] flex-col gap-1 text-xs text-neutral-500">
              복기 메모
              <textarea
                value={draft.note ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value || null }))}
                rows={2}
                className={`${inputCls} w-full resize-none`}
                placeholder="이 거래에서 배운 점, 다음에 다르게 할 것"
              />
            </label>
          </div>
        </div>
      )}

      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}

      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-md px-3 py-1.5 text-xs text-neutral-500 hover:bg-[var(--surface)]">
          취소
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
        >
          {saving ? "저장 중..." : "저장"}
        </button>
      </div>
    </div>
  );
}

function StatTile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "good" | "bad" }) {
  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] p-3">
      <p className="text-xs text-neutral-400">{label}</p>
      <p className={`mt-1 text-lg font-semibold ${tone === "good" ? "text-red-600 dark:text-red-400" : tone === "bad" ? "text-blue-600 dark:text-blue-400" : "text-neutral-900 dark:text-neutral-100"}`}>
        {value}
      </p>
      {sub && <p className="text-[11px] text-neutral-400">{sub}</p>}
    </div>
  );
}

function GroupBreakdown({ title, rows }: { title: string; rows: JournalGroupStat[] }) {
  const maxAbs = Math.max(0.01, ...rows.map((r) => Math.abs(r.avg_return ?? 0)));
  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] p-4">
      <h3 className="mb-3 text-sm font-semibold text-neutral-900 dark:text-neutral-100">{title}</h3>
      <div className="space-y-2">
        {rows.map((r) => (
          <div key={String(r.key)} className="flex items-center gap-3 text-xs">
            <span className="w-24 shrink-0 truncate text-neutral-500">{r.key ?? "—"}</span>
            {r.count === 0 ? (
              <span className="text-neutral-400">기록 없음</span>
            ) : (
              <>
                <div className="relative h-4 flex-1 rounded bg-[var(--surface-elevated)]">
                  <div
                    className={`absolute inset-y-0 rounded ${(r.avg_return ?? 0) >= 0 ? "left-1/2 bg-red-400/70" : "right-1/2 bg-blue-400/70"}`}
                    style={{ width: `${(Math.abs(r.avg_return ?? 0) / maxAbs / 2) * 100}%` }}
                  />
                </div>
                <span className="w-16 shrink-0 text-right tabular-nums text-neutral-600 dark:text-neutral-300">
                  {pct(r.avg_return)}
                </span>
                <span className="w-14 shrink-0 text-right text-neutral-400">{r.count}건</span>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function AnalysisTab({ start, end }: { start: string; end: string }) {
  const [analysis, setAnalysis] = useState<JournalAnalysis | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.getTradeJournalAnalysis({ start: start || undefined, end: end || undefined })
      .then(setAnalysis)
      .catch(() => setAnalysis(null))
      .finally(() => setLoading(false));
  }, [start, end]);

  if (loading) return <div className="py-16 text-center text-sm text-neutral-400">불러오는 중...</div>;
  if (!analysis || analysis.total_count === 0) {
    return (
      <div className="rounded-lg border border-dashed border-[var(--border-subtle)] py-16 text-center text-sm text-neutral-400">
        완결된 매매(매수→매도)에 기록이 없습니다. 매도 체결에 목표가·손절가가 설정된 매수 기록이 있어야 지표가 계산됩니다.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="완결 매매" value={`${analysis.total_count}건`} sub={`승 ${analysis.win_count} / 패 ${analysis.loss_count}`} />
        <StatTile label="승률" value={pct(analysis.win_rate, 0)} tone={analysis.win_rate != null && analysis.win_rate >= 0.5 ? "good" : "bad"} />
        <StatTile label="손익비 (평균이익÷평균손실)" value={analysis.profit_loss_ratio != null ? analysis.profit_loss_ratio.toFixed(2) : "—"} sub="1보다 크게 유지가 목표" tone={analysis.profit_loss_ratio != null && analysis.profit_loss_ratio >= 1 ? "good" : "bad"} />
        <StatTile label="평균 수익률 (전체)" value={pct(analysis.avg_return_all)} />
        <StatTile
          label="손절 지연 비율"
          value={pct(analysis.stop.delayed_rate, 0)}
          sub={`손절가 설정 ${analysis.stop.set_count}건 중 지연 ${analysis.stop.delayed_count}건`}
          tone={analysis.stop.delayed_rate != null && analysis.stop.delayed_rate > 0.2 ? "bad" : "good"}
        />
        <StatTile
          label="조기 익절 비율"
          value={pct(analysis.exit.early_exit_rate, 0)}
          sub={`목표달성 ${analysis.exit.target_hit_count}건 · 조기익절 ${analysis.exit.early_exit_count}건`}
        />
        <StatTile
          label="평균 보유일 (이긴 거래)"
          value={analysis.holding.avg_days_win != null ? `${Math.round(analysis.holding.avg_days_win)}일` : "—"}
        />
        <StatTile
          label="평균 보유일 (진 거래)"
          value={analysis.holding.avg_days_loss != null ? `${Math.round(analysis.holding.avg_days_loss)}일` : "—"}
          sub={
            analysis.holding.avg_days_win != null && analysis.holding.avg_days_loss != null && analysis.holding.avg_days_loss > analysis.holding.avg_days_win
              ? "진 거래를 더 오래 들고 있음 — 나쁜 패턴"
              : undefined
          }
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <GroupBreakdown title="감정 상태별 평균 수익률" rows={analysis.by_emotion} />
        <GroupBreakdown title="매수 사유별 평균 수익률" rows={analysis.by_buy_reason} />
        <GroupBreakdown title="확신도별 평균 수익률" rows={analysis.by_conviction} />
      </div>
    </div>
  );
}

export default function TradeJournalPage() {
  const [tab, setTab] = useState<TabId>("list");
  const [trades, setTrades] = useState<JournalTradeItem[]>([]);
  const [options, setOptions] = useState<JournalOptions>({ buy_reasons: [], entry_emotions: [], sell_reasons: [] });
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [side, setSide] = useState<SideFilter>("ALL");
  const [symbol, setSymbol] = useState("");
  const [start, setStart] = useState(() => monthsAgo(3));
  const [end, setEnd] = useState(() => formatYmd(new Date()));
  const [onlyAnnotated, setOnlyAnnotated] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const routineStore = useRoutineStore();
  const hasLoadedOnceRef = useRef(false);

  const load = useCallback(async () => {
    // 최초 로드 때만 전체를 "불러오는 중..."으로 바꾼다 — 저장 후 재조회처럼
    // 이미 목록이 떠 있는 상태에서 다시 부르면 화면이 통째로 접혔다 펴지면서
    // 스크롤이 맨 위로 튀는 문제가 있었다. 갱신 중에도 기존 목록을 그대로 보여주고
    // 데이터만 조용히 교체한다.
    if (!hasLoadedOnceRef.current) setLoading(true);
    setError(null);
    try {
      const res = await api.getTradeJournal({
        side: side === "ALL" ? undefined : side,
        symbol: symbol.trim() || undefined,
        start: start || undefined,
        end: end || undefined,
        only_annotated: onlyAnnotated || undefined,
        limit: 1000,
      });
      setTrades(res.trades);
      setTotal(res.total);
      setOptions(res.options);
    } catch (e) {
      setError(e instanceof Error ? e.message : "매매일지를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
      hasLoadedOnceRef.current = true;
    }
  }, [side, symbol, start, end, onlyAnnotated]);

  useEffect(() => {
    load();
  }, [load]);

  const annotatedCount = useMemo(() => trades.filter(hasJournalData).length, [trades]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">매매습관</h1>
        <p className="mt-0.5 text-xs text-neutral-400">
          매매 직후 매수 근거·확신도·감정·목표가·손절가를 기록하면, 손절 준수율·익절 타이밍·감정별 승률을 자동으로 계산합니다.
          아침 루틴(매매 일지)에서 세운 종목별 계획이 있으면 목표가·손절가를 자동으로 제안합니다.
        </p>
      </div>

      <div className="flex gap-1 rounded-md bg-[var(--surface-elevated)] p-1 text-xs w-fit">
        <button
          type="button"
          onClick={() => setTab("list")}
          className={`rounded px-3 py-1.5 font-medium ${tab === "list" ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900" : "text-neutral-500"}`}
        >
          매매일지
        </button>
        <button
          type="button"
          onClick={() => setTab("analysis")}
          className={`rounded px-3 py-1.5 font-medium ${tab === "analysis" ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900" : "text-neutral-500"}`}
        >
          습관 분석
        </button>
      </div>

      {/* 필터 (두 탭 공통) */}
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] p-3">
        <label className="flex flex-col gap-1 text-xs text-neutral-500">
          시작일
          <input type="date" value={start} max={end || undefined} onChange={(e) => setStart(e.target.value)} className="rounded-md border border-[var(--border-subtle)] bg-[var(--background)] px-2 py-1 text-xs focus:outline-none" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-neutral-500">
          종료일
          <input type="date" value={end} min={start || undefined} onChange={(e) => setEnd(e.target.value)} className="rounded-md border border-[var(--border-subtle)] bg-[var(--background)] px-2 py-1 text-xs focus:outline-none" />
        </label>
        <button type="button" onClick={() => { setStart(""); setEnd(""); }} className="rounded-md px-2.5 py-1.5 text-xs text-neutral-500 hover:bg-[var(--surface-elevated)]">
          전체 기간
        </button>
        {tab === "list" && (
          <>
            <div className="flex gap-1 rounded-md bg-[var(--surface-elevated)] p-1 text-xs">
              {(["ALL", "BUY", "SELL"] as const).map((s) => (
                <button key={s} type="button" onClick={() => setSide(s)} className={`rounded px-2.5 py-1 font-medium ${side === s ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900" : "text-neutral-500"}`}>
                  {s === "ALL" ? "전체" : s === "BUY" ? "매수" : "매도"}
                </button>
              ))}
            </div>
            <label className="flex flex-col gap-1 text-xs text-neutral-500">
              종목코드
              <input value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder="예: 005930" className="w-28 rounded-md border border-[var(--border-subtle)] bg-[var(--background)] px-2 py-1 text-xs focus:outline-none" />
            </label>
            <label className="flex items-center gap-1.5 pb-1.5 text-xs text-neutral-500">
              <input type="checkbox" checked={onlyAnnotated} onChange={(e) => setOnlyAnnotated(e.target.checked)} />
              기록 있는 것만
            </label>
          </>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-400">
          {error}
        </div>
      )}

      {tab === "analysis" ? (
        <AnalysisTab start={start} end={end} />
      ) : loading ? (
        <div className="py-16 text-center text-sm text-neutral-400">불러오는 중...</div>
      ) : trades.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[var(--border-subtle)] py-16 text-center text-sm text-neutral-400">
          조건에 맞는 체결내역이 없습니다.
        </div>
      ) : (
        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-subtle)] p-3">
            <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
              체결내역 {trades.length}건
              {total > trades.length && <span className="ml-2 text-xs font-normal text-neutral-400">(전체 {total}건 중)</span>}
            </h2>
            <span className="text-xs text-neutral-400">기록 있음 {annotatedCount}건 / {trades.length}건</span>
          </div>
          <div className="max-h-[640px] overflow-y-auto overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0">
                <tr className="border-b border-[var(--border-subtle)] bg-[var(--surface-elevated)] text-xs text-neutral-500">
                  <th className="px-4 py-2 text-left font-medium">날짜</th>
                  <th className="px-4 py-2 text-left font-medium">종목</th>
                  <th className="px-4 py-2 text-center font-medium">구분</th>
                  <th className="px-4 py-2 text-right font-medium">수량</th>
                  <th className="px-4 py-2 text-right font-medium">단가</th>
                  <th className="px-4 py-2 text-right font-medium">실현손익</th>
                  <th className="px-4 py-2 text-left font-medium">기록</th>
                  <th className="px-4 py-2 text-center font-medium"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)]">
                {trades.map((t) => (
                  <Fragment key={t.id}>
                    <tr
                      id={`journal-row-${t.id}`}
                      onClick={() => setExpandedId(expandedId === t.id ? null : t.id)}
                      className="cursor-pointer hover:bg-[var(--surface-elevated)]"
                    >
                      <td className="px-4 py-2 text-neutral-600 dark:text-neutral-300">{t.traded_at}</td>
                      <td className="px-4 py-2">
                        <span className="font-medium text-neutral-900 dark:text-neutral-100">{t.name}</span>
                        <span className="ml-1 text-xs text-neutral-400">{t.symbol}</span>
                      </td>
                      <td className="px-4 py-2 text-center whitespace-nowrap">
                        {t.side === "BUY" ? (
                          <span className="inline-flex items-center gap-0.5 text-red-600 dark:text-red-400"><ArrowUpRight size={12} />매수</span>
                        ) : (
                          <span className="inline-flex items-center gap-0.5 text-blue-600 dark:text-blue-400"><ArrowDownRight size={12} />매도</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right text-neutral-700 dark:text-neutral-300 tabular-nums">{t.qty.toLocaleString()}</td>
                      <td className="px-4 py-2 text-right text-neutral-700 dark:text-neutral-300 tabular-nums">{fmt(t.price)}</td>
                      <td className="px-4 py-2 text-right">
                        {t.side === "SELL" && t.realized_pnl != null ? (
                          <span className={t.realized_pnl >= 0 ? "text-red-600 dark:text-red-400" : "text-blue-600 dark:text-blue-400"}>
                            {t.realized_pnl >= 0 ? "+" : ""}{fmt(t.realized_pnl)}
                            <span className="ml-1 text-[10px] text-neutral-400">({pct(t.return_pct)})</span>
                          </span>
                        ) : (
                          <span className="text-neutral-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-xs">
                        <div className="flex flex-wrap items-center gap-1">
                          {t.side === "BUY" &&
                            findStockPlan({ today: routineStore.today, archive: routineStore.archive }, t.traded_at, t.symbol) && (
                              <Badge tone="good">📋 아침 계획</Badge>
                            )}
                          {t.side === "BUY" && t.buy_reason && <Badge tone="neutral">{t.buy_reason}</Badge>}
                          {t.side === "BUY" && t.entry_emotion && <Badge tone="neutral">{t.entry_emotion}</Badge>}
                          {t.side === "SELL" && stopDisciplineBadge(t.stop_discipline)}
                          {t.side === "SELL" && exitTimingBadge(t.exit_timing)}
                          {!hasJournalData(t) && <span className="text-neutral-300 dark:text-neutral-600">기록 없음</span>}
                        </div>
                      </td>
                      <td className="px-4 py-2 text-center text-neutral-400">
                        {expandedId === t.id ? <ChevronUp size={14} /> : hasJournalData(t) ? <NotebookPen size={14} /> : <ChevronDown size={14} />}
                      </td>
                    </tr>
                    {expandedId === t.id && (
                      <tr>
                        <td colSpan={8} className="p-0">
                          <JournalEditForm
                            trade={t}
                            options={options}
                            siblingBuys={
                              t.side === "BUY"
                                ? trades.filter(
                                    (o) => o.id !== t.id && o.side === "BUY" && o.symbol === t.symbol && o.traded_at === t.traded_at,
                                  )
                                : []
                            }
                            onCancel={() => setExpandedId(null)}
                            onSaved={() => {
                              // 저장하면 이 행의 펼침 폼이 접히면서 아래 내용이 위로 당겨진다 —
                              // 단순히 스크롤 위치(px)만 복원하면 엉뚱한 행이 그 자리에 오므로,
                              // "이 행이 화면의 몇 px 위치에 있었는지"를 기준으로 다시 맞춘다.
                              const rowEl = document.getElementById(`journal-row-${t.id}`);
                              const prevTop = rowEl?.getBoundingClientRect().top ?? null;
                              setExpandedId(null);
                              load().then(() => {
                                requestAnimationFrame(() => {
                                  if (prevTop == null) return;
                                  const newRowEl = document.getElementById(`journal-row-${t.id}`);
                                  if (!newRowEl) return;
                                  const newTop = newRowEl.getBoundingClientRect().top;
                                  window.scrollBy(0, newTop - prevTop);
                                });
                              });
                            }}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
