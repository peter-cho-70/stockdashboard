import { create } from "zustand";
import {
  CashAsset,
  IlliquidAsset,
  RealEstateAsset,
  Liability,
  FixedExpense,
  Income,
  FundingNeed,
} from "@/lib/finance/types";
import type { RealEstateValuation } from "@/lib/finance/types";
import { api } from "@/lib/api";
import {
  computePaymentCoverage,
  type PaymentCoverageResult,
} from "@/lib/finance/payment-coverage";
import { advanceDueDate } from "@/lib/finance/fixed-expense-utils";

interface FinanceState {
  cashAssets: CashAsset[];
  illiquidAssets: IlliquidAsset[];
  realEstateAssets: RealEstateAsset[];
  liabilities: Liability[];
  fixedExpenses: FixedExpense[];
  incomes: Income[];
  fundingNeeds: FundingNeed[];

  stockSnapshot: {
    total_value: number;
    total_purchase: number;
    total_profit: number;
    total_profit_rate: number;
    stock_count: number;
    updated_at: string;
  } | null;

  ready: boolean;
  saving: boolean;
  error: string | null;

  load: () => Promise<void>;
  refreshStockSnapshot: () => Promise<void>;

  addCashAsset: (asset: CashAsset) => void;
  updateCashAsset: (id: string, asset: Partial<CashAsset>) => void;
  deleteCashAsset: (id: string) => void;

  addIlliquidAsset: (asset: IlliquidAsset) => void;
  updateIlliquidAsset: (id: string, asset: Partial<IlliquidAsset>) => void;
  deleteIlliquidAsset: (id: string) => void;

  addRealEstateAsset: (asset: RealEstateAsset) => void;
  updateRealEstateAsset: (id: string, asset: Partial<RealEstateAsset>) => void;
  deleteRealEstateAsset: (id: string) => void;
  toggleRealEstateValuation: (id: string, type: RealEstateValuation) => void;

  addLiability: (liability: Liability) => void;
  updateLiability: (id: string, liability: Partial<Liability>) => void;
  deleteLiability: (id: string) => void;

  addFixedExpense: (expense: FixedExpense) => void;
  updateFixedExpense: (id: string, expense: Partial<FixedExpense>) => void;
  deleteFixedExpense: (id: string) => void;
  markFixedExpensePaid: (id: string) => void;
  addIncome: (income: Income) => void;
  updateIncome: (id: string, income: Partial<Income>) => void;
  deleteIncome: (id: string) => void;

  addFundingNeed: (need: FundingNeed) => void;
  updateFundingNeed: (id: string, need: Partial<FundingNeed>) => void;
  deleteFundingNeed: (id: string) => void;

  resetData: () => Promise<void>;

  getAssetBreakdown: () => AssetBreakdown;
  getTotalAssets: () => number;
  getLiquidNetWorth: () => number;
  getTotalLiabilities: () => number;
  getMonthlyNetCashflow: () => number;
  getPaymentCoverage: (windowDays?: number) => PaymentCoverageResult;
}

export interface AssetBreakdown {
  bankCash: number;
  securitiesCash: number;
  stockHoldings: number;
  stockValue: number;
  usesStockSnapshot: boolean;
  illiquid: number;
  realEstate: number;
  liquidTotal: number;
  total: number;
}

function computeAssetBreakdown(state: Pick<
  FinanceState,
  "cashAssets" | "illiquidAssets" | "realEstateAssets" | "stockSnapshot"
>): AssetBreakdown {
  const bankCash = state.cashAssets
    .filter((a) => a.accountType !== "securities")
    .reduce((sum, a) => sum + a.amount, 0);
  const securitiesCash = state.cashAssets
    .filter((a) => a.accountType === "securities")
    .reduce((sum, a) => sum + a.amount, 0);
  const illiquid = state.illiquidAssets.reduce((sum, a) => sum + a.amount, 0);
  const realEstate = state.realEstateAssets.reduce(
    (sum, a) => sum + a.estimatedValue,
    0
  );
  const usesStockSnapshot = (state.stockSnapshot?.total_value ?? 0) > 0;
  const stockHoldings = usesStockSnapshot ? state.stockSnapshot!.total_value : 0;
  const stockValue = usesStockSnapshot ? stockHoldings : securitiesCash;
  const liquidTotal = bankCash + (usesStockSnapshot ? stockHoldings + securitiesCash : securitiesCash);

  return {
    bankCash,
    securitiesCash,
    stockHoldings,
    stockValue,
    usesStockSnapshot,
    illiquid,
    realEstate,
    liquidTotal,
    total: liquidTotal + illiquid + realEstate,
  };
}

let lastSnapshotDate: string | null = null;

