"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const stockMenuGroups = [
  {
    title: "포트폴리오",
    links: [
      { href: "/", label: "대시보드" },
      { href: "/portfolio", label: "종목 현황" },
      { href: "/portfolio/trades", label: "체결내역" },
      { href: "/chart", label: "차트 분석" },
      { href: "/groups", label: "종목 그룹" },
    ],
  },
  {
    title: "인텔리전스",
    links: [
      { href: "/intelligence", label: "AI 분석" },
      { href: "/knowledge", label: "지식 허브" },
      { href: "/learn", label: "주식공부하기" },
      { href: "/watchlist", label: "관심 종목" },
      { href: "/alerts", label: "알림" },
    ],
  },
  {
    title: "수익",
    links: [{ href: "/gains", label: "총수익" }],
  },
  {
    title: "아침 루틴",
    links: [
      { href: "/morning", label: "루틴 상세" },
      { href: "/morning/journal", label: "매매 일지" },
    ],
  },
  {
    title: "관리",
    links: [
      { href: "/settings", label: "설정" },
      { href: "/autotrade", label: "자동매매" },
    ],
  },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function StockLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="space-y-5">
      <nav className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-[var(--border-subtle)] pb-3 text-sm">
        {stockMenuGroups.map((group) => (
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
      {children}
    </div>
  );
}
