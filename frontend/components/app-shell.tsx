"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { ThemeToggle } from "@/components/theme-toggle";
import { DemoBanner } from "@/components/demo-banner";
import {
  type HubId,
  defaultHubPath,
  hubFromPathname,
  initialHubPaths,
  saveHubPath,
} from "@/lib/hub-navigation";
import { TrendingUp, Wallet, Gavel } from "lucide-react";
import { VersionBadge } from "@/components/version-badge";

const hubTabs = [
  { id: "stock" as const, label: "주식 허브", icon: TrendingUp },
  { id: "finance" as const, label: "재정 보드", icon: Wallet },
  { id: "auction" as const, label: "경매허브", icon: Gavel },
];

function AppShellInner({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const hub = hubFromPathname(pathname);
  const [hubPaths, setHubPaths] = useState<Record<HubId, string>>({
    stock: defaultHubPath("stock"),
    finance: defaultHubPath("finance"),
    auction: defaultHubPath("auction"),
  });
  const shellWidth = "max-w-[1400px]";

  // sessionStorage는 클라이언트에만 존재 — 마운트 후에 읽어와야
  // 서버 렌더링(HTML)과 클라이언트 최초 렌더링이 어긋나 하이드레이션 경고가 나지 않는다.
  useEffect(() => {
    setHubPaths(initialHubPaths());
  }, []);

  useEffect(() => {
    const qs = searchParams.toString();
    const fullPath = qs ? `${pathname}?${qs}` : pathname;
    saveHubPath(hub, fullPath);
    setHubPaths((prev) => ({ ...prev, [hub]: fullPath }));
  }, [pathname, searchParams, hub]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="sticky top-0 z-40 border-b border-[var(--header-border)] bg-[var(--header-bg)] backdrop-blur-md">
        <div className={`mx-auto flex flex-wrap items-center gap-3 px-4 py-3 ${shellWidth}`}>
          <div className="flex items-center gap-2">
            <Link
              href={hubPaths[hub]}
              className="flex items-center gap-2 font-semibold tracking-tight text-neutral-900 dark:text-neutral-100"
            >
              <TrendingUp size={18} className="text-emerald-500" />
              StockMind
            </Link>
            <VersionBadge />
          </div>

          <div
            className="flex rounded-lg border border-neutral-200 bg-neutral-100/80 p-0.5 dark:border-neutral-700 dark:bg-neutral-800/80"
            role="tablist"
            aria-label="허브 선택"
          >
            {hubTabs.map(({ id, label, icon: Icon }) => {
              const active = id === hub;
              return (
                <Link
                  key={id}
                  href={hubPaths[id]}
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

function AppShellFallback({ children }: { children: React.ReactNode }) {
  const shellWidth = "max-w-[1400px]";
  const defaults = {
    stock: defaultHubPath("stock"),
    finance: defaultHubPath("finance"),
    auction: defaultHubPath("auction"),
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="sticky top-0 z-40 border-b border-[var(--header-border)] bg-[var(--header-bg)] backdrop-blur-md">
        <div className={`mx-auto flex flex-wrap items-center gap-3 px-4 py-3 ${shellWidth}`}>
          <div className="flex items-center gap-2">
            <Link
              href="/"
              className="flex items-center gap-2 font-semibold tracking-tight text-neutral-900 dark:text-neutral-100"
            >
              <TrendingUp size={18} className="text-emerald-500" />
              StockMind
            </Link>
            <VersionBadge />
          </div>
          <div
            className="flex rounded-lg border border-neutral-200 bg-neutral-100/80 p-0.5 dark:border-neutral-700 dark:bg-neutral-800/80"
            role="tablist"
            aria-label="허브 선택"
          >
            {hubTabs.map(({ id, label, icon: Icon }) => (
              <Link
                key={id}
                href={defaults[id]}
                role="tab"
                className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-neutral-600"
              >
                <Icon size={14} className={id === "stock" ? "text-emerald-500" : "text-emerald-600"} />
                {label}
              </Link>
            ))}
          </div>
          <div className="ml-auto shrink-0">
            <ThemeToggle />
          </div>
        </div>
      </header>
      <DemoBanner />
      <main className={`mx-auto w-full flex-1 px-4 py-6 ${shellWidth}`}>{children}</main>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // /mobile 하위 페이지는 독립된 단독 화면 — 허브 탭·테마 토글 등 PC용 상단 메뉴 없이 그대로 렌더링
  if (pathname?.startsWith("/mobile")) {
    return <>{children}</>;
  }
  return (
    <Suspense fallback={<AppShellFallback>{children}</AppShellFallback>}>
      <AppShellInner>{children}</AppShellInner>
    </Suspense>
  );
}
