"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ThemeToggle } from "@/components/theme-toggle";
import { TrendingUp } from "lucide-react";

const menuGroups = [
  {
    title: "포트폴리오",
    links: [
      { href: "/", label: "대시보드" },
      { href: "/portfolio", label: "종목 현황" },
      { href: "/chart", label: "차트 분석" },
    ],
  },
  {
    title: "인텔리전스",
    links: [
      { href: "/intelligence", label: "AI 분석" },
      { href: "/watchlist", label: "관심 종목" },
      { href: "/alerts", label: "알림" },
    ],
  },
  {
    title: "수익",
    links: [{ href: "/gains", label: "총수익" }],
  },
  {
    title: "관리",
    links: [{ href: "/settings", label: "설정" }],
  },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="sticky top-0 z-40 border-b border-[var(--header-border)] bg-[var(--header-bg)] backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3">
          <Link
            href="/"
            className="flex items-center gap-2 font-semibold tracking-tight text-neutral-900 dark:text-neutral-100"
          >
            <TrendingUp size={18} className="text-emerald-500" />
            StockMind
          </Link>
          <nav className="flex flex-1 flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            {menuGroups.map((group) => (
              <div key={group.title} className="flex flex-wrap items-center gap-1">
                <span className="px-1 text-[11px] font-medium text-neutral-400">
                  {group.title}
                </span>
                {group.links.map(({ href, label }) => {
                  const active = isActive(pathname, href);
                  return (
                    <Link
                      key={href}
                      href={href}
                      className={`rounded-md px-2.5 py-1.5 transition-colors ${
                        active
                          ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                          : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
                      }`}
                    >
                      {label}
                    </Link>
                  );
                })}
              </div>
            ))}
          </nav>
          <div className="ml-auto shrink-0">
            <ThemeToggle />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        {children}
      </main>
    </div>
  );
}
