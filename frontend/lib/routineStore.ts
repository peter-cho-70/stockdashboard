import { create } from "zustand";
import { persist } from "zustand/middleware";

// ── Snapshot (시장 현황 캐시) ──────────────────────────────────────────────────

export interface SnapshotData {
  nasdaq: number | null;
  sp500: number | null;
  dow: number | null;
  sox: number | null;
  vix: number | null;
  us10yYield: number | null;
  dxy: number | null;
  usdKrw: number | null;
  wti: number | null;
  fetchedAt: string;   // ISO string
}

const SNAPSHOT_TTL_MS = 5 * 60 * 1000;  // 5분

export function isSnapshotStale(snap: SnapshotData | null): boolean {
  if (!snap) return true;
  return Date.now() - new Date(snap.fetchedAt).getTime() > SNAPSHOT_TTL_MS;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type MarketSentiment = "risk_on" | "neutral" | "risk_off";
export type NewsType = "FOMC" | "earnings" | "geopolitics" | "economic_indicator" | "other";
export type FuturesDirection = "up" | "neutral" | "down";
export type PhaseOverallStatus = "notStarted" | "inProgress" | "completed" | "skipped";

export interface Phase1Data {
  completedAt: string;
  nasdaq: number;
  sp500: number;
  dow: number;
  sox: number;
  vix: number;
  marketSentiment: MarketSentiment;
  memo: string;
}

export interface Phase2Data {
  completedAt: string;
  us10yYield: number;
  dxy: number;
  usdKrw: number;
  wti: number;
  newsTypes: NewsType[];
  newsMemo: string;
  macroJudgment: string;
  futuresDirection: FuturesDirection;
}

export interface StockCheck {
  id: number;
  ticker: string;
  name: string;
  checked: boolean;
  technicalNote: string;
}

export interface Phase3Data {
  completedAt: string;
  kospiPrev: number;
  kosdaqPrev: number;
  foreignerNet: number;
  institutionNet: number;
  strongSectors: string[];
  weakSectors: string[];
  stockChecks: StockCheck[];
  todayEvents: string;
  supplyDemandMemo: string;
}

export interface Scenario {
  condition: string;
  action: string;
}

export interface StockPlan {
  ticker: string;
  name: string;
  entryCondition: string;
  targetPrice: number | null;
  stopLossPrice: number | null;
  positionSizePct: number | null;
  note: string;
}

export interface Phase4Data {
  completedAt: string;
  scenarioA: Scenario;
  scenarioB: Scenario;
  scenarioC: Scenario;
  stockPlans: StockPlan[];
  holdingPlans: string;
  forbiddenActions: string;
  themeMemo: string;
}

export interface Phase5Data {
  completedAt: string;
  lateNewsMemo: string;
  scenarioAConfirmed: boolean;
  scenarioBConfirmed: boolean;
  scenarioCConfirmed: boolean;
  mentalScore: 1 | 2 | 3 | 4 | 5;
  forbiddenConfirmed: boolean;
}

export interface Phase6Data {
  completedAt: string;
  openingGap: "gapUp" | "flat" | "gapDown";
  foreignerFuturesDir: "buy" | "neutral" | "sell";
  sectorStrengthNoted: boolean;
  scenarioMatchChecked: boolean;
  executedScenario: "A" | "B" | "C" | "none";
  openingMemo: string;
}

export interface DailyRoutine {
  id: string;
  date: string;
  startedAt: string;
  completedAt: string | null;
  overallStatus: PhaseOverallStatus;
  currentPhase: 1 | 2 | 3 | 4 | 5 | 6;
  phase1: Phase1Data | null;
  phase2: Phase2Data | null;
  phase3: Phase3Data | null;
  phase4: Phase4Data | null;
  phase5: Phase5Data | null;
  phase6: Phase6Data | null;
}

// ── Utilities ─────────────────────────────────────────────────────────────────

export function judgeMarketSentiment(nasdaq: number, vix: number): MarketSentiment {
  if (nasdaq >= 1.0 && vix < 20) return "risk_on";
  if (nasdaq <= -1.0 || vix >= 20) return "risk_off";
  return "neutral";
}

export function sentimentLabel(s: MarketSentiment): { text: string; color: string } {
  if (s === "risk_on") return { text: "🔴 위험 선호 장세 — 공격적 접근 가능", color: "text-red-600 dark:text-red-400" };
  if (s === "risk_off") return { text: "🔵 위험 회피 장세 — 방어적 접근 권장", color: "text-blue-600 dark:text-blue-400" };
  return { text: "🟡 방향성 탐색 중 — 신중한 접근", color: "text-yellow-600 dark:text-yellow-400" };
}

export function todayDateStr(): string {
  return new Date().toISOString().split("T")[0];
}

export function phaseLabel(n: number): string {
  return ["", "미국 증시 마감 체크", "글로벌 매크로 분석", "국내 시장 분석", "오늘의 전략 수립", "최종 점검", "개장 초반 관찰"][n] ?? "";
}

export function phaseTime(n: number): string {
  return ["", "05:30", "06:00", "06:30", "07:30", "08:00", "09:00"][n] ?? "";
}

function archiveUpsert(archive: DailyRoutine[], entry: DailyRoutine): DailyRoutine[] {
  const idx = archive.findIndex((r) => r.date === entry.date);
  if (idx >= 0) {
    const next = [...archive];
    next[idx] = entry;
    return next;
  }
  return [...archive, entry];
}

// ── Store ─────────────────────────────────────────────────────────────────────

interface RoutineStore {
  today: DailyRoutine | null;
  archive: DailyRoutine[];
  snapshot: SnapshotData | null;

  initToday: () => void;
  setSnapshot: (snap: SnapshotData) => void;
  updatePhase1: (data: Omit<Phase1Data, "completedAt">) => void;
  updatePhase2: (data: Omit<Phase2Data, "completedAt">) => void;
  updatePhase3: (data: Omit<Phase3Data, "completedAt">) => void;
  updatePhase4: (data: Omit<Phase4Data, "completedAt">) => void;
  updatePhase5: (data: Omit<Phase5Data, "completedAt">) => void;
  updatePhase6: (data: Omit<Phase6Data, "completedAt">) => void;
  getStreak: () => number;
  getYesterdaySummary: () => { scenario: string; note: string } | null;
}

export const useRoutineStore = create<RoutineStore>()(
  persist(
    (set, get) => ({
      today: null,
      archive: [],
      snapshot: null,

      setSnapshot: (snap) => set({ snapshot: snap }),

      initToday: () => {
        const dateStr = todayDateStr();
        const existing = get().today;
        if (existing?.date === dateStr) return;
        if (existing && existing.date !== dateStr) {
          set((state) => ({ archive: archiveUpsert(state.archive, existing) }));
        }
        set({
          today: {
            id: `routine-${dateStr}`,
            date: dateStr,
            startedAt: new Date().toISOString(),
            completedAt: null,
            overallStatus: "notStarted",
            currentPhase: 1,
            phase1: null,
            phase2: null,
            phase3: null,
            phase4: null,
            phase5: null,
            phase6: null,
          },
        });
      },

      updatePhase1: (data) => {
        const now = new Date().toISOString();
        set((state) => {
          if (!state.today) return {};
          const updated: DailyRoutine = {
            ...state.today,
            phase1: { ...data, completedAt: now },
            currentPhase: Math.max(state.today.currentPhase, 2) as DailyRoutine["currentPhase"],
            overallStatus: "inProgress",
          };
          return { today: updated, archive: archiveUpsert(state.archive, updated) };
        });
      },

      updatePhase2: (data) => {
        const now = new Date().toISOString();
        set((state) => {
          if (!state.today) return {};
          const updated: DailyRoutine = {
            ...state.today,
            phase2: { ...data, completedAt: now },
            currentPhase: Math.max(state.today.currentPhase, 3) as DailyRoutine["currentPhase"],
          };
          return { today: updated, archive: archiveUpsert(state.archive, updated) };
        });
      },

      updatePhase3: (data) => {
        const now = new Date().toISOString();
        set((state) => {
          if (!state.today) return {};
          const updated: DailyRoutine = {
            ...state.today,
            phase3: { ...data, completedAt: now },
            currentPhase: Math.max(state.today.currentPhase, 4) as DailyRoutine["currentPhase"],
          };
          return { today: updated, archive: archiveUpsert(state.archive, updated) };
        });
      },

      updatePhase4: (data) => {
        const now = new Date().toISOString();
        set((state) => {
          if (!state.today) return {};
          const updated: DailyRoutine = {
            ...state.today,
            phase4: { ...data, completedAt: now },
            currentPhase: Math.max(state.today.currentPhase, 5) as DailyRoutine["currentPhase"],
          };
          return { today: updated, archive: archiveUpsert(state.archive, updated) };
        });
      },

      updatePhase5: (data) => {
        const now = new Date().toISOString();
        set((state) => {
          if (!state.today) return {};
          const updated: DailyRoutine = {
            ...state.today,
            phase5: { ...data, completedAt: now },
            currentPhase: Math.max(state.today.currentPhase, 6) as DailyRoutine["currentPhase"],
          };
          return { today: updated, archive: archiveUpsert(state.archive, updated) };
        });
      },

      updatePhase6: (data) => {
        const now = new Date().toISOString();
        set((state) => {
          if (!state.today) return {};
          const updated: DailyRoutine = {
            ...state.today,
            phase6: { ...data, completedAt: now },
            overallStatus: "completed",
            completedAt: now,
          };
          return { today: updated, archive: archiveUpsert(state.archive, updated) };
        });
      },

      getStreak: () => {
        const archive = get().archive;
        const today = new Date();
        let streak = 0;
        for (let i = 1; i <= 60; i++) {
          const d = new Date(today);
          d.setDate(d.getDate() - i);
          if (d.getDay() === 0 || d.getDay() === 6) continue;
          const dateStr = d.toISOString().split("T")[0];
          const r = archive.find((x) => x.date === dateStr);
          if (r?.overallStatus === "completed") streak++;
          else break;
        }
        return streak;
      },

      getYesterdaySummary: () => {
        const archive = get().archive;
        const d = new Date();
        d.setDate(d.getDate() - 1);
        if (d.getDay() === 0) d.setDate(d.getDate() - 2);
        if (d.getDay() === 6) d.setDate(d.getDate() - 1);
        const dateStr = d.toISOString().split("T")[0];
        const r = archive.find((x) => x.date === dateStr);
        if (!r?.phase6) return null;
        const sc = r.phase6.executedScenario;
        let note = "";
        if (sc === "A") note = r.phase4?.scenarioA.action ?? "";
        if (sc === "B") note = r.phase4?.scenarioB.action ?? "";
        if (sc === "C") note = r.phase4?.scenarioC.action ?? "";
        return { scenario: sc, note };
      },
    }),
    { name: "stockmind-morning-routine" }
  )
);
