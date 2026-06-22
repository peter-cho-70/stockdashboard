"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, AlertCircle, ChevronRight, TrendingUp } from "lucide-react";
import { useRoutineStore, type DailyRoutine } from "@/lib/routineStore";

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  const days = ["일", "월", "화", "수", "목", "금", "토"];
  const [y, m, day] = dateStr.split("-");
  return `${y}.${m}.${day} (${days[d.getDay()]})`;
}

function completedCount(r: DailyRoutine): number {
  return [r.phase1, r.phase2, r.phase3, r.phase4, r.phase5, r.phase6].filter(Boolean).length;
}

function StatusBadge({ r }: { r: DailyRoutine }) {
  if (r.overallStatus === "completed") {
    return (
      <span className="flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
        <CheckCircle2 size={10} /> 완료
      </span>
    );
  }
  const done = completedCount(r);
  if (done > 0) {
    return (
      <span className="flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
        <AlertCircle size={10} /> Phase {done}/6
      </span>
    );
  }
  return (
    <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-semibold text-neutral-500 dark:bg-neutral-800">
      미완료
    </span>
  );
}

function MonthStats({ entries }: { entries: DailyRoutine[] }) {
  if (entries.length === 0) return null;
  const completed = entries.filter((r) => r.overallStatus === "completed").length;
  const rate = Math.round((completed / entries.length) * 100);

  const scenarioCounts = { A: 0, B: 0, C: 0, none: 0 };
  entries.forEach((r) => {
    const sc = r.phase6?.executedScenario ?? "none";
    scenarioCounts[sc] = (scenarioCounts[sc] ?? 0) + 1;
  });
  const total = completed;
  const hitA = scenarioCounts.A + scenarioCounts.B + scenarioCounts.C;
  const hitRate = total > 0 ? Math.round((hitA / total) * 100) : 0;

  return (
    <div className="mb-6 grid grid-cols-3 gap-3">
      {[
        { label: "완료율", value: `${rate}%`, sub: `${completed}/${entries.length}일` },
        { label: "시나리오 실행", value: `${hitRate}%`, sub: `${hitA}/${total}회` },
        { label: "이번 달", value: `${entries.length}일`, sub: "기록" },
      ].map(({ label, value, sub }) => (
        <div key={label} className="rounded-xl border border-neutral-200 bg-white p-3 text-center dark:border-neutral-700 dark:bg-neutral-900">
          <p className="text-xs text-neutral-400">{label}</p>
          <p className="mt-1 text-xl font-bold text-neutral-900 dark:text-neutral-100">{value}</p>
          <p className="text-[10px] text-neutral-400">{sub}</p>
        </div>
      ))}
    </div>
  );
}

export default function JournalPage() {
  const store = useRoutineStore();
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  if (!mounted) return null;

  const all = [...store.archive, ...(store.today ? [store.today] : [])];
  const sorted = all.sort((a, b) => b.date.localeCompare(a.date));

  // Group by month
  const grouped: Record<string, DailyRoutine[]> = {};
  sorted.forEach((r) => {
    const key = r.date.slice(0, 7);
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(r);
  });

  const months = Object.keys(grouped).sort((a, b) => b.localeCompare(a));
  const thisMonth = new Date().toISOString().slice(0, 7);
  const thisMonthEntries = grouped[thisMonth] ?? [];

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      {/* Header */}
      <div className="mb-6 flex items-center gap-3">
        <Link href="/morning" className="rounded-lg p-2 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors">
          <ArrowLeft size={18} className="text-neutral-600 dark:text-neutral-400" />
        </Link>
        <div>
          <h1 className="text-xl font-bold text-neutral-900 dark:text-neutral-100">매매 일지</h1>
          <p className="text-xs text-neutral-400">루틴 완료 기록 아카이브</p>
        </div>
      </div>

      {/* This month stats */}
      <MonthStats entries={thisMonthEntries} />

      {/* Empty state */}
      {sorted.length === 0 && (
        <div className="rounded-xl border border-dashed border-neutral-300 p-10 text-center dark:border-neutral-700">
          <TrendingUp size={32} className="mx-auto mb-3 text-neutral-300" />
          <p className="text-sm text-neutral-500">아직 완료된 루틴이 없습니다.</p>
          <Link href="/morning" className="mt-3 inline-block text-sm text-blue-500 hover:underline">
            오늘 루틴 시작하기 →
          </Link>
        </div>
      )}

      {/* Grouped list */}
      <div className="space-y-6">
        {months.map((month) => {
          const [y, m] = month.split("-");
          return (
            <div key={month}>
              <h2 className="mb-2 text-xs font-semibold text-neutral-400 uppercase">
                {y}년 {parseInt(m)}월
              </h2>
              <div className="space-y-2">
                {grouped[month].map((r) => {
                  const sc = r.phase6?.executedScenario;
                  const action =
                    sc === "A" ? r.phase4?.scenarioA.action
                    : sc === "B" ? r.phase4?.scenarioB.action
                    : sc === "C" ? r.phase4?.scenarioC.action
                    : null;
                  return (
                    <Link
                      key={r.id}
                      href={`/morning/journal/${r.date}`}
                      className="flex items-center gap-4 rounded-xl border border-neutral-200 bg-white p-4 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:hover:bg-neutral-800 transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-sm font-medium text-neutral-800 dark:text-neutral-200">
                            {formatDate(r.date)}
                          </span>
                          <StatusBadge r={r} />
                        </div>
                        {sc && sc !== "none" && (
                          <p className="text-xs text-neutral-400 truncate">
                            시나리오 {sc}{action ? ` — ${action}` : ""}
                          </p>
                        )}
                        {r.phase1 && (
                          <p className={`text-xs mt-0.5 ${r.phase1.marketSentiment === "risk_on" ? "text-red-500" : r.phase1.marketSentiment === "risk_off" ? "text-blue-500" : "text-yellow-500"}`}>
                            나스닥 {r.phase1.nasdaq > 0 ? "+" : ""}{r.phase1.nasdaq.toFixed(2)}% · VIX {r.phase1.vix.toFixed(1)}
                          </p>
                        )}
                      </div>
                      <ChevronRight size={16} className="shrink-0 text-neutral-300" />
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
