"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ThemeToggle } from "@/components/theme-toggle";
import { DemoBanner } from "@/components/demo-banner";
import { TrendingUp, Wallet, Gavel } from "lucide-react";

const hubTabs = [
  { id: "stock", href: "/", label: "주식 허브", icon: TrendingUp },
  { id: "finance", href: "/finance", label: "재정 보드", icon: Wallet },
  { id: "auction", href: "/auction", label: "경매허브", icon: Gavel },
] as const;

type HubId = (typeof hubTabs)[number]["id"];

function currentHub(pathname: string): HubId {
  if (pathname === "/finance" || pathname.startsWith("/finance/")) return "finance";
  if (pathname === "/auction" || pathname.startsWith("/auction/")) return "auction";
  return "stock";
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const hub = currentHub(pathname);
  const shellWidth = "max-w-[1400px]";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="sticky top-0 z-40 border-b border-[var(--header-border)] bg-[var(--header-bg)] backdrop-blur-md">
        <div className={`mx-auto flex flex-wrap items-center gap-3 px-4 py-3 ${shellWidth}`}>
          <Link
            href={hub === "stock" ? "/" : `/${hub}`}
            className="flex items-center gap-2 font-semibold tracking-tight text-neutral-900 dark:text-neutral-100"
          >
            <TrendingUp size={18} className="text-emerald-500" />
            StockMind
          </Link>

          <div
            className="flex rounded-lg border border-neutral-200 bg-neutral-100/80 p-0.5 dark:border-neutral-700 dark:bg-neutral-800/80"
            role="tablist"
            aria-label="허브 선택"
          >
            {hubTabs.map(({ id, href, label, icon: Icon }) => {
              const active = id === hub;
              return (
                <Link
                  key={id}
                  href={href}
                  role="tab"
                  aria-selected={active}
                  className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                    active
                      ? "bg-white text-neutral-900 shadow-sm dark:bg-neutral-900 dark:text-neutral-100"
                      : "text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-200"
                  }`}
                >
                  <Icon size={14} className={id === "stock" ? "text-emerald-500" : "text-emerald-600"} />
                  {label}
                </Link>
              );
            })}
          </div>

          <div className="ml-auto shrink-0">
            <ThemeToggle />
          </div>
        </div>
      </header>
      <DemoBanner />
      <main className={`mx-auto w-full flex-1 px-4 py-6 ${shellWidth}`}>
        {children}
      </main>
    </div>
  );
}
