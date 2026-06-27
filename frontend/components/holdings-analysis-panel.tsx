"use client";

import { useState } from "react";
import { ExternalLink, FileText, HelpCircle, Loader2, Newspaper, TrendingDown, TrendingUp } from "lucide-react";
import type {
  HoldingsAnalysis,
  StockBasicsTableRow,
  StockFinanceTable,
  StockInvestorTrendRow,
  StockInvestmentInfo,
  StockIndustryPeer,
  StockResearchReport,
} from "@/lib/api";
import { marketApi } from "@/lib/api";
import { krSignedBoldClass } from "@/lib/krMarketColors";

function fmtNewsDate(raw: string): string {
  const d = new Date(raw);
  if (isNaN(d.getTime())) return raw;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}.${m}.${day}`;
}

import { getValuationDefinition, getValuationHint, buildValuationSummary } from "@/lib/valuationHints";
import { getFinanceTermHint } from "@/lib/financeTermGlossary";
import { VALUATION_LABEL_LESSONS } from "@/lib/studyTermGlossary";
import { renderStudyTerms } from "@/lib/renderStudyTerms";
import { StudyLessonChip } from "@/components/study-term-link";

// ── 순매수 값 파싱 ("+1,234" → 1234, "-5,678" → -5678) ──────────────
function parseNetBuy(raw?: string | null): number | null {
  if (!raw || raw === "—" || raw === "-") return null;
  const cleaned = raw.replace(/,/g, "").replace(/\s/g, "");
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
}

function netBuyClass(raw?: string | null): string {
  const v = parseNetBuy(raw);
  if (v === null) return "text-neutral-500";
  if (v > 0) return "text-red-600 dark:text-red-400 font-semibold";
  if (v < 0) return "text-blue-600 dark:text-blue-400 font-semibold";
  return "text-neutral-500";
}

// ── 재무 수치 파싱 ───────────────────────────────────────────────────
function parseFinanceVal(raw?: string | null): number | null {
  if (!raw || raw === "—" || raw === "N/A" || raw.trim() === "") return null;
  const cleaned = raw.replace(/,/g, "").replace(/%$/, "").trim();
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
}

// 항목명 기준 "높을수록 좋음" 여부
function higherIsBetter(title: string): boolean | null {
  const t = title.replace(/\s/g, "");
  if (/부채비율|차입금|부채총계/.test(t)) return false;
  if (/매출|영업이익|순이익|당기순이익|지배주주|자산총계|자본총계|EPS|BPS|DPS|FCF|ROE|ROA|영업이익률|순이익률|유보율/.test(t)) return true;
  return null;
}

function trendLabel(title: string, prev: number, curr: number): { arrow: string; cls: string; desc: string } | null {
  if (prev === 0 || prev === curr) return null;
  const up = curr > prev;
  const hib = higherIsBetter(title);
  const good = hib === null ? null : up === hib;
  const arrow = up ? "▲" : "▼";
  const cls =
    good === true  ? "text-red-500"  :
    good === false ? "text-blue-500" :
    "text-neutral-400";
  const pct = ((curr - prev) / Math.abs(prev) * 100).toFixed(1);
  const desc = up ? `전기 대비 +${pct}% 증가` : `전기 대비 ${pct}% 감소`;
  return { arrow, cls, desc };
}

// ── 시총 파싱 (정렬용, "24조 5,000억" → 숫자) ────────────────────────
function parseMarketCap(raw?: string | null): number {
  if (!raw) return 0;
  const t = raw.replace(/,/g, "").replace(/\s/g, "");
  let val = 0;
  const jo = t.match(/([0-9.]+)조/);
  const eok = t.match(/([0-9.]+)억/);
  if (jo)  val += parseFloat(jo[1])  * 1e12;
  if (eok) val += parseFloat(eok[1]) * 1e8;
  if (!jo && !eok) val = parseFloat(t) || 0;
  return val;
}

// ── 공통 InfoRow ────────────────────────────────────────────────────
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

// ── 투자·시세 섹션 ───────────────────────────────────────────────────
function NaverQuoteInvestmentSection({
  quote, info, investmentTable, quoteTable,
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
              <ValuationInfoRow key={row.label} label={valuationLabel} value={row.value} info={info} />
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

      {/* 종합 밸류에이션 판정 카드 */}
      {(() => {
        const vs = buildValuationSummary(info);
        if (!vs) return null;
        const bgMap: Record<string, string> = {
          저평가: "bg-red-50 border-red-200 dark:bg-red-950/20 dark:border-red-900",
          고평가: "bg-blue-50 border-blue-200 dark:bg-blue-950/20 dark:border-blue-900",
          적정:   "bg-gray-50 border-gray-200 dark:bg-neutral-900 dark:border-neutral-700",
          판단불가: "bg-gray-50 border-gray-200 dark:bg-neutral-900 dark:border-neutral-700",
        };
        return (
          <div className={`mt-2 rounded-lg border px-3 py-2.5 ${bgMap[vs.grade] ?? bgMap["적정"]}`}>
            <div className="flex items-center gap-1.5 mb-1.5">
              <span className="text-[10px] font-semibold text-neutral-500">밸류에이션 종합 판정</span>
              <span className={`text-xs font-bold ${vs.gradeColor}`}>{vs.grade}</span>
            </div>
            <ul className="space-y-0.5">
              {vs.bullets.map((b, i) => (
                <li key={i} className="text-[10px] text-neutral-600 dark:text-neutral-400 leading-relaxed">
                  • {b}
                </li>
              ))}
            </ul>
            <p className="mt-1.5 text-[9px] text-neutral-400">* 규칙 기반 참고치이며 투자 권유가 아닙니다.</p>
          </div>
        );
      })()}
    </section>
  );
}

// ── 재무제표 (연간/분기 공통) ─────────────────────────────────────────
function FinanceTable({ table, title }: { table?: StockFinanceTable; title: string }) {
  const [hoveredTerm, setHoveredTerm] = useState<{ name: string; hint: string } | null>(null);

  if (!table?.rows?.length) return null;
  const periods = table.periods ?? [];

  return (
    <section onMouseLeave={() => setHoveredTerm(null)}>
      <h4 className="text-xs font-semibold text-neutral-700 dark:text-neutral-300 mb-2">{title}</h4>
      <div className="overflow-x-auto rounded-lg border border-[var(--border-subtle)]">
        <table className="min-w-full text-[10px]">
          <thead>
            <tr className="bg-[var(--surface-elevated)] border-b border-[var(--border-subtle)]">
              <th className="text-left px-2 py-1.5 font-medium text-neutral-500">항목</th>
              {periods.map((p) => (
                <th key={p.key ?? p.title} className="text-right px-2 py-1.5 font-medium text-neutral-500 whitespace-nowrap">
                  {p.title}{p.is_consensus ? " (E)" : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row) => {
              const hint = getFinanceTermHint(row.title ?? "");
              const vals = periods.map((p) => parseFinanceVal(row.columns?.[p.key ?? ""]));
              const isHovered = hoveredTerm?.name === row.title;
              return (
                <tr
                  key={row.title}
                  className={`border-b border-[var(--border-subtle)] last:border-0 transition-colors ${
                    isHovered ? "bg-indigo-50 dark:bg-indigo-950/30" : "hover:bg-[var(--surface-elevated)]"
                  }`}
                  onMouseEnter={() => hint ? setHoveredTerm({ name: row.title ?? "", hint }) : setHoveredTerm(null)}
                >
                  <td className="px-2 py-1.5 whitespace-nowrap">
                    {hint ? (
                      <span className="inline-flex items-center gap-0.5 font-medium text-neutral-700 dark:text-neutral-300 cursor-help">
                        {row.title}
                        <HelpCircle size={9} className="text-indigo-400 shrink-0" />
                      </span>
                    ) : (
                      <span className="font-medium text-neutral-700 dark:text-neutral-300">{row.title}</span>
                    )}
                  </td>
                  {periods.map((p, i) => {
                    const raw = row.columns?.[p.key ?? ""] ?? "—";
                    const curr = vals[i];
                    const prev = i > 0 ? vals[i - 1] : null;
                    const trend = (curr !== null && prev !== null)
                      ? trendLabel(row.title ?? "", prev, curr)
                      : null;
                    return (
                      <td key={`${row.title}-${p.key}`} className="px-2 py-1.5 text-right whitespace-nowrap">
                        <span className="text-neutral-600 dark:text-neutral-400">{raw}</span>
                        {trend && (
                          <span className={`ml-1 text-[9px] ${trend.cls}`} title={trend.desc}>
                            {trend.arrow}
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* 항목 설명 패널 */}
      <div className={`mt-1.5 rounded-lg border px-3 py-2 text-[10px] leading-relaxed transition-all ${
        hoveredTerm
          ? "border-indigo-200 bg-indigo-50 dark:border-indigo-800 dark:bg-indigo-950/30 opacity-100"
          : "border-transparent bg-transparent opacity-0 pointer-events-none h-0 py-0 overflow-hidden"
      }`}>
        {hoveredTerm && (
          <>
            <p className="font-semibold text-[11px] text-indigo-800 dark:text-indigo-300 mb-0.5">{hoveredTerm.name}</p>
            <p className="text-neutral-600 dark:text-neutral-400">{hoveredTerm.hint}</p>
          </>
        )}
      </div>

      <p className="mt-1 text-[9px] text-neutral-400">
        ▲<span className="text-red-500">빨강</span>=긍정적 증가 &nbsp;
        ▼<span className="text-blue-500">파랑</span>=부정적 감소 &nbsp;
        <span className="text-indigo-400">?</span> 항목에 마우스를 올리면 설명이 표시됩니다
      </p>
    </section>
  );
}

// ── 투자자별 순매수 ────────────────────────────────────────────────────
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
                <td className="px-2 py-1.5 text-neutral-500 whitespace-nowrap">{r.date}</td>
                <td className="px-2 py-1.5 font-medium text-neutral-700 dark:text-neutral-300 whitespace-nowrap">{r.close_price}</td>
                <td className={`px-2 py-1.5 whitespace-nowrap ${netBuyClass(r.foreign_net_buy)}`}>{r.foreign_net_buy}</td>
                <td className={`px-2 py-1.5 whitespace-nowrap ${netBuyClass(r.institution_net_buy)}`}>{r.institution_net_buy}</td>
                <td className={`px-2 py-1.5 whitespace-nowrap ${netBuyClass(r.individual_net_buy)}`}>{r.individual_net_buy}</td>
                <td className="px-2 py-1.5 text-neutral-500 whitespace-nowrap">{r.foreign_holding_rate}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-1 text-[9px] text-neutral-400">
        <span className="text-red-500">빨강</span>=순매수(매입 우세) &nbsp;<span className="text-blue-500">파랑</span>=순매도(매도 우세)
      </p>
    </section>
  );
}

// ── 동종업종 비교 (시총 순위 포함, 현재 종목 강조) ─────────────────────
function IndustryPeersTable({
  peers,
  currentSymbol,
  currentName,
  currentData,
}: {
  peers?: StockIndustryPeer[];
  currentSymbol?: string;
  currentName?: string;
  currentData?: HoldingsAnalysis;
}) {
  if (!peers?.length) return null;

  // 현재 종목이 peers에 없으면 추가
  const allPeers: (StockIndustryPeer & { isCurrent?: boolean })[] = [];
  let hasCurrent = false;
  for (const p of peers) {
    const isCurrent = p.symbol === currentSymbol || p.name === currentName;
    allPeers.push({ ...p, isCurrent });
    if (isCurrent) hasCurrent = true;
  }
  if (!hasCurrent && currentName) {
    allPeers.push({
      symbol: currentSymbol,
      name: currentName,
      close_price: currentData?.quote?.close_price ?? String(currentData?.current_price ?? ""),
      change_pct: currentData?.quote?.change_pct ?? null,
      change_direction: currentData?.quote?.change_direction ?? null,
      market_cap: currentData?.investment_info?.market_cap ?? null,
      isCurrent: true,
    });
  }

  // 시총 기준 내림차순 정렬
  const sorted = [...allPeers].sort((a, b) => parseMarketCap(b.market_cap) - parseMarketCap(a.market_cap));

  return (
    <section>
      <h4 className="text-xs font-semibold text-neutral-700 dark:text-neutral-300 mb-2">동종업종 비교 (시총 순위)</h4>
      <div className="overflow-x-auto rounded-lg border border-[var(--border-subtle)]">
        <table className="min-w-full text-[10px]">
          <thead>
            <tr className="bg-[var(--surface-elevated)] border-b border-[var(--border-subtle)]">
              {["순위", "종목", "현재가", "등락", "시총"].map((h) => (
                <th key={h} className="px-2 py-1.5 font-medium text-neutral-500 text-left whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((p, i) => {
              const isCurrent = (p as typeof p & { isCurrent?: boolean }).isCurrent;
              const changeNum = parseNetBuy(p.change_pct);
              const changeCls = changeNum == null
                ? "text-neutral-500"
                : changeNum > 0 ? "text-red-600 dark:text-red-400" : "text-blue-600 dark:text-blue-400";
              return (
                <tr
                  key={p.symbol ?? p.name ?? i}
                  className={`border-b border-[var(--border-subtle)] last:border-0 ${
                    isCurrent ? "bg-amber-50 dark:bg-amber-950/30" : ""
                  }`}
                >
                  <td className={`px-2 py-1.5 font-bold whitespace-nowrap ${i === 0 ? "text-amber-600" : "text-neutral-400"}`}>
                    #{i + 1}
                  </td>
                  <td className="px-2 py-1.5 whitespace-nowrap">
                    {isCurrent
                      ? <span className="font-bold text-neutral-900 dark:text-neutral-100">{p.name} <span className="text-[9px] text-amber-600">★현재</span></span>
                      : <span className="text-neutral-700 dark:text-neutral-300">{p.name}</span>
                    }
                  </td>
                  <td className="px-2 py-1.5 font-medium text-neutral-700 dark:text-neutral-300 whitespace-nowrap">{p.close_price ?? "—"}</td>
                  <td className={`px-2 py-1.5 whitespace-nowrap ${changeCls}`}>
                    {p.change_direction} {p.change_pct ? `${p.change_pct}%` : ""}
                  </td>
                  <td className="px-2 py-1.5 text-neutral-600 dark:text-neutral-400 whitespace-nowrap">{p.market_cap ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ── 증권사 리포트 아이템 (링크 lazy fetch) ────────────────────────────
function ReportItem({ r }: { r: StockResearchReport }) {
  const [links, setLinks] = useState<{
    naver_url: string; pdf_url: string | null; news_search_url: string;
  } | null>(null);
  const [fetching, setFetching] = useState(false);

  async function handleFetchLinks() {
    if (!r.report_id || fetching) return;
    setFetching(true);
    try {
      const data = await marketApi.getReportLinks(r.report_id);
      setLinks(data);
    } catch {
      setLinks({ naver_url: r.url ?? "", pdf_url: null, news_search_url: "" });
    } finally {
      setFetching(false);
    }
  }

  return (
    <li className="border-b border-[var(--border-subtle)] pb-2 last:border-0 last:pb-0">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-[10px] text-neutral-500">{r.date} · {r.broker}</p>
          {r.url ? (
            <a
              href={r.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-start gap-1 mt-0.5 text-[11px] text-blue-600 dark:text-blue-400 hover:underline"
            >
              <ExternalLink size={10} className="mt-0.5 shrink-0" />
              <span className="break-words leading-snug">{r.title}</span>
            </a>
          ) : (
            <p className="mt-0.5 text-[11px] text-neutral-800 dark:text-neutral-200">{r.title}</p>
          )}
          {r.target_price && (
            <p className="text-[10px] text-neutral-500 mt-0.5">목표가 {r.target_price}원</p>
          )}
        </div>
        {/* 링크 버튼 묶음 */}
        <div className="shrink-0 flex flex-col gap-1 items-end">
          {!links && r.report_id && (
            <button
              onClick={handleFetchLinks}
              disabled={fetching}
              className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded border border-[var(--border-subtle)] text-neutral-500 hover:text-neutral-800 hover:bg-[var(--surface-elevated)] disabled:opacity-50 transition-colors"
            >
              {fetching ? <Loader2 size={9} className="animate-spin" /> : <FileText size={9} />}
              링크 보기
            </button>
          )}
          {links && (
            <>
              {links.pdf_url && (
                <a
                  href={links.pdf_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded border border-red-200 bg-red-50 text-red-600 hover:bg-red-100 dark:border-red-800 dark:bg-red-950/30 dark:text-red-400 transition-colors"
                >
                  <FileText size={9} /> PDF 원문
                </a>
              )}
              {links.news_search_url && (
                <a
                  href={links.news_search_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded border border-[var(--border-subtle)] text-neutral-500 hover:text-neutral-800 hover:bg-[var(--surface-elevated)] transition-colors"
                >
                  <Newspaper size={9} /> 관련 기사
                </a>
              )}
              {!links.pdf_url && (
                <span className="text-[10px] text-neutral-400">PDF 없음</span>
              )}
            </>
          )}
        </div>
      </div>
    </li>
  );
}

// ── 이슈 리스트 ──────────────────────────────────────────────────────
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
            <span className={`font-semibold ${krSignedBoldClass(item.change_pct)}`}>{item.label}</span>
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

// ── 메인 패널 ────────────────────────────────────────────────────────
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

      {/* ── 기업 개요 (최상단) ── */}
      {(data.overview || data.business_profile) && (
        <section className="rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50/50 dark:bg-neutral-800/30 px-3 py-2.5">
          <h4 className="text-xs font-semibold text-neutral-700 dark:text-neutral-300 mb-2">기업 개요</h4>

          {/* 네이버 요약 (한 줄) */}
          {data.overview && (
            <p className="text-[11px] text-neutral-600 dark:text-neutral-400 leading-relaxed whitespace-pre-wrap mb-3">
              {data.overview}
            </p>
          )}

          {/* AI 구조화 프로파일 */}
          {data.business_profile && (
            <div className="space-y-2.5 border-t border-neutral-200 dark:border-neutral-700 pt-2.5">
              {data.business_profile.core_business && (
                <div>
                  <p className="text-[10px] font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wide mb-0.5">핵심 사업</p>
                  <p className="text-[11px] text-neutral-700 dark:text-neutral-300 leading-relaxed">{data.business_profile.core_business}</p>
                </div>
              )}
              {data.business_profile.main_products && data.business_profile.main_products.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wide mb-1">주력 제품 / 서비스</p>
                  <ul className="space-y-0.5">
                    {data.business_profile.main_products.map((p, i) => (
                      <li key={i} className="flex gap-1.5 text-[11px] text-neutral-700 dark:text-neutral-300">
                        <span className="text-neutral-400 shrink-0">•</span>
                        <span className="leading-relaxed">{p}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {data.business_profile.cash_cow && (
                <div>
                  <p className="text-[10px] font-semibold text-amber-600 dark:text-amber-400 uppercase tracking-wide mb-0.5">캐시카우</p>
                  <p className="text-[11px] text-neutral-700 dark:text-neutral-300 leading-relaxed">{data.business_profile.cash_cow}</p>
                </div>
              )}
              {data.business_profile.revenue_model && (
                <div>
                  <p className="text-[10px] font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wide mb-0.5">수익 구조</p>
                  <p className="text-[11px] text-neutral-700 dark:text-neutral-300 leading-relaxed">{data.business_profile.revenue_model}</p>
                </div>
              )}
              {data.business_profile.competitive_edge && (
                <div>
                  <p className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 uppercase tracking-wide mb-0.5">핵심 경쟁력</p>
                  <p className="text-[11px] text-neutral-700 dark:text-neutral-300 leading-relaxed">{data.business_profile.competitive_edge}</p>
                </div>
              )}
              <p className="text-[9px] text-neutral-400 pt-1">AI 분석 · 참고용 (실제와 다를 수 있음)</p>
            </div>
          )}
        </section>
      )}

      <NaverQuoteInvestmentSection
        quote={quote}
        info={info}
        investmentTable={data.investment_table}
        quoteTable={data.quote_table}
      />

      <InvestorTrendTable rows={data.investor_trends} />

      <FinanceTable table={data.financials?.annual} title="연간 재무 (네이버)" />
      <FinanceTable table={data.financials?.quarterly} title="분기 재무 (네이버)" />

      <IndustryPeersTable
        peers={data.industry_peers}
        currentSymbol={data.symbol}
        currentName={data.name}
        currentData={data}
      />

      {!!data.research_reports?.length && (
        <section>
          <h4 className="text-xs font-semibold text-neutral-700 dark:text-neutral-300 mb-2">
            증권사 리포트 ({data.research_reports.length}건)
          </h4>
          <ul className="space-y-2.5">
            {data.research_reports.map((r) => (
              <ReportItem key={r.report_id ?? `${r.broker}-${r.date}`} r={r} />
            ))}
          </ul>
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
                      <span className="block text-[9px] text-neutral-400 mt-0.5">{fmtNewsDate(n.published)}</span>
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
