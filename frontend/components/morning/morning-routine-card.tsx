"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  ChevronRight,
  Circle,
  Clock,
  Sunrise,
} from "lucide-react";
import {
  useRoutineStore,
  phaseLabel,
  phaseTime,
  type DailyRoutine,
} from "@/lib/routineStore";

const PHASE_NUMS = [1, 2, 3, 4, 5, 6] as const;

const PHASE_HINTS: Record<number, string> = {
  1: "미국 지수·VIX 확인",
  2: "금리·환율·유가 체크",
  3: "국내 시장·관심종목",
  4: "시나리오·매매 계획",
  5: "개장 전 최종 점검",
  6: "개장 초반 관찰",
};

function countCompleted(r: DailyRoutine): number {
  return [r.phase1, r.phase2, r.phase3, r.phase4, r.phase5, r.phase6].filter(Boolean).length;
}

function useCountdown(): string {
  const [label, setLabel] = useState("");
  useEffect(() => {
    function tick() {
      const now = new Date();
      const open = new Date();
      open.setHours(9, 0, 0, 0);
      const diff = open.getTime() - now.getTime();
      if (diff <= 0) {
        setLabel("개장 중");
        return;
      }
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setLabel(
        `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`,
      );
    }
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return label;
}

export function MorningRoutineCard() {
  const store = useRoutineStore();
  const [mounted, setMounted] = useState(false);
  const countdown = useCountdown();

  useEffect(() => {
    store.initToday();
    setMounted(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!mounted || !store.today) {
    return (
      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] p-4 shadow-xs">
        <div className="h-24 animate-pulse rounded bg-neutral-100 dark:bg-neutral-800" />
      </div>
    );
  }

  const today = store.today;
  const completed = countCompleted(today);
  const pct = Math.round((completed / 6) * 100);

  const phaseStatus = (n: number): "completed" | "active" | "pending" => {
    const data = [null, today.phase1, today.phase2, today.phase3, today.phase4, today.phase5, today.phase6][n];
    if (data) return "completed";
    if (n === today.currentPhase) return "active";
    return "pending";
  };

  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] shadow-xs overflow-hidden">
      <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-4 py-3">
        <div className="flex items-center gap-2">
          <Sunrise size={16} className="text-amber-500" />
          <h2 className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">아침 루틴</h2>
          {today.overallStatus === "completed" && (
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400">
              완료
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-neutral-500">
          <Clock size={12} />
          <span className="font-mono">
            {countdown === "개장 중" ? (
              <span className="text-emerald-500">개장 중</span>
            ) : (
              countdown
            )}
          </span>
        </div>
      </div>

      <div className="px-4 py-3">
        <div className="mb-2 flex items-center justify-between text-[11px] text-neutral-400">
          <span>진행률 {pct}%</span>
          <span>{completed}/6</span>
        </div>
        <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
          <div
            className="h-full rounded-full bg-emerald-500 transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>

        <ul className="space-y-1">
          {PHASE_NUMS.map((n) => {
            const status = phaseStatus(n);
            return (
              <li key={n}>
                <Link
                  href={`/morning`}
                  className={`flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-[var(--surface-elevated)] ${
                    status === "active"
                      ? "bg-blue-50/60 dark:bg-blue-950/20"
                      : status === "completed"
                        ? "opacity-80"
                        : ""
                  }`}
                >
                  {status === "completed" ? (
                    <CheckCircle2 size={14} className="shrink-0 text-emerald-500" />
                  ) : status === "active" ? (
                    <div className="h-3.5 w-3.5 shrink-0 rounded-full border-2 border-blue-400 bg-blue-100 dark:bg-blue-900" />
                  ) : (
                    <Circle size={14} className="shrink-0 text-neutral-300 dark:text-neutral-600" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-neutral-800 dark:text-neutral-200">
                      <span className="text-neutral-400">{phaseTime(n)}</span>{" "}
                      {phaseLabel(n)}
                    </p>
                    <p className="text-[10px] text-neutral-400">{PHASE_HINTS[n]}</p>
                  </div>
                  <ChevronRight size={12} className="shrink-0 text-neutral-300" />
                </Link>
              </li>
            );
          })}
        </ul>

        <Link
          href="/morning"
          className="mt-3 flex items-center justify-center gap-1 rounded-md border border-[var(--border-subtle)] py-2 text-xs font-medium text-neutral-600 transition-colors hover:bg-[var(--surface-elevated)] dark:text-neutral-300"
        >
          루틴 상세 입력
          <ChevronRight size={12} />
        </Link>
      </div>
    </div>
  );
}