function recordTodayAssetSnapshot(
  get: () => FinanceState,
  opts?: { force?: boolean }
) {
  const today = new Date().toISOString().slice(0, 10);
  if (!opts?.force && lastSnapshotDate === today) return;
  lastSnapshotDate = today;

  const state = get();
  const breakdown = computeAssetBreakdown(state);
  const totalLiabilities = state.liabilities.reduce((sum, l) => sum + l.principal, 0);
  api
    .recordFinanceAssetSnapshot({
      total_assets: breakdown.total,
      liquid_assets: breakdown.liquidTotal,
      illiquid_assets: breakdown.illiquid,
      real_estate_assets: breakdown.realEstate,
      total_liabilities: totalLiabilities,
      liquid_net_worth: breakdown.liquidTotal - totalLiabilities,
    })
    .catch(() => {
      lastSnapshotDate = null; // 실패하면 다음 load()에서 재시도
    });
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

function pickPersisted(state: FinanceState) {
  return {
    cashAssets: state.cashAssets,
    illiquidAssets: state.illiquidAssets,
    realEstateAssets: state.realEstateAssets,
    liabilities: state.liabilities,
    fixedExpenses: state.fixedExpenses,
    incomes: state.incomes,
    fundingNeeds: state.fundingNeeds,
  };
}

function scheduleSave(get: () => FinanceState) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const state = get();
    try {
      useFinanceStore.setState({ saving: true, error: null });
      await api.saveFinanceState(pickPersisted(get()));
      useFinanceStore.setState({ saving: false });
      recordTodayAssetSnapshot(get, { force: true });
    } catch (err) {
      useFinanceStore.setState({
        saving: false,
        error: err instanceof Error ? err.message : "저장 실패",
      });
    }
  }, 400);
}

