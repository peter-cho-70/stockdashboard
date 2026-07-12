"use client";

import { useState } from "react";
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  MinusCircle,
  ChevronDown,
  ChevronUp,
  Info,
  BookOpen,
  MapPin,
} from "lucide-react";
import type { ChartAnalysisResult, ChartSignal, Sentiment, PatternAccuracySummary } from "@/lib/chartAnalysis";
import { patternOutcomeDescription } from "@/lib/chartAnalysis";
import {
  krBullishBorderClass,
  krBearishBorderClass,
  krBullishPanelClass,
  krBearishPanelClass,
} from "@/lib/krMarketColors";
import {
  CHART_DISCLAIMER,
  GUIDE_SECTIONS,
} from "@/lib/chartGuideContent";
import { renderStudyTerms } from "@/lib/renderStudyTerms";
import { SIGNAL_LESSON_LINKS, STAGE_LESSON_LINKS } from "@/lib/studyTermGlossary";
import { StudyLessonChip } from "@/components/study-term-link";

function SentimentIcon({ sentiment, passed }: { sentiment: Sentiment; passed: boolean }) {
  if (!passed && sentiment === "warning")
    return <AlertTriangle size={14} className="text-amber-500 shrink-0" />;
  if (passed && (sentiment === "bullish" || sentiment === "neutral"))
    return <CheckCircle2 size={14} className="text-red-500 shrink-0" />;
  if (sentiment === "bearish" || !passed)
    return <XCircle size={14} className="text-blue-500 shrink-0" />;
  return <MinusCircle size={14} className="text-neutral-400 shrink-0" />;
}

function sentimentBorder(sentiment: Sentiment, passed: boolean, active: boolean) {
  const base =
    sentiment === "bullish" && passed
      ? krBullishBorderClass()
      : sentiment === "bearish" || (!passed && sentiment !== "warning")
        ? krBearishBorderClass()
        : sentiment === "warning"
          ? "border-amber-200 dark:border-amber-800/50 bg-amber-50/50 dark:bg-amber-900/10"
          : "border-[var(--border-subtle)] bg-[var(--surface-elevated)]";
  return active ? `${base} ring-2 ring-blue-400 dark:ring-blue-500` : base;
}

