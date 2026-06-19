"use client";

import { useEffect, useRef } from "react";
import { useFinanceStore } from "@/lib/finance/store/finance-store";
import { useLedgerStore } from "@/lib/finance/store/ledger-store";

export function useFinanceReady() {
  const financeReady = useFinanceStore((s) => s.ready);
  const ledgerReady = useLedgerStore((s) => s.ready);
  const loadFinance = useFinanceStore((s) => s.load);
  const loadLedger = useLedgerStore((s) => s.load);
  const initRef = useRef(false);

  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;
    void Promise.all([loadFinance(), loadLedger()]);
  }, [loadFinance, loadLedger]);

  return financeReady && ledgerReady;
}
