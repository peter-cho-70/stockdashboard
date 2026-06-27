'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, Legend,
  LineChart, Line,
} from 'recharts';
import { CreditCard, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, Sparkles, Loader2, RefreshCw } from 'lucide-react';
import { useLedgerStore } from '@/lib/finance/store/ledger-store';
import { api } from '@/lib/api';

const BAR_PALETTE = [
  '#6366f1', '#3b82f6', '#10b981', '#f59e0b', '#ec4899',
  '#ef4444', '#14b8a6', '#8b5cf6', '#84cc16', '#f43f5e',
];

function fmtWon(n: number) {
  return n.toLocaleString('ko-KR') + '원';
}

function SectionHeader({
  title, open, onToggle, right,
}: {
  title: React.ReactNode;
  open: boolean;
  onToggle: () => void;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between mb-3">
      <button
        onClick={onToggle}
        className="flex items-center gap-1.5 text-xs font-medium text-gray-700 hover:text-gray-900 transition-colors"
      >
        {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        {title}
      </button>
      {right}
    </div>
  );
}

export function MonthlyCashflowAnalysis() {
  const transactions = useLedgerStore((s) => s.transactions);
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);

  const [opinion, setOpinion] = useState<string | null>(null);
  const [opinionGeneratedAt, setOpinionGeneratedAt] = useState<string | null>(null);
  const [opinionLoading, setOpinionLoading] = useState(false);
  const [opinionError, setOpinionError] = useState<string | null>(null);

  // 월 변경 시 저장된 AI 의견 불러오기
  useEffect(() => {
    setOpinion(null);
    setOpinionGeneratedAt(null);
    setOpinionError(null);
    api.getCashflowOpinion(year, month)
      .then((data) => {
        if (data) {
          setOpinion(data.opinion);
          setOpinionGeneratedAt(data.generated_at ?? null);
        }
      })
      .catch(() => {});
  }, [year, month]);

  const [openCard, setOpenCard] = useState(true);
  const [openAI, setOpenAI] = useState(true);
  const [openDaily, setOpenDaily] = useState(true);
  const [openCumulative, setOpenCumulative] = useState(true);

  function prevMonth() {
    if (month === 1) { setYear((y) => y - 1); setMonth(12); } else setMonth((m) => m - 1);
  }
  function nextMonth() {
    if (month === 12) { setYear((y) => y + 1); setMonth(1); } else setMonth((m) => m + 1);
  }

  const monthTxns = useMemo(() => {
    const prefix = `${year}-${String(month).padStart(2, '0')}`;
    return transactions.filter((t) => t.date.startsWith(prefix));
  }, [transactions, year, month]);

  const cardData = useMemo(() => {
    const totals = new Map<string, number>();
    for (const t of monthTxns) {
      if (t.type !== 'expense') continue;
      const issuer = t.cardIssuer
        || (t.paymentMethod === 'cash' ? '현금' : t.paymentMethod === 'bank_transfer' ? '계좌이체' : '기타');
      totals.set(issuer, (totals.get(issuer) ?? 0) + t.amount);
    }
    return Array.from(totals.entries())
      .map(([issuer, amount]) => ({ issuer, amount }))
      .sort((a, b) => b.amount - a.amount);
  }, [monthTxns]);

  const dailyData = useMemo(() => {
    const map = new Map<number, { income: number; expense: number }>();
    for (const t of monthTxns) {
      const day = parseInt(t.date.slice(8, 10), 10);
      const entry = map.get(day) ?? { income: 0, expense: 0 };
      if (t.type === 'income') entry.income += t.amount;
      else if (t.type === 'expense') entry.expense += t.amount;
      map.set(day, entry);
    }
    return Array.from(map.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([day, { income, expense }]) => ({ day: `${day}일`, income, expense }));
  }, [monthTxns]);

  const cumulativeData = useMemo(() => {
    const daysInMonth = new Date(year, month, 0).getDate();
    const byDay = new Map<number, { income: number; expense: number }>();
    for (const t of monthTxns) {
      const day = parseInt(t.date.slice(8, 10), 10);
      const entry = byDay.get(day) ?? { income: 0, expense: 0 };
      if (t.type === 'income') entry.income += t.amount;
      else if (t.type === 'expense') entry.expense += t.amount;
      byDay.set(day, entry);
    }
    let cumIncome = 0, cumExpense = 0;
    const base: { day: string; income: number; expense: number }[] = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const entry = byDay.get(d);
      if (entry) { cumIncome += entry.income; cumExpense += entry.expense; }
      if (entry || base.length > 0) {
        base.push({ day: `${d}일`, income: cumIncome, expense: cumExpense });
      }
    }
    return base.map((pt, i, arr) => {
      const surplus = pt.income >= pt.expense;
      const prev = i > 0 ? arr[i - 1].income >= arr[i - 1].expense : surplus;
      const isEdge = surplus !== prev;
      return {
        ...pt,
        incomeSurplus: (surplus || isEdge) ? pt.income : null,
        incomeDeficit: (!surplus || isEdge) ? pt.income : null,
      };
    });
  }, [monthTxns, year, month]);

  const cardTotal = cardData.reduce((s, d) => s + d.amount, 0);
  const monthIncome = monthTxns.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const monthExpense = monthTxns.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0);

  async function handleGenerateOpinion() {
    setOpinionLoading(true);
    setOpinionError(null);
    try {
      const result = await api.generateCashflowOpinion(year, month);
      setOpinion(result.opinion);
      setOpinionGeneratedAt(result.generated_at ?? null);
    } catch (err) {
      setOpinionError(err instanceof Error ? err.message : 'AI 의견 생성에 실패했습니다.');
    } finally {
      setOpinionLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* 헤더 — 월 이동 */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-900">가계부 차트</h2>
          <p className="text-gray-400 text-xs mt-0.5">카드·수입·지출 시각화</p>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={prevMonth} className="p-1 rounded hover:bg-gray-100 text-gray-500 transition-colors">
            <ChevronLeft size={14} />
          </button>
          <span className="text-xs font-medium text-gray-700 w-20 text-center">{year}년 {month}월</span>
          <button onClick={nextMonth} className="p-1 rounded hover:bg-gray-100 text-gray-500 transition-colors">
            <ChevronRight size={14} />
          </button>
        </div>
      </div>

      {/* 카드사별 결제 + AI 의견 — 2열 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* 카드사별 결제 */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
          <SectionHeader
            title={<><CreditCard size={12} className="text-indigo-500" /> 카드사별 결제 금액</>}
            open={openCard}
            onToggle={() => setOpenCard((v) => !v)}
          />
          {openCard && (
            cardData.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-12">이 달의 결제 내역이 없습니다.</p>
            ) : (
              <>
                <div className="h-[220px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={cardData} layout="vertical" margin={{ top: 4, right: 56, left: 4, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f3f4f6" />
                      <XAxis type="number" hide />
                      <YAxis
                        type="category"
                        dataKey="issuer"
                        width={72}
                        tick={{ fontSize: 11, fill: '#111827' }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <Tooltip formatter={(v) => fmtWon(Number(v))} labelStyle={{ fontSize: 12, fontWeight: 600 }} />
                      <Bar dataKey="amount" radius={[0, 4, 4, 0]} barSize={16}>
                        {cardData.map((d, i) => (
                          <Cell key={d.issuer} fill={BAR_PALETTE[i % BAR_PALETTE.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex justify-between text-xs text-gray-400 mt-2 pt-2 border-t border-gray-100">
                  <span>{cardData.length}개 결제수단</span>
                  <span className="font-semibold text-gray-700">합계 {fmtWon(cardTotal)}</span>
                </div>
              </>
            )
          )}
        </div>

        {/* AI 의견 */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm flex flex-col">
          <SectionHeader
            title={
              <span className="flex items-center gap-1.5">
                <Sparkles size={12} className="text-violet-500" />
                수입 대비 지출 AI 의견
                {opinionGeneratedAt && !opinionLoading && (
                  <span className="text-[10px] text-gray-400 font-normal ml-1">
                    {new Date(opinionGeneratedAt + 'Z').toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </span>
                )}
              </span>
            }
            open={openAI}
            onToggle={() => setOpenAI((v) => !v)}
            right={
              openAI ? (
                <button
                  onClick={handleGenerateOpinion}
                  disabled={opinionLoading || monthTxns.length === 0}
                  className="flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-md bg-violet-50 text-violet-600 border border-violet-200 hover:bg-violet-100 disabled:opacity-40 transition-colors"
                >
                  {opinionLoading ? <Loader2 size={11} className="animate-spin" /> : opinion ? <RefreshCw size={11} /> : <Sparkles size={11} />}
                  {opinionLoading ? '분석 중…' : opinion ? '갱신' : 'AI 의견 생성'}
                </button>
              ) : undefined
            }
          />
          {openAI && (
            <div className="flex-1 bg-gray-50 rounded-lg border border-gray-100 p-4 text-xs text-gray-500 leading-relaxed overflow-y-auto max-h-[240px]">
              {opinionLoading ? (
                <div className="flex items-center justify-center h-full text-gray-400 gap-2">
                  <Loader2 size={14} className="animate-spin" /> AI가 가계부를 분석하고 있습니다…
                </div>
              ) : opinionError ? (
                <p className="text-rose-500">{opinionError}</p>
              ) : opinion ? (
                <p className="whitespace-pre-line text-gray-700">{opinion}</p>
              ) : monthTxns.length === 0 ? (
                <p className="text-gray-400">이 달의 가계부 내역이 없어 의견을 생성할 수 없습니다.</p>
              ) : (
                <p className="text-gray-400">
                  이번 달 수입 {fmtWon(monthIncome)} / 지출 {fmtWon(monthExpense)}을 바탕으로 AI 의견을 생성할 수 있습니다.
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 일별 수입·지출 */}
      {dailyData.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
          <SectionHeader
            title={<><CreditCard size={12} className="text-emerald-500" /> 일별 수입 · 지출</>}
            open={openDaily}
            onToggle={() => setOpenDaily((v) => !v)}
          />
          {openDaily && (
            <div className="h-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dailyData} margin={{ top: 4, right: 8, left: 4, bottom: 4 }} barCategoryGap="30%">
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                  <XAxis dataKey="day" tick={{ fontSize: 10, fill: '#111827' }} axisLine={false} tickLine={false} />
                  <YAxis hide />
                  <Tooltip
                    formatter={(v, name) => [fmtWon(Number(v)), name === 'income' ? '수입' : '지출']}
                    labelStyle={{ fontSize: 12, fontWeight: 600, color: '#111827' }}
                    contentStyle={{ fontSize: 11 }}
                  />
                  <Legend
                    formatter={(value) => value === 'income' ? '수입' : '지출'}
                    iconSize={8}
                    wrapperStyle={{ fontSize: 11 }}
                  />
                  <Bar dataKey="income" fill="#10b981" radius={[3, 3, 0, 0]} barSize={10} />
                  <Bar dataKey="expense" fill="#f43f5e" radius={[3, 3, 0, 0]} barSize={10} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}

      {/* 월별 누계 추이 */}
      {cumulativeData.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
          <SectionHeader
            title={<><CreditCard size={12} className="text-blue-500" /> 월별 누계 수입 · 지출 추이</>}
            open={openCumulative}
            onToggle={() => setOpenCumulative((v) => !v)}
          />
          {openCumulative && (
            <div className="h-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={cumulativeData} margin={{ top: 4, right: 8, left: 4, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                  <XAxis dataKey="day" tick={{ fontSize: 10, fill: '#111827' }} axisLine={false} tickLine={false} />
                  <YAxis hide />
                  <Tooltip
                    formatter={(v, name) => {
                      if (name === 'incomeSurplus') return [fmtWon(Number(v)), '누계 수입 (흑자)'];
                      if (name === 'incomeDeficit') return [fmtWon(Number(v)), '누계 수입 (적자)'];
                      return [fmtWon(Number(v)), '누계 지출'];
                    }}
                    labelStyle={{ fontSize: 12, fontWeight: 600, color: '#111827' }}
                    contentStyle={{ fontSize: 11 }}
                  />
                  <Legend
                    formatter={(value) => value === 'incomeSurplus' ? '수입 (흑자구간)' : value === 'incomeDeficit' ? '수입 (적자구간)' : '지출'}
                    iconSize={8}
                    wrapperStyle={{ fontSize: 11 }}
                  />
                  <Line type="monotone" dataKey="incomeSurplus" stroke="#10b981" strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} connectNulls={false} />
                  <Line type="monotone" dataKey="incomeDeficit" stroke="#f59e0b" strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} connectNulls={false} />
                  <Line type="monotone" dataKey="expense" stroke="#f43f5e" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
