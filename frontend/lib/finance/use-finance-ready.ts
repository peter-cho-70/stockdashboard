"use client";

import { useEffect, useState } from "react";
import { useFinanceStore } from "@/lib/finance/store/finance-store";
import { useLedgerStore } from "@/lib/finance/store/ledger-store";

export function useFinanceReady() {
  const financeReady = useFinanceStore((s) => s.ready);
  const ledgerReady = useLedgerStore((s) => s.ready);
  const loadFinance = useFinanceStore((s) => s.load);
  const loadLedger = useLedgerStore((s) => s.load);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    if (started) return;
    setStarted(true);
    void Promise.all([loadFinance(), loadLedger()]);
  }, [started, loadFinance, loadLedger]);

  return financeReady && ledgerReady;
}
