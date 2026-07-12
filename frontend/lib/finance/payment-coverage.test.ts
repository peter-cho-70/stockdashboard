import { strict as assert } from "node:assert";
import {
  computePaymentCoverage,
  getUpcomingFixedExpenses,
} from "./payment-coverage";
import type { CashAsset, FixedExpense, Income } from "./types";

const bank: CashAsset = {
  id: "bank-1",
  name: "급여통장",
  institution: "국민",
  accountType: "bank",
  amount: 500_000,
  updatedAt: "2026-06-01",
};

const cardPayment: FixedExpense = {
  id: "exp-1",
  name: "카드 대금",
  category: "card_payment",
  amount: 800_000,
  cycle: "monthly",
  nextDueDate: "2026-06-25",
  paymentAccountId: "bank-1",
};

const today = new Date("2026-06-17T12:00:00");

function testShortfallWithoutIncome() {
  const result = computePaymentCoverage([cardPayment], [bank], 45, today, []);
  assert.equal(result.payments[0]?.status, "shortfall");
  assert.equal(result.shortfallCount, 1);
}

function testOkWithIncomeBeforePayment() {
  const salary: Income = {
    id: "inc-1",
    name: "월급",
    incomeType: "salary",
    source: "manual",
    amount: 4_000_000,
    cycle: "monthly",
    depositAccountId: "bank-1",
    receivedDate: "2026-06-20",
  };
  const result = computePaymentCoverage([cardPayment], [bank], 45, today, [salary]);
  assert.equal(result.payments[0]?.status, "ok");
  assert.equal(result.shortfallCount, 0);
}

function testUpcomingWindow() {
  const far: FixedExpense = {
    ...cardPayment,
    id: "exp-2",
    nextDueDate: "2026-09-01",
  };
  const upcoming = getUpcomingFixedExpenses([cardPayment, far], 45, today);
  assert.equal(upcoming.length, 1);
  assert.equal(upcoming[0]?.id, "exp-1");
}

function testUnknownWithoutAccount() {
  const noAcct: FixedExpense = { ...cardPayment, id: "exp-3", paymentAccountId: undefined };
  const result = computePaymentCoverage([noAcct], [bank], 45, today, []);
  assert.equal(result.payments[0]?.status, "unknown");
}

const tests = [
  ["shortfall without income", testShortfallWithoutIncome],
  ["ok with income before payment", testOkWithIncomeBeforePayment],
  ["upcoming window filter", testUpcomingWindow],
  ["unknown without payment account", testUnknownWithoutAccount],
] as const;

let failed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`✗ ${name}`, err);
  }
}

process.exit(failed > 0 ? 1 : 0);
