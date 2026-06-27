"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  BookOpen,
  Wallet,
  CreditCard,
  TrendingUp,
  BarChart2,
  Calendar,
  Settings,
} from "lucide-react";
import { useFinanceReady } from "@/lib/finance/use-finance-ready";
import { useFinanceStore } from "@/lib/finance/store/finance-store";
import { useLedgerStore } from "@/lib/finance/store/ledger-store";

const tabs = [
  { href: "/finance", label: "대시보드", icon: LayoutDashboard, exact: true },
  { href: "/finance/ledger", label: "가계부", icon: BookOpen },
  { href: "/finance/assets", label: "자산", icon: Wallet },
  { href: "/finance/liabilities", label: "부채", icon: CreditCard },
  { href: "/finance/cashflow", label: "현금흐름", icon: TrendingUp },
  { href: "/finance/charts", label: "차트", icon: BarChart2 },
  { href: "/finance/funding", label: "자금 계획", icon: Calendar },
  { href: "/finance/settings", label: "설정", icon: Settings },
];

function isActive(pathname: string, href: string, exact?: boolean) {
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function FinanceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const ready = useFinanceReady();
  const financeError = useFinanceStore((s) => s.error);
  const ledgerError = useLedgerStore((s) => s.error);
  const financeSaving = useFinanceStore((s) => s.saving);
  const ledgerSaving = useLedgerStore((s) => s.saving);
  const saving = financeSaving || ledgerSaving;

  return (
    <div className="mx-auto max-w-[1400px] space-y-4 px-1 pb-8">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-neutral-200 pb-3 dark:border-neutral-800">
        <div>
          <p className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
            재정 보드 · 자산·부채·가계부·자금 계획
          </p>
        </div>
        <div className="flex flex-wrap gap-1">
          {tabs.map(({ href, label, icon: Icon, exact }) => {
            const active = isActive(pathname, href, exact);
            return (
              <Link
                key={href}
                href={href}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition-colors ${
                  active
                    ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                    : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
                }`}
              >
                <Icon size={14} />
                {label}
              </Link>
            );
          })}
        </div>
      </div>

      {(financeError || ledgerError) && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
          {financeError || ledgerError}
        </div>
      )}

      {saving && (
        <p className="text-xs text-neutral-500">저장 중…</p>
      )}

      <div className="relative">
        {!ready && (
          <div className="absolute inset-0 z-10 flex items-start justify-center bg-[var(--background)]/80 pt-16 backdrop-blur-[1px]">
            <p className="text-sm text-neutral-500">재정 데이터 불러오는 중…</p>
          </div>
        )}
        <div
          className={ready ? undefined : "pointer-events-none select-none opacity-40"}
          aria-busy={!ready}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
