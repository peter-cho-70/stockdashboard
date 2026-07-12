import { create } from "zustand";
import type {
  Transaction,
  Budget,
  CategoryInfo,
  LedgerSettings,
} from "@/lib/finance/types";
import { DEFAULT_CATEGORY_META } from "@/lib/finance/types";
import { api } from "@/lib/api";

interface LedgerState {
  transactions: Transaction[];
  budgets: Budget[];
  settings: LedgerSettings;

  ready: boolean;
  saving: boolean;
  error: string | null;

  load: () => Promise<void>;

  addTransaction: (t: Transaction) => void;
  addTransactions: (items: Transaction[]) => void;
  updateTransaction: (id: string, t: Partial<Transaction>) => void;
  deleteTransaction: (id: string) => void;

  setBudget: (category: string, limit: number) => void;
  deleteBudget: (category: string) => void;

  updateSettings: (settings: Partial<LedgerSettings>) => void;
  addCategory: (category: CategoryInfo) => void;
  deleteCategory: (name: string) => void;
  addCardIssuer: (name: string) => void;
  deleteCardIssuer: (name: string) => void;
  addUser: (name: string) => void;
  deleteUser: (name: string) => void;

  resetData: () => Promise<void>;

  getMonthTransactions: (year: number, month: number) => Transaction[];
  getMonthExpenses: (year: number, month: number) => number;
  getMonthIncome: (year: number, month: number) => number;
  getCategorySpending: (
    year: number,
    month: number,
    category: string
  ) => number;
  getCategoryIncome: (
    year: number,
    month: number,
    category: string
  ) => number;
  /** 특정 부채에 연결된 이자(지출) 합계. year/month 지정 시 해당 월, 미지정 시 전체 누적 */
  getLiabilityInterest: (
    liabilityId: string,
    year?: number,
    month?: number
  ) => number;
}

const INITIAL_CATEGORIES = Object.values(DEFAULT_CATEGORY_META);
const INITIAL_CARD_ISSUERS = [
  "삼성카드",
  "현대카드",
  "신한카드",
  "국민카드",
  "롯데카드",
  "우리카드",
  "하나카드",
  "NH농협카드",
];

const INITIAL_SETTINGS: LedgerSettings = {
  categories: INITIAL_CATEGORIES,
  cardIssuers: INITIAL_CARD_ISSUERS,
  users: [],
};

let saveTimer: ReturnType<typeof setTimeout> | null = null;

function pickPersisted(state: LedgerState) {
  return {
    transactions: state.transactions,
    budgets: state.budgets,
    settings: state.settings,
  };
}

function scheduleSave(get: () => LedgerState) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      useLedgerStore.setState({ saving: true, error: null });
      await api.saveLedgerState(pickPersisted(get()));
      useLedgerStore.setState({ saving: false });
    } catch (err) {
      useLedgerStore.setState({
        saving: false,
        error: err instanceof Error ? err.message : "저장 실패",
      });
    }
  }, 400);
}

