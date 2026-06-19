'use client';

import { useState, useMemo } from 'react';
import {
  ChevronLeft, ChevronRight, Plus, Pencil, Trash2,
  TrendingUp, TrendingDown, Minus, BookOpen, SlidersHorizontal,
  Search, PieChart,
} from 'lucide-react';
import { useLedgerStore } from '@/lib/finance/store/ledger-store';
import { CategoryBreakdownPanel } from '@/components/finance/ledger/category-breakdown-panel';
import {
  type Transaction, type TransactionType, type PaymentMethod,
} from '@/lib/finance/types';

// ─── 유틸 ─────────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return n.toLocaleString('ko-KR') + '원';
}

function fmtCompact(n: number) {
  if (n >= 100000000) return (n / 100000000).toFixed(1) + '억';
  if (n >= 10000) return Math.round(n / 10000) + '만';
  return n.toLocaleString('ko-KR');
}

const COLOR_MAP: Record<string, string> = {
  amber:   'bg-amber-100 text-amber-700',
  blue:    'bg-blue-100 text-blue-700',
  violet:  'bg-violet-100 text-violet-700',
  rose:    'bg-rose-100 text-rose-700',
  green:   'bg-green-100 text-green-700',
  pink:    'bg-pink-100 text-pink-700',
  yellow:  'bg-yellow-100 text-yellow-700',
  slate:   'bg-slate-100 text-slate-600',
  red:     'bg-red-100 text-red-700',
  teal:    'bg-teal-100 text-teal-700',
  indigo:  'bg-indigo-100 text-indigo-700',
  emerald: 'bg-emerald-100 text-emerald-700',
  gray:    'bg-gray-100 text-gray-600',
};

const BAR_COLOR_MAP: Record<string, string> = {
  amber:   'bg-amber-400',
  blue:    'bg-blue-400',
  violet:  'bg-violet-400',
  rose:    'bg-rose-400',
  green:   'bg-green-400',
  pink:    'bg-pink-400',
  yellow:  'bg-yellow-400',
  slate:   'bg-slate-400',
  red:     'bg-red-400',
  teal:    'bg-teal-400',
  indigo:  'bg-indigo-400',
  emerald: 'bg-emerald-400',
  gray:    'bg-gray-400',
};

const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  cash: '현금',
  check_card: '체크카드',
  credit_card: '신용카드',
  bank_transfer: '계좌이체',
};

// ─── 빈 폼 ──────────────────────────────────────────────────────────────────

function emptyForm() {
  return {
    date: new Date().toISOString().slice(0, 10),
    amount: '',
    type: 'expense' as TransactionType,
    category: '',
    subCategory: '',
    paymentMethod: 'credit_card' as PaymentMethod,
    cardIssuer: '',
    memo: '',
    isFixed: false,
    user: '',
  };
}

// ─── 날짜 라벨 ────────────────────────────────────────────────────────────────

function dateLabel(dateStr: string) {
  const d = new Date(dateStr + 'T00:00:00');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((d.getTime() - today.getTime()) / 86400000);
  const dow = ['일', '월', '화', '수', '목', '금', '토'][d.getDay()];
  const base = `${d.getMonth() + 1}.${String(d.getDate()).padStart(2, '0')} (${dow})`;
  if (diff === 0) return base + ' — 오늘';
  if (diff === -1) return base + ' — 어제';
  return base;
}

// ─── 메인 컴포넌트 ───────────────────────────────────────────────────────────

