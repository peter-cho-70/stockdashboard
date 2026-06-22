"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  Circle,
  Clock,
  Flame,
  BookOpen,
  Loader2,
  RefreshCw,
  ChevronRight,
} from "lucide-react";
import {
  useRoutineStore,
  phaseLabel,
  phaseTime,
  type DailyRoutine,
} from "@/lib/routineStore";
import { useSnapshot } from "@/lib/useSnapshot";
import {
  Phase1,
  Phase2,
  Phase3,
  Phase4,
  Phase5,
  Phase6,
} from "@/components/morning/phase-forms";

const PHASE_NUMS = [1, 2, 3, 4, 5, 6] as const;
type PhaseNum = 1 | 2 | 3 | 4 | 5 | 6;

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
        `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
      );
    }
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return label;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  const days = ["일", "월", "화", "수", "목", "금", "토"];
  return `${dateStr.replace(/-/g, ".")} (${days[d.getDay()]})`;
}

function pctColor(v: number | null): string {
  if (v === null) return "text-neutral-400";
  if (v > 0) return "text-red-500 dark:text-red-400";
  if (v < 0) return "text-blue-500 dark:text-blue-400";
  return "text-neutral-500";
}

function pctStr(v: number | null): string {
  if (v === null) return "—";
  return `${v > 0 ? "+" : ""}${v.toFixed(2)}%`;
}

export default function MorningDashboard() {
  const store = useRoutineStore();
  const [mounted, setMounted] = useState(false);
  const [selectedPhase, setSelectedPhase] = useState<PhaseNum>(1);
  const countdown = useCountdown();
  // autoFetch=true: 마운트 시 캐시가 만료됐을 때만 자동 조회
  const { snapshot, loading: snapLoading, error: snapError, refresh: refreshSnap } =
    useSnapshot({ autoFetch: true });

  useEffect(() => {
    store.initToday();
    // initToday()가 Zustand store를 동기적으로 업데이트하므로 getState()로 즉시 읽기
    const today = useRoutineStore.getState().today;
    setSelectedPhase((today?.currentPhase ?? 1) as PhaseNum);
    setMounted(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!mounted) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="animate-spin text-neutral-400" size={28} />
      </div>
    );
  }

  const today = store.today!;
  const completed = countCompleted(today);
  const pct = Math.round((completed / 6) * 100);
  const streak = store.getStreak();
  const yesterday = store.getYesterdaySummary();

  const phaseStatus = (n: number): "completed" | "active" | "pending" => {
    const data = [null, today.phase1, today.phase2, today.phase3, today.phase4, today.phase5, today.phase6][n];
    if (data) return "completed";
    if (n === today.currentPhase) return "active";
    return "pending";
  };

  const handlePhaseComplete = () => {
    const next = Math.min(selectedPhase + 1, 6) as PhaseNum;
    setSelectedPhase(next);
  };

  const phaseComponents: Record<PhaseNum, React.ReactNode> = {
    1: <Phase1 onComplete={handlePhaseComplete} />,
    2: <Phase2 onComplete={handlePhaseComplete} />,
    3: <Phase3 onComplete={handlePhaseComplete} />,
    4: <Phase4 onComplete={handlePhaseComplete} />,
    5: <Phase5 onComplete={handlePhaseComplete} />,
    6: <Phase6 onComplete={handlePhaseComplete} />,
  };

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      {/* Header */}
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">아침 루틴</h1>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            {formatDate(today.date)}
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-xl border border-neutral-200 bg-white px-4 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900">
          <Clock size={14} className="text-neutral-400" />
          <span className="font-mono font-medium">
            {countdown === "개장 중" ? (
              <span className="text-emerald-500">개장 중</span>
            ) : (
              <>
                <span className="text-neutral-400 text-xs mr-1">개장까지</span>
                <span>{countdown}</span>
              </>
            )}
          </span>
        </div>
      </div>

      {/* 시장 현황 */}
      <div className="mb-6 rounded-xl border border-neutral-200 bg-white dark:border-neutral-700 dark:bg-neutral-900">
        <div className="flex items-center justify-between border-b border-neutral-100 px-4 py-2.5 dark:border-neutral-800">
          <span className="text-xs font-semibold text-neutral-500">미국 증시 현황</span>
          <div className="flex items-center gap-2">
            {snapshot && (
              <span className="text-[10px] text-neutral-400">
                {snapshot.fetchedAt.slice(0, 16).replace("T", " ")}
              </span>
            )}
            <button
              onClick={() => refreshSnap()}
              disabled={snapLoading}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:opacity-40 transition-colors"
            >
              {snapLoading ? (
                <Loader2 size={10} className="animate-spin" />
              ) : (
                <RefreshCw size={10} />
              )}
              갱신
            </button>
          </div>
        </div>
        {snapError && <p className="px-4 py-2 text-xs text-red-500">{snapError}</p>}
        {!snapshot && snapLoading && (
          <div className="flex items-center justify-center gap-2 py-4 text-xs text-neutral-400">
            <Loader2 size={12} className="animate-spin" /> 시장 데이터 불러오는 중...
          </div>
        )}
        {!snapshot && !snapLoading && !snapError && (
          <p className="px-4 py-3 text-xs text-neutral-400">
            갱신 버튼을 눌러 시장 데이터를 불러오세요.
          </p>
        )}
        {snapshot && (
          <div className="grid grid-cols-3 divide-x divide-neutral-100 dark:divide-neutral-800 sm:grid-cols-5">
            {[
              {
                label: "나스닥",
                value: snapshot.nasdaq,
                isPrice: false,
                help: "전일 마감 등락률",
              },
              {
                label: "S&P 500",
                value: snapshot.sp500,
                isPrice: false,
                help: "미국 대표 지수 등락률",
              },
              {
                label: "SOX",
                value: snapshot.sox,
                isPrice: false,
                help: "필라델피아 반도체 지수",
              },
              {
                label: "VIX",
                value: snapshot.vix,
                isPrice: true,
                help: "공포지수 (20 이상이면 경고)",
              },
              {
                label: "₩/USD",
                value: snapshot.usdKrw,
                isPrice: true,
                help: "원/달러 환율 (고평가·자금이탈 체크)",
              },
            ].map(({ label, value, isPrice, help }) => (
              <div key={label} className="flex flex-col items-center py-3 px-2 text-center">
                <span className="text-[10px] text-neutral-400">{label}</span>
                <span
                  className={`mt-0.5 text-sm font-bold tabular-nums ${
                    isPrice
                      ? "text-neutral-700 dark:text-neutral-300"
                      : pctColor(value)
                  }`}
                >
                  {isPrice
                    ? value !== null
                      ? label === "₩/USD"
                        ? value.toFixed(0)
                        : value.toFixed(1)
                      : "—"
                    : pctStr(value)}
                </span>
                <span className="mt-0.5 text-[10px] leading-snug text-neutral-400">
                  {help}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Phase 스테퍼 탭 */}
      <div className="mb-4">
        <div className="mb-3 flex items-center justify-between text-xs text-neutral-400">
          <span>
            진행률 {pct}%{" "}
            <span className="text-neutral-300">({completed}/6 완료)</span>
          </span>
          {today.overallStatus === "completed" && (
            <span className="text-emerald-500 font-medium">✅ 오늘 루틴 완료!</span>
          )}
        </div>
        {/* 프로그레스 바 */}
        <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
          <div
            className="h-full rounded-full bg-emerald-500 transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
        {/* Phase 탭 버튼 */}
        <div className="grid grid-cols-6 gap-1.5">
          {PHASE_NUMS.map((n) => {
            const status = phaseStatus(n);
            const isSelected = selectedPhase === n;
            return (
              <button
                key={n}
                onClick={() => setSelectedPhase(n)}
                className={`flex flex-col items-center rounded-xl border py-2.5 px-1 transition-all ${
                  isSelected
                    ? "border-blue-400 bg-blue-50 shadow-sm dark:border-blue-700 dark:bg-blue-950/30"
                    : status === "completed"
                    ? "border-emerald-200 bg-emerald-50/60 dark:border-emerald-900/40 dark:bg-emerald-950/20"
                    : "border-neutral-200 bg-white hover:border-neutral-300 dark:border-neutral-700 dark:bg-neutral-900"
                }`}
              >
                <span className="mb-1">
                  {status === "completed" ? (
                    <CheckCircle2 size={15} className="text-emerald-500" />
                  ) : isSelected ? (
                    <div className="h-3.5 w-3.5 rounded-full bg-blue-400" />
                  ) : status === "active" ? (
                    <div className="h-3.5 w-3.5 rounded-full border-2 border-blue-400 bg-blue-100 dark:bg-blue-900" />
                  ) : (
                    <Circle size={15} className="text-neutral-300 dark:text-neutral-600" />
                  )}
                </span>
                <span
                  className={`text-[10px] font-bold ${
                    isSelected
                      ? "text-blue-600 dark:text-blue-400"
                      : status === "completed"
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-neutral-400"
                  }`}
                >
                  P{n}
                </span>
                <span
                  className={`text-[9px] ${
                    isSelected ? "text-blue-400" : "text-neutral-300 dark:text-neutral-600"
                  }`}
                >
                  {phaseTime(n)}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 현재 Phase 제목 */}
      <div className="mb-4 flex items-center justify-between rounded-xl border border-neutral-200 bg-white px-4 py-3 dark:border-neutral-700 dark:bg-neutral-900">
        <div>
          <p className="text-xs font-semibold text-neutral-400">
            Phase {selectedPhase} · {phaseTime(selectedPhase)}
          </p>
          <h2 className="text-base font-bold text-neutral-900 dark:text-neutral-100">
            {phaseLabel(selectedPhase)}
          </h2>
        </div>
        {phaseStatus(selectedPhase) === "completed" && (
          <span className="text-xs font-medium text-emerald-500">완료 ✅</span>
        )}
      </div>

      {/* Phase 인라인 폼 */}
      {phaseComponents[selectedPhase]}

      {/* 하단 정보 */}
      <div className="mt-6 grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-900">
          <p className="mb-1 text-xs font-medium text-neutral-400">어제 결과</p>
          {yesterday ? (
            <>
              <p className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">
                시나리오 {yesterday.scenario}
              </p>
              {yesterday.note && (
                <p className="mt-1 text-xs text-neutral-500 line-clamp-2">{yesterday.note}</p>
              )}
            </>
          ) : (
            <p className="text-sm text-neutral-400">기록 없음</p>
          )}
        </div>
        <div className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-900">
          <p className="mb-1 text-xs font-medium text-neutral-400">연속 완료</p>
          <div className="flex items-center gap-2">
            <Flame
              size={20}
              className={streak > 0 ? "text-orange-500" : "text-neutral-300"}
            />
            <span className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">
              {streak}
            </span>
            <span className="text-sm text-neutral-400">일</span>
          </div>
        </div>
      </div>

      <Link
        href="/morning/journal"
        className="mt-3 flex items-center gap-3 rounded-xl border border-neutral-200 bg-white p-4 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
      >
        <BookOpen size={16} className="text-neutral-400" />
        <span>매매 일지 보기</span>
        <ChevronRight size={14} className="ml-auto text-neutral-300" />
      </Link>
    </div>
  );
}
