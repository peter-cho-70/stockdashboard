import type { CashAsset, FixedExpense, Income } from "@/lib/finance/types";

export type PaymentCoverageStatus = "ok" | "tight" | "shortfall" | "unknown";

export interface UpcomingPaymentCheck {
  expense: FixedExpense;
  daysUntil: number;
  accountId?: string;
  accountName?: string;
  accountBalance?: number;
  projectedBalance?: number;
  shortfall?: number;
  status: PaymentCoverageStatus;
}

export interface AccountPaymentSummary {
  accountId: string;
  accountName: string;
  balance: number;
  upcomingTotal: number;
  minProjectedBalance: number;
  shortfall: number;
  status: PaymentCoverageStatus;
}

export interface PaymentCoverageResult {
  windowDays: number;
  payments: UpcomingPaymentCheck[];
  accounts: AccountPaymentSummary[];
  shortfallCount: number;
  urgentShortfallCount: number;
}

interface CashFlowEvent {
  date: string;
  delta: number;
  expenseId?: string;
  sortKey: number;
}

function daysUntil(dateStr: string, today: Date): number {
  const due = new Date(`${dateStr}T00:00:00`);
  const base = new Date(today);
  base.setHours(0, 0, 0, 0);
  return Math.ceil((due.getTime() - base.getTime()) / 86400000);
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return d;
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function accountLabel(asset: CashAsset): string {
  return `${asset.name} · ${asset.institution}`;
}

function statusFromBalance(projected: number, paymentAmount: number): PaymentCoverageStatus {
  if (projected < 0) return "shortfall";
  if (projected < paymentAmount * 0.15) return "tight";
  return "ok";
}

function parsePayDay(income: Income, defaultDay = 25): number {
  if (income.receivedDate) {
    const day = parseInt(income.receivedDate.slice(8, 10), 10);
    if (day >= 1 && day <= 28) return day;
  }
  return defaultDay;
}

function buildIncomeCredits(
  incomes: Income[],
  accountId: string,
  today: Date,
  windowEnd: Date
): CashFlowEvent[] {
  const events: CashFlowEvent[] = [];
  const todayStr = formatDate(today);
  const windowEndStr = formatDate(windowEnd);

  for (const income of incomes) {
    if (income.cycle !== "monthly") continue;
    if (income.depositAccountId !== accountId) continue;

    const payDay = parsePayDay(income);
    const cursor = new Date(today);
    cursor.setDate(1);

    while (cursor <= windowEnd) {
      const y = cursor.getFullYear();
      const m = cursor.getMonth();
      const lastDay = new Date(y, m + 1, 0).getDate();
      const day = Math.min(payDay, lastDay);
      const creditDate = `${y}-${String(m + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

      if (creditDate >= todayStr && creditDate <= windowEndStr) {
        events.push({
          date: creditDate,
          delta: income.amount,
          sortKey: 0,
        });
      }
      cursor.setMonth(cursor.getMonth() + 1);
    }
  }

  return events;
}

export function getUpcomingFixedExpenses(
  expenses: FixedExpense[],
  windowDays = 45,
  today = new Date()
): FixedExpense[] {
  return expenses
    .filter((e) => {
      const diff = daysUntil(e.nextDueDate, today);
      return diff >= 0 && diff <= windowDays;
    })
    .sort(
      (a, b) =>
        new Date(a.nextDueDate).getTime() - new Date(b.nextDueDate).getTime()
    );
}

export function computePaymentCoverage(
  expenses: FixedExpense[],
  cashAssets: CashAsset[],
  windowDays = 45,
  today = new Date(),
  incomes: Income[] = []
): PaymentCoverageResult {
  const upcoming = getUpcomingFixedExpenses(expenses, windowDays, today);
  const bankAccounts = cashAssets.filter((a) => a.accountType !== "securities");
  const accountMap = new Map(bankAccounts.map((a) => [a.id, a]));
  const windowEnd = addDays(today, windowDays);

  const byAccount = new Map<string, FixedExpense[]>();
  for (const expense of upcoming) {
    if (!expense.paymentAccountId) continue;
    const list = byAccount.get(expense.paymentAccountId) ?? [];
    list.push(expense);
    byAccount.set(expense.paymentAccountId, list);
  }

  const projectedByExpenseId = new Map<
    string,
    { projectedBalance: number; shortfall?: number; status: PaymentCoverageStatus }
  >();

  const accounts: AccountPaymentSummary[] = [];

  for (const [accountId, list] of byAccount.entries()) {
    const account = accountMap.get(accountId);
    if (!account) continue;

    const sorted = [...list].sort(
      (a, b) =>
        new Date(a.nextDueDate).getTime() - new Date(b.nextDueDate).getTime()
    );

    const events: CashFlowEvent[] = sorted.map((expense) => ({
      date: expense.nextDueDate,
      delta: -expense.amount,
      expenseId: expense.id,
      sortKey: 1,
    }));

    events.push(...buildIncomeCredits(incomes, accountId, today, windowEnd));

    events.sort((a, b) => {
      const byDate = a.date.localeCompare(b.date);
      if (byDate !== 0) return byDate;
      return a.sortKey - b.sortKey;
    });

    let balance = account.amount;
    let minProjected = balance;
    let maxShortfall = 0;

    for (const event of events) {
      balance += event.delta;
      minProjected = Math.min(minProjected, balance);
      if (event.expenseId) {
        const expense = sorted.find((e) => e.id === event.expenseId)!;
        const shortfall = balance < 0 ? Math.abs(balance) : undefined;
        if (shortfall) maxShortfall = Math.max(maxShortfall, shortfall);
        projectedByExpenseId.set(event.expenseId, {
          projectedBalance: balance,
          shortfall,
          status: statusFromBalance(balance, expense.amount),
        });
      }
    }

    const upcomingTotal = sorted.reduce((s, e) => s + e.amount, 0);
    const accountStatus: PaymentCoverageStatus =
      minProjected < 0 ? "shortfall" : minProjected < upcomingTotal * 0.1 ? "tight" : "ok";

    accounts.push({
      accountId,
      accountName: accountLabel(account),
      balance: account.amount,
      upcomingTotal,
      minProjectedBalance: minProjected,
      shortfall: maxShortfall,
      status: accountStatus,
    });
  }

  accounts.sort((a, b) => a.minProjectedBalance - b.minProjectedBalance);

  const payments: UpcomingPaymentCheck[] = upcoming.map((expense) => {
    const days = daysUntil(expense.nextDueDate, today);
    const account = expense.paymentAccountId
      ? accountMap.get(expense.paymentAccountId)
      : undefined;
    const projection = projectedByExpenseId.get(expense.id);

    if (!expense.paymentAccountId || !account) {
      return {
        expense,
        daysUntil: days,
        status: "unknown",
      };
    }

    return {
      expense,
      daysUntil: days,
      accountId: account.id,
      accountName: accountLabel(account),
      accountBalance: account.amount,
      projectedBalance: projection?.projectedBalance,
      shortfall: projection?.shortfall,
      status: projection?.status ?? "ok",
    };
  });

  const shortfallCount = payments.filter((p) => p.status === "shortfall").length;
  const urgentShortfallCount = payments.filter(
    (p) => p.status === "shortfall" && p.daysUntil <= 7
  ).length;

  return {
    windowDays,
    payments,
    accounts,
    shortfallCount,
    urgentShortfallCount,
  };
}

export function coverageStatusLabel(status: PaymentCoverageStatus): string {
  switch (status) {
    case "ok":
      return "여유";
    case "tight":
      return "빠듯";
    case "shortfall":
      return "부족";
    default:
      return "계좌 미지정";
  }
}
