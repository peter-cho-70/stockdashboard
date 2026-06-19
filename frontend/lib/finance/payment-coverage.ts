import type { CashAsset, FixedExpense } from "@/lib/finance/types";

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

function daysUntil(dateStr: string, today: Date): number {
  const due = new Date(`${dateStr}T00:00:00`);
  const base = new Date(today);
  base.setHours(0, 0, 0, 0);
  return Math.ceil((due.getTime() - base.getTime()) / 86400000);
}

function accountLabel(asset: CashAsset): string {
  return `${asset.name} · ${asset.institution}`;
}

function statusFromBalance(projected: number, paymentAmount: number): PaymentCoverageStatus {
  if (projected < 0) return "shortfall";
  if (projected < paymentAmount * 0.15) return "tight";
  return "ok";
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
  today = new Date()
): PaymentCoverageResult {
  const upcoming = getUpcomingFixedExpenses(expenses, windowDays, today);
  const bankAccounts = cashAssets.filter((a) => a.accountType !== "securities");
  const accountMap = new Map(bankAccounts.map((a) => [a.id, a]));

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

    let balance = account.amount;
    let minProjected = balance;
    let maxShortfall = 0;

    for (const expense of sorted) {
      balance -= expense.amount;
      minProjected = Math.min(minProjected, balance);
      const shortfall = balance < 0 ? Math.abs(balance) : undefined;
      if (shortfall) maxShortfall = Math.max(maxShortfall, shortfall);
      projectedByExpenseId.set(expense.id, {
        projectedBalance: balance,
        shortfall,
        status: statusFromBalance(balance, expense.amount),
      });
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
