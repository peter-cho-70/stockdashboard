"use client";

import { ExternalLink, HelpCircle, Loader2, TrendingDown, TrendingUp } from "lucide-react";
import type {
  HoldingsAnalysis,
  StockBasicsTableRow,
  StockFinanceTable,
  StockInvestorTrendRow,
  StockInvestmentInfo,
} from "@/lib/api";
import { krSignedBoldClass } from "@/lib/krMarketColors";
import { getValuationDefinition, getValuationHint } from "@/lib/valuationHints";
import { VALUATION_LABEL_LESSONS } from "@/lib/studyTermGlossary";
import { renderStudyTerms } from "@/lib/renderStudyTerms";
import { StudyLessonChip } from "@/components/study-term-link";

function InfoRow({
  label,
  value,
  emphasizeValue = false,
}: {
  label: string;
  value?: string | null;
  emphasizeValue?: boolean;
}) {
  if (!value) return null;
  return (
    <div className="flex gap-2 text-[11px] py-1 border-b border-[var(--border-subtle)] last:border-0">
      <span className="w-28 shrink-0 text-neutral-500">{label}</span>
      <span
        className={`break-words ${
          emphasizeValue
            ? "font-semibold text-neutral-900 dark:text-neutral-100"
            : "text-neutral-800 dark:text-neutral-200"
        }`}
      >
        {value}
      </span>
    </div>
  );
}

function ValuationInfoRow({
  label,
  value,
  info,
}: {
  label: string;
  value?: string | null;
  info: StockInvestmentInfo;
}) {
  if (!value) return null;
  const definition = getValuationDefinition(label);
  const hint = getValuationHint(label, info);
  const lessonId = VALUATION_LABEL_LESSONS[label];
  const tooltip = definition ? (hint ? `${definition}\n\n${hint}` : definition) : hint;

  return (
    <div className="py-1.5 border-b border-[var(--border-subtle)] last:border-0">
      <div className="flex gap-2 text-[11px]">
        <span
          className={`w-28 shrink-0 text-neutral-500 flex items-start gap-0.5 ${tooltip ? "group cursor-help" : ""}`}
          title={tooltip ?? undefined}
        >
          <span className={definition ? "border-b border-dotted border-neutral-400/50" : ""}>
            {renderStudyTerms(label, `label-${label}`)}
          </span>
          {definition && (
            <HelpCircle
              size={10}
              className="shrink-0 mt-px text-neutral-400 opacity-70 group-hover:text-blue-500"
              aria-hidden
            />
          )}
        </span>
        <span className="break-words font-semibold text-neutral-900 dark:text-neutral-100">{value}</span>
      </div>
      {hint && (
        <p className="mt-1 ml-[7.5rem] text-[10px] leading-relaxed text-neutral-500 dark:text-neutral-400">
          {renderStudyTerms(hint, `hint-${label}`)}
        </p>
      )}
      {lessonId && (
        <div className="mt-1 ml-[7.5rem]">
          <StudyLessonChip lessonId={lessonId} />
        </div>
      )}
    </div>
  );
}

function normalizeNaverLabel(label: string): string {
  return label.replace(/\s+/g, "").replace(/[·|/()]/g, "").replace(/l/gi, "").toLowerCase();
}

function formatNaverDisplayLabel(raw: string): string {
  return raw.split(" l ")[0].split(" | ")[0].trim();
}

function resolveValuationLabel(rawLabel: string): string | null {
  const norm = normalizeNaverLabel(rawLabel);
  if (norm.startsWith("per") && norm.includes("eps") && !norm.includes("추정")) return "PER · EPS";
  if (norm.includes("추정per")) return "추정 PER · EPS";
  if (norm.startsWith("pbr") && norm.includes("bps")) return "PBR · BPS";
  if (norm.includes("외국인소진율")) return "외국인 소진율";
  if (norm.includes("외국인보유율")) return "외국인 보유율";
  if (norm.includes("동일업종per")) return "동일업종 PER";
  return null;
}

function isImportantNaverLabel(rawLabel: string): boolean {
  const n = normalizeNaverLabel(rawLabel);
  if (n === "현재가") return true;
  if (n.includes("시가총액") && !n.includes("순위")) return true;
  if (n.includes("투자의견") || n.includes("목표주가")) return true;
  if (n.includes("per") || n.includes("pbr") || n.includes("배당")) return true;
  if (n.includes("52주")) return true;
  if (n.includes("외국인")) return true;
  if (n === "거래량" || n === "거래대금") return true;
  return false;
}

