"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import {
  Plus, Trash2, PenLine, Check, X,
  TrendingUp, TrendingDown, Gift, Wallet,
  Receipt, Banknote, ArrowUpRight, ArrowDownRight,
  Star,
} from "lucide-react";
import {
  LineChart, Line, ReferenceLine,
} from "recharts";
import { api, type StockItem } from "@/lib/api";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api";
const THIS_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: THIS_YEAR - 2019 }, (_, i) => 2020 + i).reverse();

// ─── 타입 ────────────────────────────────────────────
interface GainItem {
  id: number; year: number; gain_type: "CAPITAL" | "DIVIDEND";
  symbol: string | null; stock_name: string | null;
  amount: number; tax_amount: number; net_amount: number;
  trade_date: string | null; note: string | null;
}
interface YearlySummary {
  year: number;
  capital_amount: number; capital_tax: number;
  dividend_amount: number; dividend_tax: number;
  total_amount: number; total_tax: number; total_net: number;
}
interface AllTime { capital: number; dividend: number; total: number; tax: number; net: number; }

// ─── 유틸 ─────────────────────────────────────────────
const fmt = (n: number) => n.toLocaleString("ko-KR");
const fmtW = (n: number) => `${fmt(Math.round(n))}원`;
const isValidGainAmount = (v: string) => {
  if (v === "" || v === "-") return false;
  const n = Number(v);
  return Number.isFinite(n) && n !== 0;
};

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  return r.json();
}