export const useLedgerStore = create<LedgerState>()((set, get) => ({
  transactions: [],
  budgets: [],
  settings: INITIAL_SETTINGS,
  ready: false,
  saving: false,
  error: null,

  load: async () => {
    try {
      const state = await api.getLedgerState();
      set({
        transactions: state.transactions ?? [],
        budgets: state.budgets ?? [],
        settings: {
          ...INITIAL_SETTINGS,
          ...state.settings,
          categories:
            state.settings?.categories ?? INITIAL_SETTINGS.categories,
          cardIssuers:
            state.settings?.cardIssuers ?? INITIAL_SETTINGS.cardIssuers,
          users: state.settings?.users ?? INITIAL_SETTINGS.users,
        },
        ready: true,
        error: null,
      });
    } catch (err) {
      set({
        ready: true,
        error: err instanceof Error ? err.message : "불러오기 실패",
      });
    }
  },

  addTransaction: (t) => {
    set((s) => ({ transactions: [t, ...s.transactions] }));
    scheduleSave(get);
  },
  addTransactions: (items) => {
    set((s) => ({ transactions: [...items, ...s.transactions] }));
    scheduleSave(get);
  },
  updateTransaction: (id, t) => {
    set((s) => ({
      transactions: s.transactions.map((x) =>
        x.id === id ? { ...x, ...t } : x
      ),
    }));
    scheduleSave(get);
  },
  deleteTransaction: (id) => {
    set((s) => ({
      transactions: s.transactions.filter((x) => x.id !== id),
    }));
    scheduleSave(get);
  },

  setBudget: (category, limit) => {
    set((s) => {
      const existing = s.budgets.find((b) => b.category === category);
      if (existing) {
        return {
          budgets: s.budgets.map((b) =>
            b.category === category ? { ...b, monthlyLimit: limit } : b
          ),
        };
      }
      return {
        budgets: [
          ...s.budgets,
          { id: `b${Date.now()}`, category, monthlyLimit: limit },
        ],
      };
    });
    scheduleSave(get);
  },
  deleteBudget: (category) => {
    set((s) => ({
      budgets: s.budgets.filter((b) => b.category !== category),
    }));
    scheduleSave(get);
  },

  updateSettings: (newSettings) => {
    set((s) => ({ settings: { ...s.settings, ...newSettings } }));
    scheduleSave(get);
  },
  addCategory: (cat) => {
    set((s) => ({
      settings: {
        ...s.settings,
        categories: [...s.settings.categories, cat],
      },
    }));
    scheduleSave(get);
  },
  deleteCategory: (name) => {
    set((s) => ({
      settings: {
        ...s.settings,
        categories: s.settings.categories.filter((c) => c.name !== name),
      },
    }));
    scheduleSave(get);
  },
  addCardIssuer: (name) => {
    set((s) => ({
      settings: {
        ...s.settings,
        cardIssuers: [...s.settings.cardIssuers, name],
      },
    }));
    scheduleSave(get);
  },
  deleteCardIssuer: (name) => {
    set((s) => ({
      settings: {
        ...s.settings,
        cardIssuers: s.settings.cardIssuers.filter((n) => n !== name),
      },
    }));
    scheduleSave(get);
  },
  addUser: (name) => {
    set((s) => ({
      settings: {
        ...s.settings,
        users: [...(s.settings.users ?? []), name],
      },
    }));
    scheduleSave(get);
  },
  deleteUser: (name) => {
    set((s) => ({
      settings: {
        ...s.settings,
        users: (s.settings.users ?? []).filter((n) => n !== name),
      },
    }));
    scheduleSave(get);
  },

  resetData: async () => {
    const state = await api.resetLedgerState();
    set({
      transactions: state.transactions ?? [],
      budgets: state.budgets ?? [],
      settings: {
        ...INITIAL_SETTINGS,
        ...state.settings,
      },
      error: null,
    });
  },

  getMonthTransactions: (year, month) => {
    const prefix = `${year}-${String(month).padStart(2, "0")}`;
    return get().transactions.filter((t) => t.date.startsWith(prefix));
  },
  getMonthExpenses: (year, month) => {
    return get()
      .getMonthTransactions(year, month)
      .filter((t) => t.type === "expense")
      .reduce((s, t) => s + t.amount, 0);
  },
  getMonthIncome: (year, month) => {
    return get()
      .getMonthTransactions(year, month)
      .filter((t) => t.type === "income")
      .reduce((s, t) => s + t.amount, 0);
  },
  getCategorySpending: (year, month, category) => {
    return get()
      .getMonthTransactions(year, month)
      .filter((t) => t.type === "expense" && t.category === category)
      .reduce((s, t) => s + t.amount, 0);
  },
  getCategoryIncome: (year, month, category) => {
    return get()
      .getMonthTransactions(year, month)
      .filter((t) => t.type === "income" && t.category === category)
      .reduce((s, t) => s + t.amount, 0);
  },
  getLiabilityInterest: (liabilityId, year, month) => {
    const prefix =
      year != null && month != null
        ? `${year}-${String(month).padStart(2, "0")}`
        : null;
    return get()
      .transactions.filter((t) => {
        if (t.linkedLiabilityId !== liabilityId) return false;
        if (t.type !== "expense") return false;
        if (prefix && !t.date.startsWith(prefix)) return false;
        return true;
      })
      .reduce((s, t) => s + t.amount, 0);
  },
}));
