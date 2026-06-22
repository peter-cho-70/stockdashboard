"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Gavel, ListChecks, Archive } from "lucide-react";

const tabs = [
  { href: "/auction", label: "물건 목록", icon: ListChecks, exact: true },
  { href: "/auction/backup", label: "백업", icon: Archive },
];

function isActive(pathname: string, href: string, exact?: boolean) {
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function AuctionLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-3">
        <div className="flex items-center gap-2 text-sm text-neutral-500">
          <Gavel size={16} className="text-amber-600" />
          경매허브 · 물건 관리·세입자 분석·입찰가 산정
        </div>
        <nav className="flex items-center gap-1">
          {tabs.map(({ href, label, icon: Icon, exact }) => {
            const active = isActive(pathname, href, exact);
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors ${
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
        </nav>
      </div>
      {children}
    </div>
  );
}
