"use client";

import Link from "next/link";
import { BarChart, Bell, Wallet } from "lucide-react";
import type { PortfolioSummary } from "@/lib/api";
import { krChangeClass } from "@/lib/krMarketColors";

function RateTag({ rate }: { rate: number }) {
  return (
    <span className={`text-[10px] font-medium tabular-nums ${krChangeClass(rate)}`}>
      {rate > 0 ? "+" : ""}
      {rate.toFixed(2)}%
    </span>
  );
}

export function HoldingsMiniCard({ summary }: { summary: PortfolioSummary | null }) {
  if (!summary || summary.stock_count === 0) {
    return (
      <div className="flex h-full min-h-[760px] flex-col rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] shadow-xs">
        <div className="border-b border-[var(--border-subtle)] px-3 py-2.5">
          <h2 className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">보유 종목</h2>
        </div>
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 py-6 text-center">
          <Wallet size={24} className="text-neutral-300 dark:text-neutral-600" />
          <p className="text-xs text-neutral-500">보유 종목이 없습니다</p>
          <Link href="/portfolio" className="text-[11px] text-blue-500 hover:underline">
            종목 등록하기
          </Link>
        </div>
      </div>
    );
  }

  const stocks = [...summary.stocks].sort((a, b) => b.change_rate - a.change_rate);

  return (
    <div className="flex h-full min-h-[760px] flex-col rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] shadow-xs overflow-hidden">
      <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-3 py-2.5">
        <h2 className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">
          보유 종목
          <span className="ml-1.5 text-xs font-normal text-neutral-400">
            {summary.stock_count}개
          </span>
        </h2>
        <Link
          href="/portfolio"
          className="text-[10px] text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"
        >
          전체 →
        </Link>
      </div>
      <div className="flex-1 divide-y divide-[var(--border-subtle)] overflow-y-auto max-h-[760px]">
        {stocks.map((stock) => (
          <Link
            key={stock.symbol}
            href={`/chart?symbol=${stock.symbol}`}
            className={`flex items-center gap-2 px-3 py-2 transition-colors hover:bg-[var(--surface-elevated)] group ${
              Math.abs(stock.change_rate) >= 5 ? "bg-amber-50/40 dark:bg-amber-900/10" : ""
            }`}
          >
            {Math.abs(stock.change_rate) >= 5 && (
              <Bell size={10} className="shrink-0 text-amber-500" />
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium text-neutral-900 dark:text-neutral-100 group-hover:text-blue-600 dark:group-hover:text-blue-400">
                {stock.name}
              </p>
              <p className="text-[10px] text-neutral-400">{stock.symbol}</p>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-xs font-medium tabular-nums text-neutral-800 dark:text-neutral-200">
                {stock.current_price.toLocaleString("ko-KR")}
              </p>
              <div className="flex items-center justify-end gap-1">
                <RateTag rate={stock.change_rate} />
                <RateTag rate={stock.profit_rate} />
              </div>
            </div>
            <BarChart size={12} className="shrink-0 text-neutral-300 group-hover:text-blue-400" />
          </Link>
        ))}
      </div>
    </div>
  );
}
