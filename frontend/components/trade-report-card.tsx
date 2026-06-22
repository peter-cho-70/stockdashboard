"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Loader2, RefreshCw, Ship } from "lucide-react";
import { marketApi, type TradeMonthlyReport } from "@/lib/api";

/** 조회·표시 가능한 최대 기간 (개월) */
const TRADE_VIEW_MONTHS = 12;

function lastMonths(count: number): string[] {
  const out: string[] = [];
  const d = new Date();
  d.setDate(1);
  for (let i = 0; i < count; i++) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    out.push(`${y}-${m}`);
    d.setMonth(d.getMonth() - 1);
  }
  return out;
}

function defaultMonth(): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return d.toISOString().slice(0, 7);
}

function rowTradeValues(r: Record<string, unknown>) {
  const exp = r.수출액 ?? r.expAmt ?? r.expDlr ?? r.export;
  const imp = r.수입액 ?? r.impAmt ?? r.impDlr ?? r.import;
  const bal = r.무역수지 ?? r.balAmt ?? r.balDlr ?? r.balance ?? Number(exp) - Number(imp);
  return { exp, imp, bal };
}

function isReportViewable(r: TradeMonthlyReport | null | undefined): boolean {
  return !!r && (r.status === "ready" || r.status === "partial");
}

function fmtAmt(n: unknown): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  if (Math.abs(v) >= 1e8) return `${(v / 1e8).toFixed(1)}억$`;
  if (Math.abs(v) >= 1e4) return `${(v / 1e4).toFixed(0)}만$`;
  return v.toLocaleString("ko-KR");
}

