"use client";

import { useState } from "react";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import type { MacroAnalysis, SectorAnalysisItem, StockIssueItem } from "@/lib/api";

export interface IntelDetailData {
  id?: number;
  source_type: string;
  source_url?: string | null;
  summary?: string | null;
  key_points?: string[];
  mentioned_stocks?: string[];
  mentioned_sectors?: string[];
  keywords?: string[];
  sentiment?: string | null;
  analyzed_at?: string | null;
  stock_issues?: StockIssueItem[];
  macro_analysis?: MacroAnalysis;
  sector_analysis?: SectorAnalysisItem[];
  source_document?: string | null;
}

type DetailTab = "analysis" | "document" | "source";

function SentDot({ s }: { s: string }) {
  if (s === "POSITIVE") return <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />;
  if (s === "NEGATIVE") return <span className="h-1.5 w-1.5 rounded-full bg-red-500 shrink-0" />;
  return <span className="h-1.5 w-1.5 rounded-full bg-neutral-400 shrink-0" />;
}

function MacroSectorBlock({ macro, sectors }: { macro?: MacroAnalysis; sectors?: SectorAnalysisItem[] }) {
  const hasMacro = macro && (macro.summary || (macro.topics?.length ?? 0) > 0);
  const hasSector = sectors && sectors.length > 0;
  if (!hasMacro && !hasSector) return null;

  return (
    <div className="space-y-2">
      {hasMacro && (
        <div className="rounded-md border border-purple-200 bg-purple-50 dark:border-purple-800 dark:bg-purple-900/15 p-2.5">
          <p className="text-[10px] font-semibold text-purple-700 dark:text-purple-400 mb-1">🌍 매크로 분석</p>
          {macro!.summary && <p className="text-xs text-neutral-600 dark:text-neutral-400 mb-1.5 whitespace-pre-wrap">{macro!.summary}</p>}
          {macro!.topics?.map((t, i) => (
            <div key={i} className="flex gap-2 items-start mb-1.5">
              <SentDot s={t.sentiment} />
              <div>
                <span className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">{t.topic}</span>
                <p className="text-xs text-neutral-600 dark:text-neutral-400 whitespace-pre-wrap">{t.summary}</p>
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
                  <span className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">{s.sector}</span>
                  <p className="text-xs text-neutral-600 dark:text-neutral-400 whitespace-pre-wrap">{s.summary}</p>
                  {s.outlook && <p className="text-[10px] text-neutral-400">전망: {s.outlook}</p>}
                  {s.mentioned_stocks && s.mentioned_stocks.length > 0 && (
                    <p className="text-[10px] text-neutral-400 mt-0.5">언급: {s.mentioned_stocks.join(", ")}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function DocumentBlock({ text, emptyLabel }: { text?: string | null; emptyLabel: string }) {
  if (!text?.trim()) {
    return <p className="text-xs text-neutral-400 py-4 text-center">{emptyLabel}</p>;
  }
  return (
    <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--background)] p-3 max-h-96 overflow-y-auto">
      <p className="text-[10px] text-neutral-400 mb-2">{text.length.toLocaleString()}자</p>
      <pre className="text-xs text-neutral-700 dark:text-neutral-300 whitespace-pre-wrap font-sans leading-relaxed">{text}</pre>
    </div>
  );
}

export function IntelDetailPanel({ data, compact = false }: { data: IntelDetailData; compact?: boolean }) {
  const isYoutube = data.source_type === "YOUTUBE";
  const isTextOrNews = data.source_type === "TEXT" || data.source_type === "NEWS";

  const tabs = [
    { id: "analysis" as const, label: "구조화 분석", show: true },
    { id: "document" as const, label: "추출 문서", show: isYoutube && !!data.source_document },
    { id: "source" as const, label: "원본 텍스트", show: isTextOrNews && !!data.source_document },
  ].filter((t) => t.show);

  const [tab, setTab] = useState<DetailTab>("analysis");

  const sentLabel: Record<string, string> = { POSITIVE: "긍정", NEGATIVE: "부정", NEUTRAL: "중립" };
  const s = data.sentiment ?? "NEUTRAL";

  return (
    <div className={`space-y-3 ${compact ? "text-xs" : "text-sm"}`}>
      {tabs.length > 1 && (
        <div className="flex gap-1 rounded-md border border-[var(--border-subtle)] p-0.5 bg-[var(--surface-elevated)]">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`flex-1 rounded px-2 py-1 text-[10px] font-medium transition-colors ${
                tab === t.id
                  ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                  : "text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {tab === "analysis" && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${
              s === "POSITIVE" ? "text-emerald-700 dark:text-emerald-400" :
              s === "NEGATIVE" ? "text-red-700 dark:text-red-400" :
              "text-neutral-600 dark:text-neutral-400"
            }`}>
              {s === "POSITIVE" ? <TrendingUp size={11} /> : s === "NEGATIVE" ? <TrendingDown size={11} /> : <Minus size={11} />}
              {sentLabel[s] ?? s}
            </span>
            {data.analyzed_at && (
              <span className="text-[10px] text-neutral-400">{new Date(data.analyzed_at).toLocaleString("ko-KR")}</span>
            )}
          </div>

          {data.summary && (
            <div>
              <p className="text-[10px] font-semibold text-neutral-500 mb-1">요약</p>
              <p className="text-xs text-neutral-700 dark:text-neutral-300 leading-relaxed whitespace-pre-wrap">{data.summary}</p>
            </div>
          )}

          {(data.key_points?.length ?? 0) > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-neutral-500 mb-1">핵심 포인트</p>
              <ul className="space-y-1">
                {data.key_points!.map((p, i) => (
                  <li key={i} className="flex gap-2 text-xs text-neutral-600 dark:text-neutral-400">
                    <span className="shrink-0 text-neutral-300">•</span>
                    <span className="whitespace-pre-wrap">{p}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {(data.stock_issues?.length ?? 0) > 0 && (
            <div className="rounded-md border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/15 p-2.5">
              <p className="text-[10px] font-semibold text-amber-700 dark:text-amber-400 mb-1.5">
                📌 내 보유 종목 ({data.stock_issues!.length}개)
              </p>
              <div className="space-y-2">
                {data.stock_issues!.map((iss, i) => (
                  <div key={i} className="flex gap-2">
                    <SentDot s={iss.sentiment} />
                    <div>
                      <span className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">{iss.name}</span>
                      <p className="text-xs text-neutral-600 dark:text-neutral-400 whitespace-pre-wrap">{iss.issue_summary}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <MacroSectorBlock macro={data.macro_analysis} sectors={data.sector_analysis} />

          {((data.keywords?.length ?? 0) > 0 || (data.mentioned_stocks?.length ?? 0) > 0 || (data.mentioned_sectors?.length ?? 0) > 0) && (
            <div className="flex flex-wrap gap-1">
              {data.mentioned_sectors?.map((sec) => (
                <span key={sec} className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] text-blue-700 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-400">{sec}</span>
              ))}
              {data.mentioned_stocks?.map((st) => (
                <span key={st} className="rounded-full border border-[var(--border-subtle)] px-2 py-0.5 text-[10px] text-neutral-600 dark:text-neutral-400">{st}</span>
              ))}
              {data.keywords?.map((kw) => (
                <span key={kw} className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] text-neutral-500 dark:bg-neutral-800">#{kw}</span>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "document" && (
        <DocumentBlock
          text={data.source_document}
          emptyLabel={isYoutube ? "추출 문서가 없습니다. 영상을 다시 분석하세요." : "저장된 문서가 없습니다."}
        />
      )}

      {tab === "source" && (
        <>
          {isTextOrNews ? (
            <DocumentBlock text={data.source_document} emptyLabel="원본 텍스트가 없습니다." />
          ) : isYoutube && data.source_url ? (
            <p className="text-xs text-neutral-500">
              YouTube 원본은 영상 링크에서 확인하세요.{" "}
              <a href={data.source_url} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">
                영상 열기
              </a>
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
