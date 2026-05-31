"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, ArrowUpRight, ArrowDownRight, Minus, PenLine, X, Check, BarChart, ChevronUp, ChevronDown } from "lucide-react";
import { api, type StockItem } from "@/lib/api";

type SortKey = "name" | "current_price" | "change_rate" | "qty" | "avg_price" | "eval_value" | "pnl" | "profit_rate" | "sector";
type SortDir = "asc" | "desc";

const SORT_STORAGE_KEY = "stockmind-portfolio-sort";

function loadSort(): { key: SortKey; dir: SortDir } {
  if (typeof window === "undefined") return { key: "eval_value", dir: "desc" };
  try {
    const raw = localStorage.getItem(SORT_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return { key: "eval_value", dir: "desc" };
}

function evalValue(s: StockItem) {
  return s.current_value ?? s.current_price * s.qty;
}

function pnlValue(s: StockItem) {
  return evalValue(s) - s.avg_price * s.qty;
}

function RateCell({ rate }: { rate: number }) {
  if (rate > 0)
    return (
      <span className="inline-flex items-center gap-0.5 text-emerald-600 dark:text-emerald-400 font-medium">
        <ArrowUpRight size={13} />
        {rate.toFixed(2)}%
      </span>
    );
  if (rate < 0)
    return (
      <span className="inline-flex items-center gap-0.5 text-red-600 dark:text-red-400 font-medium">
        <ArrowDownRight size={13} />
        {Math.abs(rate).toFixed(2)}%
      </span>
    );
  return (
    <span className="inline-flex items-center gap-0.5 text-neutral-400">
      <Minus size={13} />
      0.00%
    </span>
  );
}

function fmt(n: number, currency = "KRW") {
  if (currency === "USD")
    return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return `${n.toLocaleString("ko-KR")}`;
}

const SECTORS = [
  "반도체", "AI·빅테크", "2차전지", "바이오·헬스케어",
  "금융", "에너지", "소비재", "자동차", "방산", "부동산·리츠", "기타",
];

export default function PortfolioPage() {
  const router = useRouter();
  const [stocks, setStocks] = useState<StockItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editMemo, setEditMemo] = useState("");
  const [editSector, setEditSector] = useState("");
  const [filter, setFilter] = useState<"ALL" | "KRX" | "US">("ALL");
  const [sortKey, setSortKey] = useState<SortKey>(() => loadSort().key);
  const [sortDir, setSortDir] = useState<SortDir>(() => loadSort().dir);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  function SortHeader({ label, col, align = "left" }: { label: string; col: SortKey; align?: "left" | "right" }) {
    const active = sortKey === col;
    return (
      <th
        className={`px-4 py-3 font-medium cursor-pointer select-none hover:text-neutral-700 dark:hover:text-neutral-200 ${align === "right" ? "text-right" : "text-left"}`}
        onClick={() => toggleSort(col)}
      >
        <span className={`inline-flex items-center gap-0.5 ${align === "right" ? "justify-end w-full" : ""}`}>
          {label}
          {active && (sortDir === "asc" ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}
        </span>
      </th>
    );
  }

  const load = useCallback(async () => {
    try {
      const data = await api.getStocks();
      setStocks(data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSync() {
    setSyncing(true);
    try {
      await api.syncNow();
      await load();
    } catch {
      // ignore
    } finally {
      setSyncing(false);
    }
  }

  async function saveMemo(symbol: string) {
    await api.updateMemo(symbol, editMemo, editSector || undefined);
    setStocks((prev) =>
      prev.map((s) =>
        s.symbol === symbol ? { ...s, memo: editMemo, sector: editSector || s.sector } : s
      )
    );
    setEditingId(null);
  }

  const filtered = stocks.filter((s) => {
    if (filter === "KRX") return s.market === "KRX";
    if (filter === "US") return s.market !== "KRX";
    return true;
  });

  const sorted = useMemo(() => {
    const list = [...filtered];
    const dir = sortDir === "asc" ? 1 : -1;
    list.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "name":
          cmp = a.name.localeCompare(b.name, "ko");
          break;
        case "sector":
          cmp = (a.sector || "").localeCompare(b.sector || "", "ko");
          break;
        case "current_price":
          cmp = a.current_price - b.current_price;
          break;
        case "change_rate":
          cmp = a.change_rate - b.change_rate;
          break;
        case "qty":
          cmp = a.qty - b.qty;
          break;
        case "avg_price":
          cmp = a.avg_price - b.avg_price;
          break;
        case "eval_value":
          cmp = evalValue(a) - evalValue(b);
          break;
        case "pnl":
          cmp = pnlValue(a) - pnlValue(b);
          break;
        case "profit_rate":
          cmp = a.profit_rate - b.profit_rate;
          break;
        default:
          cmp = 0;
      }
      return cmp * dir;
    });
    return list;
  }, [filtered, sortKey, sortDir]);

  useEffect(() => {
    localStorage.setItem(SORT_STORAGE_KEY, JSON.stringify({ key: sortKey, dir: sortDir }));
  }, [sortKey, sortDir]);

  const krxStocks = stocks.filter((s) => s.market === "KRX");
  const usStocks = stocks.filter((s) => s.market !== "KRX");

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">종목 현황</h1>
          <p className="mt-0.5 text-xs text-neutral-400">
            국내 {krxStocks.length}개 · 해외 {usStocks.length}개
          </p>
        </div>
        <button
          onClick={handleSync}
          disabled={syncing}
          className="flex items-center gap-2 rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-neutral-700 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
        >
          <RefreshCw size={14} className={syncing ? "animate-spin" : ""} />
          {syncing ? "동기화 중..." : "동기화"}
        </button>
      </div>

      {/* 필터 탭 */}
      <div className="flex gap-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] p-1 w-fit">
        {(["ALL", "KRX", "US"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              filter === f
                ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                : "text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"
            }`}
          >
            {f === "ALL" ? "전체" : f === "KRX" ? "국내" : "해외"}
          </button>
        ))}
      </div>

      {/* 테이블 */}
      {loading ? (
        <div className="py-16 text-center text-sm text-neutral-400">불러오는 중...</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[var(--border-subtle)] py-16 text-center text-sm text-neutral-400">
          보유 종목이 없습니다. 동기화 버튼을 눌러주세요.
        </div>
      ) : (
        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border-subtle)] bg-[var(--surface-elevated)] text-xs text-neutral-500 dark:text-neutral-400">
                  <SortHeader label="종목" col="name" />
                  <SortHeader label="현재가" col="current_price" align="right" />
                  <SortHeader label="전일대비" col="change_rate" align="right" />
                  <SortHeader label="수량" col="qty" align="right" />
                  <SortHeader label="평균단가" col="avg_price" align="right" />
                  <SortHeader label="평가금액" col="eval_value" align="right" />
                  <SortHeader label="평가손익" col="pnl" align="right" />
                  <SortHeader label="수익률" col="profit_rate" align="right" />
                  <SortHeader label="섹터" col="sector" />
                  <th className="px-4 py-3 text-left font-medium">메모</th>
                  <th className="px-4 py-3 text-center font-medium">편집</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)]">
                {sorted.map((stock) => (
                  <tr
                    key={stock.id}
                    onClick={() => {
                      if (editingId !== stock.id) router.push(`/chart?symbol=${stock.symbol}`);
                    }}
                    className={`transition-colors ${
                      editingId === stock.id
                        ? "bg-[var(--surface-elevated)]"
                        : "cursor-pointer hover:bg-[var(--surface-elevated)]"
                    }`}
                  >
                    <td className="px-4 py-3">
                      <div className="inline-flex flex-col" title="차트 보기">
                        <div className="flex items-center gap-1.5 font-medium text-neutral-900 dark:text-neutral-100 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                          {stock.name}
                          <BarChart size={12} className="text-neutral-300" />
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className="text-xs text-neutral-400">{stock.symbol}</span>
                          <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-500 dark:bg-neutral-800">
                            {stock.market}
                          </span>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-neutral-900 dark:text-neutral-100">
                      {fmt(stock.current_price, stock.currency)}
                      <span className="ml-1 text-xs text-neutral-400">{stock.currency}</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <RateCell rate={stock.change_rate} />
                    </td>
                    <td className="px-4 py-3 text-right text-neutral-700 dark:text-neutral-300">
                      {stock.qty.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right text-neutral-700 dark:text-neutral-300">
                      {fmt(stock.avg_price, stock.currency)}
                    </td>
                    <td className="px-4 py-3 text-right text-neutral-800 dark:text-neutral-200">
                      {(() => {
                        const evalAmt = stock.current_value ?? stock.current_price * stock.qty;
                        return stock.currency === "USD"
                          ? `$${evalAmt.toLocaleString("en-US", { maximumFractionDigits: 0 })}`
                          : `${Math.round(evalAmt).toLocaleString("ko-KR")}원`;
                      })()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {(() => {
                        const evalAmt = stock.current_value ?? stock.current_price * stock.qty;
                        const pnl = evalAmt - stock.avg_price * stock.qty;
                        const isPos = pnl >= 0;
                        const valStr = stock.currency === "USD"
                          ? `${isPos ? "+" : ""}$${Math.abs(pnl).toLocaleString("en-US", { maximumFractionDigits: 0 })}`
                          : `${isPos ? "+" : "-"}${Math.abs(Math.round(pnl)).toLocaleString("ko-KR")}원`;
                        return (
                          <span className={`font-medium ${isPos ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                            {valStr}
                          </span>
                        );
                      })()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <RateCell rate={stock.profit_rate} />
                    </td>
                    <td className="px-4 py-3">
                      {editingId === stock.id ? (
                        <select
                          value={editSector}
                          onChange={(e) => setEditSector(e.target.value)}
                          onClick={(e) => e.stopPropagation()}
                          className="rounded border border-[var(--border-subtle)] bg-[var(--surface)] px-2 py-1 text-xs focus:outline-none"
                        >
                          <option value="">선택</option>
                          {SECTORS.map((s) => (
                            <option key={s} value={s}>{s}</option>
                          ))}
                        </select>
                      ) : (
                        <span className="text-xs text-neutral-500">
                          {stock.sector || "—"}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 max-w-[200px]">
                      {editingId === stock.id ? (
                        <textarea
                          value={editMemo}
                          onChange={(e) => setEditMemo(e.target.value)}
                          onClick={(e) => e.stopPropagation()}
                          rows={2}
                          placeholder="투자 thesis, 메모..."
                          className="w-full rounded border border-[var(--border-subtle)] bg-[var(--surface)] px-2 py-1 text-xs focus:outline-none resize-none"
                        />
                      ) : (
                        <span className="text-xs text-neutral-500 line-clamp-2">
                          {stock.memo || "—"}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                      {editingId === stock.id ? (
                        <div className="flex items-center justify-center gap-1">
                          <button
                            type="button"
                            onClick={() => saveMemo(stock.symbol)}
                            className="rounded p-1 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20"
                          >
                            <Check size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingId(null)}
                            className="rounded p-1 text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                          >
                            <X size={14} />
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            setEditingId(stock.id);
                            setEditMemo(stock.memo || "");
                            setEditSector(stock.sector || "");
                          }}
                          className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
                        >
                          <PenLine size={14} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
