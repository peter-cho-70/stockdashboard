import type { ExpenseCategory, FixedExpense } from "@/lib/finance/types";

const PAYMENT_ACCOUNT_CATEGORIES: ExpenseCategory[] = [
  "card_payment",
  "utility",
  "subscription",
  "insurance",
  "management_fee",
  "interest",
];

export function requiresPaymentAccount(
  category: ExpenseCategory
): boolean {
  return PAYMENT_ACCOUNT_CATEGORIES.includes(category);
}

export function advanceDueDate(
  dueDate: string,
  cycle: FixedExpense["cycle"]
): string {
  const d = new Date(`${dueDate}T00:00:00`);
  switch (cycle) {
    case "monthly":
      d.setMonth(d.getMonth() + 1);
      break;
    case "quarterly":
      d.setMonth(d.getMonth() + 3);
      break;
    case "yearly":
    case "seasonal":
      d.setFullYear(d.getFullYear() + 1);
      break;
  }
  // 로컬 자정으로 파싱했으므로 로컬 기준으로 포맷해야 한다 —
  // toISOString()은 UTC 변환이라 KST(UTC+9)에서는 하루 전 날짜가 된다.
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