function SummaryTable({ rows }: { rows: Record<string, unknown>[] }) {
  if (!rows.length) return <p className="text-xs text-neutral-400">총괄 데이터 없음</p>;
  const recent = [...rows].reverse().slice(0, TRADE_VIEW_MONTHS);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[11px]">
        <thead>
          <tr className="text-neutral-400 border-b border-[var(--border-subtle)]">
            <th className="text-left py-1 pr-2">월</th>
            <th className="text-right py-1">수출</th>
            <th className="text-right py-1">수입</th>
            <th className="text-right py-1">수지</th>
          </tr>
        </thead>
        <tbody>
          {recent.map((r, i) => {
            const ym = String(r.yyyymm ?? `${r.year}${String(r.month).padStart(2, "0")}`);
            const label = ym.length >= 6 ? `${ym.slice(0, 4)}.${ym.slice(4, 6)}` : ym;
            const { exp, imp, bal } = rowTradeValues(r);
            return (
              <tr key={i} className="border-b border-[var(--border-subtle)]/50">
                <td className="py-1.5 pr-2 text-neutral-600 dark:text-neutral-400">{label}</td>
                <td className="text-right tabular-nums">{fmtAmt(exp)}</td>
                <td className="text-right tabular-nums">{fmtAmt(imp)}</td>
                <td
                  className={`text-right tabular-nums font-medium ${
                    Number(bal) >= 0 ? "text-emerald-600" : "text-red-500"
                  }`}
                >
                  {fmtAmt(bal)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function MarkdownBody({ text }: { text: string }) {
  const blocks = text.split(/\n\n+/);
  return (
    <div className="prose prose-sm dark:prose-invert max-w-none text-xs space-y-2">
      {blocks.map((block, i) => {
        const line = block.trim();
        if (!line) return null;
        if (line.startsWith("## ")) {
          return (
            <h3 key={i} className="text-[11px] font-semibold text-neutral-500 mt-3 mb-1">
              {line.replace(/^##\s*/, "")}
            </h3>
          );
        }
        const html = escapeHtml(line)
          .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
          .replace(/\n/g, "<br/>");
        return (
          <p
            key={i}
            className="text-neutral-700 dark:text-neutral-300 leading-relaxed"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        );
      })}
    </div>
  );
}

export function TradeReportCard() {
  const [reports, setReports] = useState<TradeMonthlyReport[]>([]);
  const [selectedMonth, setSelectedMonth] = useState(defaultMonth());
  const [report, setReport] = useState<TradeMonthlyReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [section, setSection] = useState<"overview" | "body">("overview");
  const autoGenTried = useRef(false);

  const monthOptions = useMemo(() => lastMonths(TRADE_VIEW_MONTHS), []);

  const loadList = useCallback(async () => {
    const res = await marketApi.listTradeReports(TRADE_VIEW_MONTHS);
    setReports(res.reports.filter((r) => r.status === "ready" || r.status === "partial"));
  }, []);

  const loadMonth = useCallback(async (month: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await marketApi.getTradeReport(month);
      setReport(res.report);
      if (!res.report && reports.length === 0) {
        await loadList();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "로드 실패");
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, [loadList, reports.length]);

  useEffect(() => {
    loadList().catch(() => {});
  }, [loadList]);

  useEffect(() => {
    loadMonth(selectedMonth);
  }, [selectedMonth, loadMonth]);

  useEffect(() => {
    const best = reports.find((r) => r.status === "ready" || r.status === "partial");
    if (best && !isReportViewable(report) && selectedMonth === defaultMonth()) {
      setSelectedMonth(best.report_month);
    }
  }, [reports, report, selectedMonth]);

  const handleGenerate = useCallback(
    async (force = false) => {
      setGenerating(true);
      setError(null);
      try {
        const res = await marketApi.generateTradeReport({ month: selectedMonth, force });
        setReport(res.report);
        if (res.warning) {
          setError(res.warning);
        }
        await loadList();
      } catch (e) {
        setError(e instanceof Error ? e.message : "생성 실패");
        await loadMonth(selectedMonth);
      } finally {
        setGenerating(false);
      }
    },
    [selectedMonth, loadList, loadMonth],
  );

  useEffect(() => {
    if (loading || generating || autoGenTried.current) return;
    if (!isReportViewable(report)) {
      autoGenTried.current = true;
      handleGenerate(false);
    }
  }, [loading, generating, report, handleGenerate]);

  const analyses = report?.analyses ?? {};
  const sectionEntries = [
    { key: "summary_trend", label: "총괄 트렌드" },
    { key: "country_trade", label: "국가별" },
    { key: "sector_items", label: "품목·섹터" },
    { key: "integrated", label: "통합 시사점" },
  ].filter((s) => analyses[s.key as keyof typeof analyses]);

  return (
    <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface)] p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <Ship size={18} className="text-blue-600 dark:text-blue-400" />
          <div>
            <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
              수출입 동향
            </h2>
            <p className="text-[10px] text-neutral-400">
              월별 무역 통계 · AI 해석 (최근 {TRADE_VIEW_MONTHS}개월)
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="appearance-none rounded-md border border-[var(--border-subtle)] bg-[var(--surface-elevated)] pl-2.5 pr-7 py-1.5 text-xs font-medium"
            >
              {monthOptions.map((m) => (
                <option key={m} value={m}>
                  {m.replace("-", "년 ")}월
                </option>
              ))}
            </select>
            <ChevronDown
              size={14}
              className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-neutral-400"
            />
          </div>
          <button
            type="button"
            disabled={generating}
            onClick={() => handleGenerate(!!report)}
            className="inline-flex items-center gap-1 rounded-md border border-[var(--border-subtle)] px-2.5 py-1.5 text-[11px] font-medium hover:bg-[var(--surface-elevated)] disabled:opacity-50"
          >
            {generating ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <RefreshCw size={12} />
            )}
            {isReportViewable(report) ? "재생성" : "생성"}
          </button>
        </div>
      </div>

      {error && (
        <p className="text-xs text-red-500 mb-2 rounded-md bg-red-50 dark:bg-red-900/20 px-2 py-1.5">
          {error}
        </p>
      )}

      {loading ? (
        <div className="flex items-center gap-2 py-8 text-xs text-neutral-400 justify-center">
          <Loader2 size={14} className="animate-spin" /> 불러오는 중…
        </div>
      ) : generating ? (
        <div className="flex flex-col items-center gap-2 py-8 text-xs text-neutral-500">
          <Loader2 size={18} className="animate-spin text-blue-500" />
          <p>수출입 데이터 수집·AI 분석 중… (1~3분 소요)</p>
        </div>
      ) : !report || !isReportViewable(report) ? (
        <div className="text-center py-8 space-y-2">
          <p className="text-xs text-neutral-500">
            {selectedMonth} 리포트가 없습니다. 생성 버튼을 눌러 주세요.
          </p>
          {report && report.status === "failed" && report.error_message && (
            <p className="text-[10px] text-red-500">{report.error_message}</p>
          )}
        </div>
      ) : (
        <>
          {report.status === "partial" && report.error_message && (
            <p className="text-[10px] text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 rounded-md px-2 py-1.5 mb-2">
              {report.error_message}
            </p>
          )}
          {report.highlights.length > 0 && (
            <ul className="mb-3 space-y-1 rounded-md bg-blue-50/80 dark:bg-blue-900/15 border border-blue-200/60 dark:border-blue-800/40 px-3 py-2">
              {report.highlights.map((h, i) => (
                <li key={i} className="text-xs text-neutral-700 dark:text-neutral-300 flex gap-1.5">
                  <span className="text-blue-500 shrink-0">•</span>
                  <span>{h}</span>
                </li>
              ))}
            </ul>
          )}

          <div className="flex gap-1 mb-3 rounded-md border border-[var(--border-subtle)] p-0.5 w-fit">
            <button
              type="button"
              onClick={() => setSection("overview")}
              className={`rounded px-2.5 py-1 text-[10px] font-medium ${
                section === "overview"
                  ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                  : "text-neutral-500"
              }`}
            >
              데이터
            </button>
            <button
              type="button"
              onClick={() => setSection("body")}
              className={`rounded px-2.5 py-1 text-[10px] font-medium ${
                section === "body"
                  ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                  : "text-neutral-500"
              }`}
            >
              AI 리포트
            </button>
          </div>

          {section === "overview" ? (
            <div className="space-y-4">
              <div>
                <h3 className="text-[11px] font-semibold text-neutral-500 mb-2">
                  월별 총괄 (최대 {TRADE_VIEW_MONTHS}개월)
                </h3>
                <SummaryTable rows={report.summary} />
              </div>
              {sectionEntries.map(({ key, label }) => (
                <div key={key}>
                  <h3 className="text-[11px] font-semibold text-neutral-500 mb-1">{label}</h3>
                  <p className="text-xs text-neutral-600 dark:text-neutral-400 whitespace-pre-wrap leading-relaxed">
                    {String(analyses[key as keyof typeof analyses] ?? "")}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            report.body_markdown && <MarkdownBody text={report.body_markdown} />
          )}

          {report.generated_at && (
            <p className="text-[10px] text-neutral-400 mt-3">
              생성: {new Date(report.generated_at).toLocaleString("ko-KR")}
            </p>
          )}
        </>
      )}
    </section>
  );
}
