"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { krChangeClass } from "@/lib/krMarketColors";

export function MarketViewToggle({
  view,
  onChange,
}: {
  view: "kr" | "us";
  onChange: (v: "kr" | "us") => void;
}) {
  return (
    <div
      className="inline-flex rounded-md border border-[var(--border-subtle)] p-0.5 text-[11px] font-medium"
      role="tablist"
      aria-label="시장 선택"
    >
      <button
        type="button"
        role="tab"
        aria-selected={view === "kr"}
        onClick={() => onChange("kr")}
        className={`rounded px-2.5 py-1 transition-colors ${
          view === "kr"
            ? "bg-red-500 text-white shadow-xs"
            : "text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"
        }`}
      >
        국내
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={view === "us"}
        onClick={() => onChange("us")}
        className={`rounded px-2.5 py-1 transition-colors ${
          view === "us"
            ? "bg-blue-500 text-white shadow-xs"
            : "text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"
        }`}
      >
        미국
      </button>
    </div>
  );
}

export function MoverRow({
  item,
  onSelect,
}: {
  item: {
    symbol: string;
    name: string;
    close?: number | null;
    change_pct?: number | null;
    net_amount_억?: number | null;
    market?: string;
  };
  onSelect?: (item: {
    symbol: string;
    name: string;
    close?: number | null;
    change_pct?: number | null;
    net_amount_억?: number | null;
    market?: string;
  }) => void;
}) {
  const changePct = item.change_pct;
  const showQuote = changePct != null;
  const showNet = !showQuote && item.net_amount_억 != null;
  const marketLabel =
    item.market && item.market !== "MIXED" ? ` · ${item.market}` : "";
  const row = (
    <>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-neutral-800 dark:text-neutral-200">
          {item.name}
        </p>
        <p className="text-[10px] text-neutral-400">
          {item.symbol}
          {marketLabel}
        </p>
      </div>
      <div className="shrink-0 text-right">
        {showQuote && item.close != null && (
          <p className="text-xs tabular-nums text-neutral-700 dark:text-neutral-300">
            {item.close.toLocaleString("ko-KR")}
          </p>
        )}
        {showQuote && (
          <p className={`text-[11px] font-medium tabular-nums ${krChangeClass(changePct ?? 0)}`}>
            {(changePct ?? 0) >= 0 ? "+" : ""}
            {(changePct ?? 0).toFixed(2)}%
          </p>
        )}
        {showNet && (
          <p className="text-[11px] font-medium tabular-nums text-neutral-700 dark:text-neutral-300">
            {item.net_amount_억!.toLocaleString("ko-KR")}억
          </p>
        )}
      </div>
    </>
  );

  if (onSelect) {
    return (
      <button
        type="button"
        onClick={() => onSelect(item)}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-[var(--surface-elevated)]"
      >
        {row}
      </button>
    );
  }

  return (
    <Link
      href={`/chart?symbol=${item.symbol}`}
      className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-[var(--surface-elevated)]"
    >
      {row}
    </Link>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h3 className="text-[11px] font-semibold text-neutral-500 mb-2">{children}</h3>
  );
}
