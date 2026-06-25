"use client";

import { useState } from "react";
import { Star, Loader2 } from "lucide-react";
import { watchlistApi, addStockNameToWatchlist } from "@/lib/api";

type Status = "idle" | "busy" | "added" | "already" | "error";

/** 종목 하나를 관심종목에 바로 등록하는 버튼 — symbol이 없으면 이름으로 내부 조회 후 등록 */
export function AddToWatchlistButton({
  symbol,
  stockName,
  compact = false,
}: {
  symbol?: string;
  stockName: string;
  compact?: boolean;
}) {
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function handleClick() {
    if (status === "busy" || status === "added" || status === "already") return;
    setStatus("busy");
    setErrorMsg(null);
    try {
      const existing = await watchlistApi.getAll();
      const dup = existing.items.some(
        (it) => (symbol && it.symbol === symbol) || it.stock_name === stockName,
      );
      if (dup) {
        setStatus("already");
        return;
      }
      await addStockNameToWatchlist(stockName, symbol);
      setStatus("added");
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "등록에 실패했습니다.");
      setStatus("error");
    }
  }

  const isStarred = status === "added" || status === "already";
  const label =
    status === "added" ? "등록됨" : status === "already" ? "이미 등록됨" : status === "error" ? "재시도" : "관심종목";

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={status === "busy" || isStarred}
      title={errorMsg ?? (isStarred ? label : "관심종목에 추가")}
      className={
        compact
          ? `inline-flex items-center justify-center rounded-full p-0.5 disabled:opacity-70 ${
              isStarred
                ? "text-amber-500"
                : "text-neutral-400 hover:bg-amber-100 hover:text-amber-600 dark:hover:bg-amber-900/30"
            }`
          : `flex items-center gap-1 rounded-md border border-[var(--border-subtle)] px-2 py-1 text-[11px] disabled:opacity-70 ${
              isStarred
                ? "text-amber-600"
                : "text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            }`
      }
    >
      {status === "busy" ? (
        <Loader2 size={compact ? 10 : 11} className="animate-spin" />
      ) : (
        <Star size={compact ? 10 : 11} className={isStarred ? "fill-current" : ""} />
      )}
      {!compact && label}
    </button>
  );
}
