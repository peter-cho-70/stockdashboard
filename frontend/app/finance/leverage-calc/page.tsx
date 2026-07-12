'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import { useFinanceStore } from '@/lib/finance/store/finance-store';
import { api, type AllTradeItem, type StockItem } from '@/lib/api';
import {
  Plus, Trash2, TrendingUp, Calculator, Info, ChevronDown,
  AlertTriangle, BarChart3, RefreshCw, CheckSquare, Square, Percent,
} from 'lucide-react';

// ── Shared ────────────────────────────────────────────────────────────────────
type Mode = 'trades' | 'manual';
const DAYS_PER_MONTH = 30.4368;

const fmt = (v: number) =>
  new Intl.NumberFormat('ko-KR', { style: 'currency', currency: 'KRW', maximumFractionDigits: 0 }).format(v);

const fmtPct = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(2)}%`;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function monthsBetween(dateStr: string, toDate = today()): number {
  if (!dateStr) return 0;
  const start = new Date(dateStr);
  const end = new Date(toDate);
  const days = Math.max(0, (end.getTime() - start.getTime()) / 86400000);
  return days / DAYS_PER_MONTH;
}

function ProfitBadge({ value, className = '' }: { value: number; className?: string }) {
  const cls = value > 0 ? 'text-rose-500' : value < 0 ? 'text-blue-500' : 'text-gray-400';
  return (
    <span className={`${cls} ${className} tabular-nums`}>
      {value > 0 ? '+' : ''}
      {fmt(value)}
    </span>
  );
}

// ── Settings Panel ────────────────────────────────────────────────────────────
function SettingsPanel({
  annualRate,
  opportunityCostRate,
  setOpportunityCostRate,
  taxRate,
  setTaxRate,
  feeRate,
  setFeeRate,
  selectedId,
  setSelectedId,
  lenderLabel,
}: {
  annualRate: number;
  opportunityCostRate: number;
  setOpportunityCostRate: (v: number) => void;
  taxRate: number;
  setTaxRate: (v: number) => void;
  feeRate: number;
  setFeeRate: (v: number) => void;
  selectedId: string;
  setSelectedId: (v: string) => void;
  lenderLabel: string;
}) {
  const { liabilities } = useFinanceStore();
  const selected = liabilities.find((l) => l.id === selectedId);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      {/* Liability */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm space-y-3">
        <div className="flex items-center gap-2">
          <div className="p-1.5 bg-rose-50 border border-rose-200 rounded-lg">
            <TrendingUp className="text-rose-500" size={15} />
          </div>
          <h3 className="text-sm font-semibold text-gray-900">사용 부채 (레버리지 원천)</h3>
        </div>
        {liabilities.length === 0 ? (
          <p className="text-xs text-gray-400">부채 관리 페이지에서 먼저 대출을 등록하세요.</p>
        ) : (
          <div className="relative">
            <select
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
              className="w-full appearance-none bg-gray-50 border border-gray-200 px-3 py-2.5 rounded-lg text-sm text-gray-900 outline-none focus:border-emerald-400 pr-8"
            >
              <option value="">부채를 선택하세요</option>
              {liabilities.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name} — {l.interestRate}% ({fmt(l.principal)})
                </option>
              ))}
            </select>
            <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          </div>
        )}
        {selected && (
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-gray-50 rounded-lg px-3 py-2">
              <p className="text-[10px] text-gray-400">금융기관</p>
              <p className="text-xs font-medium text-gray-700 mt-0.5">{selected.lender}</p>
            </div>
            <div className="bg-rose-50 rounded-lg px-3 py-2">
              <p className="text-[10px] text-gray-400">연 금리</p>
              <p className="text-xs font-bold text-rose-600 mt-0.5">{selected.interestRate}%</p>
            </div>
            <div className="bg-gray-50 rounded-lg px-3 py-2">
              <p className="text-[10px] text-gray-400">대출 잔액</p>
              <p className="text-xs font-medium text-gray-700 mt-0.5">{fmt(selected.principal)}</p>
            </div>
          </div>
        )}
      </div>

      {/* Opportunity cost */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm space-y-3">
        <div className="flex items-center gap-2">
          <div className="p-1.5 bg-amber-50 border border-amber-200 rounded-lg">
            <Calculator className="text-amber-500" size={15} />
          </div>
          <h3 className="text-sm font-semibold text-gray-900">기회비용 기준금리</h3>
        </div>
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <input
              type="range" min={0} max={10} step={0.1}
              value={opportunityCostRate}
              onChange={(e) => setOpportunityCostRate(Number(e.target.value))}
              className="flex-1 accent-amber-500"
            />
            <div className="flex items-center gap-1 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5 min-w-[72px]">
              <input
                type="number" step={0.1} min={0} max={30}
                value={opportunityCostRate}
                onChange={(e) => setOpportunityCostRate(Number(e.target.value) || 0)}
                className="w-12 bg-transparent text-sm font-bold text-amber-600 text-right outline-none"
              />
              <span className="text-xs text-amber-600 font-bold">%</span>
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            {[{ label: 'CMA (2.5%)', value: 2.5 }, { label: '예금 (3.5%)', value: 3.5 }, { label: '국채 (4.5%)', value: 4.5 }].map((p) => (
              <button
                key={p.value}
                onClick={() => setOpportunityCostRate(p.value)}
                className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors ${
                  opportunityCostRate === p.value
                    ? 'bg-amber-500 text-white border-amber-500'
                    : 'bg-white text-gray-500 border-gray-200 hover:border-amber-300'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-gray-400 flex items-start gap-1">
            <Info size={11} className="mt-0.5 shrink-0" />
            대출 원금을 안전 자산에 굴렸을 때 기대 수익률. {lenderLabel && `대출금리(${annualRate}%)보다 `}이 기준금리를 초과해야 레버리지 프리미엄이 있습니다. (대출 원금 기준으로 한 번만 계산됩니다)
          </p>
        </div>
      </div>

      {/* Trading cost: tax + fee */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm space-y-3">
        <div className="flex items-center gap-2">
          <div className="p-1.5 bg-sky-50 border border-sky-200 rounded-lg">
            <Percent className="text-sky-500" size={15} />
          </div>
          <h3 className="text-sm font-semibold text-gray-900">매매 비용 (종목별 적용)</h3>
        </div>
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <p className="text-[10px] text-gray-500">매도 세금 (%)</p>
              <div className="flex items-center gap-1 bg-sky-50 border border-sky-200 rounded-lg px-3 py-1.5">
                <input
                  type="number" step={0.01} min={0} max={50}
                  value={taxRate}
                  onChange={(e) => setTaxRate(Number(e.target.value) || 0)}
                  className="w-full bg-transparent text-sm font-bold text-sky-600 text-right outline-none"
                />
                <span className="text-xs text-sky-600 font-bold">%</span>
              </div>
            </div>
            <div className="space-y-1">
              <p className="text-[10px] text-gray-500">매매 수수료 (%, 편도)</p>
              <div className="flex items-center gap-1 bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5">
                <input
                  type="number" step={0.005} min={0} max={5}
                  value={feeRate}
                  onChange={(e) => setFeeRate(Number(e.target.value) || 0)}
                  className="w-full bg-transparent text-sm font-bold text-gray-700 text-right outline-none"
                />
                <span className="text-xs text-gray-500 font-bold">%</span>
              </div>
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            {[{ label: '국내 매매세 0.15%', value: 0.15 }, { label: '해외 양도세 22%', value: 22 }, { label: '면제 0%', value: 0 }].map((p) => (
              <button
                key={p.value}
                onClick={() => setTaxRate(p.value)}
                className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors ${
                  taxRate === p.value
                    ? 'bg-sky-500 text-white border-sky-500'
                    : 'bg-white text-gray-500 border-gray-200 hover:border-sky-300'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-gray-400 flex items-start gap-1">
            <Info size={11} className="mt-0.5 shrink-0" />
            매수·매도 금액에 각각 적용되어 종목 손익에서 차감됩니다(세금은 매도 시에만). 이자·기회비용과 달리 종목별 매수·매도 금액에 비례합니다.
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Summary Panel ─────────────────────────────────────────────────────────────
// 이자비용·기회비용은 대출 원금 기준으로 딱 한 번만 계산합니다(종목별 계산이 아님).
function SummaryPanel({
  totalInvestment, totalRealizedPnl, totalGross, totalSellTax, totalFee, grossPct,
  principal, annualRate, opportunityCostRate, loanMonths, loanInterest, loanOp,
  totalNet, totalPremium, netReturnPct, premiumReturnPct,
}: {
  totalInvestment: number; totalRealizedPnl: number; totalGross: number; totalSellTax: number; totalFee: number; grossPct: number;
  principal: number; annualRate: number; opportunityCostRate: number; loanMonths: number;
  loanInterest: number; loanOp: number; totalNet: number; totalPremium: number;
  netReturnPct: number; premiumReturnPct: number;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 space-y-4">
      <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
        <div className="p-1 bg-emerald-50 border border-emerald-200 rounded">
          <Calculator size={13} className="text-emerald-500" />
        </div>
        종합 손익 분석
        {principal > 0 && (
          <span className="text-[11px] font-normal text-gray-400">대출원금 {fmt(principal)} · {loanMonths.toFixed(1)}개월 경과</span>
        )}
      </h3>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="bg-gray-50 rounded-lg px-4 py-3">
          <p className="text-[11px] text-gray-500">총 투자금액</p>
          <p className="text-sm font-semibold text-gray-800 mt-0.5 tabular-nums">{fmt(totalInvestment)}</p>
        </div>
        <div className="bg-gray-50 rounded-lg px-4 py-3">
          <p className="text-[11px] text-gray-500">주식 손익 (세금·수수료 차감)</p>
          <p className="text-sm font-semibold mt-0.5"><ProfitBadge value={totalGross} /></p>
          <p className={`text-[10px] mt-0.5 ${grossPct > 0 ? 'text-rose-400' : grossPct < 0 ? 'text-blue-400' : 'text-gray-400'}`}>{fmtPct(grossPct)} / 투자금</p>
        </div>
        <div className="bg-amber-50 rounded-lg px-4 py-3">
          <p className="text-[11px] text-amber-600">대출 이자비용</p>
          <p className="text-sm font-semibold text-amber-700 mt-0.5 tabular-nums">-{fmt(loanInterest)}</p>
          {annualRate > 0 && <p className="text-[10px] text-amber-500 mt-0.5">대출원금 × 연{annualRate}%</p>}
        </div>
        <div className="bg-violet-50 rounded-lg px-4 py-3">
          <p className="text-[11px] text-violet-600">대출 기회비용</p>
          <p className="text-sm font-semibold text-violet-700 mt-0.5 tabular-nums">-{fmt(loanOp)}</p>
          <p className="text-[10px] text-violet-500 mt-0.5">대출원금 × 연{opportunityCostRate}%</p>
        </div>
        <div className={`rounded-lg px-4 py-3 border ${totalNet >= 0 ? 'bg-rose-50 border-rose-200' : 'bg-blue-50 border-blue-200'}`}>
          <p className="text-[11px] text-gray-500">레버리지 순수익</p>
          <p className="text-sm font-bold mt-0.5"><ProfitBadge value={totalNet} /></p>
          <p className={`text-[10px] mt-0.5 ${netReturnPct > 0 ? 'text-rose-400' : netReturnPct < 0 ? 'text-blue-400' : 'text-gray-400'}`}>{fmtPct(netReturnPct)} / 원금</p>
        </div>
        <div className={`rounded-lg px-4 py-3 border-2 ${totalPremium >= 0 ? 'bg-emerald-50 border-emerald-300' : 'bg-gray-50 border-gray-300'}`}>
          <p className="text-[11px] text-gray-500">기회비용 대비 프리미엄</p>
          <p className="text-sm font-bold mt-0.5"><ProfitBadge value={totalPremium} /></p>
          <p className={`text-[10px] mt-0.5 ${premiumReturnPct > 0 ? 'text-rose-400' : premiumReturnPct < 0 ? 'text-blue-400' : 'text-gray-400'}`}>{fmtPct(premiumReturnPct)} / 원금</p>
        </div>
      </div>
      {(totalRealizedPnl !== 0 || totalSellTax > 0 || totalFee > 0) && (
        <p className="text-[11px] text-gray-400 space-x-3">
          {totalRealizedPnl !== 0 && (
            <span>* 실현손익 <ProfitBadge value={totalRealizedPnl} className="text-[11px]" /> 포함</span>
          )}
          {totalSellTax > 0 && <span>* 매도세금 -{fmt(totalSellTax)} 차감됨</span>}
          {totalFee > 0 && <span>* 매매수수료 -{fmt(totalFee)} 차감됨</span>}
        </p>
      )}
      <div className={`flex items-start gap-2 rounded-lg px-4 py-3 text-xs ${
        totalPremium > 0 ? 'bg-emerald-50 border border-emerald-200 text-emerald-700'
        : totalNet > 0 ? 'bg-amber-50 border border-amber-200 text-amber-700'
        : 'bg-rose-50 border border-rose-200 text-rose-700'}`}>
        <AlertTriangle size={13} className="mt-0.5 shrink-0" />
        <p>
          {totalPremium > 0
            ? `레버리지 투자가 대출 이자비용(${fmt(loanInterest)})과 기회비용(${fmt(loanOp)})을 모두 상회합니다. 레버리지 전략이 유효합니다.`
            : totalNet > 0
            ? `주식 손익이 대출 이자비용은 초과하지만, 안전 자산(${opportunityCostRate}%) 대비 ${fmt(Math.abs(totalPremium))} 더 적습니다.`
            : `대출 이자비용(${fmt(loanInterest)})을 제하면 순손실입니다. 추가 주가 상승이 필요합니다.`}
        </p>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// TRADES MODE
// ══════════════════════════════════════════════════════════════════════════════

interface TradeRow {
  symbol: string;
  name: string;
  buyQty: number;
  buyAmount: number;
  avgPrice: number;
  firstBuyDate: string;
  realizedPnl: number;
  // editable:
  heldQty: number;
  currentPrice: number;
  selected: boolean;
}

// 종목 손익은 평단가·현재가·세금·수수료만으로 계산합니다.
// 이자비용·기회비용은 종목과 무관하게 대출 원금 기준으로 요약(summary)에서 한 번만 계산합니다.
function computeTradesRow(
  row: TradeRow,
  taxRate: number,
  feeRate: number,
) {
  const investment = row.buyAmount;
  const buyFee = investment > 0 ? investment * (feeRate / 100) : 0;
  const sellProceeds = row.currentPrice * row.heldQty;
  const sellFee = sellProceeds > 0 ? sellProceeds * (feeRate / 100) : 0;
  const sellTax = sellProceeds > 0 ? sellProceeds * (taxRate / 100) : 0;
  const totalFee = buyFee + sellFee;
  const unrealized = (row.currentPrice - row.avgPrice) * row.heldQty - sellTax - totalFee;
  const grossProfit = unrealized + row.realizedPnl;
  const grossPct = investment > 0 ? (grossProfit / investment) * 100 : 0;
  return { ...row, investment, sellTax, buyFee, sellFee, totalFee, unrealized, grossProfit, grossPct };
}

function TradesMode({
  annualRate,
  opportunityCostRate,
  taxRate,
  feeRate,
  principal,
  defaultStart,
}: {
  annualRate: number;
  opportunityCostRate: number;
  taxRate: number;
  feeRate: number;
  principal: number;
  defaultStart: string;
}) {
  const [startDate, setStartDate] = useState(defaultStart || '');
  const [endDate, setEndDate] = useState(today());
  const [rows, setRows] = useState<TradeRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  // Sync defaultStart when liability changes
  useEffect(() => {
    setStartDate(defaultStart || '');
    setRows([]);
    setLoaded(false);
  }, [defaultStart]);

  const load = useCallback(async () => {
    if (!startDate) { setError('시작일을 입력하세요.'); return; }
    setLoading(true);
    setError(null);
    try {
      const [tradesRes, stocksRes] = await Promise.all([
        api.getAllTrades({ start: startDate, end: endDate, limit: 2000 }),
        api.getStocks(),
      ]);

      const allTrades: AllTradeItem[] = tradesRes.trades;
      const portfolio: StockItem[] = stocksRes;
      const portfolioMap = new Map(portfolio.map((s) => [s.symbol, s]));

      // Aggregate buys by symbol
      const buyMap = new Map<string, { name: string; qty: number; amount: number; firstDate: string }>();
      for (const t of allTrades) {
        if (t.side !== 'BUY') continue;
        const agg = buyMap.get(t.symbol);
        if (!agg) {
          buyMap.set(t.symbol, { name: t.name, qty: t.qty, amount: t.amount, firstDate: t.traded_at });
        } else {
          agg.qty += t.qty;
          agg.amount += t.amount;
          if (t.traded_at < agg.firstDate) agg.firstDate = t.traded_at;
        }
      }

      // Aggregate sells (realized P&L) by symbol
      const sellPnlMap = new Map<string, number>();
      for (const t of allTrades) {
        if (t.side !== 'SELL' || t.realized_pnl == null) continue;
        sellPnlMap.set(t.symbol, (sellPnlMap.get(t.symbol) ?? 0) + t.realized_pnl);
      }

      const newRows: TradeRow[] = [];
      for (const [symbol, agg] of buyMap) {
        const stock = portfolioMap.get(symbol);
        newRows.push({
          symbol,
          name: agg.name,
          buyQty: agg.qty,
          buyAmount: agg.amount,
          avgPrice: agg.qty > 0 ? agg.amount / agg.qty : 0,
          firstBuyDate: agg.firstDate,
          realizedPnl: sellPnlMap.get(symbol) ?? 0,
          heldQty: agg.qty,
          currentPrice: stock?.current_price ?? 0,
          selected: true,
        });
      }
      newRows.sort((a, b) => b.buyAmount - a.buyAmount);
      setRows(newRows);
      setLoaded(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : '체결내역을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate]);

  const updateRow = <K extends keyof TradeRow>(symbol: string, field: K, value: TradeRow[K]) =>
    setRows((prev) => prev.map((r) => (r.symbol === symbol ? { ...r, [field]: value } : r)));

  const toggleAll = () => {
    const allSelected = rows.every((r) => r.selected);
    setRows((prev) => prev.map((r) => ({ ...r, selected: !allSelected })));
  };

  const computed = useMemo(
    () => rows.map((r) => computeTradesRow(r, taxRate, feeRate)),
    [rows, taxRate, feeRate],
  );

  const selected = computed.filter((r) => r.selected);

  const summary = useMemo(() => {
    const totalInvestment = selected.reduce((a, r) => a + r.investment, 0);
    const totalRealizedPnl = selected.reduce((a, r) => a + r.realizedPnl, 0);
    const totalGross = selected.reduce((a, r) => a + r.grossProfit, 0);
    const totalSellTax = selected.reduce((a, r) => a + r.sellTax, 0);
    const totalFee = selected.reduce((a, r) => a + r.totalFee, 0);
    const grossPct = totalInvestment > 0 ? (totalGross / totalInvestment) * 100 : 0;

    // 이자·기회비용: 대출 원금 × 금리 × 대출 실행일부터 경과한 기간 (종목별 계산 아님)
    const loanMonths = monthsBetween(defaultStart);
    const loanInterest = principal > 0 ? principal * (annualRate / 100) * (loanMonths / 12) : 0;
    const loanOp = principal > 0 ? principal * (opportunityCostRate / 100) * (loanMonths / 12) : 0;
    const totalNet = totalGross - loanInterest;
    const totalPremium = totalGross - loanInterest - loanOp;
    const netReturnPct = principal > 0 ? (totalNet / principal) * 100 : 0;
    const premiumReturnPct = principal > 0 ? (totalPremium / principal) * 100 : 0;

    return {
      totalInvestment, totalRealizedPnl, totalGross, totalSellTax, totalFee, grossPct, principal,
      loanMonths, loanInterest, loanOp, totalNet, totalPremium, netReturnPct, premiumReturnPct,
    };
  }, [selected, principal, annualRate, opportunityCostRate, defaultStart]);

  return (
    <div className="space-y-4">
      {/* Date range + load */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-600">매수 시작일</label>
            <input
              type="date" value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="bg-gray-50 border border-gray-200 px-3 py-2 rounded-lg text-sm outline-none focus:border-emerald-400 focus:bg-white"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-600">종료일</label>
            <input
              type="date" value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="bg-gray-50 border border-gray-200 px-3 py-2 rounded-lg text-sm outline-none focus:border-emerald-400 focus:bg-white"
            />
          </div>
          <button
            onClick={load}
            disabled={loading || !startDate}
            className="flex items-center gap-2 bg-emerald-500 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-emerald-600 disabled:opacity-50 transition-colors"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            {loading ? '불러오는 중...' : '체결내역 불러오기'}
          </button>
          {defaultStart && (
            <p className="text-[11px] text-gray-400 self-end pb-2">
              * 선택한 대출 실행일({defaultStart})을 시작일로 자동 설정했습니다.
            </p>
          )}
        </div>
        {error && <p className="mt-2 text-xs text-rose-500">{error}</p>}
      </div>

      {loaded && rows.length === 0 && (
        <p className="text-sm text-gray-400 text-center py-8">해당 기간에 체결내역이 없습니다.</p>
      )}

      {rows.length > 0 && (
        <>
          {/* Table */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <BarChart3 className="text-emerald-500" size={15} />
                <span className="text-sm font-semibold text-gray-900">
                  종목별 집계
                  <span className="ml-2 text-xs font-normal text-gray-400">
                    {selected.length}/{rows.length}종목 선택
                  </span>
                </span>
              </div>
              <p className="text-[11px] text-gray-400">현재가·보유수량은 직접 수정 가능합니다</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-gray-50 text-gray-500 border-b border-gray-100">
                    <th className="px-3 py-2.5 w-8">
                      <button onClick={toggleAll} className="text-gray-400 hover:text-gray-600">
                        {rows.every((r) => r.selected)
                          ? <CheckSquare size={14} className="text-emerald-500" />
                          : <Square size={14} />}
                      </button>
                    </th>
                    <th className="text-left px-3 py-2.5 font-medium">종목</th>
                    <th className="text-right px-3 py-2.5 font-medium">매수금액</th>
                    <th className="text-right px-3 py-2.5 font-medium">평단가</th>
                    <th className="text-right px-3 py-2.5 font-medium min-w-[100px]">
                      현재가 <span className="text-gray-400 font-normal">(수정가능)</span>
                    </th>
                    <th className="text-right px-3 py-2.5 font-medium min-w-[80px]">
                      보유수량 <span className="text-gray-400 font-normal">(수정가능)</span>
                    </th>
                    <th className="text-right px-3 py-2.5 font-medium">최초 매수일</th>
                    <th className="text-right px-3 py-2.5 font-medium">미실현 손익 (세금·수수료 차감)</th>
                    <th className="text-right px-3 py-2.5 font-medium">실현손익</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {computed.map((row) => (
                    <tr key={row.symbol} className={`hover:bg-gray-50/60 group ${!row.selected ? 'opacity-40' : ''}`}>
                      <td className="px-3 py-2 text-center">
                        <button
                          onClick={() => updateRow(row.symbol, 'selected', !row.selected)}
                          className="text-gray-400 hover:text-emerald-500"
                        >
                          {row.selected
                            ? <CheckSquare size={14} className="text-emerald-500" />
                            : <Square size={14} />}
                        </button>
                      </td>
                      <td className="px-3 py-2">
                        <p className="font-medium text-gray-800">{row.name}</p>
                        <p className="text-[10px] text-gray-400">{row.symbol} · {row.buyQty.toLocaleString()}주 매수</p>
                      </td>
                      <td className="px-3 py-2 text-right text-gray-600 tabular-nums">{fmt(row.investment)}</td>
                      <td className="px-3 py-2 text-right text-gray-600 tabular-nums">{fmt(row.avgPrice)}</td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          value={row.currentPrice === 0 ? '' : row.currentPrice}
                          placeholder="현재가 입력"
                          onChange={(e) => updateRow(row.symbol, 'currentPrice', Number(e.target.value) || 0)}
                          className="w-full bg-gray-50 border border-gray-200 px-2 py-1 rounded-md text-xs text-right outline-none focus:border-emerald-400 focus:bg-white tabular-nums"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          value={row.heldQty === 0 ? '' : row.heldQty}
                          placeholder="보유수량"
                          onChange={(e) => updateRow(row.symbol, 'heldQty', Number(e.target.value) || 0)}
                          className="w-full bg-gray-50 border border-gray-200 px-2 py-1 rounded-md text-xs text-right outline-none focus:border-emerald-400 focus:bg-white tabular-nums"
                        />
                      </td>
                      <td className="px-3 py-2 text-right text-gray-500 tabular-nums">{row.firstBuyDate}</td>
                      <td className="px-3 py-2 text-right">
                        {row.heldQty > 0 && row.currentPrice > 0 ? (
                          <div>
                            <ProfitBadge value={row.unrealized} />
                            {row.totalFee + row.sellTax > 0 && (
                              <p className="text-[10px] text-gray-400 mt-0.5">
                                {row.sellTax > 0 && `세금 -${fmt(row.sellTax)}`}
                                {row.sellTax > 0 && row.totalFee > 0 && ' · '}
                                {row.totalFee > 0 && `수수료 -${fmt(row.totalFee)}`}
                              </p>
                            )}
                          </div>
                        ) : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {row.realizedPnl !== 0
                          ? <ProfitBadge value={row.realizedPnl} />
                          : <span className="text-gray-300">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Summary */}
          {summary.totalInvestment > 0 && (
            <SummaryPanel
              {...summary}
              annualRate={annualRate}
              opportunityCostRate={opportunityCostRate}
            />
          )}
        </>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// MANUAL MODE
// ══════════════════════════════════════════════════════════════════════════════

interface ManualEntry {
  id: string;
  name: string;
  avgPrice: number;
  qty: number;
  currentPrice: number;
  purchaseDate: string;
}

function ManualMode({
  annualRate, opportunityCostRate, taxRate, feeRate, principal, loanStartDate,
}: {
  annualRate: number; opportunityCostRate: number; taxRate: number; feeRate: number;
  principal: number; loanStartDate: string;
}) {
  const [entries, setEntries] = useState<ManualEntry[]>([
    { id: crypto.randomUUID(), name: '', avgPrice: 0, qty: 0, currentPrice: 0, purchaseDate: '' },
  ]);

  const add = () => setEntries((p) => [...p, { id: crypto.randomUUID(), name: '', avgPrice: 0, qty: 0, currentPrice: 0, purchaseDate: '' }]);
  const remove = (id: string) => setEntries((p) => p.filter((e) => e.id !== id));
  const update = <K extends keyof Omit<ManualEntry, 'id'>>(id: string, field: K, value: ManualEntry[K]) =>
    setEntries((p) => p.map((e) => (e.id === id ? { ...e, [field]: value } : e)));

  // 종목 손익은 평단가·현재가·세금·수수료만으로 계산 (이자·기회비용은 대출 원금 기준으로 요약에서 계산)
  const rows = useMemo(() =>
    entries.map((e) => {
      const investment = e.avgPrice * e.qty;
      const buyFee = investment > 0 ? investment * (feeRate / 100) : 0;
      const sellProceeds = e.currentPrice * e.qty;
      const sellFee = sellProceeds > 0 ? sellProceeds * (feeRate / 100) : 0;
      const sellTax = sellProceeds > 0 ? sellProceeds * (taxRate / 100) : 0;
      const totalFee = buyFee + sellFee;
      const grossProfit = (e.currentPrice - e.avgPrice) * e.qty - sellTax - totalFee;
      const grossPct = investment > 0 ? (grossProfit / investment) * 100 : 0;
      return { ...e, investment, sellTax, buyFee, sellFee, totalFee, grossProfit, grossPct };
    }),
    [entries, taxRate, feeRate],
  );

  const summary = useMemo(() => {
    const totalInvestment = rows.reduce((a, r) => a + r.investment, 0);
    const totalGross = rows.reduce((a, r) => a + r.grossProfit, 0);
    const totalSellTax = rows.reduce((a, r) => a + r.sellTax, 0);
    const totalFee = rows.reduce((a, r) => a + r.totalFee, 0);
    const grossPct = totalInvestment > 0 ? (totalGross / totalInvestment) * 100 : 0;

    const loanMonths = monthsBetween(loanStartDate);
    const loanInterest = principal > 0 ? principal * (annualRate / 100) * (loanMonths / 12) : 0;
    const loanOp = principal > 0 ? principal * (opportunityCostRate / 100) * (loanMonths / 12) : 0;
    const totalNet = totalGross - loanInterest;
    const totalPremium = totalGross - loanInterest - loanOp;
    const netReturnPct = principal > 0 ? (totalNet / principal) * 100 : 0;
    const premiumReturnPct = principal > 0 ? (totalPremium / principal) * 100 : 0;

    return {
      totalInvestment, totalRealizedPnl: 0, totalGross, totalSellTax, totalFee, grossPct, principal,
      loanMonths, loanInterest, loanOp, totalNet, totalPremium, netReturnPct, premiumReturnPct,
    };
  }, [rows, principal, annualRate, opportunityCostRate, loanStartDate]);

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BarChart3 className="text-emerald-500" size={15} />
            <div>
              <span className="text-sm font-semibold text-gray-900">종목 직접 입력</span>
              <p className="text-xs text-gray-400 mt-0.5">가상 시나리오 또는 체결내역이 없는 해외주식에 사용</p>
            </div>
          </div>
          <button
            onClick={add}
            className="flex items-center gap-1.5 bg-emerald-500 text-white px-3 py-1.5 rounded-md text-xs font-medium hover:bg-emerald-600"
          >
            <Plus size={12} /> 종목 추가
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-50 text-gray-500 border-b border-gray-100">
                <th className="text-left px-4 py-2.5 font-medium min-w-[120px]">종목명</th>
                <th className="text-right px-3 py-2.5 font-medium min-w-[110px]">평단가 (원)</th>
                <th className="text-right px-3 py-2.5 font-medium min-w-[80px]">수량 (주)</th>
                <th className="text-right px-3 py-2.5 font-medium min-w-[110px]">현재가 (원)</th>
                <th className="text-right px-3 py-2.5 font-medium min-w-[130px]">매수일</th>
                <th className="text-right px-3 py-2.5 font-medium min-w-[90px]">투자금액</th>
                <th className="text-right px-3 py-2.5 font-medium min-w-[100px]">주식 손익 (세금·수수료 차감)</th>
                <th className="px-3 py-2.5 w-10"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((row) => (
                <tr key={row.id} className="hover:bg-gray-50/60 group">
                  <td className="px-4 py-2">
                    <input type="text" value={row.name} placeholder="종목명" onChange={(e) => update(row.id, 'name', e.target.value)}
                      className="w-full bg-gray-50 border border-gray-200 px-2 py-1.5 rounded-md text-xs outline-none focus:border-emerald-400 focus:bg-white" />
                  </td>
                  <td className="px-3 py-2">
                    <input type="number" value={row.avgPrice || ''} placeholder="평단가" onChange={(e) => update(row.id, 'avgPrice', Number(e.target.value) || 0)}
                      className="w-full bg-gray-50 border border-gray-200 px-2 py-1.5 rounded-md text-xs text-right outline-none focus:border-emerald-400 focus:bg-white tabular-nums" />
                  </td>
                  <td className="px-3 py-2">
                    <input type="number" value={row.qty || ''} placeholder="수량" onChange={(e) => update(row.id, 'qty', Number(e.target.value) || 0)}
                      className="w-full bg-gray-50 border border-gray-200 px-2 py-1.5 rounded-md text-xs text-right outline-none focus:border-emerald-400 focus:bg-white tabular-nums" />
                  </td>
                  <td className="px-3 py-2">
                    <input type="number" value={row.currentPrice || ''} placeholder="현재가" onChange={(e) => update(row.id, 'currentPrice', Number(e.target.value) || 0)}
                      className="w-full bg-gray-50 border border-gray-200 px-2 py-1.5 rounded-md text-xs text-right outline-none focus:border-emerald-400 focus:bg-white tabular-nums" />
                  </td>
                  <td className="px-3 py-2">
                    <input type="date" value={row.purchaseDate} onChange={(e) => update(row.id, 'purchaseDate', e.target.value)}
                      className="w-full bg-gray-50 border border-gray-200 px-2 py-1.5 rounded-md text-xs outline-none focus:border-emerald-400 focus:bg-white" />
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-600">
                    {row.investment > 0 ? fmt(row.investment) : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {row.investment > 0 ? (
                      <div>
                        <ProfitBadge value={row.grossProfit} />
                        <p className={`text-[10px] mt-0.5 ${row.grossPct > 0 ? 'text-rose-400' : row.grossPct < 0 ? 'text-blue-400' : 'text-gray-400'}`}>{fmtPct(row.grossPct)}</p>
                        {row.sellTax + row.totalFee > 0 && (
                          <p className="text-[10px] text-gray-400 mt-0.5">
                            {row.sellTax > 0 && `세금 -${fmt(row.sellTax)}`}
                            {row.sellTax > 0 && row.totalFee > 0 && ' · '}
                            {row.totalFee > 0 && `수수료 -${fmt(row.totalFee)}`}
                          </p>
                        )}
                      </div>
                    ) : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-3 py-2">
                    {entries.length > 1 && (
                      <button onClick={() => remove(row.id)}
                        className="p-1 text-gray-300 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-colors">
                        <Trash2 size={13} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {summary.totalInvestment > 0 && (
        <SummaryPanel {...summary} annualRate={annualRate} opportunityCostRate={opportunityCostRate} />
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// PAGE
// ══════════════════════════════════════════════════════════════════════════════

export default function LeverageCalcPage() {
  const { liabilities } = useFinanceStore();
  const [mode, setMode] = useState<Mode>('trades');
  const [selectedId, setSelectedId] = useState('');
  const [opportunityCostRate, setOpportunityCostRate] = useState(3.5);
  const [taxRate, setTaxRate] = useState(0.15);
  const [feeRate, setFeeRate] = useState(0.015);

  const selectedLiability = liabilities.find((l) => l.id === selectedId) ?? null;
  const annualRate = selectedLiability?.interestRate ?? 0;
  const principal = selectedLiability?.principal ?? 0;
  const defaultStart = selectedLiability?.startDate ?? '';

  return (
    <div className="space-y-5 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">레버리지 손익 계산기</h1>
          <p className="text-gray-400 text-sm mt-0.5">
            대출을 활용한 주식 투자의 이자·기회비용 대비 실질 수익을 분석합니다
          </p>
        </div>
        {/* Mode toggle */}
        <div className="flex rounded-xl border border-gray-200 bg-white shadow-sm p-1 gap-1">
          <button
            onClick={() => setMode('trades')}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              mode === 'trades'
                ? 'bg-emerald-500 text-white shadow-sm'
                : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
            }`}
          >
            <BarChart3 size={14} />
            체결내역 기반
          </button>
          <button
            onClick={() => setMode('manual')}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              mode === 'manual'
                ? 'bg-gray-800 text-white shadow-sm'
                : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
            }`}
          >
            <Calculator size={14} />
            수동 입력
          </button>
        </div>
      </div>

      {/* Shared settings */}
      <SettingsPanel
        selectedId={selectedId}
        setSelectedId={setSelectedId}
        annualRate={annualRate}
        opportunityCostRate={opportunityCostRate}
        setOpportunityCostRate={setOpportunityCostRate}
        taxRate={taxRate}
        setTaxRate={setTaxRate}
        feeRate={feeRate}
        setFeeRate={setFeeRate}
        lenderLabel={selectedLiability?.name ?? ''}
      />

      {/* Mode content */}
      {mode === 'trades' ? (
        <TradesMode
          annualRate={annualRate}
          opportunityCostRate={opportunityCostRate}
          taxRate={taxRate}
          feeRate={feeRate}
          principal={principal}
          defaultStart={defaultStart}
        />
      ) : (
        <ManualMode
          annualRate={annualRate}
          opportunityCostRate={opportunityCostRate}
          taxRate={taxRate}
          feeRate={feeRate}
          principal={principal}
          loanStartDate={defaultStart}
        />
      )}

      {/* Legend */}
      <div className="bg-gray-50 rounded-xl border border-gray-200 p-4">
        <p className="text-[11px] font-semibold text-gray-500 mb-2">용어 설명</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-1.5 text-[11px] text-gray-500">
          <span><span className="font-medium text-gray-700">이자비용</span> = 대출 원금 × 대출금리 × 대출 실행일부터 경과 기간 (종목과 무관하게 한 번만 계산)</span>
          <span><span className="font-medium text-gray-700">기회비용</span> = 대출 원금 × 기준금리 × 대출 실행일부터 경과 기간 (안전자산 대안수익, 종목과 무관)</span>
          <span><span className="font-medium text-gray-700">종목 손익</span> = (현재가 − 평단가) × 보유수량 − 매도세금 − 매매수수료(매수+매도) + 실현손익</span>
          <span><span className="font-medium text-gray-700">레버리지 순수익</span> = 전체 종목 손익 합계 − 대출 이자비용</span>
          <span><span className="font-medium text-gray-700">기회비용 대비 프리미엄</span> = 전체 종목 손익 합계 − 대출 이자비용 − 대출 기회비용</span>
          <span><span className="font-medium text-gray-700">체결내역 기반</span> = 기간 내 매수 수량·단가를 종목별로 집계, 보유수량은 해당 기간 매수 수량을 기본값으로 사용 (수정 가능)</span>
        </div>
      </div>
    </div>
  );
}
