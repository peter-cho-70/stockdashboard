"use client";

import { useEffect, useState } from "react";
import { Loader2, X } from "lucide-react";
import { marketApi, type KrMarketMover } from "@/lib/api";
import { krChangeClass } from "@/lib/krMarketColors";
import { StockPreviewModal, type StockPreviewItem } from "@/components/stock-preview-modal";

export type GroupPreviewTarget = {
  kind: "theme" | "industry";
  name: string;
  group_no: string;
  change_pct: number;
};

export function GroupStocksModal({
  group,
  onClose,
}: {
  group: GroupPreviewTarget | null;
  onClose: () => void;
}) {
  const [stocks, setStocks] = useState<KrMarketMover[]>([]);
  const [groupTitle, setGroupTitle] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewItem, setPreviewItem] = useState<StockPreviewItem | null>(null);

  useEffect(() => {
    if (!group) return;
    setLoading(true);
    setError(null);
    setStocks([]);
    setGroupTitle(group.name);
    const groupType = group.kind === "theme" ? "theme" : "upjong";
    marketApi
      .getKrGroupStocks(groupType, group.group_no, 10)
      .then((res) => {
        setGroupTitle(res.name || group.name);
        setStocks(res.stocks);
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : "종목 목록을 불러오지 못했습니다.");
      })
      .finally(() => setLoading(false));
  }, [group]);

  if (!group) return null;

  const kindLabel = group.kind === "theme" ? "테마" : "업종";

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
        onClick={onClose}
        role="presentation"
      >
        <div
          className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-xl border border-[var(--border-subtle)] bg-[var(--surface)] shadow-lg"
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
        >
          <div className="flex items-start justify-between border-b border-[var(--border-subtle)] px-4 py-3">
            <div className="min-w-0">
              <p className="text-[10px] text-neutral-400">{kindLabel}</p>
              <h2 className="truncate text-base font-semibold text-neutral-900 dark:text-neutral-100">
                {groupTitle ?? group.name}
              </h2>
              <p className={`mt-0.5 text-xs font-medium tabular-nums ${krChangeClass(group.change_pct)}`}>
                업종/테마 등락 {group.change_pct >= 0 ? "+" : ""}
                {group.change_pct.toFixed(2)}%
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md p-1 text-neutral-400 hover:bg-[var(--surface-elevated)]"
              aria-label="닫기"
            >
              <X size={18} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-3">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-10 text-sm text-neutral-400">
                <Loader2 size={16} className="animate-spin" />
                구성 종목 불러오는 중...
              </div>
            ) : error ? (
              <p className="py-6 text-center text-sm text-red-500">{error}</p>
            ) : stocks.length === 0 ? (
              <p className="py-6 text-center text-sm text-neutral-400">표시할 종목이 없습니다.</p>
            ) : (
              <div className="divide-y divide-[var(--border-subtle)]">
                {stocks.map((stock, idx) => (
                  <button
                    key={`${stock.symbol}-${idx}`}
                    type="button"
                    onClick={() =>
                      setPreviewItem({
                        symbol: stock.symbol,
                        name: stock.name,
                        close: stock.close,
                        change_pct: stock.change_pct,
                        market: stock.market,
                      })
                    }
                    className="flex w-full items-center gap-3 py-2.5 text-left hover:bg-[var(--surface-elevated)]"
                  >
                    <span className="w-5 shrink-0 text-[10px] tabular-nums text-neutral-400">
                      {idx + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">
                        {stock.name}
                      </p>
                      <p className="text-[10px] text-neutral-400">{stock.symbol}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      {stock.close != null && (
                        <p className="text-xs tabular-nums text-neutral-700 dark:text-neutral-300">
                          {stock.close.toLocaleString("ko-KR")}
                        </p>
                      )}
                      <p className={`text-[11px] font-medium tabular-nums ${krChangeClass(stock.change_pct)}`}>
                        {stock.change_pct >= 0 ? "+" : ""}
                        {stock.change_pct.toFixed(2)}%
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="border-t border-[var(--border-subtle)] px-4 py-2 text-[10px] text-neutral-400">
            등락률 상위 10종목 · 종목 클릭 시 상세·차트
          </div>
        </div>
      </div>

      <StockPreviewModal
        item={previewItem}
        onClose={() => setPreviewItem(null)}
      />
    </>
  );
}