// ─── 서브 컴포넌트 ────────────────────────────────────
function SummaryCard({ icon, label, value, sub, highlight, color }: {
  icon: React.ReactNode; label: string; value: string; sub?: string;
  highlight?: boolean; color?: string;
}) {
  return (
    <div className={`rounded-lg border bg-[var(--surface)] p-4 ${highlight ? "border-neutral-400 dark:border-neutral-500" : "border-[var(--border-subtle)]"}`}>
      <div className="flex items-center gap-1.5 text-xs text-neutral-500">{icon}{label}</div>
      <div className={`mt-1.5 text-base font-bold ${color ?? "text-neutral-900 dark:text-neutral-100"}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-neutral-400">{sub}</div>}
    </div>
  );
}

function RateTag({ rate }: { rate: number }) {
  if (rate > 0) return (
    <span className="inline-flex items-center gap-0.5 text-emerald-600 dark:text-emerald-400 font-medium">
      <ArrowUpRight size={13} />{rate.toFixed(2)}%
    </span>
  );
  if (rate < 0) return (
    <span className="inline-flex items-center gap-0.5 text-red-600 dark:text-red-400 font-medium">
      <ArrowDownRight size={13} />{Math.abs(rate).toFixed(2)}%
    </span>
  );
  return <span className="text-neutral-400">0.00%</span>;
}

// ─── 메인 페이지 ──────────────────────────────────────
export default function GainsPage() {
  const router = useRouter();
  const [stocks, setStocks] = useState<StockItem[]>([]);
  const [summary, setSummary] = useState<{ yearly: YearlySummary[]; all_time: AllTime } | null>(null);
  const [gains, setGains] = useState<GainItem[]>([]);
  const [cashBalance, setCashBalance] = useState(0);
  const [cashInput, setCashInput] = useState("");
  const [editingCash, setEditingCash] = useState(false);
  const [filterYear, setFilterYear] = useState<number | "ALL">(THIS_YEAR);
  const [filterType, setFilterType] = useState<"ALL" | "CAPITAL" | "DIVIDEND">("ALL");

  // 입력 폼
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    year: THIS_YEAR, gain_type: "CAPITAL" as "CAPITAL" | "DIVIDEND",
    stock_name: "", symbol: "", amount: "", tax_amount: "", trade_date: "", note: "",
  });
  const [submitting, setSubmitting] = useState(false);

  // 편집
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<Partial<GainItem & { amount: number; tax_amount: number }>>({});

  const loadAll = useCallback(async () => {
    try {
      const qs = [
        filterYear !== "ALL" ? `year=${filterYear}` : "",
        filterType !== "ALL" ? `gain_type=${filterType}` : "",
      ].filter(Boolean).join("&");

      const [sum, list, stockList, cash] = await Promise.all([
        fetchJson<{ yearly: YearlySummary[]; all_time: AllTime }>("/gains/summary"),
        fetchJson<GainItem[]>(`/gains${qs ? `?${qs}` : ""}`),
        api.getStocks(),
        fetchJson<{ cash_balance: number }>("/gains/cash"),
      ]);
      setSummary(sum);
      setGains(list);
      setStocks(stockList);
      setCashBalance(cash.cash_balance);
      setCashInput(String(cash.cash_balance));
    } catch { /* ignore */ }
  }, [filterYear, filterType]);

  useEffect(() => { loadAll(); }, [loadAll]);

  async function saveCash() {
    await fetchJson("/gains/cash", { method: "POST", body: JSON.stringify({ amount: Number(cashInput) || 0 }) });
    setCashBalance(Number(cashInput) || 0);
    setEditingCash(false);
    await loadAll();
  }

  async function handleSubmit() {
    if (!isValidGainAmount(form.amount)) return;
    setSubmitting(true);
    try {
      await fetchJson("/gains", {
        method: "POST",
        body: JSON.stringify({
          year: form.year, gain_type: form.gain_type,
          stock_name: form.stock_name || null, symbol: form.symbol || null,
          amount: Number(form.amount), tax_amount: Number(form.tax_amount || 0),
          trade_date: form.trade_date || null, note: form.note || null,
        }),
      });
      setForm({ year: THIS_YEAR, gain_type: "CAPITAL", stock_name: "", symbol: "", amount: "", tax_amount: "", trade_date: "", note: "" });
      setShowForm(false);
      await loadAll();
    } finally { setSubmitting(false); }
  }

  async function handleDelete(id: number) {
    if (!confirm("이 내역을 삭제할까요?")) return;
    await fetchJson(`/gains/${id}`, { method: "DELETE" });
    loadAll();
  }

  async function handleEditSave(id: number) {
    await fetchJson(`/gains/${id}`, {
      method: "PATCH",
      body: JSON.stringify({
        amount: editForm.amount, tax_amount: editForm.tax_amount,
        stock_name: editForm.stock_name, trade_date: editForm.trade_date, note: editForm.note,
      }),
    });
    setEditingId(null);
    loadAll();
  }

  // ─── 포트폴리오 계산 ────────────────────────────────
  const totalEval   = stocks.reduce((s, st) => s + (st.current_value ?? st.current_price * st.qty), 0);
  const totalPurch  = stocks.reduce((s, st) => s + st.avg_price * st.qty, 0);
  const totalUnreal = totalEval - totalPurch;
  const totalAssets = totalEval + cashBalance;
  const allTime     = summary?.all_time;

  // ─── 전체 수익 계산 ─────────────────────────────────
  const realizedNet   = allTime?.net ?? 0;
  const totalProfit   = realizedNet + totalUnreal;
  const totalInvested = totalPurch;
  const totalProfitRate = totalInvested > 0 ? (totalProfit / totalInvested) * 100 : 0;
  const unrealRate    = totalInvested > 0 ? (totalUnreal / totalInvested) * 100 : 0;
  const realRate      = totalInvested > 0 ? (realizedNet / totalInvested) * 100 : 0;

  // ─── 올해 수익 계산 ─────────────────────────────────
  const thisYearRow   = summary?.yearly.find((y) => y.year === THIS_YEAR);
  const thisYearNet   = thisYearRow?.total_net ?? 0;          // 올해 실현(세후)
  const thisYearCapital  = thisYearRow?.capital_amount ?? 0;
  const thisYearDividend = thisYearRow?.dividend_amount ?? 0;
  const thisYearTax      = thisYearRow?.total_tax ?? 0;
  const thisYearTotal    = thisYearNet + totalUnreal;         // 올해 실현 + 미실현
  const thisYearRate     = totalInvested > 0 ? (thisYearTotal / totalInvested) * 100 : 0;

  // ─── 차트 데이터 ────────────────────────────────────
  const chartData = [...(summary?.yearly ?? [])].sort((a, b) => a.year - b.year).map((y) => ({
    year: `${y.year}`,
    매도수익: Math.round(y.capital_amount),
    배당수익: Math.round(y.dividend_amount),
    세금:   Math.round(y.total_tax),
    순이익:  Math.round(y.total_net),
  }));

  // 올해 데이터에 미실현 평가익 추가
  const combinedChartData = chartData.map((d) =>
    d.year === String(THIS_YEAR)
      ? { ...d, 미실현평가익: Math.round(totalUnreal) }
      : { ...d, 미실현평가익: 0 }
  );

  return (
    <div className="space-y-6">
      {/* ── 헤더 ─────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">총수익 분석</h1>
          <p className="mt-0.5 text-xs text-neutral-400">매도·배당 실현수익 + 포트폴리오 평가익 종합</p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-2 rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900"
        >
          <Plus size={14} /> 수익 추가
        </button>
      </div>

      {/* ── 올해/전체 수익 히어로 2분할 ──────────────── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">

        {/* 올해 수익 */}
        <div className={`rounded-xl border-2 p-5 ${thisYearTotal >= 0 ? "border-blue-200 bg-blue-50/50 dark:border-blue-800 dark:bg-blue-900/15" : "border-red-200 bg-red-50/50 dark:border-red-800 dark:bg-red-900/15"}`}>
          <div className="flex items-center justify-between mb-2">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-neutral-500 uppercase tracking-wide">
              <Star size={13} className="text-blue-400" />
              {THIS_YEAR}년 수익
            </span>
            <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-600 dark:bg-blue-900/40 dark:text-blue-400">진행중</span>
          </div>
          <div className={`text-3xl font-bold tracking-tight ${thisYearTotal >= 0 ? "text-blue-700 dark:text-blue-300" : "text-red-700 dark:text-red-300"}`}>
            {thisYearTotal >= 0 ? "+" : ""}{fmt(Math.round(thisYearTotal))}원
          </div>
          <div className={`mt-1 text-sm font-semibold ${thisYearRate >= 0 ? "text-blue-600 dark:text-blue-400" : "text-red-500"}`}>
            {thisYearRate >= 0 ? "▲" : "▼"} {Math.abs(thisYearRate).toFixed(2)}%
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2 border-t border-blue-100 dark:border-blue-800/50 pt-3 text-xs">
            <div>
              <div className="text-neutral-400 mb-0.5">매도수익</div>
              <div className={`font-semibold ${thisYearCapital >= 0 ? "text-blue-600 dark:text-blue-400" : "text-red-500"}`}>
                {fmt(Math.round(thisYearCapital))}원
              </div>
            </div>
            <div>
              <div className="text-neutral-400 mb-0.5">배당수익</div>
              <div className="font-semibold text-emerald-600 dark:text-emerald-400">{fmt(Math.round(thisYearDividend))}원</div>
            </div>
            <div>
              <div className="text-neutral-400 mb-0.5">미실현</div>
              <div className={`font-semibold ${totalUnreal >= 0 ? "text-violet-600 dark:text-violet-400" : "text-red-500"}`}>
                {totalUnreal >= 0 ? "+" : ""}{fmt(Math.round(totalUnreal))}원
              </div>
            </div>
          </div>
          {thisYearTax > 0 && (
            <div className="mt-1.5 text-xs text-neutral-400">세금 {fmt(Math.round(thisYearTax))}원 납부</div>
          )}
        </div>

        {/* 전체 누적 수익 */}
        <div className={`rounded-xl border-2 p-5 ${totalProfit >= 0 ? "border-emerald-200 bg-emerald-50/50 dark:border-emerald-800 dark:bg-emerald-900/15" : "border-red-200 bg-red-50/50 dark:border-red-800 dark:bg-red-900/15"}`}>
          <div className="flex items-center justify-between mb-2">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-neutral-500 uppercase tracking-wide">
              <Star size={13} className="text-emerald-400" />
              전체 누적 수익
            </span>
            <span className="text-xs text-neutral-400">2020 ~ {THIS_YEAR}</span>
          </div>
          <div className={`text-3xl font-bold tracking-tight ${totalProfit >= 0 ? "text-emerald-700 dark:text-emerald-300" : "text-red-700 dark:text-red-300"}`}>
            {totalProfit >= 0 ? "+" : ""}{fmt(Math.round(totalProfit))}원
          </div>
          <div className={`mt-1 text-sm font-semibold ${totalProfitRate >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-500"}`}>
            {totalProfitRate >= 0 ? "▲" : "▼"} {Math.abs(totalProfitRate).toFixed(2)}%
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2 border-t border-emerald-100 dark:border-emerald-800/50 pt-3 text-xs">
            <div>
              <div className="text-neutral-400 mb-0.5">실현수익(세후)</div>
              <div className={`font-semibold ${realizedNet >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-500"}`}>
                {realizedNet >= 0 ? "+" : ""}{fmt(Math.round(realizedNet))}원
              </div>
              <div className="text-neutral-400 mt-0.5">{realRate >= 0 ? "+" : ""}{realRate.toFixed(2)}%</div>
            </div>
            <div>
              <div className="text-neutral-400 mb-0.5">미실현 평가익</div>
              <div className={`font-semibold ${totalUnreal >= 0 ? "text-violet-600 dark:text-violet-400" : "text-red-500"}`}>
                {totalUnreal >= 0 ? "+" : ""}{fmt(Math.round(totalUnreal))}원
              </div>
              <div className="text-neutral-400 mt-0.5">{unrealRate >= 0 ? "+" : ""}{unrealRate.toFixed(2)}%</div>
            </div>
            <div>
              <div className="text-neutral-400 mb-0.5">투자원금</div>
              <div className="font-semibold text-neutral-700 dark:text-neutral-300">{fmt(Math.round(totalInvested))}원</div>
            </div>
          </div>
        </div>
      </div>

      {/* ── 예수금 + 총자산 ───────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {/* 예수금 */}
        <div className="col-span-2 sm:col-span-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] p-4">
          <div className="flex items-center gap-1.5 text-xs text-neutral-500"><Banknote size={14} className="text-amber-500" />예수금</div>
          {editingCash ? (
            <div className="mt-2 flex gap-1.5">
              <input
                type="number"
                value={cashInput}
                onChange={(e) => setCashInput(e.target.value)}
                className="w-full rounded border border-[var(--border-subtle)] bg-[var(--background)] px-2 py-1.5 text-sm focus:outline-none"
                placeholder="0"
              />
              <button onClick={saveCash} className="rounded p-1.5 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20"><Check size={14} /></button>
              <button onClick={() => { setEditingCash(false); setCashInput(String(cashBalance)); }} className="rounded p-1.5 text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"><X size={14} /></button>
            </div>
          ) : (
            <div className="mt-1.5 flex items-center gap-2">
              <span className="text-base font-bold text-amber-600 dark:text-amber-400">{fmt(cashBalance)}원</span>
              <button onClick={() => setEditingCash(true)} className="rounded p-1 text-neutral-300 hover:text-neutral-500"><PenLine size={12} /></button>
            </div>
          )}
        </div>
        <SummaryCard icon={<Wallet size={14} className="text-blue-500" />} label="총 자산" value={`${fmt(totalAssets)}원`} sub={`포트폴리오+예수금`} highlight color="text-blue-600 dark:text-blue-400" />
        <SummaryCard
          icon={totalUnreal >= 0 ? <TrendingUp size={14} className="text-emerald-500" /> : <TrendingDown size={14} className="text-red-500" />}
          label="미실현 평가익"
          value={`${totalUnreal >= 0 ? "+" : ""}${fmt(Math.round(totalUnreal))}원`}
          sub={`수익률 ${totalPurch > 0 ? ((totalUnreal / totalPurch) * 100).toFixed(2) : "0.00"}%`}
          color={totalUnreal >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}
        />
        <SummaryCard icon={<Receipt size={14} className="text-neutral-500" />} label="실현 수익 합계" value={`${fmt(allTime?.net ?? 0)}원`} sub={`세후 순이익 (${allTime?.total ? fmt(allTime.total) : 0}원 - 세금)`} />
      </div>

      {/* ── 입력 폼 ──────────────────────────────────── */}
      {showForm && (
        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] overflow-hidden">
          <div className="border-b border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-4 py-3">
            <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">새 수익 내역 입력</h2>
          </div>
          <div className="p-4 space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div>
                <label className="block mb-1 text-xs font-medium text-neutral-500">연도 *</label>
                <select value={form.year} onChange={(e) => setForm({ ...form, year: Number(e.target.value) })}
                  className="w-full rounded-md border border-[var(--border-subtle)] bg-[var(--background)] px-3 py-2 text-sm focus:outline-none">
                  {YEARS.map((y) => <option key={y} value={y}>{y}년</option>)}
                </select>
              </div>
              <div>
                <label className="block mb-1 text-xs font-medium text-neutral-500">종류 *</label>
                <div className="flex gap-1 h-[38px] rounded-md border border-[var(--border-subtle)] p-1">
                  {(["CAPITAL", "DIVIDEND"] as const).map((t) => (
                    <button key={t} onClick={() => setForm({ ...form, gain_type: t })}
                      className={`flex-1 rounded text-xs font-medium transition-colors ${form.gain_type === t ? (t === "CAPITAL" ? "bg-blue-600 text-white" : "bg-emerald-600 text-white") : "text-neutral-500 hover:text-neutral-700"}`}>
                      {t === "CAPITAL" ? "매도" : "배당"}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block mb-1 text-xs font-medium text-neutral-500">금액 (원) * <span className="font-normal text-neutral-400">오입력 정정 시 음수 입력</span></label>
                <input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })}
                  placeholder="3500000 (정정: -3500000)" className="w-full rounded-md border border-[var(--border-subtle)] bg-[var(--background)] px-3 py-2 text-sm focus:outline-none" />
              </div>
              <div>
                <label className="block mb-1 text-xs font-medium text-neutral-500">세금 (원)</label>
                <input type="number" value={form.tax_amount} onChange={(e) => setForm({ ...form, tax_amount: e.target.value })}
                  placeholder="0" className="w-full rounded-md border border-[var(--border-subtle)] bg-[var(--background)] px-3 py-2 text-sm focus:outline-none" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div>
                <label className="block mb-1 text-xs font-medium text-neutral-500">종목명</label>
                <input type="text" value={form.stock_name} onChange={(e) => setForm({ ...form, stock_name: e.target.value })}
                  placeholder="삼성전자" className="w-full rounded-md border border-[var(--border-subtle)] bg-[var(--background)] px-3 py-2 text-sm focus:outline-none" />
              </div>
              <div>
                <label className="block mb-1 text-xs font-medium text-neutral-500">날짜</label>
                <input type="date" value={form.trade_date} onChange={(e) => setForm({ ...form, trade_date: e.target.value })}
                  className="w-full rounded-md border border-[var(--border-subtle)] bg-[var(--background)] px-3 py-2 text-sm focus:outline-none" />
              </div>
              <div className="sm:col-span-2">
                <label className="block mb-1 text-xs font-medium text-neutral-500">메모</label>
                <input type="text" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })}
                  placeholder="메모 (선택)" className="w-full rounded-md border border-[var(--border-subtle)] bg-[var(--background)] px-3 py-2 text-sm focus:outline-none" />
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={handleSubmit} disabled={submitting || !isValidGainAmount(form.amount)}
                className="flex items-center gap-2 rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900">
                <Plus size={14} />{submitting ? "저장 중..." : "저장"}
              </button>
              <button onClick={() => setShowForm(false)}
                className="rounded-md border border-[var(--border-subtle)] px-4 py-2 text-sm text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800">
                취소
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 연도별 차트 ───────────────────────────────── */}
      {combinedChartData.length > 0 && (
        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] p-4">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
            <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">연도별 수익 현황</h2>
            <span className="text-xs text-neutral-400">{THIS_YEAR}년 막대는 미실현 평가익 포함</span>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={combinedChartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
              <XAxis dataKey="year" tick={{ fontSize: 12, fill: "var(--foreground)" }} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "var(--foreground)" }} tickFormatter={(v) => `${(v/10000).toFixed(0)}만`} tickLine={false} axisLine={false} width={52} />
              <Tooltip formatter={(v, n) => [`${Number(v).toLocaleString()}원`, n]}
                contentStyle={{ background: "var(--surface)", border: "1px solid var(--border-subtle)", borderRadius: "8px", fontSize: "12px" }} />
              <Legend wrapperStyle={{ fontSize: "12px" }} />
              <ReferenceLine y={0} stroke="var(--border-subtle)" />
              <Bar dataKey="매도수익"    fill="#3b82f6" radius={[3,3,0,0]} />
              <Bar dataKey="배당수익"    fill="#10b981" radius={[3,3,0,0]} />
              <Bar dataKey="미실현평가익" fill="#a78bfa" radius={[3,3,0,0]} />
              <Bar dataKey="세금"        fill="#f87171" radius={[3,3,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ── 연도별 요약 테이블 ────────────────────────── */}
      {summary && summary.yearly.length > 0 && (
        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] overflow-hidden">
          <div className="border-b border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-4 py-3">
            <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">연도별 요약</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border-subtle)] text-xs text-neutral-500">
                  <th className="px-4 py-2.5 text-left font-medium">연도</th>
                  <th className="px-4 py-2.5 text-right font-medium text-blue-500">매도수익</th>
                  <th className="px-4 py-2.5 text-right font-medium text-emerald-500">배당수익</th>
                  <th className="px-4 py-2.5 text-right font-medium">합계</th>
                  <th className="px-4 py-2.5 text-right font-medium text-red-400">세금</th>
                  <th className="px-4 py-2.5 text-right font-medium">세후 순이익</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)]">
                {[...summary.yearly].sort((a, b) => b.year - a.year).map((row) => (
                  <tr key={row.year} className={`hover:bg-[var(--surface-elevated)] transition-colors ${row.year === THIS_YEAR ? "bg-blue-50/30 dark:bg-blue-900/10" : ""}`}>
                    <td className="px-4 py-3 font-semibold text-neutral-800 dark:text-neutral-200">
                      {row.year}년
                      {row.year === THIS_YEAR && <span className="ml-1.5 rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] text-blue-600 dark:bg-blue-900/40 dark:text-blue-400">진행중</span>}
                    </td>
                    <td className="px-4 py-3 text-right text-blue-600 dark:text-blue-400">{fmt(row.capital_amount)}원</td>
                    <td className="px-4 py-3 text-right text-emerald-600 dark:text-emerald-400">{fmt(row.dividend_amount)}원</td>
                    <td className="px-4 py-3 text-right font-medium text-neutral-800 dark:text-neutral-200">{fmt(row.total_amount)}원</td>
                    <td className="px-4 py-3 text-right text-red-500">{fmt(row.total_tax)}원</td>
                    <td className="px-4 py-3 text-right font-bold text-neutral-900 dark:text-neutral-100">{fmt(row.total_net)}원</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── 2026 포트폴리오 평가 현황 ─────────────────── */}
      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] overflow-hidden">
        <div className="border-b border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-4 py-3">
          <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">
            {THIS_YEAR}년 포트폴리오 평가 현황
            <span className="ml-2 text-xs font-normal text-neutral-400">종목별 평가손익 · 비중</span>
          </h2>
        </div>
        {stocks.length === 0 ? (
          <div className="py-10 text-center text-sm text-neutral-400">종목 데이터 없음</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border-subtle)] text-xs text-neutral-500">
                  <th className="px-4 py-2.5 text-left font-medium">종목</th>
                  <th className="px-4 py-2.5 text-right font-medium">수량</th>
                  <th className="px-4 py-2.5 text-right font-medium">평균단가</th>
                  <th className="px-4 py-2.5 text-right font-medium">현재가</th>
                  <th className="px-4 py-2.5 text-right font-medium">평가금액</th>
                  <th className="px-4 py-2.5 text-right font-medium">평가손익</th>
                  <th className="px-4 py-2.5 text-right font-medium">수익률</th>
                  <th className="px-4 py-2.5 text-right font-medium">비중</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)]">
                {stocks
                  .sort((a, b) => b.profit_rate - a.profit_rate)
                  .map((s) => {
                    const evalAmt  = s.current_value ?? s.current_price * s.qty;
                    const purchAmt = s.avg_price * s.qty;
                    const pnl      = evalAmt - purchAmt;
                    const weight   = totalAssets > 0 ? (evalAmt / totalAssets) * 100 : 0;
                    return (
                      <tr
                        key={s.symbol}
                        onClick={() => router.push(`/chart?symbol=${s.symbol}`)}
                        className="cursor-pointer hover:bg-[var(--surface-elevated)] transition-colors"
                      >
                        <td className="px-4 py-3">
                          <div className="font-medium text-neutral-900 dark:text-neutral-100">{s.name}</div>
                          <div className="text-xs text-neutral-400">{s.symbol}</div>
                        </td>
                        <td className="px-4 py-3 text-right text-neutral-600 dark:text-neutral-400">{fmt(s.qty)}</td>
                        <td className="px-4 py-3 text-right text-neutral-600 dark:text-neutral-400">{fmt(Math.round(s.avg_price))}원</td>
                        <td className="px-4 py-3 text-right font-medium text-neutral-900 dark:text-neutral-100">{fmt(s.current_price)}원</td>
                        <td className="px-4 py-3 text-right text-neutral-800 dark:text-neutral-200">{fmtW(evalAmt)}</td>
                        <td className={`px-4 py-3 text-right font-medium ${pnl >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                          {pnl >= 0 ? "+" : ""}{fmtW(pnl)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <RateTag rate={s.profit_rate} />
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <div className="h-1.5 w-16 rounded-full bg-neutral-100 dark:bg-neutral-800 overflow-hidden">
                              <div
                                className="h-full rounded-full bg-blue-400 dark:bg-blue-500"
                                style={{ width: `${Math.min(weight * 3, 100)}%` }}
                              />
                            </div>
                            <span className="text-xs text-neutral-500 w-10 text-right">{weight.toFixed(1)}%</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
              {/* 합계 행 */}
              <tfoot>
                <tr className="border-t-2 border-[var(--border-subtle)] bg-[var(--surface-elevated)] font-semibold">
                  <td className="px-4 py-3 text-neutral-700 dark:text-neutral-300" colSpan={4}>합계</td>
                  <td className="px-4 py-3 text-right text-neutral-900 dark:text-neutral-100">{fmtW(totalEval)}</td>
                  <td className={`px-4 py-3 text-right ${totalUnreal >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                    {totalUnreal >= 0 ? "+" : ""}{fmtW(totalUnreal)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <RateTag rate={totalPurch > 0 ? (totalUnreal / totalPurch) * 100 : 0} />
                  </td>
                  <td className="px-4 py-3 text-right text-xs text-neutral-500">100%</td>
                </tr>
                {cashBalance > 0 && (
                  <tr className="border-t border-[var(--border-subtle)] bg-amber-50/40 dark:bg-amber-900/10">
                    <td className="px-4 py-3 text-neutral-600 dark:text-neutral-400 flex items-center gap-1.5" colSpan={4}>
                      <Banknote size={13} className="text-amber-500" /> 예수금
                    </td>
                    <td className="px-4 py-3 text-right text-amber-600 dark:text-amber-400 font-semibold">{fmt(cashBalance)}원</td>
                    <td colSpan={3} />
                    <td className="px-4 py-3 text-right text-xs text-neutral-500">{((cashBalance / totalAssets) * 100).toFixed(1)}%</td>
                    <td />
                  </tr>
                )}
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* ── 상세 내역 ──────────────────────────────────── */}
      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-4 py-3">
          <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">
            실현수익 상세 내역 <span className="text-xs font-normal text-neutral-400">({gains.length}건)</span>
          </h2>
          <div className="flex gap-2">
            <select value={filterYear} onChange={(e) => setFilterYear(e.target.value === "ALL" ? "ALL" : Number(e.target.value))}
              className="rounded-md border border-[var(--border-subtle)] bg-[var(--background)] px-2 py-1 text-xs focus:outline-none">
              <option value="ALL">전체 연도</option>
              {YEARS.map((y) => <option key={y} value={y}>{y}년</option>)}
            </select>
            <div className="flex gap-0.5 rounded-md border border-[var(--border-subtle)] p-0.5">
              {(["ALL", "CAPITAL", "DIVIDEND"] as const).map((t) => (
                <button key={t} onClick={() => setFilterType(t)}
                  className={`rounded px-2 py-1 text-xs font-medium transition-colors ${filterType === t ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900" : "text-neutral-500"}`}>
                  {t === "ALL" ? "전체" : t === "CAPITAL" ? "매도" : "배당"}
                </button>
              ))}
            </div>
          </div>
        </div>

        {gains.length === 0 ? (
          <div className="py-14 text-center">
            <p className="text-sm text-neutral-400">내역이 없습니다.</p>
            <button onClick={() => setShowForm(true)} className="mt-2 text-sm text-blue-500 hover:underline">+ 수익 추가하기</button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border-subtle)] text-xs text-neutral-500">
                  <th className="px-4 py-2.5 text-left font-medium">연도</th>
                  <th className="px-4 py-2.5 text-left font-medium">종류</th>
                  <th className="px-4 py-2.5 text-left font-medium">종목</th>
                  <th className="px-4 py-2.5 text-right font-medium">금액</th>
                  <th className="px-4 py-2.5 text-right font-medium">세금</th>
                  <th className="px-4 py-2.5 text-right font-medium">순이익</th>
                  <th className="px-4 py-2.5 text-left font-medium">날짜</th>
                  <th className="px-4 py-2.5 text-left font-medium">메모</th>
                  <th className="px-4 py-2.5 text-center font-medium">관리</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)]">
                {gains.map((g) => (
                  <tr key={g.id} className="hover:bg-[var(--surface-elevated)] transition-colors">
                    <td className="px-4 py-3 font-medium text-neutral-700 dark:text-neutral-300">{g.year}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${g.gain_type === "CAPITAL" ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"}`}>
                        {g.gain_type === "CAPITAL" ? <TrendingUp size={10} /> : <Gift size={10} />}
                        {g.gain_type === "CAPITAL" ? "매도" : "배당"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-neutral-700 dark:text-neutral-300">
                      {editingId === g.id ? (
                        <input value={editForm.stock_name ?? ""} onChange={(e) => setEditForm({ ...editForm, stock_name: e.target.value })}
                          className="w-24 rounded border border-[var(--border-subtle)] bg-[var(--background)] px-2 py-1 text-xs" />
                      ) : g.stock_name || <span className="text-neutral-300">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {editingId === g.id ? (
                        <input type="number" value={editForm.amount ?? ""} onChange={(e) => setEditForm({ ...editForm, amount: Number(e.target.value) })}
                          className="w-28 rounded border border-[var(--border-subtle)] bg-[var(--background)] px-2 py-1 text-xs text-right" />
                      ) : (
                        <span className={g.gain_type === "CAPITAL" ? "text-blue-600 dark:text-blue-400" : "text-emerald-600 dark:text-emerald-400"}>
                          {fmt(g.amount)}원
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-red-500">
                      {editingId === g.id ? (
                        <input type="number" value={editForm.tax_amount ?? ""} onChange={(e) => setEditForm({ ...editForm, tax_amount: Number(e.target.value) })}
                          className="w-24 rounded border border-[var(--border-subtle)] bg-[var(--background)] px-2 py-1 text-xs text-right" />
                      ) : `${fmt(g.tax_amount)}원`}
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-neutral-900 dark:text-neutral-100">{fmt(g.net_amount)}원</td>
                    <td className="px-4 py-3 text-xs text-neutral-500">
                      {editingId === g.id ? (
                        <input type="date" value={editForm.trade_date ?? ""} onChange={(e) => setEditForm({ ...editForm, trade_date: e.target.value })}
                          className="rounded border border-[var(--border-subtle)] bg-[var(--background)] px-2 py-1 text-xs" />
                      ) : g.trade_date || "—"}
                    </td>
                    <td className="px-4 py-3 text-xs text-neutral-500 max-w-[140px]">
                      {editingId === g.id ? (
                        <input value={editForm.note ?? ""} onChange={(e) => setEditForm({ ...editForm, note: e.target.value })}
                          className="w-full rounded border border-[var(--border-subtle)] bg-[var(--background)] px-2 py-1 text-xs" />
                      ) : <span className="line-clamp-1">{g.note || "—"}</span>}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {editingId === g.id ? (
                        <div className="flex justify-center gap-1">
                          <button onClick={() => handleEditSave(g.id)} className="rounded p-1 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20"><Check size={14} /></button>
                          <button onClick={() => setEditingId(null)} className="rounded p-1 text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"><X size={14} /></button>
                        </div>
                      ) : (
                        <div className="flex justify-center gap-1">
                          <button onClick={() => { setEditingId(g.id); setEditForm({ amount: g.amount, tax_amount: g.tax_amount, stock_name: g.stock_name ?? "", trade_date: g.trade_date ?? "", note: g.note ?? "" }); }}
                            className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800"><PenLine size={13} /></button>
                          <button onClick={() => handleDelete(g.id)}
                            className="rounded p-1 text-neutral-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20"><Trash2 size={13} /></button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