function SignalCard({
  signal,
  active,
  onSelect,
}: {
  signal: ChartSignal;
  active: boolean;
  onSelect: (id: string | null) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const guide = GUIDE_SECTIONS[signal.id];

  if (!signal.applicable) return null;

  const hasChartMarker = ["sr", "ma_cross", "pullback", "volume", "bollinger"].includes(signal.id);

  return (
    <button
      type="button"
      onClick={() => {
        if (!hasChartMarker) return;
        onSelect(active ? null : signal.id);
      }}
      className={`w-full text-left rounded-lg border p-3 transition-all ${sentimentBorder(signal.sentiment, signal.passed, active)} ${
        hasChartMarker ? "cursor-pointer hover:opacity-90" : "cursor-default"
      }`}
    >
      <div className="flex items-start gap-2">
        <SentimentIcon sentiment={signal.sentiment} passed={signal.passed} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] font-medium text-neutral-400 uppercase">
              {signal.category}
            </span>
            {signal.passed ? (
              <span className="text-[10px] font-medium text-red-600 dark:text-red-400">통과</span>
            ) : (
              <span className="text-[10px] font-medium text-neutral-500">미통과</span>
            )}
            {hasChartMarker && (
              <span className="inline-flex items-center gap-0.5 text-[10px] text-blue-500">
                <MapPin size={9} /> 차트 표시
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs font-semibold text-neutral-800 dark:text-neutral-200">
            {renderStudyTerms(signal.title, `title-${signal.id}`)}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-neutral-700 dark:text-neutral-300">
            {renderStudyTerms(signal.result, `result-${signal.id}`)}
          </p>
          <span
            role="presentation"
            onClick={(e) => {
              e.stopPropagation();
              setExpanded((v) => !v);
            }}
            className="mt-1.5 inline-flex items-center gap-0.5 text-[10px] text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 cursor-pointer"
          >
            <BookOpen size={10} />
            분석법 설명
            {expanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
          </span>
          {expanded && (
            <p className="mt-1.5 rounded bg-neutral-100/80 px-2 py-1.5 text-[10px] leading-relaxed text-neutral-600 dark:bg-neutral-800/50 dark:text-neutral-400">
              {renderStudyTerms(signal.method, `method-${signal.id}`)}
              {guide && (
                <span className="mt-1 block text-neutral-400">출처: 가이드 {guide.source}</span>
              )}
              {SIGNAL_LESSON_LINKS[signal.id] && (
                <span className="mt-1.5 block">
                  <StudyLessonChip lessonId={SIGNAL_LESSON_LINKS[signal.id]} />
                </span>
              )}
            </p>
          )}
        </div>
      </div>
    </button>
  );
}

function StageBlock({
  stage,
  highlight,
}: {
  stage: ChartAnalysisResult["threeStage"]["stage1"];
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border p-3 ${
        highlight
          ? "border-amber-300 dark:border-amber-700 bg-amber-50/30 dark:bg-amber-900/10"
          : "border-[var(--border-subtle)] bg-[var(--surface-elevated)]"
      }`}
    >
      <div className="flex items-center justify-between mb-2 gap-2">
        <span className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">
          {renderStudyTerms(stage.label, `stage-${stage.label}`)}
        </span>
        <div className="flex items-center gap-2 shrink-0">
          {STAGE_LESSON_LINKS[stage.label] && (
            <StudyLessonChip lessonId={STAGE_LESSON_LINKS[stage.label]} label="레슨" />
          )}
          {stage.available ? (
            <span className="text-[10px] font-medium text-neutral-500">
              {stage.passed}/{stage.total} 통과
            </span>
          ) : (
            <span className="text-[10px] font-medium text-amber-600 dark:text-amber-400">
              KIS 연동 필요
            </span>
          )}
        </div>
      </div>
      <ul className="space-y-1">
        {stage.items.map((item) => (
          <li key={item.label} className="flex items-start gap-1.5 text-[11px]">
            {item.unavailable ? (
              <MinusCircle size={12} className="mt-0.5 shrink-0 text-neutral-300" />
            ) : item.passed ? (
              <CheckCircle2 size={12} className="mt-0.5 shrink-0 text-red-500" />
            ) : (
              <XCircle size={12} className="mt-0.5 shrink-0 text-neutral-300" />
            )}
            <span
              className={
                item.unavailable
                  ? "text-neutral-400"
                  : item.passed
                    ? "text-neutral-700 dark:text-neutral-300"
                    : "text-neutral-500"
              }
            >
              {renderStudyTerms(item.label, `item-${item.label}`)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PatternAccuracyCard({
  summary,
  active,
  onSelect,
}: {
  summary: PatternAccuracySummary;
  active: boolean;
  onSelect: (id: string | null) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const insufficientData = summary.total < 3;

  return (
    <div
      className={`rounded-lg border p-3 transition-all ${
        active ? "border-blue-400 ring-2 ring-blue-400 dark:ring-blue-500" : "border-[var(--border-subtle)] bg-[var(--surface-elevated)]"
      }`}
    >
      <button
        type="button"
        onClick={() => onSelect(active ? null : "pattern_accuracy")}
        className="w-full text-left"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold text-neutral-800 dark:text-neutral-200">{summary.label}</span>
          {insufficientData ? (
            <span className="text-[10px] font-medium text-neutral-400">데이터 부족</span>
          ) : (
            <span
              className={`text-xs font-bold ${
                summary.hitRate! >= 60
                  ? "text-red-600 dark:text-red-400"
                  : summary.hitRate! >= 40
                    ? "text-amber-600 dark:text-amber-400"
                    : "text-blue-600 dark:text-blue-400"
              }`}
            >
              {summary.hitCount}/{summary.total} ({summary.hitRate}%)
            </span>
          )}
        </div>
      </button>
      {summary.outcomes.length > 0 && (
        <span
          role="presentation"
          onClick={(e) => {
            e.stopPropagation();
            setExpanded((v) => !v);
          }}
          className="mt-1.5 inline-flex items-center gap-0.5 text-[10px] text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 cursor-pointer"
        >
          <BookOpen size={10} />
          발생 내역 {summary.outcomes.length}건
          {expanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
        </span>
      )}
      {expanded && (
        <ul className="mt-1.5 space-y-1 max-h-48 overflow-y-auto pr-1">
          {[...summary.outcomes].reverse().map((o) => (
            <li
              key={`${o.type}-${o.date}`}
              className={`rounded bg-neutral-100/80 px-2 py-1 text-[10px] leading-relaxed dark:bg-neutral-800/50 ${
                o.hit === true
                  ? "text-emerald-700 dark:text-emerald-400"
                  : o.hit === false
                    ? "text-neutral-500 dark:text-neutral-400"
                    : "text-blue-600 dark:text-blue-400"
              }`}
            >
              {patternOutcomeDescription(o)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface ChartAnalysisPanelProps {
  analysis: ChartAnalysisResult;
  stockName: string;
  periodLabel?: string;
  activeSignalId: string | null;
  onSignalSelect: (id: string | null) => void;
}

export function ChartAnalysisPanel({
  analysis,
  stockName,
  periodLabel = "1개월",
  activeSignalId,
  onSignalSelect,
}: ChartAnalysisPanelProps) {
  const regimeColor =
    analysis.regime === "bull"
      ? krBullishPanelClass()
      : analysis.regime === "bear"
        ? krBearishPanelClass()
        : "text-neutral-600 dark:text-neutral-400 bg-neutral-100 dark:bg-neutral-800";

  const orderedSignals = [...analysis.signals].sort((a, b) => a.step - b.step);

  return (
    <div className="flex flex-col gap-3 h-full">
      <div>
        <h3 className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">
          차트 분석 — {stockName}
        </h3>
        <p className="mt-0.5 text-[10px] text-neutral-400">
          {periodLabel} 차트 기준 · 항목 클릭 시 차트에 해당 구간 표시 ·{" "}
          <span className="border-b border-dotted border-blue-400/60 text-blue-600 dark:text-blue-400">
            파란 밑줄
          </span>
          용어 클릭 → 주식공부하기
        </p>
      </div>

      <div className={`rounded-lg px-3 py-2 ${regimeColor}`}>
        <div className="flex items-center gap-1.5">
          <Info size={12} />
          <span className="text-xs font-semibold">시장 국면: {analysis.regimeLabel}</span>
        </div>
        <p className="mt-1 text-[11px] leading-relaxed opacity-90">{renderStudyTerms(analysis.regimeHint, "regime")}</p>
      </div>

      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-elevated)] p-3">
        <p className="text-xs font-semibold text-neutral-800 dark:text-neutral-200">
          {analysis.threeStage.verdict}
        </p>
        <p className="mt-1 text-[11px] leading-relaxed text-neutral-600 dark:text-neutral-400">
          {renderStudyTerms(analysis.threeStage.summary, "summary")}
        </p>
        <p className="mt-2 text-[10px] text-neutral-400">
          {renderStudyTerms(`손절 참고: ${analysis.stopLoss.text}`, "stop")}
        </p>
      </div>

      <div>
        <p className="mb-2 text-xs font-semibold text-neutral-700 dark:text-neutral-300">
          3단계 확인법
        </p>
        <div className="space-y-2">
          <StageBlock stage={analysis.threeStage.stage1} />
          <StageBlock stage={analysis.threeStage.stage2} highlight />
          <StageBlock stage={analysis.threeStage.stage3} />
        </div>
      </div>

      {analysis.patternAccuracy.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-semibold text-neutral-700 dark:text-neutral-300">
            이 종목 기술적 패턴 적중률
          </p>
          <p className="mb-2 text-[10px] leading-relaxed text-neutral-400">
            과거 이 종목 차트에서 패턴이 나온 뒤 실제로 예측 방향대로 움직였는지 검증한 결과입니다.
            차트의 ✓(적중)/✗(실패) 마커와 연결됩니다.
          </p>
          <div className="space-y-2">
            {analysis.patternAccuracy.map((summary) => (
              <PatternAccuracyCard
                key={summary.type}
                summary={summary}
                active={activeSignalId === "pattern_accuracy"}
                onSelect={onSignalSelect}
              />
            ))}
          </div>
        </div>
      )}

      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">
            현재 적용 가능한 분석
          </p>
          {activeSignalId && (
            <button
              type="button"
              onClick={() => onSignalSelect(null)}
              className="text-[10px] text-blue-500 hover:underline"
            >
              전체 표시
            </button>
          )}
        </div>
        <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
          {orderedSignals.map((signal) => (
            <SignalCard
              key={signal.id}
              signal={signal}
              active={activeSignalId === signal.id}
              onSelect={onSignalSelect}
            />
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-amber-200 dark:border-amber-800/50 bg-amber-50/30 dark:bg-amber-900/10 p-3">
        <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">
          2단계: 수급 분석 (Phase 2)
        </p>
        <p className="mt-1 text-[11px] leading-relaxed text-amber-900/80 dark:text-amber-200/80">
          {renderStudyTerms(GUIDE_SECTIONS.supply.body, "supply")}
        </p>
        <div className="mt-2">
          <StudyLessonChip lessonId="patterns-context" />
        </div>
      </div>

      <p className="text-[10px] leading-relaxed text-neutral-400 border-t border-[var(--border-subtle)] pt-3">
        {CHART_DISCLAIMER}
      </p>
    </div>
  );
}
