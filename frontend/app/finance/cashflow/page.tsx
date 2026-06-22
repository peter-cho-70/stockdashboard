'use client';

import { useFinanceStore } from '@/lib/finance/store/finance-store';
import { useLedgerStore } from '@/lib/finance/store/ledger-store';
import { coverageStatusLabel } from '@/lib/finance/payment-coverage';
import { MonthlyCashflowAnalysis } from '@/components/finance/cashflow/monthly-cashflow-analysis';
import { useState } from 'react';
import { Plus, TrendingUp, TrendingDown, User, CreditCard, Zap, Trash2, Calendar, Pencil, X, Wallet, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { IncomeType, ExpenseCategory, Income, FixedExpense } from '@/lib/finance/types';

export default function CashflowPage() {
  const store = useFinanceStore();
  const cardIssuers = useLedgerStore((s) => s.settings.cardIssuers);
  const paymentCoverage = store.getPaymentCoverage();
  const bankAccounts = store.cashAssets.filter((a) => a.accountType !== 'securities');

  const [isIncomeFormOpen, setIsIncomeFormOpen] = useState(false);
  const [editingIncomeId, setEditingIncomeId] = useState<string | null>(null);
  const [incomeForm, setIncomeForm] = useState({ name: '', earnerName: '', amount: '', incomeType: 'salary' as IncomeType });

  const [isExpenseFormOpen, setIsExpenseFormOpen] = useState(false);
  const [editingExpenseId, setEditingExpenseId] = useState<string | null>(null);
  const [expenseForm, setExpenseForm] = useState({
    name: '',
    category: 'card_payment' as ExpenseCategory,
    cardIssuer: '',
    amount: '',
    nextDueDate: '',
    paymentAccountId: '',
  });


  const handleIncomeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!incomeForm.name || !incomeForm.amount) return;
    if (editingIncomeId) {
      store.updateIncome(editingIncomeId, { name: incomeForm.name, earnerName: incomeForm.earnerName, amount: Number(incomeForm.amount), incomeType: incomeForm.incomeType });
    } else {
      store.addIncome({ id: crypto.randomUUID(), name: incomeForm.name, earnerName: incomeForm.earnerName, amount: Number(incomeForm.amount), incomeType: incomeForm.incomeType, cycle: 'monthly', source: 'manual' });
    }
    resetIncomeForm();
  };

  const handleExpenseSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!expenseForm.name || !expenseForm.amount) return;
    const payload = {
      name: expenseForm.name,
      category: expenseForm.category,
      cardIssuer: expenseForm.cardIssuer || undefined,
      amount: Number(expenseForm.amount),
      nextDueDate: expenseForm.nextDueDate || new Date().toISOString().split('T')[0],
      paymentAccountId: expenseForm.paymentAccountId || undefined,
    };
    if (editingExpenseId) {
      store.updateFixedExpense(editingExpenseId, payload);
    } else {
      store.addFixedExpense({
        id: crypto.randomUUID(),
        ...payload,
        cycle: 'monthly',
      });
    }
    resetExpenseForm();
  };

  const handleEditIncome = (income: Income) => {
    setIncomeForm({ name: income.name, earnerName: income.earnerName || '', amount: income.amount.toString(), incomeType: income.incomeType });
    setEditingIncomeId(income.id);
    setIsIncomeFormOpen(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleEditExpense = (expense: FixedExpense) => {
    setExpenseForm({
      name: expense.name,
      category: expense.category,
      cardIssuer: expense.cardIssuer || '',
      amount: expense.amount.toString(),
      nextDueDate: expense.nextDueDate,
      paymentAccountId: expense.paymentAccountId || '',
    });
    setEditingExpenseId(expense.id);
    setIsExpenseFormOpen(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const resetIncomeForm = () => { setIncomeForm({ name: '', earnerName: '', amount: '', incomeType: 'salary' }); setEditingIncomeId(null); setIsIncomeFormOpen(false); };
  const resetExpenseForm = () => {
    setExpenseForm({ name: '', category: 'card_payment', cardIssuer: '', amount: '', nextDueDate: '', paymentAccountId: '' });
    setEditingExpenseId(null);
    setIsExpenseFormOpen(false);
  };

  const paymentCheckById = new Map(paymentCoverage.payments.map((p) => [p.expense.id, p]));

  const accountName = (id?: string) => {
    if (!id) return null;
    const a = bankAccounts.find((x) => x.id === id);
    return a ? `${a.name} · ${a.institution}` : null;
  };

  const statusBadgeClass = (status: string) => {
    switch (status) {
      case 'ok': return 'text-emerald-700 bg-emerald-50 border-emerald-200';
      case 'tight': return 'text-amber-700 bg-amber-50 border-amber-200';
      case 'shortfall': return 'text-rose-700 bg-rose-50 border-rose-200';
      default: return 'text-gray-500 bg-gray-100 border-gray-200';
    }
  };

  const formatKRW = (amount: number) =>
    new Intl.NumberFormat('ko-KR', { style: 'currency', currency: 'KRW' }).format(amount);

  const monthlyIncome = store.incomes.reduce((s, i) => s + (i.cycle === 'monthly' ? i.amount : 0), 0);
  const monthlyExpense = store.fixedExpenses.reduce((s, e) => s + (e.cycle === 'monthly' ? e.amount : 0), 0);
  const netFlow = monthlyIncome - monthlyExpense;

  const incomeTypeLabel = (t: IncomeType) =>
    ({ salary: '월급', bonus: '보너스', interest: '이자/배당', dividend: '배당', rent: '임대', other: '기타' })[t] ?? t;

  const categoryLabel = (c: ExpenseCategory) =>
    ({ card_payment: '카드결제', utility: '공과금', insurance: '보험료', subscription: '구독료', interest: '대출이자', seasonal_gift: '명절/경조사', management_fee: '관리비', other: '기타' })[c] ?? c;

  return (
    <div className="space-y-5 max-w-[1400px] mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">현금흐름</h1>
          <p className="text-gray-400 text-sm mt-0.5">월별 수입 및 고정 지출 현황</p>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white rounded-xl border border-gray-200 px-5 py-4 shadow-sm">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp size={14} className="text-emerald-600" />
            <p className="text-xs text-gray-500 font-medium">월 총 수입</p>
          </div>
          <p className="text-xl font-bold text-emerald-600 tabular-nums">{formatKRW(monthlyIncome)}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 px-5 py-4 shadow-sm">
          <div className="flex items-center gap-2 mb-2">
            <TrendingDown size={14} className="text-rose-500" />
            <p className="text-xs text-gray-500 font-medium">월 고정 지출</p>
          </div>
          <p className="text-xl font-bold text-rose-500 tabular-nums">{formatKRW(monthlyExpense)}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 px-5 py-4 shadow-sm">
          <div className="flex items-center gap-2 mb-2">
            <Zap size={14} className={netFlow >= 0 ? 'text-blue-600' : 'text-rose-500'} />
            <p className="text-xs text-gray-500 font-medium">월 순현금</p>
          </div>
          <p className={`text-xl font-bold tabular-nums ${netFlow >= 0 ? 'text-blue-600' : 'text-rose-500'}`}>
            {formatKRW(netFlow)}
          </p>
        </div>
      </div>

      {/* Inline forms */}
      {isIncomeFormOpen && (
        <div className="bg-white rounded-xl border border-emerald-200 p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-gray-900">{editingIncomeId ? '수입 수정' : '수입 항목 등록'}</h3>
            <button onClick={resetIncomeForm} className="text-gray-400 hover:text-gray-600"><X size={14} /></button>
          </div>
          <form onSubmit={handleIncomeSubmit} className="grid grid-cols-2 md:grid-cols-4 gap-3 items-end">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-gray-600">항목명</label>
              <input type="text" required className="w-full bg-gray-50 border border-gray-200 px-3 py-2 rounded-lg text-sm text-gray-900 outline-none focus:border-emerald-400 focus:bg-white transition-colors" placeholder="예: 회사 월급" value={incomeForm.name} onChange={e => setIncomeForm({ ...incomeForm, name: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-gray-600">수령인</label>
              <input type="text" className="w-full bg-gray-50 border border-gray-200 px-3 py-2 rounded-lg text-sm text-gray-900 outline-none focus:border-emerald-400 focus:bg-white transition-colors" placeholder="예: 조충남" value={incomeForm.earnerName} onChange={e => setIncomeForm({ ...incomeForm, earnerName: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-gray-600">금액</label>
              <input type="number" required className="w-full bg-gray-50 border border-gray-200 px-3 py-2 rounded-lg text-sm text-gray-900 outline-none focus:border-emerald-400 focus:bg-white transition-colors" placeholder="0" value={incomeForm.amount} onChange={e => setIncomeForm({ ...incomeForm, amount: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-gray-600">수입 유형</label>
              <div className="flex gap-2">
                <select className="flex-1 bg-gray-50 border border-gray-200 px-3 py-2 rounded-lg text-sm text-gray-900 outline-none" value={incomeForm.incomeType} onChange={e => setIncomeForm({ ...incomeForm, incomeType: e.target.value as IncomeType })}>
                  <option value="salary">월급</option>
                  <option value="bonus">보너스</option>
                  <option value="interest">이자/배당</option>
                  <option value="rent">임대료</option>
                  <option value="other">기타</option>
                </select>
                <button type="submit" className="bg-emerald-600 text-white px-3 py-2 rounded-lg text-xs font-semibold hover:bg-emerald-500 transition-colors whitespace-nowrap">
                  {editingIncomeId ? '수정' : '저장'}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {isExpenseFormOpen && (
        <div className="bg-white rounded-xl border border-rose-200 p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-gray-900">
              {editingExpenseId ? '지출 수정' : expenseForm.category === 'card_payment' ? '카드 결제 등록' : '지출 항목 등록'}
            </h3>
            <button onClick={resetExpenseForm} className="text-gray-400 hover:text-gray-600"><X size={14} /></button>
          </div>
          <form onSubmit={handleExpenseSubmit} className="space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="space-y-1.5 md:col-span-2">
                <label className="text-xs font-medium text-gray-600">항목명</label>
                <input type="text" required className="w-full bg-gray-50 border border-gray-200 px-3 py-2 rounded-lg text-sm text-gray-900 outline-none focus:border-rose-400 focus:bg-white transition-colors" placeholder={expenseForm.category === 'card_payment' ? '예: 삼성카드 6월 대금' : '예: 전기요금'} value={expenseForm.name} onChange={e => setExpenseForm({ ...expenseForm, name: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-gray-600">카테고리</label>
                <select className="w-full bg-gray-50 border border-gray-200 px-3 py-2 rounded-lg text-sm text-gray-900 outline-none" value={expenseForm.category} onChange={e => setExpenseForm({ ...expenseForm, category: e.target.value as ExpenseCategory })}>
                  <option value="card_payment">카드결제</option>
                  <option value="utility">공과금</option>
                  <option value="insurance">보험료</option>
                  <option value="subscription">구독료</option>
                  <option value="interest">대출이자</option>
                  <option value="seasonal_gift">명절/경조사</option>
                  <option value="other">기타</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-gray-600">결제 금액 (원)</label>
                <input type="number" required className="w-full bg-gray-50 border border-gray-200 px-3 py-2 rounded-lg text-sm text-gray-900 outline-none focus:border-rose-400 focus:bg-white transition-colors" placeholder="0" value={expenseForm.amount} onChange={e => setExpenseForm({ ...expenseForm, amount: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 items-end">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-gray-600">결제일</label>
                <input type="date" required className="w-full bg-gray-50 border border-gray-200 px-3 py-2 rounded-lg text-sm text-gray-900 outline-none" value={expenseForm.nextDueDate} onChange={e => setExpenseForm({ ...expenseForm, nextDueDate: e.target.value })} />
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <label className="text-xs font-medium text-gray-600">결제 계좌 (출금 은행)</label>
                <select
                  className="w-full bg-gray-50 border border-gray-200 px-3 py-2 rounded-lg text-sm text-gray-900 outline-none"
                  value={expenseForm.paymentAccountId}
                  onChange={e => setExpenseForm({ ...expenseForm, paymentAccountId: e.target.value })}
                >
                  <option value="">계좌 선택…</option>
                  {bankAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} · {a.institution} ({formatKRW(a.amount)})
                    </option>
                  ))}
                </select>
                {bankAccounts.length === 0 && (
                  <p className="text-[11px] text-amber-600 mt-1">
                    <a href="/finance/assets" className="underline">자산 페이지</a>에서 은행 계좌를 먼저 등록하세요.
                  </p>
                )}
              </div>
              <button type="submit" className="bg-rose-500 text-white px-4 py-2 rounded-lg text-xs font-semibold hover:bg-rose-600 transition-colors">
                {editingExpenseId ? '수정 저장' : '저장'}
              </button>
            </div>
            {expenseForm.category === 'card_payment' && (
              <div className="space-y-1.5 max-w-xs">
                <label className="text-xs font-medium text-gray-600">카드사</label>
                <select
                  className="w-full bg-gray-50 border border-gray-200 px-3 py-2 rounded-lg text-sm text-gray-900 outline-none"
                  value={expenseForm.cardIssuer}
                  onChange={e => setExpenseForm({ ...expenseForm, cardIssuer: e.target.value })}
                >
                  <option value="">카드사 선택…</option>
                  {cardIssuers.map((card) => (
                    <option key={card} value={card}>{card}</option>
                  ))}
                </select>
              </div>
            )}
          </form>
        </div>
      )}

      {/* 카드사별 결제 현황 + AI 의견 */}
      <MonthlyCashflowAnalysis />

      {/* Payment coverage summary */}
      {paymentCoverage.payments.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <Wallet size={14} className="text-emerald-600" />
            <h3 className="text-sm font-semibold text-gray-900">결제 계좌 잔액 확인</h3>
            <span className="text-xs text-gray-400">45일 이내</span>
          </div>
          {paymentCoverage.accounts.length === 0 ? (
            <p className="text-xs text-gray-500">출금 계좌가 지정된 결제가 없습니다. 지출 등록 시 결제 계좌를 선택하세요.</p>
          ) : (
            <div className="space-y-2">
              {paymentCoverage.accounts.map((acct) => (
                <div key={acct.accountId} className={`flex items-center justify-between rounded-lg border px-3 py-2 text-xs ${statusBadgeClass(acct.status)}`}>
                  <div>
                    <p className="font-medium">{acct.accountName}</p>
                    <p className="opacity-80 mt-0.5">
                      잔액 {formatKRW(acct.balance)} · 예정 {formatKRW(acct.upcomingTotal)}
                      {acct.shortfall > 0 && ` · 부족 ${formatKRW(acct.shortfall)}`}
                    </p>
                  </div>
                  <span className="font-semibold shrink-0">{coverageStatusLabel(acct.status)}</span>
                </div>
              ))}
            </div>
          )}
          {paymentCoverage.shortfallCount > 0 && (
            <p className="mt-3 text-xs text-rose-600 flex items-center gap-1">
              <AlertTriangle size={12} />
              잔액 부족 결제 {paymentCoverage.shortfallCount}건
              {paymentCoverage.urgentShortfallCount > 0 && ` (7일 이내 ${paymentCoverage.urgentShortfallCount}건)`}
            </p>
          )}
        </div>
      )}

      {/* Content grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <section className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="p-1.5 bg-gray-100 border border-gray-200 rounded-lg">
                <User className="text-emerald-600" size={14} />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-gray-900">소득 현황</h3>
                <p className="text-gray-400 text-xs mt-0.5">가구 수입 항목</p>
              </div>
            </div>
            {!isIncomeFormOpen && (
              <button onClick={() => setIsIncomeFormOpen(true)} className="flex items-center gap-1 text-xs text-emerald-600 hover:text-emerald-700 transition-colors font-medium">
                <Plus size={12} /> 추가
              </button>
            )}
          </div>
          <div className="divide-y divide-gray-100">
            {store.incomes.length === 0 ? (
              <div className="px-5 py-6 text-center text-xs text-gray-400">등록된 수입 항목이 없습니다.</div>
            ) : (
              store.incomes.map((income) => (
                <div key={income.id} className="px-5 py-3 flex items-center justify-between group hover:bg-gray-50 transition-colors">
                  <div className="flex items-center gap-3">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                    <div>
                      <p className="text-sm text-gray-800 font-medium">{income.name}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{income.earnerName && `${income.earnerName} · `}{incomeTypeLabel(income.incomeType)}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-sm font-semibold text-gray-800 tabular-nums">{formatKRW(income.amount)}</span>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => handleEditIncome(income)} className="p-1 text-gray-400 hover:text-blue-500 transition-colors"><Pencil size={12} /></button>
                      <button onClick={() => { if (confirm('삭제하시겠습니까?')) { store.deleteIncome(income.id); if (editingIncomeId === income.id) resetIncomeForm(); } }} className="p-1 text-gray-400 hover:text-rose-500 transition-colors"><Trash2 size={12} /></button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
          <div className="px-5 py-3 border-t border-gray-100 flex justify-between">
            <span className="text-xs text-gray-400">월 합계</span>
            <span className="text-xs font-semibold text-emerald-600 tabular-nums">{formatKRW(monthlyIncome)}</span>
          </div>
        </section>

        <section className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="p-1.5 bg-gray-100 border border-gray-200 rounded-lg">
                <CreditCard className="text-rose-500" size={14} />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-gray-900">고정 지출</h3>
                <p className="text-gray-400 text-xs mt-0.5">카드·이자·공과금 등</p>
              </div>
            </div>
            {!isExpenseFormOpen && (
              <button onClick={() => setIsExpenseFormOpen(true)} className="flex items-center gap-1 text-xs text-rose-500 hover:text-rose-600 transition-colors font-medium">
                <Plus size={12} /> 추가
              </button>
            )}
          </div>
          <div className="divide-y divide-gray-100">
            {store.fixedExpenses.length === 0 ? (
              <div className="px-5 py-6 text-center text-xs text-gray-400">등록된 지출 항목이 없습니다.</div>
            ) : (
              store.fixedExpenses.map((expense) => {
                const check = paymentCheckById.get(expense.id);
                const acct = accountName(expense.paymentAccountId);
                return (
                <div key={expense.id} className="px-5 py-3 flex items-center justify-between group hover:bg-gray-50 transition-colors">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`p-1.5 rounded-lg border shrink-0 ${expense.category === 'card_payment' ? 'bg-blue-50 border-blue-200 text-blue-500' : 'bg-rose-50 border-rose-200 text-rose-500'}`}>
                      {expense.category === 'card_payment' ? <CreditCard size={12} /> : <Zap size={12} />}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm text-gray-800 font-medium">{expense.name}</p>
                      <div className="flex flex-wrap items-center gap-1.5 mt-0.5 text-xs text-gray-400">
                        <span>{categoryLabel(expense.category)}</span>
                        {expense.cardIssuer && <><span>·</span><span>{expense.cardIssuer}</span></>}
                        <Calendar size={10} />
                        <span>{expense.nextDueDate}</span>
                        {acct && <><span>·</span><span className="truncate">{acct}</span></>}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {check && check.status !== 'unknown' && (
                      <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${statusBadgeClass(check.status)}`}>
                        {check.status === 'ok' ? <CheckCircle2 size={10} className="inline mr-0.5" /> : check.status === 'shortfall' ? <AlertTriangle size={10} className="inline mr-0.5" /> : null}
                        {coverageStatusLabel(check.status)}
                      </span>
                    )}
                    <span className="text-sm font-semibold text-gray-800 tabular-nums">{formatKRW(expense.amount)}</span>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => handleEditExpense(expense)} className="p-1 text-gray-400 hover:text-blue-500 transition-colors"><Pencil size={12} /></button>
                      <button onClick={() => { if (confirm('삭제하시겠습니까?')) { store.deleteFixedExpense(expense.id); if (editingExpenseId === expense.id) resetExpenseForm(); } }} className="p-1 text-gray-400 hover:text-rose-500 transition-colors"><Trash2 size={12} /></button>
                    </div>
                  </div>
                </div>
              );})
            )}
          </div>
          <div className="px-5 py-3 border-t border-gray-100 flex justify-between">
            <span className="text-xs text-gray-400">월 합계</span>
            <span className="text-xs font-semibold text-rose-500 tabular-nums">{formatKRW(monthlyExpense)}</span>
          </div>
        </section>
      </div>
    </div>
  );
}
