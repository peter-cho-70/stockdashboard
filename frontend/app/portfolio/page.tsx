"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  RefreshCw,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  PenLine,
  X,
  Check,
  BarChart,
  ChevronUp,
  ChevronDown,
  Plus,
  MoreHorizontal,
} from "lucide-react";
import { api, type StockItem, type StockCreatePayload } from "@/lib/api";

type SortKey =
  | "name"
  | "current_price"
  | "change_rate"
  | "qty"
  | "avg_price"
  | "eval_value"
  | "pnl"
  | "profit_rate"
  | "sector";
type SortDir = "asc" | "desc";

type ModalState =
  | { type: "add" }
  | { type: "buy" | "sell"; stock: StockItem }
  | { type: "adjust"; stock: StockItem }
  | { type: "delete"; stock: StockItem }
  | null;

const SORT_STORAGE_KEY = "stockmind-portfolio-sort";

function loadSort(): { key: SortKey; dir: SortDir } {
  if (typeof window === "undefined") return { key: "eval_value", dir: "desc" };
  try {
    const raw = localStorage.getItem(SORT_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore */
  }
  return { key: "eval_value", dir: "desc" };
}

function evalValue(s: StockItem) {
  return s.current_value ?? s.current_price * s.qty;
}

function pnlValue(s: StockItem) {
  return evalValue(s) - s.avg_price * s.qty;
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
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
  "반도체",
  "AI·빅테크",
  "2차전지",
  "바이오·헬스케어",
  "금융",
  "에너지",
  "소비재",
  "자동차",
  "방산",
  "부동산·리츠",
  "기타",
];

function ModalBackdrop({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl border border-[var(--border-subtle)] bg-[var(--surface)] p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">{title}</h2>
          <button type="button" onClick={onClose} className="rounded p-1 text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800">
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1 text-sm">
      <span className="text-xs font-medium text-neutral-500">{label}</span>
      {children}
    </label>
  );
}

const inputCls =
  "w-full rounded-md border border-[var(--border-subtle)] bg-[var(--background)] px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-neutral-400";

export default function PortfolioPage() {
  const router = useRouter();
  const [stocks, setStocks] = useState<StockItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editMemo, setEditMemo] = useState("");
  const [editSector, setEditSector] = useState("");
  const [filter, setFilter] = useState<"ALL" | "KRX" | "US">("ALL");
  const [sortKey, setSortKey] = useState<SortKey>(() => loadSort().key);
  const [sortDir, setSortDir] = useState<SortDir>(() => loadSort().dir);
  const [menuOpenId, setMenuOpenId] = useState<number | null>(null);
  const [modal, setModal] = useState<ModalState>(null);

  // add form
  const [addForm, setAddForm] = useState<StockCreatePayload>({
    symbol: "",
    name: "",
    market: "KRX",
    qty: 0,
    avg_price: 0,
    sector: "",
    currency: "KRW",
  });

  // trade form
  const [tradeQty, setTradeQty] = useState("");
  const [tradePrice, setTradePrice] = useState("");
  const [tradeDate, setTradeDate] = useState(todayStr());
  const [tradeMemo, setTradeMemo] = useState("");

  // adjust form
  const [adjQty, setAdjQty] = useState("");
  const [adjAvg, setAdjAvg] = useState("");
  const [adjName, setAdjName] = useState("");

  const load = useCallback(async () => {
    try {
      const data = await api.getStocks();
      setStocks(data);
      setError(null);
    } catch {
      setError("종목 목록을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!menuOpenId) return;
    const close = () => setMenuOpenId(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menuOpenId]);

  function openTradeModal(type: "buy" | "sell", stock: StockItem) {
    setTradeQty("");
    setTradePrice(String(stock.current_price || stock.avg_price || ""));
    setTradeDate(todayStr());
    setTradeMemo("");
    setModal({ type, stock });
    setMenuOpenId(null);
  }

  function openAdjustModal(stock: StockItem) {
    setAdjQty(String(stock.qty));
    setAdjAvg(String(stock.avg_price));
    setAdjName(stock.name);
    setModal({ type: "adjust", stock });
    setMenuOpenId(null);
  }

  async function handleSync() {
    setSyncing(true);
    setError(null);
    try {
      await api.syncNow();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "동기화 실패");
    } finally {
      setSyncing(false);
    }
  }

  async function saveMemo(symbol: string) {
    await api.updateMemo(symbol, editMemo, editSector || undefined);
    setStocks((prev) =>
      prev.map((s) =>
        s.symbol === symbol ? { ...s, memo: editMemo, sector: editSector || s.sector } : s,
      ),
    );
    setEditingId(null);
  }

  async function submitAdd(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const body: StockCreatePayload = {
        symbol: addForm.symbol.trim(),
        name: addForm.name.trim(),
        market: addForm.market || "KRX",
        currency: addForm.market === "KRX" ? "KRW" : "USD",
        qty: Number(addForm.qty),
        avg_price: Number(addForm.avg_price),
        sector: addForm.sector || undefined,
        current_price: Number(addForm.avg_price) || undefined,
      };
      const res = await api.addStock(body);
      setStocks((prev) => {
        const rest = prev.filter((s) => s.symbol !== res.stock.symbol);
        return [...rest, res.stock].filter((s) => s.qty > 0);
      });
      setModal(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "등록 실패");
    } finally {
      setSaving(false);
    }
  }

  async function submitTrade(e: React.FormEvent) {
    e.preventDefault();
    if (!modal || (modal.type !== "buy" && modal.type !== "sell")) return;
    setSaving(true);
    setError(null);
    try {
      const res = await api.createTrade(modal.stock.symbol, {
        side: modal.type === "buy" ? "BUY" : "SELL",
        qty: Number(tradeQty),
        price: Number(tradePrice),
        traded_at: tradeDate,
        memo: tradeMemo || undefined,
      });
      if (res.stock.qty > 0) {
        setStocks((prev) => {
          const rest = prev.filter((s) => s.symbol !== res.stock.symbol);
          return [...rest, res.stock];
        });
      } else {
        setStocks((prev) => prev.filter((s) => s.symbol !== res.stock.symbol));
      }
      setModal(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "체결 반영 실패");
    } finally {
      setSaving(false);
    }
  }

  async function submitAdjust(e: React.FormEvent) {
    e.preventDefault();
    if (!modal || modal.type !== "adjust") return;
    setSaving(true);
    setError(null);
    try {
      const res = await api.updatePosition(modal.stock.symbol, {
        qty: Number(adjQty),
        avg_price: Number(adjAvg),
        name: adjName.trim() || undefined,
      });
      if (res.stock.qty > 0) {
        setStocks((prev) => {
          const rest = prev.filter((s) => s.symbol !== res.stock.symbol);
          return [...rest, res.stock];
        });
      } else {
        setStocks((prev) => prev.filter((s) => s.symbol !== res.stock.symbol));
      }
      setModal(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "수정 실패");
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!modal || modal.type !== "delete") return;
    setSaving(true);
    setError(null);
    try {
      await api.deleteStock(modal.stock.symbol);
      setStocks((prev) => prev.filter((s) => s.symbol !== modal.stock.symbol));
      setModal(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "삭제 실패");
    } finally {
      setSaving(false);
    }
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

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  function SortHeader({
    label,
    col,
    align = "left",
  }: {
    label: string;
    col: SortKey;
    align?: "left" | "right";
  }) {
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

  const krxStocks = stocks.filter((s) => s.market === "KRX");
  const usStocks = stocks.filter((s) => s.market !== "KRX");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">종목 현황</h1>
          <p className="mt-0.5 text-xs text-neutral-400">
            국내 {krxStocks.length}개 · 해외 {usStocks.length}개 · 수동 입력 종목은 KIS 동기화 시 잔고가 덮어쓰이지 않음
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => {
              setAddForm({
                symbol: "",
                name: "",
                market: "KRX",
                qty: 0,
                avg_price: 0,
                sector: "",
                currency: "KRW",
              });
              setModal({ type: "add" });
            }}
            className="flex items-center gap-1.5 rounded-md border border-[var(--border-subtle)] bg-[var(--surface)] px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-[var(--surface-elevated)] dark:text-neutral-300"
          >
            <Plus size={14} />
            종목 추가
          </button>
          <button
            type="button"
            onClick={handleSync}
            disabled={syncing}
            className="flex items-center gap-2 rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-neutral-700 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
          >
            <RefreshCw size={14} className={syncing ? "animate-spin" : ""} />
            {syncing ? "동기화 중..." : "KIS 동기화"}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-400">
          {error}
        </div>
      )}

      <div className="flex gap-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] p-1 w-fit">
        {(["ALL", "KRX", "US"] as const).map((f) => (
          <button
            key={f}
            type="button"
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

      {loading ? (
        <div className="py-16 text-center text-sm text-neutral-400">불러오는 중...</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[var(--border-subtle)] py-16 text-center text-sm text-neutral-400 space-y-2">
          <p>보유 종목이 없습니다.</p>
          <p className="text-xs">KIS 동기화 또는 「종목 추가」로 등록하세요.</p>
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
                  <th className="px-4 py-3 text-center font-medium w-24">관리</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)]">
                {sorted.map((stock) => (
                  <tr
                    key={stock.id}
                    onClick={() => {
                      if (editingId !== stock.id && menuOpenId !== stock.id)
                        router.push(`/chart?symbol=${stock.symbol}`);
                    }}
                    className={`transition-colors ${
                      editingId === stock.id
                        ? "bg-[var(--surface-elevated)]"
                        : "cursor-pointer hover:bg-[var(--surface-elevated)]"
                    }`}
                  >
                    <td className="px-4 py-3">
                      <div className="inline-flex flex-col" title="차트 보기">
                        <div className="flex items-center gap-1.5 font-medium text-neutral-900 dark:text-neutral-100">
                          {stock.name}
                          <BarChart size={12} className="text-neutral-300" />
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                          <span className="text-xs text-neutral-400">{stock.symbol}</span>
                          <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-500 dark:bg-neutral-800">
                            {stock.market}
                          </span>
                          {stock.position_source === "manual" && (
                            <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[10px] text-violet-700 dark:bg-violet-900/30 dark:text-violet-300">
                              수동
                            </span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-neutral-900 dark:text-neutral-100">
                      {fmt(stock.current_price, stock.currency)}
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
                      {fmt(Math.round(evalValue(stock)), stock.currency)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {(() => {
                        const pnl = pnlValue(stock);
                        const isPos = pnl >= 0;
                        return (
                          <span
                            className={`font-medium ${isPos ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}
                          >
                            {isPos ? "+" : "-"}
                            {fmt(Math.abs(Math.round(pnl)), stock.currency)}
                          </span>
                        );
                      })()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <RateCell rate={stock.profit_rate} />
                    </td>
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      {editingId === stock.id ? (
                        <select
                          value={editSector}
                          onChange={(e) => setEditSector(e.target.value)}
                          className="rounded border border-[var(--border-subtle)] bg-[var(--surface)] px-2 py-1 text-xs focus:outline-none"
                        >
                          <option value="">선택</option>
                          {SECTORS.map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="text-xs text-neutral-500">{stock.sector || "—"}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 max-w-[180px]" onClick={(e) => e.stopPropagation()}>
                      {editingId === stock.id ? (
                        <textarea
                          value={editMemo}
                          onChange={(e) => setEditMemo(e.target.value)}
                          rows={2}
                          className="w-full rounded border border-[var(--border-subtle)] bg-[var(--surface)] px-2 py-1 text-xs focus:outline-none resize-none"
                        />
                      ) : (
                        <span className="text-xs text-neutral-500 line-clamp-2">{stock.memo || "—"}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center relative" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-center gap-0.5">
                        {editingId === stock.id ? (
                          <>
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
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingId(stock.id);
                                setEditMemo(stock.memo || "");
                                setEditSector(stock.sector || "");
                              }}
                              className="rounded p-1 text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                              title="메모"
                            >
                              <PenLine size={14} />
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setMenuOpenId(menuOpenId === stock.id ? null : stock.id);
                              }}
                              className="rounded p-1 text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                            >
                              <MoreHorizontal size={14} />
                            </button>
                          </>
                        )}
                      </div>
                      {menuOpenId === stock.id && (
                        <div
                          className="absolute right-2 top-full z-20 mt-1 min-w-[120px] rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] py-1 text-xs shadow-lg"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            className="block w-full px-3 py-2 text-left hover:bg-[var(--surface-elevated)] text-emerald-700 dark:text-emerald-400"
                            onClick={() => openTradeModal("buy", stock)}
                          >
                            매수
                          </button>
                          <button
                            type="button"
                            className="block w-full px-3 py-2 text-left hover:bg-[var(--surface-elevated)] text-red-600 dark:text-red-400"
                            onClick={() => openTradeModal("sell", stock)}
                          >
                            매도
                          </button>
                          <button
                            type="button"
                            className="block w-full px-3 py-2 text-left hover:bg-[var(--surface-elevated)]"
                            onClick={() => openAdjustModal(stock)}
                          >
                            잔고 수정
                          </button>
                          <button
                            type="button"
                            className="block w-full px-3 py-2 text-left hover:bg-[var(--surface-elevated)] text-red-600 dark:text-red-400"
                            onClick={() => {
                              setModal({ type: "delete", stock });
                              setMenuOpenId(null);
                            }}
                          >
                            보유 제외
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {modal?.type === "add" && (
        <ModalBackdrop title="종목 추가" onClose={() => setModal(null)}>
          <form onSubmit={submitAdd} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="종목코드 (6자리)">
                <input
                  required
                  className={inputCls}
                  value={addForm.symbol}
                  onChange={(e) => setAddForm((f) => ({ ...f, symbol: e.target.value }))}
                  placeholder="069500"
                />
              </Field>
              <Field label="시장">
                <select
                  className={inputCls}
                  value={addForm.market}
                  onChange={(e) => setAddForm((f) => ({ ...f, market: e.target.value }))}
                >
                  <option value="KRX">KRX</option>
                  <option value="NASDAQ">NASDAQ</option>
                  <option value="NYSE">NYSE</option>
                </select>
              </Field>
            </div>
            <Field label="종목명">
              <input
                required
                className={inputCls}
                value={addForm.name}
                onChange={(e) => setAddForm((f) => ({ ...f, name: e.target.value }))}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="보유 수량">
                <input
                  required
                  type="number"
                  min={0}
                  step="any"
                  className={inputCls}
                  value={addForm.qty || ""}
                  onChange={(e) => setAddForm((f) => ({ ...f, qty: Number(e.target.value) }))}
                />
              </Field>
              <Field label="평균단가">
                <input
                  required
                  type="number"
                  min={0}
                  step="any"
                  className={inputCls}
                  value={addForm.avg_price || ""}
                  onChange={(e) => setAddForm((f) => ({ ...f, avg_price: Number(e.target.value) }))}
                />
              </Field>
            </div>
            <Field label="섹터 (선택)">
              <select
                className={inputCls}
                value={addForm.sector || ""}
                onChange={(e) => setAddForm((f) => ({ ...f, sector: e.target.value }))}
              >
                <option value="">선택</option>
                {SECTORS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </Field>
            <button
              type="submit"
              disabled={saving}
              className="w-full rounded-md bg-neutral-900 py-2.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
            >
              {saving ? "등록 중..." : "등록"}
            </button>
          </form>
        </ModalBackdrop>
      )}

      {modal && (modal.type === "buy" || modal.type === "sell") && (
        <ModalBackdrop
          title={`${modal.type === "buy" ? "매수" : "매도"} — ${modal.stock.name}`}
          onClose={() => setModal(null)}
        >
          <form onSubmit={submitTrade} className="space-y-3">
            <p className="text-xs text-neutral-400">
              현재 보유 {modal.stock.qty.toLocaleString()}주 · 평단 {fmt(modal.stock.avg_price, modal.stock.currency)}
            </p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="수량">
                <input
                  required
                  type="number"
                  min={0}
                  step="any"
                  className={inputCls}
                  value={tradeQty}
                  onChange={(e) => setTradeQty(e.target.value)}
                />
              </Field>
              <Field label="체결 단가">
                <input
                  required
                  type="number"
                  min={0}
                  step="any"
                  className={inputCls}
                  value={tradePrice}
                  onChange={(e) => setTradePrice(e.target.value)}
                />
              </Field>
            </div>
            <Field label="체결일">
              <input
                type="date"
                className={inputCls}
                value={tradeDate}
                onChange={(e) => setTradeDate(e.target.value)}
              />
            </Field>
            <Field label="메모 (선택)">
              <input className={inputCls} value={tradeMemo} onChange={(e) => setTradeMemo(e.target.value)} />
            </Field>
            <button
              type="submit"
              disabled={saving}
              className={`w-full rounded-md py-2.5 text-sm font-medium text-white disabled:opacity-50 ${
                modal.type === "buy" ? "bg-emerald-600 hover:bg-emerald-700" : "bg-red-600 hover:bg-red-700"
              }`}
            >
              {saving ? "반영 중..." : modal.type === "buy" ? "매수 반영" : "매도 반영"}
            </button>
          </form>
        </ModalBackdrop>
      )}

      {modal?.type === "adjust" && (
        <ModalBackdrop title={`잔고 수정 — ${modal.stock.name}`} onClose={() => setModal(null)}>
          <form onSubmit={submitAdjust} className="space-y-3">
            <Field label="종목명">
              <input className={inputCls} value={adjName} onChange={(e) => setAdjName(e.target.value)} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="보유 수량">
                <input
                  required
                  type="number"
                  min={0}
                  step="any"
                  className={inputCls}
                  value={adjQty}
                  onChange={(e) => setAdjQty(e.target.value)}
                />
              </Field>
              <Field label="평균단가">
                <input
                  required
                  type="number"
                  min={0}
                  step="any"
                  className={inputCls}
                  value={adjAvg}
                  onChange={(e) => setAdjAvg(e.target.value)}
                />
              </Field>
            </div>
            <p className="text-[10px] text-neutral-400">수동 입력 종목으로 표시되며 KIS 동기화 시 수량·평단은 유지됩니다.</p>
            <button
              type="submit"
              disabled={saving}
              className="w-full rounded-md bg-neutral-900 py-2.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
            >
              {saving ? "저장 중..." : "저장"}
            </button>
          </form>
        </ModalBackdrop>
      )}

      {modal?.type === "delete" && (
        <ModalBackdrop title="보유 제외" onClose={() => setModal(null)}>
          <p className="text-sm text-neutral-600 dark:text-neutral-400 mb-4">
            <strong>{modal.stock.name}</strong> ({modal.stock.symbol})을(를) 목록에서 제외합니다.
            AI 분석·차트 이력은 유지됩니다.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setModal(null)}
              className="flex-1 rounded-md border border-[var(--border-subtle)] py-2 text-sm"
            >
              취소
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={confirmDelete}
              className="flex-1 rounded-md bg-red-600 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {saving ? "처리 중..." : "제외"}
            </button>
          </div>
        </ModalBackdrop>
      )}
    </div>
  );
}