export const useFinanceStore = create<FinanceState>()((set, get) => ({
  cashAssets: [],
  illiquidAssets: [],
  realEstateAssets: [],
  liabilities: [],
  fixedExpenses: [],
  incomes: [],
  fundingNeeds: [],
  stockSnapshot: null,
  ready: false,
  saving: false,
  error: null,

  load: async () => {
    try {
      const [state, snapshot] = await Promise.all([
        api.getFinanceState(),
        api.getFinanceStockSnapshot(),
      ]);
      const cashAssets = (state.cashAssets ?? []).map((a) =>
        a.accountType
          ? a
          : {
              ...a,
              accountType: (/증권/.test(`${a.name}${a.institution}`)
                ? "securities"
                : "bank") as CashAsset["accountType"],
            }
      );
      set({
        ...state,
        cashAssets,
        stockSnapshot: snapshot,
        ready: true,
        error: null,
      });
      recordTodayAssetSnapshot(get);
    } catch (err) {
      set({
        ready: true,
        error: err instanceof Error ? err.message : "불러오기 실패",
      });
    }
  },

  refreshStockSnapshot: async () => {
    try {
      const snapshot = await api.getFinanceStockSnapshot();
      set({ stockSnapshot: snapshot });
    } catch {
      /* optional refresh */
    }
  },

  addCashAsset: (asset) => {
    set((s) => ({ cashAssets: [...s.cashAssets, asset] }));
    scheduleSave(get);
  },
  updateCashAsset: (id, updatedAsset) => {
    set((s) => ({
      cashAssets: s.cashAssets.map((a) =>
        a.id === id ? { ...a, ...updatedAsset } : a
      ),
    }));
    scheduleSave(get);
  },
  deleteCashAsset: (id) => {
    set((s) => ({ cashAssets: s.cashAssets.filter((a) => a.id !== id) }));
    scheduleSave(get);
  },

  addIlliquidAsset: (asset) => {
    set((s) => ({ illiquidAssets: [...s.illiquidAssets, asset] }));
    scheduleSave(get);
  },
  updateIlliquidAsset: (id, updatedAsset) => {
    set((s) => ({
      illiquidAssets: s.illiquidAssets.map((a) =>
        a.id === id ? { ...a, ...updatedAsset } : a
      ),
    }));
    scheduleSave(get);
  },
  deleteIlliquidAsset: (id) => {
    set((s) => ({
      illiquidAssets: s.illiquidAssets.filter((a) => a.id !== id),
    }));
    scheduleSave(get);
  },

  addRealEstateAsset: (asset) => {
    set((s) => ({ realEstateAssets: [...s.realEstateAssets, asset] }));
    scheduleSave(get);
  },
  updateRealEstateAsset: (id, updatedAsset) => {
    set((s) => ({
      realEstateAssets: s.realEstateAssets.map((a) =>
        a.id === id ? { ...a, ...updatedAsset } : a
      ),
    }));
    scheduleSave(get);
  },
  deleteRealEstateAsset: (id) => {
    set((s) => ({
      realEstateAssets: s.realEstateAssets.filter((a) => a.id !== id),
    }));
    scheduleSave(get);
  },
  toggleRealEstateValuation: (id, type) => {
    set((s) => ({
      realEstateAssets: s.realEstateAssets.map((a) =>
        a.id === id
          ? {
              ...a,
              valuationType: type,
              estimatedValue:
                type === "official" ? a.officialPrice : a.marketPrice,
            }
          : a
      ),
    }));
    scheduleSave(get);
  },

  addLiability: (liability) => {
    set((s) => ({ liabilities: [...s.liabilities, liability] }));
    scheduleSave(get);
  },
  updateLiability: (id, updatedLiability) => {
    set((s) => ({
      liabilities: s.liabilities.map((l) =>
        l.id === id ? { ...l, ...updatedLiability } : l
      ),
    }));
    scheduleSave(get);
  },
  deleteLiability: (id) => {
    set((s) => ({ liabilities: s.liabilities.filter((l) => l.id !== id) }));
    scheduleSave(get);
  },

  addFixedExpense: (expense) => {
    set((s) => ({ fixedExpenses: [...s.fixedExpenses, expense] }));
    scheduleSave(get);
  },
  updateFixedExpense: (id, updatedExpense) => {
    set((s) => ({
      fixedExpenses: s.fixedExpenses.map((e) =>
        e.id === id ? { ...e, ...updatedExpense } : e
      ),
    }));
    scheduleSave(get);
  },
  deleteFixedExpense: (id) => {
    set((s) => ({
      fixedExpenses: s.fixedExpenses.filter((e) => e.id !== id),
    }));
    scheduleSave(get);
  },
  markFixedExpensePaid: (id) => {
    const expense = get().fixedExpenses.find((e) => e.id === id);
    if (!expense) return;
    const nextDueDate = advanceDueDate(expense.nextDueDate, expense.cycle);
    set((s) => ({
      fixedExpenses: s.fixedExpenses.map((e) =>
        e.id === id ? { ...e, nextDueDate } : e
      ),
    }));
    scheduleSave(get);
  },
  addIncome: (income) => {
    set((s) => ({ incomes: [...s.incomes, income] }));
    scheduleSave(get);
  },
  updateIncome: (id, updatedIncome) => {
    set((s) => ({
      incomes: s.incomes.map((i) =>
        i.id === id ? { ...i, ...updatedIncome } : i
      ),
    }));
    scheduleSave(get);
  },
  deleteIncome: (id) => {
    set((s) => ({ incomes: s.incomes.filter((i) => i.id !== id) }));
    scheduleSave(get);
  },

  addFundingNeed: (need) => {
    set((s) => ({ fundingNeeds: [...s.fundingNeeds, need] }));
    scheduleSave(get);
  },
  updateFundingNeed: (id, updatedNeed) => {
    set((s) => ({
      fundingNeeds: s.fundingNeeds.map((f) =>
        f.id === id ? { ...f, ...updatedNeed } : f
      ),
    }));
    scheduleSave(get);
  },
  deleteFundingNeed: (id) => {
    set((s) => ({
      fundingNeeds: s.fundingNeeds.filter((f) => f.id !== id),
    }));
    scheduleSave(get);
  },

  resetData: async () => {
    const state = await api.resetFinanceState();
    set({ ...state, error: null });
  },

  getAssetBreakdown: () => computeAssetBreakdown(get()),

  getTotalAssets: () => computeAssetBreakdown(get()).total,

  getTotalLiabilities: () => {
    return get().liabilities.reduce((sum, l) => sum + l.principal, 0);
  },

  getLiquidNetWorth: () => {
    const { liabilities } = get();
    const { liquidTotal } = computeAssetBreakdown(get());
    const debtTotal = liabilities.reduce((sum, l) => sum + l.principal, 0);
    return liquidTotal - debtTotal;
  },

  getMonthlyNetCashflow: () => {
    const { incomes, fixedExpenses } = get();
    const incomeTotal = incomes.reduce(
      (sum, i) => sum + (i.cycle === "monthly" ? i.amount : 0),
      0
    );
    const expenseTotal = fixedExpenses.reduce(
      (sum, e) => sum + (e.cycle === "monthly" ? e.amount : 0),
      0
    );
    return incomeTotal - expenseTotal;
  },

  getPaymentCoverage: (windowDays = 45) =>
    computePaymentCoverage(
      get().fixedExpenses,
      get().cashAssets,
      windowDays,
      new Date(),
      get().incomes
    ),
}));
