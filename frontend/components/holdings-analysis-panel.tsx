"use client";

import { ExternalLink, Loader2, TrendingDown, TrendingUp } from "lucide-react";
import type {
  HoldingsAnalysis,
  StockBasicsTableRow,
  StockFinanceTable,
  StockInvestorTrendRow,
} from "@/lib/api";
import { krSignedBoldClass } from "@/lib/krMarketColors";

function InfoRow({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div className="flex gap-2 text-[11px] py-1 border-b border-[var(--border-subtle)] last:border-0">
      <span className="w-28 shrink-0 text-neutral-500">{label}</span>
      <span className="text-neutral-800 dark:text-neutral-200 break-words">{value}</span>
    </div>
  );
}

function TableRows({ rows, emptyLabel }: { rows?: StockBasicsTableRow[]; emptyLabel?: string }) {
  if (!rows?.length) {
    return emptyLabel ? <p className="text-[11px] text-neutral-400 py-1">{emptyLabel}</p> : null;
  }
  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-3 py-2">
      {rows.map((row) => (
        <InfoRow key={row.label} label={row.label} value={row.value} />
      ))}
    </div>
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

      {(quote?.close_price || data.quote_table?.length || quote?.items?.length) && (
        <section>
          <h4 className="text-xs font-semibold text-neutral-700 dark:text-neutral-300 mb-2">시세 스냅샷</h4>
          <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-3 py-2">
            {quote?.close_price && (
              <InfoRow
                label="현재가"
                value={
                  quote.change_direction && quote.change
                    ? `${quote.close_price} (${quote.change_direction} ${quote.change}${quote.change_pct ? ` · ${quote.change_pct}%` : ""})`
                    : quote.close_price
                }
              />
            )}
            <InfoRow label="거래소" value={quote?.exchange} />
            <InfoRow label="시장 상태" value={quote?.market_status} />
            {(quote?.items ?? []).map((item) => (
              <InfoRow key={item.label} label={item.label} value={item.value} />
            ))}
            {(data.quote_table ?? []).map((row) => (
              <InfoRow key={`q-${row.label}`} label={row.label} value={row.value} />
            ))}
          </div>
        </section>
      )}

      <section>
        <h4 className="text-xs font-semibold text-neutral-700 dark:text-neutral-300 mb-2">
          투자정보 (네이버 금융)
        </h4>
        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-3 py-2">
          <InfoRow label="시가총액" value={info.market_cap} />
          <InfoRow label="시총 순위" value={info.market_cap_rank} />
          <InfoRow label="상장주식수" value={info.listed_shares} />
          <InfoRow label="액면가·매매단위" value={info.face_value_trading_unit} />
          <InfoRow label="외국인 한도" value={info.foreign_limit_shares} />
          <InfoRow label="외국인 보유" value={info.foreign_held_shares} />
          <InfoRow
            label="투자의견·목표"
            value={
              info.consensus_rating && info.consensus_target_price
                ? `${info.consensus_rating} · ${info.consensus_target_price}`
                : info.consensus_rating_score && info.consensus_target_price_numeric
                  ? `${info.consensus_rating_score} · ${info.consensus_target_price_numeric}`
                  : info.consensus_opinion_line
            }
          />
          <InfoRow label="컨센서스 기준일" value={info.consensus_date} />
          <InfoRow label="PER · EPS" value={info.per_eps ?? (info.per && info.eps ? `${info.per} · ${info.eps}` : info.per)} />
          <InfoRow label="추정 PER · EPS" value={info.forward_per_eps ?? (info.forward_per && info.forward_eps ? `${info.forward_per} · ${info.forward_eps}` : info.forward_per)} />
          <InfoRow label="PBR · BPS" value={info.pbr_bps ?? (info.pbr && info.bps ? `${info.pbr} · ${info.bps}` : info.pbr)} />
          <InfoRow label="배당금" value={info.dividend_amount} />
          <InfoRow label="52주 최고·최저" value={info.week52_range ?? (info.week52_high && info.week52_low ? `${info.week52_high} · ${info.week52_low}` : null)} />
          <InfoRow label="외국인 소진율" value={info.foreign_exhaustion_rate ?? info.foreign_holding_rate} />
          <InfoRow label="동일업종 PER" value={info.industry_per} />
          <InfoRow label="동일업종 등락" value={info.industry_change_pct} />
          <InfoRow label="배당수익률" value={info.dividend_yield} />
          <InfoRow label="거래량" value={info.trading_volume} />
          <InfoRow label="거래대금" value={info.trading_value} />
        </div>
      </section>

      {!!data.investment_table?.length && (
        <section>
          <h4 className="text-xs font-semibold text-neutral-700 dark:text-neutral-300 mb-2">투자정보 전체</h4>
          <TableRows rows={data.investment_table} />
        </section>
      )}

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
