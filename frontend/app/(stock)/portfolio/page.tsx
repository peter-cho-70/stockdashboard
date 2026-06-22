"use client";

import { useEffect, useState, useCallback, useMemo, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
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
  Target,
  Calculator,
  Layers,
  History,
  Trash2,
} from "lucide-react";
import {
  api,
  marketApi,
  type StockItem,
  type StockCreatePayload,
  type TradeWhatIfItem,
  type RecentTradeForWhatIf,
} from "@/lib/api";
import { krChangeClass, krSignedMediumClass } from "@/lib/krMarketColors";
import { netSellProceeds } from "@/lib/tax";
import { computeTargetAverage } from "@/lib/priceTargetUtils";

function tradeLookbackStart(years = 3): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

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
  | { type: "mixed"; stock: StockItem }
  | { type: "simulate"; stock: StockItem }
  | { type: "whatif"; stock: StockItem }
  | { type: "scenario"; stock: StockItem }
  | null;

const SORT_STORAGE_KEY = "stockmind-portfolio-sort";

function loadSortFromStorage(): { key: SortKey; dir: SortDir } {
  try {
    const raw = localStorage.getItem(SORT_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { key?: SortKey; dir?: SortDir };
      if (parsed.key && parsed.dir) return { key: parsed.key, dir: parsed.dir };
    }
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

function simulateMixedTrade(
  stock: StockItem,
  { sellQty, sellPrice, buyQty, buyPrice, evalPrice }: { sellQty: number; sellPrice: number; buyQty: number; buyPrice: number; evalPrice: number },
) {
  let qty = stock.qty;
  let avg = stock.avg_price;
  let realizedPnl = 0;
  if (sellQty > 0) {
    realizedPnl = netSellProceeds(sellQty, sellPrice) - sellQty * avg;
    qty -= sellQty;
  }
  if (buyQty > 0) {
    avg = qty > 0 ? (qty * avg + buyQty * buyPrice) / (qty + buyQty) : buyPrice;
    qty += buyQty;
  }
  const unrealizedPnl = qty * (evalPrice - avg);
  return { realizedPnl, newQty: qty, newAvg: avg, unrealizedPnl, totalPnl: realizedPnl + unrealizedPnl };
}

function RateCell({ rate }: { rate: number }) {
  if (rate > 0)
    return (
      <span className={`inline-flex items-center gap-0.5 ${krSignedMediumClass(rate)}`}>
        <ArrowUpRight size={13} />
        {rate.toFixed(2)}%
      </span>
    );
  if (rate < 0)
    return (
      <span className={`inline-flex items-center gap-0.5 ${krSignedMediumClass(rate)}`}>
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

function PortfolioContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const deepLinkHandledRef = useRef(false);
  const [stocks, setStocks] = useState<StockItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingSymbol, setEditingSymbol] = useState<string | null>(null);
  const [editMemo, setEditMemo] = useState("");
  const [editSector, setEditSector] = useState("");
  const [filter, setFilter] = useState<"ALL" | "KRX" | "US">("ALL");
  const [sortKey, setSortKey] = useState<SortKey>("eval_value");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const sortHydratedRef = useRef(false);
  const [menuOpenSymbol, setMenuOpenSymbol] = useState<string | null>(null);
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
  const [tradeDate, setTradeDate] = useState("");
  const [tradeMemo, setTradeMemo] = useState("");

  // mixed trade form (불타기·물타기 실제 체결)
  const [mixedSellQty, setMixedSellQty] = useState("");
  const [mixedSellPrice, setMixedSellPrice] = useState("");
  const [mixedBuyQty, setMixedBuyQty] = useState("");
  const [mixedBuyPrice, setMixedBuyPrice] = useState("");
  const [mixedDate, setMixedDate] = useState("");
  const [mixedMemo, setMixedMemo] = useState("");
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // 시나리오 분석 (불타기·물타기 / 매수 시나리오 / 매도 후 기회비용 통합 모달)
  const [scenarioTab, setScenarioTab] = useState<"mixed" | "buydate" | "whatif">("mixed");
  const [simSellQty, setSimSellQty] = useState("");
  const [simSellPrice, setSimSellPrice] = useState("");
  const [simBuyQty, setSimBuyQty] = useState("");
  const [simBuyPrice, setSimBuyPrice] = useState("");
  const [simEvalPrice, setSimEvalPrice] = useState("");

  // 매수 시나리오 (특정일 종가로 매수했다면)
  const [bdDate, setBdDate] = useState("");
  const [bdQty, setBdQty] = useState("");
  const [bdPrice, setBdPrice] = useState<number | null>(null);
  const [bdLoading, setBdLoading] = useState(false);
  const [bdError, setBdError] = useState<string | null>(null);

  // what-if (매도 후 기회비용 분석) form
  const [wifSellMode, setWifSellMode] = useState<"manual" | "real">("manual");
  const [wifSellQty, setWifSellQty] = useState("");
  const [wifSellPrice, setWifSellPrice] = useState("");
  const [wifSellDate, setWifSellDate] = useState("");
  const [wifSellTradeIds, setWifSellTradeIds] = useState<number[]>([]);
  const [wifBuyMode, setWifBuyMode] = useState<"none" | "manual" | "real">("none");
  const [wifBuySymbol, setWifBuySymbol] = useState("");
  const [wifBuyQty, setWifBuyQty] = useState("");
  const [wifBuyPrice, setWifBuyPrice] = useState("");
  const [wifBuyDate, setWifBuyDate] = useState("");
  const [wifBuyTradeId, setWifBuyTradeId] = useState("");
  const [wifMemo, setWifMemo] = useState("");
  const [recentSells, setRecentSells] = useState<RecentTradeForWhatIf[]>([]);
  const [recentBuys, setRecentBuys] = useState<RecentTradeForWhatIf[]>([]);
  const [whatIfList, setWhatIfList] = useState<TradeWhatIfItem[]>([]);
  const [whatIfAsOf, setWhatIfAsOf] = useState("");
  const [whatIfLoading, setWhatIfLoading] = useState(false);

  // adjust form
  const [adjQty, setAdjQty] = useState("");
  const [adjAvg, setAdjAvg] = useState("");
  const [adjName, setAdjName] = useState("");
  const [adjTargetBuy, setAdjTargetBuy] = useState("");
  const [adjTargetSell, setAdjTargetSell] = useState("");

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

  const [computedBuyPrices, setComputedBuyPrices] = useState<Record<string, number | null>>({});
  const symbolsKey = stocks.map((s) => s.symbol).join(",");

  useEffect(() => {
    const symbols = symbolsKey ? symbolsKey.split(",") : [];
    if (symbols.length === 0) return;
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        symbols.map(async (symbol) => {
          try {
            const [{ targets }, setting] = await Promise.all([
              marketApi.getPriceTargets(symbol),
              marketApi.getTargetSetting(symbol),
            ]);
            const avg = computeTargetAverage(targets, setting.avg_window_days);
            const buyPrice = avg ? avg.avg * (setting.weight_pct / 100) : null;
            return [symbol, buyPrice] as const;
          } catch {
            return [symbol, null] as const;
          }
        }),
      );
      if (!cancelled) setComputedBuyPrices(Object.fromEntries(entries));
    })();
    return () => {
      cancelled = true;
    };
  }, [symbolsKey]);

  useEffect(() => {
    if (!menuOpenSymbol) return;
    const close = () => setMenuOpenSymbol(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menuOpenSymbol]);

  const loadWhatIfs = useCallback(async (asOf: string) => {
    setWhatIfLoading(true);
    try {
      const res = await api.getTradeWhatIfs(asOf || undefined);
      setWhatIfList(res.trades);
    } catch (e) {
      setError(e instanceof Error ? e.message : "기회비용 분석 목록을 불러오지 못했습니다.");
    } finally {
      setWhatIfLoading(false);
    }
  }, []);

  useEffect(() => {
    loadWhatIfs(whatIfAsOf);
  }, [loadWhatIfs, whatIfAsOf]);

  function openTradeModal(type: "buy" | "sell", stock: StockItem) {
    setTradeQty("");
    setTradePrice(String(stock.current_price || stock.avg_price || ""));
    setTradeDate(todayStr());
    setTradeMemo("");
    setModal({ type, stock });
    setMenuOpenSymbol(null);
  }

  function openMixedModal(stock: StockItem) {
    setMixedSellQty("");
    setMixedSellPrice("");
    setMixedBuyQty("");
    setMixedBuyPrice(String(stock.current_price || stock.avg_price || ""));
    setMixedDate(todayStr());
    setMixedMemo("");
    setModal({ type: "mixed", stock });
    setMenuOpenSymbol(null);
  }

  function openSimulateModal(stock: StockItem) {
    setScenarioTab("mixed");
    setSimSellQty("");
    setSimSellPrice(String(stock.current_price || stock.avg_price || ""));
    setSimBuyQty("");
    setSimBuyPrice(String(stock.current_price || stock.avg_price || ""));
    setSimEvalPrice(String(stock.current_price || stock.avg_price || ""));
    setBdDate("");
    setBdQty("");
    setBdPrice(null);
    setBdError(null);
    setWifSellMode("manual");
    setWifSellQty("");
    setWifSellPrice(String(stock.current_price || stock.avg_price || ""));
    setWifSellDate(todayStr());
    setWifSellTradeIds([]);
    setWifBuyMode("none");
    setWifBuySymbol("");
    setWifBuyQty("");
    setWifBuyPrice("");
    setWifBuyDate("");
    setWifBuyTradeId("");
    setWifMemo("");
    setModal({ type: "simulate", stock });
    setMenuOpenSymbol(null);
  }

  useEffect(() => {
    if (modal?.type !== "simulate" || scenarioTab !== "buydate" || !bdDate) return;
    setBdLoading(true);
    setBdError(null);
    api
      .getPriceOnDate(modal.stock.symbol, bdDate)
      .then((res) => setBdPrice(res.price))
      .catch((e) => {
        setBdPrice(null);
        setBdError(e instanceof Error ? e.message : "종가 조회 실패");
      })
      .finally(() => setBdLoading(false));
  }, [modal, scenarioTab, bdDate]);

  function openWhatIfModal(stock: StockItem) {
    setWifSellMode("manual");
    setWifSellQty("");
    setWifSellPrice(String(stock.current_price || stock.avg_price || ""));
    setWifSellDate(todayStr());
    setWifSellTradeIds([]);
    setWifBuyMode("none");
    setWifBuySymbol("");
    setWifBuyQty("");
    setWifBuyPrice("");
    setWifBuyDate("");
    setWifBuyTradeId("");
    setWifMemo("");
    setModal({ type: "whatif", stock });
    setMenuOpenSymbol(null);
  }

  useEffect(() => {
    if (deepLinkHandledRef.current || loading) return;
    const tradeIdParam = searchParams.get("openWhatIf");
    const sym = searchParams.get("symbol");
    if (!tradeIdParam || !sym) return;
    deepLinkHandledRef.current = true;
    const tradeIds = tradeIdParam.split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n > 0);

    (async () => {
      let stock = stocks.find((s) => s.symbol === sym);
      if (!stock) {
        try {
          const res = await api.ensureStock(sym);
          stock = res.stock;
        } catch (e) {
          setError(e instanceof Error ? e.message : `종목 정보를 불러오지 못했습니다: ${sym}`);
          return;
        }
      }
      openWhatIfModal(stock);
      setWifSellMode("real");
      setWifSellTradeIds(tradeIds);
      router.replace("/portfolio");
    })();
  }, [loading, stocks, searchParams, router]);

  useEffect(() => {
    if (modal?.type !== "whatif" || wifSellMode !== "real") return;
    const symbol = modal.stock.symbol;
    api
      .getRecentTradesForWhatIf("SELL", { symbol, start: tradeLookbackStart(3), limit: 1000 })
      .then((res) => setRecentSells(res.trades))
      .catch(() => setRecentSells([]));
  }, [modal, wifSellMode]);

  useEffect(() => {
    if (modal?.type !== "whatif" || wifBuyMode !== "real") return;
    api
      .getRecentTradesForWhatIf("BUY", { start: tradeLookbackStart(3), limit: 1000 })
      .then((res) => setRecentBuys(res.trades))
      .catch(() => setRecentBuys([]));
  }, [modal, wifBuyMode]);

  function toggleWifSellTradeId(tradeId: number) {
    setWifSellTradeIds((prev) =>
      prev.includes(tradeId) ? prev.filter((id) => id !== tradeId) : [...prev, tradeId],
    );
  }

  const wifSellCandidates = useMemo(() => {
    if (modal?.type !== "whatif") return [];
    return recentSells;
  }, [modal, recentSells]);

  const wifSellSelectionSummary = useMemo(() => {
    if (wifSellTradeIds.length === 0) return null;
    const selected = wifSellCandidates.filter((t) => wifSellTradeIds.includes(t.trade_id));
    const totalQty = selected.reduce((sum, t) => sum + t.qty, 0);
    const totalAmount = selected.reduce((sum, t) => sum + t.qty * t.price, 0);
    return {
      count: selected.length,
      totalQty,
      avgPrice: totalQty > 0 ? totalAmount / totalQty : 0,
    };
  }, [wifSellCandidates, wifSellTradeIds]);

  async function submitWhatIf(e: React.FormEvent) {
    e.preventDefault();
    if (!modal || modal.type !== "whatif") return;
    if (wifSellMode === "real" && wifSellTradeIds.length === 0) {
      setError("실제 매도 내역을 하나 이상 선택하세요.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.createTradeWhatIf({
        sell_symbol: wifSellMode === "manual" ? modal.stock.symbol : undefined,
        sell_qty: wifSellMode === "manual" ? Number(wifSellQty) : undefined,
        sell_price: wifSellMode === "manual" ? Number(wifSellPrice) : undefined,
        sell_date: wifSellMode === "manual" ? wifSellDate : undefined,
        sell_trade_ids: wifSellMode === "real" ? wifSellTradeIds : undefined,
        buy_symbol: wifBuyMode === "manual" ? wifBuySymbol.trim() || undefined : undefined,
        buy_qty: wifBuyMode === "manual" ? Number(wifBuyQty) || undefined : undefined,
        buy_price: wifBuyMode === "manual" ? Number(wifBuyPrice) || undefined : undefined,
        buy_date: wifBuyMode === "manual" ? wifBuyDate || undefined : undefined,
        buy_trade_id: wifBuyMode === "real" ? Number(wifBuyTradeId) || undefined : undefined,
        memo: wifMemo || undefined,
      });
      setModal(null);
      await loadWhatIfs(whatIfAsOf);
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장 실패");
    } finally {
      setSaving(false);
    }
  }

  async function deleteWhatIf(id: number) {
    setError(null);
    try {
      await api.deleteTradeWhatIf(id);
      setWhatIfList((prev) => prev.filter((t) => t.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "삭제 실패");
    }
  }

  function openAdjustModal(stock: StockItem) {
    setAdjQty(String(stock.qty));
    setAdjAvg(String(stock.avg_price));
    setAdjName(stock.name);
    setAdjTargetBuy(stock.target_buy_price ? String(stock.target_buy_price) : "");
    setAdjTargetSell(stock.target_sell_price ? String(stock.target_sell_price) : "");
    setModal({ type: "adjust", stock });
    setMenuOpenSymbol(null);
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

  const [syncingTrades, setSyncingTrades] = useState(false);

  async function handleSyncTrades() {
    setSyncingTrades(true);
    setError(null);
    try {
      const res = await api.syncTradeHistory(90);
      setSuccessMsg(res.message);
      setTimeout(() => setSuccessMsg(null), 5000);
      setRecentSells([]);
      setRecentBuys([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "체결내역 동기화 실패");
    } finally {
      setSyncingTrades(false);
    }
  }

  async function saveMemo(symbol: string) {
    await api.updateMemo(symbol, editMemo, editSector || undefined);
    setStocks((prev) =>
      prev.map((s) =>
        s.symbol === symbol ? { ...s, memo: editMemo, sector: editSector || s.sector } : s,
      ),
    );
    setEditingSymbol(null);
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

  async function submitMixedTrade(e: React.FormEvent) {
    e.preventDefault();
    if (!modal || modal.type !== "mixed") return;
    setSaving(true);
    setError(null);
    try {
      const res = await api.createMixedTrade(modal.stock.symbol, {
        sell_qty: Number(mixedSellQty) || 0,
        sell_price: Number(mixedSellPrice) || 0,
        buy_qty: Number(mixedBuyQty) || 0,
        buy_price: Number(mixedBuyPrice) || 0,
        traded_at: mixedDate,
        memo: mixedMemo || undefined,
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
      setSuccessMsg(
        `혼합 매매 반영 완료 — 실현손익 ${res.realized_pnl >= 0 ? "+" : ""}${fmt(Math.round(res.realized_pnl), modal.stock.currency)}`,
      );
      setTimeout(() => setSuccessMsg(null), 5000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "혼합 매매 반영 실패");
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
      const buy = Number(adjTargetBuy.replace(/,/g, ""));
      const sell = Number(adjTargetSell.replace(/,/g, ""));
      const res = await api.updatePosition(modal.stock.symbol, {
        qty: Number(adjQty),
        avg_price: Number(adjAvg),
        name: adjName.trim() || undefined,
        target_buy_price: adjTargetBuy.trim() === "" || !Number.isFinite(buy) || buy <= 0 ? 0 : buy,
        target_sell_price: adjTargetSell.trim() === "" || !Number.isFinite(sell) || sell <= 0 ? 0 : sell,
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
    const saved = loadSortFromStorage();
    setSortKey(saved.key);
    setSortDir(saved.dir);
    sortHydratedRef.current = true;
  }, []);

  useEffect(() => {
    if (!sortHydratedRef.current) return;
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
          <button
            type="button"
            onClick={handleSyncTrades}
            disabled={syncingTrades}
            title="KIS에서 최근 90일 체결내역(매도 후 기회비용 분석의 '실제 내역'에서 사용)을 가져옵니다"
            className="flex items-center gap-2 rounded-md border border-[var(--border-subtle)] bg-[var(--surface)] px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-[var(--surface-elevated)] disabled:opacity-50 dark:text-neutral-300"
          >
            <History size={14} className={syncingTrades ? "animate-spin" : ""} />
            {syncingTrades ? "체결내역 동기화 중..." : "체결내역 동기화"}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-400">
          {error}
        </div>
      )}

      {successMsg && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-400">
          {successMsg}
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
                  <th className="px-4 py-3 text-left font-medium">희망가</th>
                  <th className="px-4 py-3 text-left font-medium">메모</th>
                  <th className="px-4 py-3 text-center font-medium w-24">관리</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)]">
                {sorted.map((stock) => (
                  <tr
                    key={stock.symbol}
                    onClick={() => {
                      if (editingSymbol !== stock.symbol && menuOpenSymbol !== stock.symbol)
                        router.push(`/chart?symbol=${stock.symbol}`);
                    }}
                    className={`transition-colors ${
                      editingSymbol === stock.symbol
                        ? "bg-[var(--surface-elevated)]"
                        : stock.target_sell_hit
                          ? "cursor-pointer bg-violet-50/60 hover:bg-violet-50 dark:bg-violet-900/15 dark:hover:bg-violet-900/20"
                          : stock.target_buy_hit
                            ? "cursor-pointer bg-sky-50/60 hover:bg-sky-50 dark:bg-sky-900/15 dark:hover:bg-sky-900/20"
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
                          <span className={`font-medium ${krSignedMediumClass(pnl)}`}>
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
                      {editingSymbol === stock.symbol ? (
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
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <div className="flex flex-col gap-0.5 text-[11px]">
                        {(() => {
                          const rawBuyPrice = computedBuyPrices[stock.symbol];
                          if (rawBuyPrice == null) return null;
                          const round = stock.currency === "USD" ? (n: number) => Math.round(n * 100) / 100 : Math.round;
                          const buyPrice = round(rawBuyPrice);
                          const diff = stock.current_price > 0 ? round(stock.current_price - buyPrice) : null;
                          return (
                            <span className="inline-flex items-center gap-1 text-neutral-500 dark:text-neutral-400">
                              매수적정가 {fmt(buyPrice, stock.currency)}
                              {diff != null && (
                                <span
                                  className={
                                    diff >= 0
                                      ? "font-medium text-red-500"
                                      : "font-medium text-emerald-600 dark:text-emerald-400"
                                  }
                                >
                                  ({diff >= 0 ? "+" : ""}
                                  {fmt(diff, stock.currency)})
                                </span>
                              )}
                            </span>
                          );
                        })()}
                        {stock.target_sell_price ? (
                          <span
                            className={`inline-flex items-center gap-1 ${
                              stock.target_sell_hit
                                ? "font-semibold text-violet-600 dark:text-violet-400"
                                : "text-neutral-400"
                            }`}
                          >
                            매도 {fmt(stock.target_sell_price, stock.currency)}
                            {stock.target_sell_hit && <Target size={10} />}
                          </span>
                        ) : null}
                        {computedBuyPrices[stock.symbol] == null && !stock.target_sell_price && (
                          <span className="text-neutral-300 dark:text-neutral-600">—</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 max-w-[180px]" onClick={(e) => e.stopPropagation()}>
                      {editingSymbol === stock.symbol ? (
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
                        {editingSymbol === stock.symbol ? (
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
                              onClick={() => setEditingSymbol(null)}
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
                                setEditingSymbol(stock.symbol);
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
                              onClick={() => openSimulateModal(stock)}
                              className="rounded p-1 text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                              title="불타기·물타기 시나리오 계산기"
                            >
                              <Calculator size={14} />
                            </button>
                            <button
                              type="button"
                              onClick={() => openWhatIfModal(stock)}
                              className="rounded p-1 text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                              title="매도 후 기회비용 분석"
                            >
                              <History size={14} />
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setMenuOpenSymbol(
                                  menuOpenSymbol === stock.symbol ? null : stock.symbol,
                                );
                              }}
                              className="rounded p-1 text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                            >
                              <MoreHorizontal size={14} />
                            </button>
                          </>
                        )}
                      </div>
                      {menuOpenSymbol === stock.symbol && (
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
                            className="flex w-full items-center gap-1.5 px-3 py-2 text-left hover:bg-[var(--surface-elevated)] text-amber-700 dark:text-amber-400"
                            onClick={() => openMixedModal(stock)}
                          >
                            <Layers size={12} />
                            혼합매매(불·물타기)
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
                              setMenuOpenSymbol(null);
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

      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">매도 후 기회비용 분석</h2>
            <p className="mt-0.5 text-xs text-neutral-400">가상 매도 또는 실제 매도 내역을 기준일(현재가/특정일 종가)과 비교합니다</p>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-neutral-500">기준일</span>
            <input
              type="date"
              className="rounded-md border border-[var(--border-subtle)] bg-[var(--background)] px-2 py-1 text-xs focus:outline-none"
              value={whatIfAsOf}
              onChange={(e) => setWhatIfAsOf(e.target.value)}
            />
            {whatIfAsOf && (
              <button type="button" onClick={() => setWhatIfAsOf("")} className="rounded px-2 py-1 text-neutral-500 hover:bg-[var(--surface-elevated)]">
                현재가로
              </button>
            )}
          </div>
        </div>
        {whatIfLoading ? (
          <p className="py-6 text-center text-xs text-neutral-400">불러오는 중...</p>
        ) : whatIfList.length === 0 ? (
          <p className="py-6 text-center text-xs text-neutral-400">행의 <History size={12} className="inline" /> 아이콘으로 분석을 추가하세요.</p>
        ) : (
          <div className="space-y-2">
            {whatIfList.map((item) => {
              if (item.error) {
                return (
                  <div key={item.id} className="flex items-center justify-between rounded-md border border-red-200 bg-red-50/50 p-3 text-xs text-red-600 dark:border-red-900 dark:bg-red-950/20">
                    <span>#{item.id} 평가 실패: {item.error}</span>
                    <button type="button" onClick={() => deleteWhatIf(item.id)} className="rounded p-1 text-red-500 hover:bg-red-100 dark:hover:bg-red-900/30">
                      <Trash2 size={14} />
                    </button>
                  </div>
                );
              }
              return (
                <div key={item.id} className="rounded-md border border-[var(--border-subtle)] p-3 text-sm space-y-1.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className={`rounded px-1.5 py-0.5 text-[10px] ${item.source === "real" ? "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300" : "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"}`}>
                        {item.source === "real" ? "실제" : "가상"}
                      </span>
                      <span className="font-medium text-neutral-900 dark:text-neutral-100">{item.sell_name || item.sell_symbol}</span>
                      <span className="text-xs text-neutral-400">
                        매도 {item.sell_date} · {item.sell_qty.toLocaleString()}주 @ {Math.round(item.sell_price).toLocaleString()}
                        {(item.sell_trade_count ?? 0) > 1 ? ` (${item.sell_trade_count}건 합산)` : ""}
                      </span>
                    </div>
                    <button type="button" onClick={() => deleteWhatIf(item.id)} className="rounded p-1 text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800">
                      <Trash2 size={14} />
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                    <span className="text-neutral-500">기준가({item.as_of}): <span className="text-neutral-700 dark:text-neutral-300">{item.sell_compare_price.toLocaleString()}</span></span>
                    {item.realized_if_sold !== undefined && (
                      <span className="text-neutral-500">매도 실현손익(세후): <span className={krSignedMediumClass(item.realized_if_sold)}>{item.realized_if_sold >= 0 ? "+" : ""}{Math.round(item.realized_if_sold).toLocaleString()}</span></span>
                    )}
                    <span className="text-neutral-500">
                      보유했다면: <span className={krSignedMediumClass(item.holding_opportunity)}>{item.holding_opportunity >= 0 ? "+" : ""}{Math.round(item.holding_opportunity).toLocaleString()}</span>
                      <span className="ml-1 text-[10px] text-neutral-400">{item.holding_opportunity >= 0 ? "(보유했으면 더 벌었을 것)" : "(매도가 손실을 피함)"}</span>
                    </span>
                  </div>
                  {item.buy_symbol && (
                    <div className="rounded-md bg-[var(--surface-elevated)] p-2 text-xs space-y-1">
                      <div>교체매수: <span className="font-medium">{item.buy_name || item.buy_symbol}</span> {item.buy_date} · {item.buy_qty?.toLocaleString()}주 @ {item.buy_price?.toLocaleString()}</div>
                      <div className="flex flex-wrap gap-x-4">
                        <span className="text-neutral-500">기준가: {item.buy_compare_price?.toLocaleString()}</span>
                        <span className="text-neutral-500">신규종목손익: <span className={krSignedMediumClass(item.buy_pnl ?? 0)}>{(item.buy_pnl ?? 0) >= 0 ? "+" : ""}{Math.round(item.buy_pnl ?? 0).toLocaleString()}</span></span>
                        <span className="text-neutral-500">
                          비교우위: <span className={krSignedMediumClass(item.switch_advantage ?? 0)}>{(item.switch_advantage ?? 0) >= 0 ? "+" : ""}{Math.round(item.switch_advantage ?? 0).toLocaleString()}</span>
                          <span className="ml-1 text-[10px] text-neutral-400">{(item.switch_advantage ?? 0) >= 0 ? "(교체매매가 유리)" : "(원 종목 보유가 유리)"}</span>
                        </span>
                      </div>
                    </div>
                  )}
                  {item.memo && <p className="text-xs text-neutral-400">메모: {item.memo}</p>}
                </div>
              );
            })}
          </div>
        )}
      </div>

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

      {modal?.type === "mixed" && (
        <ModalBackdrop title={`혼합매매(불타기·물타기) — ${modal.stock.name}`} onClose={() => setModal(null)}>
          <form onSubmit={submitMixedTrade} className="space-y-3">
            <p className="text-xs text-neutral-400">
              현재 보유 {modal.stock.qty.toLocaleString()}주 · 평단 {fmt(modal.stock.avg_price, modal.stock.currency)}
              · 매도와 매수 중 필요한 것만 입력하세요 (둘 다 입력하면 혼합 체결)
            </p>
            <div className="rounded-md border border-red-200 bg-red-50/50 p-3 space-y-2 dark:border-red-900 dark:bg-red-950/20">
              <p className="text-xs font-medium text-red-700 dark:text-red-400">매도 (선택)</p>
              <div className="grid grid-cols-2 gap-3">
                <Field label="매도 수량">
                  <input type="number" min={0} step="any" className={inputCls} value={mixedSellQty} onChange={(e) => setMixedSellQty(e.target.value)} />
                </Field>
                <Field label="매도 단가">
                  <input type="number" min={0} step="any" className={inputCls} value={mixedSellPrice} onChange={(e) => setMixedSellPrice(e.target.value)} />
                </Field>
              </div>
            </div>
            <div className="rounded-md border border-emerald-200 bg-emerald-50/50 p-3 space-y-2 dark:border-emerald-900 dark:bg-emerald-950/20">
              <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">매수 (선택)</p>
              <div className="grid grid-cols-2 gap-3">
                <Field label="매수 수량">
                  <input type="number" min={0} step="any" className={inputCls} value={mixedBuyQty} onChange={(e) => setMixedBuyQty(e.target.value)} />
                </Field>
                <Field label="매수 단가">
                  <input type="number" min={0} step="any" className={inputCls} value={mixedBuyPrice} onChange={(e) => setMixedBuyPrice(e.target.value)} />
                </Field>
              </div>
            </div>
            <Field label="체결일">
              <input type="date" className={inputCls} value={mixedDate} onChange={(e) => setMixedDate(e.target.value)} />
            </Field>
            <Field label="메모 (선택)">
              <input className={inputCls} value={mixedMemo} onChange={(e) => setMixedMemo(e.target.value)} />
            </Field>
            <button
              type="submit"
              disabled={saving || (!Number(mixedSellQty) && !Number(mixedBuyQty))}
              className="w-full rounded-md bg-amber-600 py-2.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
            >
              {saving ? "반영 중..." : "혼합 매매 반영"}
            </button>
          </form>
        </ModalBackdrop>
      )}

      {modal?.type === "simulate" && (
        <ModalBackdrop title={`시나리오 계산기 — ${modal.stock.name}`} onClose={() => setModal(null)}>
          <div className="space-y-3">
            <div className="flex gap-1 rounded-md bg-[var(--surface-elevated)] p-1 text-xs w-fit">
              <button
                type="button"
                onClick={() => setScenarioTab("mixed")}
                className={`rounded px-2.5 py-1 font-medium ${scenarioTab === "mixed" ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900" : "text-neutral-500"}`}
              >
                불타기·물타기
              </button>
              <button
                type="button"
                onClick={() => setScenarioTab("buydate")}
                className={`rounded px-2.5 py-1 font-medium ${scenarioTab === "buydate" ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900" : "text-neutral-500"}`}
              >
                매수 시나리오
              </button>
            </div>
            <p className="text-xs text-neutral-400">
              현재 보유 {modal.stock.qty.toLocaleString()}주 · 평단 {fmt(modal.stock.avg_price, modal.stock.currency)} · 실제 거래는 기록되지 않습니다
            </p>
            {scenarioTab === "buydate" ? (
              <div className="space-y-3">
                <Field label="매수일 (해당 날짜 종가로 매수했다고 가정)">
                  <input type="date" max={todayStr()} className={inputCls} value={bdDate} onChange={(e) => setBdDate(e.target.value)} />
                </Field>
                <Field label="매수 수량">
                  <input type="number" min={0} step="any" className={inputCls} value={bdQty} onChange={(e) => setBdQty(e.target.value)} />
                </Field>
                {bdLoading && <p className="text-xs text-neutral-400">종가 조회 중...</p>}
                {bdError && <p className="text-xs text-red-600 dark:text-red-400">{bdError}</p>}
                {!bdLoading && bdPrice !== null && Number(bdQty) > 0 && (() => {
                  const qty = Number(bdQty);
                  const cur = modal.stock.currency;
                  const evalPrice = modal.stock.current_price;
                  const cost = qty * bdPrice;
                  const grossValue = qty * evalPrice;
                  const netValue = netSellProceeds(qty, evalPrice);
                  const taxFee = grossValue - netValue;
                  const pnl = netValue - cost;
                  const rate = cost > 0 ? (pnl / cost) * 100 : 0;
                  return (
                    <div className="space-y-1.5 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-elevated)] p-3 text-sm">
                      <div className="flex justify-between"><span className="text-neutral-500">{bdDate} 종가</span><span>{fmt(Math.round(bdPrice), cur)}</span></div>
                      <div className="flex justify-between"><span className="text-neutral-500">매수금액</span><span>{fmt(Math.round(cost), cur)}</span></div>
                      <div className="flex justify-between"><span className="text-neutral-500">현재가</span><span>{fmt(Math.round(evalPrice), cur)}</span></div>
                      <div className="flex justify-between"><span className="text-neutral-500">평가금액(세전)</span><span>{fmt(Math.round(grossValue), cur)}</span></div>
                      <div className="flex justify-between"><span className="text-neutral-500">매도 시 세금·수수료(추정)</span><span className="text-neutral-400">−{fmt(Math.round(taxFee), cur)}</span></div>
                      <div className="flex justify-between border-t border-[var(--border-subtle)] pt-1.5 font-medium">
                        <span>예상 손익(세후, 지금 매도 가정)</span>
                        <span className={krSignedMediumClass(pnl)}>{pnl >= 0 ? "+" : ""}{fmt(Math.round(pnl), cur)} ({rate >= 0 ? "+" : ""}{rate.toFixed(2)}%)</span>
                      </div>
                    </div>
                  );
                })()}
              </div>
            ) : (
              <>
            <div className="rounded-md border border-red-200 bg-red-50/50 p-3 space-y-2 dark:border-red-900 dark:bg-red-950/20">
              <p className="text-xs font-medium text-red-700 dark:text-red-400">매도 (선택)</p>
              <div className="grid grid-cols-2 gap-3">
                <Field label="매도 수량">
                  <input type="number" min={0} step="any" className={inputCls} value={simSellQty} onChange={(e) => setSimSellQty(e.target.value)} />
                </Field>
                <Field label="매도 단가">
                  <input type="number" min={0} step="any" className={inputCls} value={simSellPrice} onChange={(e) => setSimSellPrice(e.target.value)} />
                </Field>
              </div>
            </div>
            <div className="rounded-md border border-emerald-200 bg-emerald-50/50 p-3 space-y-2 dark:border-emerald-900 dark:bg-emerald-950/20">
              <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">매수 (선택)</p>
              <div className="grid grid-cols-2 gap-3">
                <Field label="매수 수량">
                  <input type="number" min={0} step="any" className={inputCls} value={simBuyQty} onChange={(e) => setSimBuyQty(e.target.value)} />
                </Field>
                <Field label="매수 단가">
                  <input type="number" min={0} step="any" className={inputCls} value={simBuyPrice} onChange={(e) => setSimBuyPrice(e.target.value)} />
                </Field>
              </div>
            </div>
            <Field label="평가 기준가 (기본값: 현재가)">
              <input type="number" min={0} step="any" className={inputCls} value={simEvalPrice} onChange={(e) => setSimEvalPrice(e.target.value)} />
            </Field>
            {(() => {
              const sellQty = Number(simSellQty) || 0;
              const sellPrice = Number(simSellPrice) || 0;
              const buyQty = Number(simBuyQty) || 0;
              const buyPrice = Number(simBuyPrice) || 0;
              const evalPrice = Number(simEvalPrice) || modal.stock.current_price;
              if (sellQty <= 0 && buyQty <= 0) return null;
              const overSell = sellQty > modal.stock.qty;
              const result = simulateMixedTrade(modal.stock, { sellQty, sellPrice, buyQty, buyPrice, evalPrice });
              const cur = modal.stock.currency;
              return (
                <div className="space-y-1.5 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-elevated)] p-3 text-sm">
                  {overSell && (
                    <p className="text-xs text-red-600 dark:text-red-400">보유 수량({modal.stock.qty.toLocaleString()}주)보다 매도 수량이 많습니다.</p>
                  )}
                  <div className="flex justify-between"><span className="text-neutral-500">실현손익 (매도분, 세후)</span><span className={krSignedMediumClass(result.realizedPnl)}>{result.realizedPnl >= 0 ? "+" : ""}{fmt(Math.round(result.realizedPnl), cur)}</span></div>
                  <div className="flex justify-between"><span className="text-neutral-500">매매 후 수량</span><span>{result.newQty.toLocaleString()}주</span></div>
                  <div className="flex justify-between"><span className="text-neutral-500">매매 후 평단가</span><span>{fmt(Math.round(result.newAvg), cur)}</span></div>
                  <div className="flex justify-between"><span className="text-neutral-500">평가손익 (잔여분)</span><span className={krSignedMediumClass(result.unrealizedPnl)}>{result.unrealizedPnl >= 0 ? "+" : ""}{fmt(Math.round(result.unrealizedPnl), cur)}</span></div>
                  <div className="flex justify-between border-t border-[var(--border-subtle)] pt-1.5 font-medium"><span>예상 총손익</span><span className={krSignedMediumClass(result.totalPnl)}>{result.totalPnl >= 0 ? "+" : ""}{fmt(Math.round(result.totalPnl), cur)}</span></div>
                </div>
              );
            })()}
              </>
            )}
          </div>
        </ModalBackdrop>
      )}

      {modal?.type === "whatif" && (
        <ModalBackdrop title={`매도 후 기회비용 분석 — ${modal.stock.name}`} onClose={() => setModal(null)}>
          <form onSubmit={submitWhatIf} className="space-y-3">
            <p className="text-xs text-neutral-400">
              매도(또는 매도+교체매수)를 가정하거나, 실제 체결 내역을 골라서 "팔지 않았다면" 기회비용을 추적합니다.
            </p>
            <div className="rounded-md border border-red-200 bg-red-50/50 p-3 space-y-2 dark:border-red-900 dark:bg-red-950/20">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-red-700 dark:text-red-400">매도 (필수)</p>
                <div className="flex gap-1 text-[11px]">
                  <button type="button" onClick={() => { setWifSellMode("manual"); setWifSellTradeIds([]); }} className={`rounded px-2 py-0.5 ${wifSellMode === "manual" ? "bg-red-600 text-white" : "text-neutral-500"}`}>가상 입력</button>
                  <button type="button" onClick={() => setWifSellMode("real")} className={`rounded px-2 py-0.5 ${wifSellMode === "real" ? "bg-red-600 text-white" : "text-neutral-500"}`}>실제 내역</button>
                </div>
              </div>
              {wifSellMode === "manual" ? (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="매도 수량">
                      <input required type="number" min={0} step="any" className={inputCls} value={wifSellQty} onChange={(e) => setWifSellQty(e.target.value)} />
                    </Field>
                    <Field label="매도 단가">
                      <input required type="number" min={0} step="any" className={inputCls} value={wifSellPrice} onChange={(e) => setWifSellPrice(e.target.value)} />
                    </Field>
                  </div>
                  <Field label="매도일">
                    <input type="date" className={inputCls} value={wifSellDate} onChange={(e) => setWifSellDate(e.target.value)} />
                  </Field>
                </>
              ) : (
                <Field label={`실제 매도 내역 선택 (${modal.stock.symbol}) — 복수 선택 가능`}>
                  <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-[var(--border-subtle)] bg-[var(--background)] p-2">
                    {wifSellCandidates.length === 0 ? (
                      <p className="py-2 text-center text-xs text-neutral-400">
                        선택 가능한 매도 내역이 없습니다. 체결내역 페이지에서 <strong>2년</strong> 또는 원하는 기간을 선택한 뒤 KIS 동기화를 실행하세요.
                      </p>
                    ) : (
                      wifSellCandidates.map((t) => (
                        <label
                          key={t.trade_id}
                          className="flex cursor-pointer items-start gap-2 rounded px-1 py-1.5 text-xs hover:bg-[var(--surface-elevated)]"
                        >
                          <input
                            type="checkbox"
                            className="mt-0.5"
                            checked={wifSellTradeIds.includes(t.trade_id)}
                            onChange={() => toggleWifSellTradeId(t.trade_id)}
                          />
                          <span className="text-neutral-700 dark:text-neutral-300">
                            {t.traded_at} · {t.qty.toLocaleString()}주 @ {t.price.toLocaleString()}
                            {t.memo ? <span className="ml-1 text-neutral-400">({t.memo})</span> : null}
                          </span>
                        </label>
                      ))
                    )}
                  </div>
                  {wifSellSelectionSummary && (
                    <p className="mt-1.5 text-[11px] text-neutral-500">
                      {wifSellSelectionSummary.count}건 선택 · 합계 {wifSellSelectionSummary.totalQty.toLocaleString()}주 · 가중평균 {Math.round(wifSellSelectionSummary.avgPrice).toLocaleString()}원
                    </p>
                  )}
                </Field>
              )}
            </div>
            <div className="rounded-md border border-emerald-200 bg-emerald-50/50 p-3 space-y-2 dark:border-emerald-900 dark:bg-emerald-950/20">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">교체매수 (선택)</p>
                <div className="flex gap-1 text-[11px]">
                  <button type="button" onClick={() => setWifBuyMode("none")} className={`rounded px-2 py-0.5 ${wifBuyMode === "none" ? "bg-emerald-600 text-white" : "text-neutral-500"}`}>없음</button>
                  <button type="button" onClick={() => setWifBuyMode("manual")} className={`rounded px-2 py-0.5 ${wifBuyMode === "manual" ? "bg-emerald-600 text-white" : "text-neutral-500"}`}>가상 입력</button>
                  <button type="button" onClick={() => setWifBuyMode("real")} className={`rounded px-2 py-0.5 ${wifBuyMode === "real" ? "bg-emerald-600 text-white" : "text-neutral-500"}`}>실제 내역</button>
                </div>
              </div>
              {wifBuyMode === "manual" && (
                <>
                  <Field label="매수 종목코드 (6자리)">
                    <input className={inputCls} value={wifBuySymbol} onChange={(e) => setWifBuySymbol(e.target.value)} placeholder="예: 005930" />
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="매수 수량">
                      <input type="number" min={0} step="any" className={inputCls} value={wifBuyQty} onChange={(e) => setWifBuyQty(e.target.value)} />
                    </Field>
                    <Field label="매수 단가">
                      <input type="number" min={0} step="any" className={inputCls} value={wifBuyPrice} onChange={(e) => setWifBuyPrice(e.target.value)} />
                    </Field>
                  </div>
                  <Field label="매수일">
                    <input type="date" className={inputCls} value={wifBuyDate} onChange={(e) => setWifBuyDate(e.target.value)} />
                  </Field>
                </>
              )}
              {wifBuyMode === "real" && (
                <Field label="실제 매수 내역에서 선택 (전 종목)">
                  <select required className={inputCls} value={wifBuyTradeId} onChange={(e) => setWifBuyTradeId(e.target.value)}>
                    <option value="">선택하세요</option>
                    {recentBuys.map((t) => (
                      <option key={t.trade_id} value={t.trade_id}>
                        {t.name}({t.symbol}) · {t.traded_at} · {t.qty.toLocaleString()}주 @ {t.price.toLocaleString()}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
            </div>
            <Field label="메모 (선택)">
              <input className={inputCls} value={wifMemo} onChange={(e) => setWifMemo(e.target.value)} />
            </Field>
            <button
              type="submit"
              disabled={saving || (wifSellMode === "real" && wifSellTradeIds.length === 0)}
              className="w-full rounded-md bg-neutral-900 py-2.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
            >
              {saving ? "저장 중..." : "분석 기록 저장"}
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
            <div className="grid grid-cols-2 gap-3">
              <Field label="매수 희망가 (선택)">
                <input
                  type="number"
                  min={0}
                  step="any"
                  placeholder="비우면 해제"
                  className={inputCls}
                  value={adjTargetBuy}
                  onChange={(e) => setAdjTargetBuy(e.target.value)}
                />
              </Field>
              <Field label="매도 희망가 (선택)">
                <input
                  type="number"
                  min={0}
                  step="any"
                  placeholder="비우면 해제"
                  className={inputCls}
                  value={adjTargetSell}
                  onChange={(e) => setAdjTargetSell(e.target.value)}
                />
              </Field>
            </div>
            <p className="text-[10px] text-neutral-400">수동 입력 종목으로 표시되며 KIS 동기화 시 수량·평단은 유지됩니다. 희망가 도달 시 알림이 발송됩니다.</p>
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

export default function PortfolioPage() {
  return (
    <Suspense fallback={<div className="py-16 text-center text-sm text-neutral-400">불러오는 중...</div>}>
      <PortfolioContent />
    </Suspense>
  );
}