function mergeNaverInvestmentRows(
  investmentTable?: StockBasicsTableRow[],
  quoteTable?: StockBasicsTableRow[],
): StockBasicsTableRow[] {
  const merged: StockBasicsTableRow[] = [];
  const seen = new Set<string>();

  for (const row of investmentTable ?? []) {
    const key = normalizeNaverLabel(row.label);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(row);
  }

  for (const row of quoteTable ?? []) {
    const key = normalizeNaverLabel(row.label);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(row);
  }

  return merged;
}

function NaverQuoteInvestmentSection({
  quote,
  info,
  investmentTable,
  quoteTable,
}: {
  quote?: HoldingsAnalysis["quote"];
  info: StockInvestmentInfo;
  investmentTable?: StockBasicsTableRow[];
  quoteTable?: StockBasicsTableRow[];
}) {
  const fallbackRows = info.table_rows;
  const rows = mergeNaverInvestmentRows(
    investmentTable?.length ? investmentTable : fallbackRows,
    quoteTable,
  );
  const hasQuoteHeader = Boolean(quote?.close_price);
  const filteredRows = hasQuoteHeader
    ? rows.filter((row) => normalizeNaverLabel(row.label) !== "현재가")
    : rows;
  const hasHeader = Boolean(quote?.close_price || quote?.exchange || quote?.market_status);
  const hasConsensusDate =
    info.consensus_date &&
    !filteredRows.some((row) => normalizeNaverLabel(row.label).includes("컨센서스"));

  if (!hasHeader && filteredRows.length === 0 && !hasConsensusDate) return null;

  return (
    <section>
      <h4 className="text-xs font-semibold text-neutral-700 dark:text-neutral-300 mb-2">
        투자·시세 (네이버 금융)
      </h4>
      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-3 py-2">
        {quote?.close_price && (
          <InfoRow
            label="현재가"
            emphasizeValue
            value={
              quote.change_direction && quote.change
                ? `${quote.close_price} (${quote.change_direction} ${quote.change}${quote.change_pct ? ` · ${quote.change_pct}%` : ""})`
                : quote.close_price
            }
          />
        )}
        <InfoRow label="거래소" value={quote?.exchange} />
        <InfoRow label="시장 상태" value={quote?.market_status} />
        {filteredRows.map((row) => {
          const valuationLabel = resolveValuationLabel(row.label);
          if (valuationLabel) {
            return (
              <ValuationInfoRow
                key={row.label}
                label={valuationLabel}
                value={row.value}
                info={info}
              />
            );
          }
          return (
            <InfoRow
              key={row.label}
              label={formatNaverDisplayLabel(row.label)}
              value={row.value}
              emphasizeValue={isImportantNaverLabel(row.label)}
            />
          );
        })}
        {hasConsensusDate && <InfoRow label="컨센서스 기준일" value={info.consensus_date} />}
      </div>
    </section>
  );
}