export default function LedgerPage() {
  const store = useLedgerStore();
  const { categories, cardIssuers, users } = store.settings || { categories: [], cardIssuers: [], users: [] };

  const expenseCategories = useMemo(() => categories.filter(c => !c.incomeOk).map(c => c.name), [categories]);
  const incomeCategories = useMemo(() => categories.filter(c => c.incomeOk).map(c => c.name), [categories]);

  // ─ 월 선택 ─
  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth() + 1);

  function prevMonth() {
    if (viewMonth === 1) { setViewYear(y => y - 1); setViewMonth(12); }
    else setViewMonth(m => m - 1);
  }
  function nextMonth() {
    if (viewMonth === 12) { setViewYear(y => y + 1); setViewMonth(1); }
    else setViewMonth(m => m + 1);
  }

  // ─ 필터 ─
  const [filterType, setFilterType] = useState<'all' | TransactionType>('all');
  const [filterCategory, setFilterCategory] = useState<string | 'all'>('all');
  const [showBudgetPanel, setShowBudgetPanel] = useState(false);
  const [showAnalysisPanel, setShowAnalysisPanel] = useState(false);

  // ─ 거래 폼 ─
  const [form, setForm] = useState(emptyForm());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  // ─ 예산 편집 ─
  const [budgetEditCategory, setBudgetEditCategory] = useState<string | null>(null);
  const [budgetEditValue, setBudgetEditValue] = useState('');

  // ─ 이번 달 데이터 ─
  const monthTxns = useMemo(
    () => store.getMonthTransactions(viewYear, viewMonth),
    [store.transactions, viewYear, viewMonth, store]
  );
  const monthExpenses = monthTxns.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
  const monthIncome = monthTxns.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const monthNet = monthIncome - monthExpenses;

  // ─ 필터된 거래 목록 ─
  const filtered = useMemo(() => {
    return monthTxns.filter(t => {
      if (filterType !== 'all' && t.type !== filterType) return false;
      if (filterCategory !== 'all' && t.category !== filterCategory) return false;
      return true;
    }).sort((a, b) => (b.date + b.createdAt).localeCompare(a.date + a.createdAt));
  }, [monthTxns, filterType, filterCategory]);

  // ─ 날짜별 그룹 ─
  const grouped = useMemo(() => {
    const map = new Map<string, Transaction[]>();
    for (const t of filtered) {
      const arr = map.get(t.date) ?? [];
      arr.push(t);
      map.set(t.date, arr);
    }
    return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [filtered]);

  // ─ 예산 현황 ─
  const budgetItems = useMemo(() => {
    return store.budgets.map(b => ({
      ...b,
      spent: store.getCategorySpending(viewYear, viewMonth, b.category),
    }));
  }, [store.budgets, store.transactions, viewYear, viewMonth, store]);

  // ─ 액션 ─
  function openNew() {
    const defaultCat = expenseCategories[0] || '';
    setForm({ ...emptyForm(), category: defaultCat });
    setEditingId(null);
    setFormOpen(true);
  }
  function openEdit(t: Transaction) {
    setForm({
      date: t.date, amount: String(t.amount), type: t.type,
      category: t.category, subCategory: t.subCategory ?? '',
      paymentMethod: t.paymentMethod, cardIssuer: t.cardIssuer ?? '',
      memo: t.memo ?? '', isFixed: t.isFixed, user: t.user ?? '',
    });
    setEditingId(t.id);
    setFormOpen(true);
  }
  function submitForm() {
    const amount = Number(form.amount.replace(/,/g, ''));
    if (!amount || amount <= 0) return;
    const base = {
      date: form.date,
      amount,
      type: form.type,
      category: form.category,
      subCategory: form.subCategory || undefined,
      paymentMethod: form.paymentMethod,
      cardIssuer: form.cardIssuer || undefined,
      memo: form.memo || undefined,
      isFixed: form.isFixed,
      user: form.user || undefined,
      createdAt: new Date().toISOString(),
    };
    if (editingId) {
      store.updateTransaction(editingId, base);
    } else {
      store.addTransaction({ id: `t${Date.now()}`, ...base });
    }
    setFormOpen(false);
    setForm(emptyForm());
    setEditingId(null);
  }

  const currentCategories = form.type === 'income' ? incomeCategories : expenseCategories;
  const currentCategoryInfo = categories.find(c => c.name === form.category);

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      {/* ─ 헤더 ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <BookOpen size={18} className="text-emerald-600" />
          <h1 className="text-lg font-bold text-gray-900">일상 가계부</h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowAnalysisPanel(v => !v)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border transition-all ${showAnalysisPanel ? 'bg-gray-900 text-white border-gray-900' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'}`}
          >
            <PieChart size={12} />
            카테고리 분석
          </button>
          <button
            onClick={() => setShowBudgetPanel(v => !v)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border transition-all ${showBudgetPanel ? 'bg-gray-900 text-white border-gray-900' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'}`}
          >
            <SlidersHorizontal size={12} />
            예산 관리
          </button>
          <button
            onClick={openNew}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-emerald-600 text-white hover:bg-emerald-700 transition-all"
          >
            <Plus size={12} />
            거래 추가
          </button>
        </div>
      </div>

      {/* ─ 월 선택 + 요약 ──────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center justify-between mb-4">
          <button onClick={prevMonth} className="p-1.5 rounded-md hover:bg-gray-100 text-gray-500 transition-all">
            <ChevronLeft size={16} />
          </button>
          <span className="text-base font-bold text-gray-900">
            {viewYear}년 {viewMonth}월
          </span>
          <button onClick={nextMonth} className="p-1.5 rounded-md hover:bg-gray-100 text-gray-500 transition-all">
            <ChevronRight size={16} />
          </button>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <div className="text-center">
            <div className="flex items-center justify-center gap-1.5 text-xs text-gray-500 mb-1">
              <TrendingUp size={12} className="text-emerald-500" />
              수입
            </div>
            <div className="text-lg font-bold text-emerald-600">{fmt(monthIncome)}</div>
          </div>
          <div className="text-center border-x border-gray-100">
            <div className="flex items-center justify-center gap-1.5 text-xs text-gray-500 mb-1">
              <TrendingDown size={12} className="text-rose-500" />
              지출
            </div>
            <div className="text-lg font-bold text-rose-600">{fmt(monthExpenses)}</div>
          </div>
          <div className="text-center">
            <div className="flex items-center justify-center gap-1.5 text-xs text-gray-500 mb-1">
              <Minus size={12} className="text-gray-400" />
              순현금흐름
            </div>
            <div className={`text-lg font-bold ${monthNet >= 0 ? 'text-blue-600' : 'text-rose-600'}`}>
              {monthNet >= 0 ? '+' : ''}{fmt(monthNet)}
            </div>
          </div>
        </div>
      </div>

      {/* ─ 카테고리별 분석 (원형 / 막대 / 별형) ──────────────────────── */}
      {showAnalysisPanel && (
        <CategoryBreakdownPanel
          categories={categories}
          budgets={store.budgets}
          viewYear={viewYear}
          viewMonth={viewMonth}
          monthExpenses={monthExpenses}
          monthIncome={monthIncome}
          getCategorySpending={store.getCategorySpending}
          getCategoryIncome={store.getCategoryIncome}
        />
      )}

      {/* ─ 예산 관리 패널 ─────────────────────────────────────────────── */}
      {showBudgetPanel && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">예산 설정 및 현황</h2>
          <div className="space-y-3">
            {expenseCategories.map(cat => {
              const info = categories.find(c => c.name === cat);
              if (!info) return null;
              const badge = COLOR_MAP[info.color];
              const bar = BAR_COLOR_MAP[info.color];
              const budget = store.budgets.find(b => b.category === cat);
              const spent = store.getCategorySpending(viewYear, viewMonth, cat);
              const pct = budget ? Math.min(100, Math.round((spent / budget.monthlyLimit) * 100)) : 0;
              const isOver = budget && spent > budget.monthlyLimit;

              return (
                <div key={cat} className="flex items-center gap-3">
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full w-16 text-center shrink-0 ${badge}`}>{cat}</span>
                  <div className="flex-1">
                    {budget ? (
                      <div className="space-y-0.5">
                        <div className="flex justify-between text-xs text-gray-500">
                          <span>{fmtCompact(spent)}</span>
                          <span className={isOver ? 'text-rose-500 font-medium' : ''}>/ {fmtCompact(budget.monthlyLimit)} {isOver ? '⚠️ 초과' : `(${pct}%)`}</span>
                        </div>
                        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full transition-all ${isOver ? 'bg-rose-500' : bar}`} style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    ) : (
                      <div className="text-xs text-gray-400">
                        {spent > 0 ? `${fmtCompact(spent)} 지출 (예산 미설정)` : '예산 미설정'}
                      </div>
                    )}
                  </div>
                  {budgetEditCategory === cat ? (
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        value={budgetEditValue}
                        onChange={e => setBudgetEditValue(e.target.value)}
                        placeholder="한도 입력"
                        className="w-24 px-2 py-1 text-xs border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-emerald-400"
                        autoFocus
                        onKeyDown={e => {
                          if (e.key === 'Enter') {
                            const v = Number(budgetEditValue);
                            if (v > 0) store.setBudget(cat, v);
                            setBudgetEditCategory(null);
                          }
                          if (e.key === 'Escape') setBudgetEditCategory(null);
                        }}
                      />
                      <button
                        onClick={() => {
                          const v = Number(budgetEditValue);
                          if (v > 0) store.setBudget(cat, v);
                          setBudgetEditCategory(null);
                        }}
                        className="text-xs px-2 py-1 bg-emerald-600 text-white rounded-md hover:bg-emerald-700"
                      >저장</button>
                    </div>
                  ) : (
                    <button
                      onClick={() => {
                        setBudgetEditCategory(cat);
                        setBudgetEditValue(budget ? String(budget.monthlyLimit) : '');
                      }}
                      className="text-xs text-gray-400 hover:text-gray-600 shrink-0"
                    >
                      {budget ? '수정' : '+ 예산 설정'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ─ 거래 추가/수정 폼 ──────────────────────────────────────────── */}
      {formOpen && (
        <div className="bg-white rounded-xl border border-emerald-200 p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">
            {editingId ? '거래 수정' : '거래 추가'}
          </h2>
          <div className="space-y-3">
            {/* 유형 선택 */}
            <div className="flex gap-2">
              {(['expense', 'income', 'transfer'] as TransactionType[]).map(t => (
                <button
                  key={t}
                  onClick={() => {
                    const defaultCat = t === 'income' ? incomeCategories[0] : expenseCategories[0];
                    setForm(f => ({ ...f, type: t, category: defaultCat || '' }));
                  }}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${form.type === t ? (t === 'expense' ? 'bg-rose-100 text-rose-700 border border-rose-300' : t === 'income' ? 'bg-emerald-100 text-emerald-700 border border-emerald-300' : 'bg-blue-100 text-blue-700 border border-blue-300') : 'bg-gray-50 text-gray-500 border border-gray-200 hover:bg-gray-100'}`}
                >
                  {t === 'expense' ? '지출' : t === 'income' ? '수입' : '이체'}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-3">
              {/* 날짜 */}
              <div>
                <label className="block text-xs text-gray-500 mb-1">날짜</label>
                <input
                  type="date"
                  value={form.date}
                  onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-emerald-400"
                />
              </div>
              {/* 금액 */}
              <div>
                <label className="block text-xs text-gray-500 mb-1">금액 (원)</label>
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="0"
                  value={form.amount}
                  onChange={e => setForm(f => ({ ...f, amount: e.target.value.replace(/[^0-9]/g, '') }))}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-emerald-400"
                />
              </div>
              {/* 사용자 */}
              <div>
                <label className="block text-xs text-gray-500 mb-1">사용자</label>
                <select
                  value={form.user}
                  onChange={e => setForm(f => ({ ...f, user: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-emerald-400 bg-white"
                >
                  <option value="">공통</option>
                  {users?.map(u => (
                    <option key={u} value={u}>{u}</option>
                  ))}
                </select>
              </div>
              {/* 카테고리 */}
              <div>
                <label className="block text-xs text-gray-500 mb-1">카테고리</label>
                <select
                  value={form.category}
                  onChange={e => setForm(f => ({ ...f, category: e.target.value, subCategory: '' }))}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-emerald-400 bg-white"
                >
                  {currentCategories.map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
              {/* 세부 카테고리 */}
              <div>
                <label className="block text-xs text-gray-500 mb-1">세부 분류</label>
                {currentCategoryInfo && currentCategoryInfo.sub.length > 0 ? (
                  <select
                    value={form.subCategory}
                    onChange={e => setForm(f => ({ ...f, subCategory: e.target.value }))}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-emerald-400 bg-white"
                  >
                    <option value="">선택 안함</option>
                    {currentCategoryInfo.sub.map(s => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    placeholder="직접 입력 (선택)"
                    value={form.subCategory}
                    onChange={e => setForm(f => ({ ...f, subCategory: e.target.value }))}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-emerald-400"
                  />
                )}
              </div>
              {/* 결제수단 */}
              <div>
                <label className="block text-xs text-gray-500 mb-1">결제수단</label>
                <select
                  value={form.paymentMethod}
                  onChange={e => setForm(f => ({ ...f, paymentMethod: e.target.value as PaymentMethod }))}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-emerald-400 bg-white"
                >
                  <option value="credit_card">신용카드</option>
                  <option value="check_card">체크카드</option>
                  <option value="bank_transfer">계좌이체</option>
                  <option value="cash">현금</option>
                </select>
              </div>
              {/* 카드사 */}
              {form.paymentMethod === 'credit_card' && (
                <div>
                  <label className="block text-xs text-gray-500 mb-1">카드사</label>
                  <select
                    value={form.cardIssuer}
                    onChange={e => setForm(f => ({ ...f, cardIssuer: e.target.value }))}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-emerald-400 bg-white"
                  >
                    <option value="">카드사 선택</option>
                    {cardIssuers.map(card => (
                      <option key={card} value={card}>{card}</option>
                    ))}
                    <option value="direct">직접 입력</option>
                  </select>
                  {form.cardIssuer === 'direct' && (
                     <input
                      type="text"
                      placeholder="카드사명 입력"
                      className="w-full mt-2 px-3 py-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-emerald-400"
                      onChange={e => setForm(f => ({ ...f, cardIssuer: e.target.value }))}
                    />
                  )}
                </div>
              )}
            </div>

            {/* 메모 / 사용내역 */}
            <div>
              <label className="block text-xs text-gray-500 mb-1 flex items-center gap-1">
                사용내역 (메모)
              </label>
              <div className="relative">
                <input
                  type="text"
                  placeholder="예: 스타벅스, 마트..."
                  value={form.memo}
                  onChange={e => setForm(f => ({ ...f, memo: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-emerald-400"
                  onKeyDown={e => { if (e.key === 'Enter') submitForm(); }}
                />
              </div>
            </div>

            {/* 고정비 여부 */}
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.isFixed}
                onChange={e => setForm(f => ({ ...f, isFixed: e.target.checked }))}
                className="w-3.5 h-3.5 accent-emerald-600"
              />
              <span className="text-xs text-gray-600">고정 지출/수입으로 등록 (매월 반복)</span>
            </label>

            {/* 버튼 */}
            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={() => { setFormOpen(false); setEditingId(null); }}
                className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-md hover:bg-gray-50 transition-all"
              >
                취소
              </button>
              <button
                onClick={submitForm}
                className="px-4 py-2 text-sm font-medium bg-emerald-600 text-white rounded-md hover:bg-emerald-700 transition-all"
              >
                {editingId ? '수정 완료' : '추가'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─ 예산 요약 바 (간략) ────────────────────────────────────────── */}
      {!showBudgetPanel && budgetItems.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-gray-600">이번 달 예산 현황</span>
            <button onClick={() => setShowBudgetPanel(true)} className="text-xs text-gray-400 hover:text-gray-600">
              전체 보기 →
            </button>
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-2.5">
            {budgetItems.map(b => {
              const info = categories.find(c => c.name === b.category);
              if (!info) return null;
              const bar = BAR_COLOR_MAP[info.color];
              const badge = COLOR_MAP[info.color];
              const pct = Math.min(100, Math.round((b.spent / b.monthlyLimit) * 100));
              const isOver = b.spent > b.monthlyLimit;
              return (
                <div key={b.category} className="flex items-center gap-2 min-w-0">
                  <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full shrink-0 ${badge}`}>{b.category}</span>
                  <div className="flex-1 min-w-0">
                    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full transition-all ${isOver ? 'bg-rose-500' : bar}`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                  <span className={`text-[10px] shrink-0 ${isOver ? 'text-rose-500 font-medium' : 'text-gray-500'}`}>
                    {pct}%{isOver ? ' ⚠️' : ''}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ─ 필터 바 ───────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* 유형 필터 */}
        {(['all', 'expense', 'income'] as const).map(t => (
          <button
            key={t}
            onClick={() => setFilterType(t)}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${filterType === t ? 'bg-gray-800 text-white' : 'bg-white border border-gray-200 text-gray-500 hover:bg-gray-50'}`}
          >
            {t === 'all' ? '전체' : t === 'expense' ? '지출' : '수입'}
          </button>
        ))}
        <span className="text-gray-300">|</span>
        {/* 카테고리 필터 */}
        <select
          value={filterCategory}
          onChange={e => setFilterCategory(e.target.value)}
          className="px-3 py-1 text-xs border border-gray-200 rounded-md bg-white text-gray-600 focus:outline-none"
        >
          <option value="all">전체 카테고리</option>
          {categories.map(c => (
            <option key={c.name} value={c.name}>{c.name}</option>
          ))}
        </select>
        <span className="ml-auto text-xs text-gray-400">{filtered.length}건</span>
      </div>

      {/* ─ 거래 목록 ─────────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {grouped.length === 0 ? (
          <div className="py-16 text-center text-gray-400">
            <BookOpen size={32} className="mx-auto mb-3 opacity-30" />
            <p className="text-sm">이 달의 거래 내역이 없습니다.</p>
            <button onClick={openNew} className="mt-3 text-xs text-emerald-600 hover:underline">
              첫 거래 추가하기 →
            </button>
          </div>
        ) : (
          grouped.map(([date, txns], gi) => (
            <div key={date}>
              {/* 날짜 헤더 */}
              <div className={`px-5 py-2 bg-gray-50 border-b border-gray-100 flex items-center justify-between ${gi > 0 ? 'border-t border-gray-100' : ''}`}>
                <span className="text-xs font-semibold text-gray-500">{dateLabel(date)}</span>
                <span className="text-xs text-gray-400">
                  {txns.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0) > 0 && (
                    <span className="text-rose-500">
                      -{fmtCompact(txns.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0))}
                    </span>
                  )}
                  {txns.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0) > 0 && (
                    <span className="text-emerald-500 ml-2">
                      +{fmtCompact(txns.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0))}
                    </span>
                  )}
                </span>
              </div>
              {/* 거래 목록 */}
              {txns.map((t, ti) => {
                const info = categories.find(c => c.name === t.category);
                const badge = info ? COLOR_MAP[info.color] : 'bg-gray-100 text-gray-600';
                return (
                  <div
                    key={t.id}
                    className={`group flex items-center px-5 py-3 hover:bg-gray-50 transition-all ${ti < txns.length - 1 ? 'border-b border-gray-50' : ''}`}
                  >
                    {/* 카테고리 배지 */}
                    <div className="w-24 shrink-0">
                      <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${badge}`}>{t.category}</span>
                      {t.subCategory && (
                        <span className="ml-1 text-[10px] text-gray-400">{t.subCategory}</span>
                      )}
                    </div>
                    {/* 메모 */}
                    <div className="flex-1 min-w-0 mx-3">
                      <span className="text-sm text-gray-700 truncate block flex items-center gap-1.5">
                        {t.memo || t.subCategory || t.category}
                        {t.user && (
                          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-gray-100 text-gray-500 border border-gray-200">
                            {t.user}
                          </span>
                        )}
                      </span>
                      <span className="text-[11px] text-gray-400">
                        {PAYMENT_LABELS[t.paymentMethod]}
                        {t.cardIssuer ? ` · ${t.cardIssuer}` : ''}
                        {t.isFixed && <span className="ml-1.5 text-indigo-400">고정</span>}
                      </span>
                    </div>
                    {/* 금액 */}
                    <div className={`text-sm font-semibold shrink-0 ${t.type === 'income' ? 'text-emerald-600' : t.type === 'expense' ? 'text-gray-800' : 'text-blue-600'}`}>
                      {t.type === 'income' ? '+' : t.type === 'expense' ? '-' : ''}
                      {fmt(t.amount)}
                    </div>
                    {/* 액션 */}
                    <div className="flex items-center gap-1 ml-3 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => openEdit(t)}
                        className="p-1.5 text-gray-400 hover:text-gray-700 rounded hover:bg-gray-100 transition-all"
                      >
                        <Pencil size={12} />
                      </button>
                      <button
                        onClick={() => store.deleteTransaction(t.id)}
                        className="p-1.5 text-gray-400 hover:text-rose-500 rounded hover:bg-rose-50 transition-all"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>

    </div>
  );
}