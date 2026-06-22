'use client';

import { useMemo, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import { CreditCard, ChevronLeft, ChevronRight, Sparkles, Loader2 } from 'lucide-react';
import { useLedgerStore } from '@/lib/finance/store/ledger-store';
import { api } from '@/lib/api';

const BAR_PALETTE = [
  '#6366f1', '#3b82f6', '#10b981', '#f59e0b', '#ec4899',
  '#ef4444', '#14b8a6', '#8b5cf6', '#84cc16', '#f43f5e',
];

function fmtWon(n: number) {
  return n.toLocaleString('ko-KR') + '원';
}

export function MonthlyCashflowAnalysis() {
  const transactions = useLedgerStore((s) => s.transactions);
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);

  const [opinion, setOpinion] = useState<string | null>(null);
  const [opinionLoading, setOpinionLoading] = useState(false);
  const [opinionError, setOpinionError] = useState<string | null>(null);

  function prevMonth() {
    setOpinion(null); setOpinionError(null);
    if (month === 1) { setYear((y) => y - 1); setMonth(12); } else setMonth((m) => m - 1);
  }
  function nextMonth() {
    setOpinion(null); setOpinionError(null);
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

  const cardTotal = cardData.reduce((s, d) => s + d.amount, 0);
  const monthIncome = monthTxns.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const monthExpense = monthTxns.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0);

  async function handleGenerateOpinion() {
    setOpinionLoading(true);
    setOpinionError(null);
    try {
      const result = await api.generateCashflowOpinion(year, month);
      setOpinion(result.opinion);
    } catch (err) {
      setOpinionError(err instanceof Error ? err.message : 'AI 의견 생성에 실패했습니다.');
    } finally {
      setOpinionLoading(false);
    }
  }

  return (
    <section className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">월별 가계부 분석</h3>
          <p className="text-gray-400 text-xs mt-0.5">카드사별 결제 현황 · AI 수입·지출 의견</p>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={prevMonth} className="p-1 rounded hover:bg-gray-100 text-gray-500 transition-colors">
            <ChevronLeft size={14} />
          </button>
          <span className="text-xs font-medium text-gray-600 w-20 text-center">{year}년 {month}월</span>
          <button onClick={nextMonth} className="p-1 rounded hover:bg-gray-100 text-gray-500 transition-colors">
            <ChevronRight size={14} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* 카드사별 결제 차트 */}
        <div>
          <div className="flex items-center gap-1.5 text-xs font-medium text-gray-600 mb-3">
            <CreditCard size={12} className="text-indigo-500" />
            카드사별 결제 금액
          </div>
          {cardData.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-16">이 달의 결제 내역이 없습니다.</p>
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
                      tick={{ fontSize: 11, fill: '#6b7280' }}
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
          )}
        </div>

        {/* AI 의견 */}
        <div className="flex flex-col">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-1.5 text-xs font-medium text-gray-600">
              <Sparkles size={12} className="text-violet-500" />
              수입 대비 지출 AI 의견
            </div>
            <button
              onClick={handleGenerateOpinion}
              disabled={opinionLoading || monthTxns.length === 0}
              className="flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-md bg-violet-50 text-violet-600 border border-violet-200 hover:bg-violet-100 disabled:opacity-40 transition-colors"
            >
              {opinionLoading ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
              {opinion ? '다시 생성' : 'AI 의견 생성'}
            </button>
          </div>
          <div className="flex-1 bg-gray-50 rounded-lg border border-gray-100 p-4 text-xs text-gray-500 leading-relaxed overflow-y-auto max-h-[260px]">
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
        </div>
      </div>
    </section>
  );
}