function FinanceTable({ table, title }: { table?: StockFinanceTable; title: string }) {
  if (!table?.rows?.length) return null;
  const periods = table.periods ?? [];

  return (
    <section>
      <h4 className="text-xs font-semibold text-neutral-700 dark:text-neutral-300 mb-2">{title}</h4>
      <div className="overflow-x-auto rounded-lg border border-[var(--border-subtle)]">
        <table className="min-w-full text-[10px]">
          <thead>
            <tr className="bg-[var(--surface-elevated)] border-b border-[var(--border-subtle)]">
              <th className="text-left px-2 py-1.5 font-medium text-neutral-500">항목</th>
              {periods.map((p) => (
                <th key={p.key ?? p.title} className="text-right px-2 py-1.5 font-medium text-neutral-500 whitespace-nowrap">
                  {p.title}
                  {p.is_consensus ? " (E)" : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row) => (
              <tr key={row.title} className="border-b border-[var(--border-subtle)] last:border-0">
                <td className="px-2 py-1.5 text-neutral-700 dark:text-neutral-300 whitespace-nowrap">{row.title}</td>
                {periods.map((p) => (
                  <td key={`${row.title}-${p.key}`} className="px-2 py-1.5 text-right text-neutral-600 dark:text-neutral-400 whitespace-nowrap">
                    {row.columns?.[p.key ?? ""] ?? "—"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function InvestorTrendTable({ rows }: { rows?: StockInvestorTrendRow[] }) {
  if (!rows?.length) return null;
  return (
    <section>
      <h4 className="text-xs font-semibold text-neutral-700 dark:text-neutral-300 mb-2">투자자별 순매수 (최근)</h4>
      <div className="overflow-x-auto rounded-lg border border-[var(--border-subtle)]">
        <table className="min-w-full text-[10px]">
          <thead>
            <tr className="bg-[var(--surface-elevated)] border-b border-[var(--border-subtle)]">
              {["일자", "종가", "외국인", "기관", "개인", "외국인보유"].map((h) => (
                <th key={h} className="px-2 py-1.5 font-medium text-neutral-500 text-left whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.date} className="border-b border-[var(--border-subtle)] last:border-0">
                <td className="px-2 py-1.5 whitespace-nowrap">{r.date}</td>
                <td className="px-2 py-1.5 whitespace-nowrap">{r.close_price}</td>
                <td className="px-2 py-1.5 whitespace-nowrap">{r.foreign_net_buy}</td>
                <td className="px-2 py-1.5 whitespace-nowrap">{r.institution_net_buy}</td>
                <td className="px-2 py-1.5 whitespace-nowrap">{r.individual_net_buy}</td>
                <td className="px-2 py-1.5 whitespace-nowrap">{r.foreign_holding_rate}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function IssueList({ items, period }: { items: HoldingsAnalysis["daily_issues"]; period: "daily" | "weekly" }) {
  if (!items?.length) {
    return (
      <p className="text-[11px] text-neutral-400 py-2">
        {period === "daily" ? "최근 뚜렷한 일간 급변 없음" : "최근 뚜렷한 주간 변동 없음"}
      </p>
    );
  }

  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li
          key={`${item.period}-${item.date}-${item.week_key ?? ""}`}
          className="rounded-lg border border-[var(--border-subtle)] px-3 py-2 text-[11px]"
        >
          <div className="flex items-center gap-2 flex-wrap">
            {item.direction === "up" ? (
              <TrendingUp size={12} className="text-red-500 shrink-0" />
            ) : (
              <TrendingDown size={12} className="text-blue-500 shrink-0" />
            )}
            <span className={`font-semibold ${krSignedBoldClass(item.change_pct)}`}>
              {item.label}
            </span>
            <span className="text-neutral-400">
              {period === "weekly" && item.week_start && item.week_end
                ? `${item.week_start} ~ ${item.week_end}`
                : item.date}
            </span>
            {item.cause_source === "ai_saved" && (
              <span className="text-[9px] text-violet-600 dark:text-violet-400">AI 원인</span>
            )}
            {item.cause_source === "intel_issue" && (
              <span className="text-[9px] text-emerald-600 dark:text-emerald-400">Intel 이슈</span>
            )}
          </div>
          {item.reason && (
            <p className="mt-1.5 text-neutral-600 dark:text-neutral-400 leading-relaxed">{item.reason}</p>
          )}
          {item.summary && period === "weekly" && (
            <p className="mt-1 text-neutral-500">{item.summary}</p>
          )}
        </li>
      ))}
    </ul>
  );
}

interface HoldingsAnalysisPanelProps {
  data: HoldingsAnalysis | null;
  loading: boolean;
  error?: string | null;
}

export function HoldingsAnalysisPanel({ data, loading, error }: HoldingsAnalysisPanelProps) {
  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-8 text-sm text-neutral-400">
        <Loader2 size={14} className="animate-spin" />
        종목 기초정보 불러오는 중…
      </div>
    );
  }

  if (error) {
    return <p className="text-xs text-red-500 py-4">{error}</p>;
  }

  if (!data?.eligible) {
    return (
      <p className="text-xs text-neutral-400 py-4">
        {data?.message ?? "분석 모드에서 종목 기초정보를 표시합니다."}
      </p>
    );
  }

  const info = data.investment_info ?? {};
  const quote = data.quote;

  return (
    <div className="space-y-4">
      {data.message && !data.is_holding && (
        <p className="text-[10px] text-neutral-500 rounded-md border border-[var(--border-subtle)] px-2 py-1.5">
          {data.message}
        </p>
      )}

      <div className="rounded-lg border border-blue-200 bg-blue-50/50 px-3 py-2 dark:border-blue-900 dark:bg-blue-950/20">
        <p className="text-[11px] font-medium text-blue-800 dark:text-blue-300">한 줄 요약</p>
        <p className="mt-1 text-xs text-blue-900 dark:text-blue-200 leading-relaxed">{data.headline}</p>
        {data.is_holding && data.qty != null && data.qty > 0 && (
          <p className="mt-1 text-[10px] text-blue-700/80 dark:text-blue-400/80">
            보유 {data.qty.toLocaleString("ko-KR")}주 · 수익률{" "}
            <span className={krSignedBoldClass(data.profit_rate ?? 0)}>
              {(data.profit_rate ?? 0) >= 0 ? "+" : ""}
              {(data.profit_rate ?? 0).toFixed(2)}%
            </span>
          </p>
        )}
      </div>

      <NaverQuoteInvestmentSection
        quote={quote}
        info={info}
        investmentTable={data.investment_table}
        quoteTable={data.quote_table}
      />

      <InvestorTrendTable rows={data.investor_trends} />

      <FinanceTable table={data.financials?.annual} title="연간 재무 (네이버)" />
      <FinanceTable table={data.financials?.quarterly} title="분기 재무 (네이버)" />

      {!!data.industry_peers?.length && (
        <section>
          <h4 className="text-xs font-semibold text-neutral-700 dark:text-neutral-300 mb-2">동종업종 비교</h4>
          <div className="overflow-x-auto rounded-lg border border-[var(--border-subtle)]">
            <table className="min-w-full text-[10px]">
              <thead>
                <tr className="bg-[var(--surface-elevated)] border-b border-[var(--border-subtle)]">
                  {["종목", "현재가", "등락", "시총"].map((h) => (
                    <th key={h} className="px-2 py-1.5 font-medium text-neutral-500 text-left">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.industry_peers.map((p) => (
                  <tr key={p.symbol} className="border-b border-[var(--border-subtle)] last:border-0">
                    <td className="px-2 py-1.5">{p.name}</td>
                    <td className="px-2 py-1.5 whitespace-nowrap">{p.close_price}</td>
                    <td className="px-2 py-1.5 whitespace-nowrap">
                      {p.change_direction} {p.change_pct ? `${p.change_pct}%` : ""}
                    </td>
                    <td className="px-2 py-1.5 whitespace-nowrap">{p.market_cap}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {!!data.research_reports?.length && (
        <section>
          <h4 className="text-xs font-semibold text-neutral-700 dark:text-neutral-300 mb-2">증권사 리포트</h4>
          <ul className="space-y-1.5">
            {data.research_reports.map((r) => (
              <li key={r.report_id ?? `${r.broker}-${r.date}`} className="text-[11px] border-b border-[var(--border-subtle)] pb-1.5 last:border-0">
                <span className="text-neutral-500">{r.date} · {r.broker}</span>
                <p className="text-neutral-800 dark:text-neutral-200">{r.title}</p>
                {r.target_price && <p className="text-neutral-500">목표 {r.target_price}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {data.overview && (
        <section>
          <h4 className="text-xs font-semibold text-neutral-700 dark:text-neutral-300 mb-2">기업 개요</h4>
          <p className="text-[11px] text-neutral-600 dark:text-neutral-400 leading-relaxed whitespace-pre-wrap">{data.overview}</p>
        </section>
      )}

      <section>
        <h4 className="text-xs font-semibold text-neutral-700 dark:text-neutral-300 mb-2">일별 변동 이슈</h4>
        <IssueList items={data.daily_issues} period="daily" />
      </section>

      <section>
        <h4 className="text-xs font-semibold text-neutral-700 dark:text-neutral-300 mb-2">주별 변동 이슈</h4>
        <IssueList items={data.weekly_issues} period="weekly" />
      </section>

      {data.news && data.news.length > 0 && (
        <section>
          <h4 className="text-xs font-semibold text-neutral-700 dark:text-neutral-300 mb-2">
            최신 뉴스 ({data.news.length}건)
          </h4>
          <ul className="space-y-1.5 max-h-56 overflow-y-auto">
            {data.news.map((n, i) => (
              <li key={`${n.url}-${i}`}>
                <a
                  href={n.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-start gap-1 text-[11px] text-blue-600 dark:text-blue-400 hover:underline"
                >
                  <ExternalLink size={10} className="mt-0.5 shrink-0" />
                  <span>
                    <span className="line-clamp-2">{n.title}</span>
                    {n.published && (
                      <span className="block text-[9px] text-neutral-400 mt-0.5">{n.published}</span>
                    )}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="text-[10px] text-neutral-400">
        네이버 금융 · 재무/수급/동종업종/리포트 · pykrx 변동 탐지 · Intel/AI 원인 연동
      </p>
    </div>
  );
}
