'use client';

import { useFinanceStore } from '@/lib/finance/store/finance-store';
import { useState } from 'react';
import { LiabilityType, Liability } from '@/lib/finance/types';
import { Plus, CreditCard, Percent, Trash2, Pencil, X, AlertTriangle } from 'lucide-react';

export default function LiabilitiesPage() {
  const store = useFinanceStore();
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    lender: '',
    principal: '',
    interestRate: '',
    lenderType: 'credit_line' as LiabilityType,
  });


  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name || !formData.principal || !formData.interestRate) return;
    const principal = Number(formData.principal);
    const rate = Number(formData.interestRate);
    const monthlyInterest = Math.round((principal * (rate / 100)) / 12);

    if (editingId) {
      store.updateLiability(editingId, { name: formData.name, lender: formData.lender, principal, interestRate: rate, monthlyInterest, lenderType: formData.lenderType });
    } else {
      store.addLiability({ id: crypto.randomUUID(), name: formData.name, lender: formData.lender, principal, interestRate: rate, monthlyInterest, lenderType: formData.lenderType, source: 'manual', maturityDate: null });
    }
    resetForm();
  };

  const handleEdit = (l: Liability) => {
    setFormData({ name: l.name, lender: l.lender, principal: l.principal.toString(), interestRate: l.interestRate.toString(), lenderType: l.lenderType });
    setEditingId(l.id);
    setIsFormOpen(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDelete = (id: string) => {
    if (confirm('이 부채 항목을 삭제하시겠습니까?')) {
      store.deleteLiability(id);
      if (editingId === id) resetForm();
    }
  };

  const resetForm = () => {
    setFormData({ name: '', lender: '', principal: '', interestRate: '', lenderType: 'credit_line' });
    setEditingId(null);
    setIsFormOpen(false);
  };

  const formatKRW = (amount: number) =>
    new Intl.NumberFormat('ko-KR', { style: 'currency', currency: 'KRW' }).format(amount);

  const totalPrincipal = store.liabilities.reduce((s, l) => s + l.principal, 0);
  const totalMonthlyInterest = store.liabilities.reduce((s, l) => s + l.monthlyInterest, 0);

  const lenderTypeLabel = (t: LiabilityType) =>
    t === 'credit_line' ? '마이너스 통장' : t === 'bank_loan' ? '일반 대출' : '경락잔금대출';

  return (
    <div className="space-y-5 max-w-[1400px] mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">부채 관리</h1>
          <p className="text-gray-400 text-sm mt-0.5">대출 및 마이너스 통장 현황</p>
        </div>
        <button
          onClick={() => (isFormOpen ? resetForm() : setIsFormOpen(true))}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-all shadow-sm ${
            isFormOpen
              ? 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
              : 'bg-rose-500 text-white hover:bg-rose-600'
          }`}
        >
          {isFormOpen ? <X size={12} /> : <Plus size={12} />}
          {isFormOpen ? '취소' : '부채 등록'}
        </button>
      </div>

      {/* Summary row */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white rounded-xl border border-gray-200 px-5 py-4 shadow-sm">
          <p className="text-xs text-gray-500 font-medium">총 부채 잔액</p>
          <p className="text-xl font-bold text-rose-500 mt-1 tabular-nums">{formatKRW(totalPrincipal)}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 px-5 py-4 shadow-sm">
          <p className="text-xs text-gray-500 font-medium">월 총 이자 납입액</p>
          <p className="text-xl font-bold text-amber-600 mt-1 tabular-nums">{formatKRW(totalMonthlyInterest)}</p>
        </div>
      </div>

      {isFormOpen && (
        <div className="bg-white rounded-xl border border-rose-200 p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">{editingId ? '부채 수정' : '신규 부채 등록'}</h3>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <div className="space-y-1.5 md:col-span-2">
                <label className="text-xs font-medium text-gray-600">부채명</label>
                <input type="text" required className="w-full bg-gray-50 border border-gray-200 px-3 py-2 rounded-lg text-sm text-gray-900 outline-none focus:border-rose-400 focus:bg-white transition-colors" placeholder="예: 현대카드 카드론" value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-gray-600">금융기관</label>
                <input type="text" required className="w-full bg-gray-50 border border-gray-200 px-3 py-2 rounded-lg text-sm text-gray-900 outline-none focus:border-rose-400 focus:bg-white transition-colors" placeholder="예: 현대카드" value={formData.lender} onChange={e => setFormData({ ...formData, lender: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-gray-600">대출 종류</label>
                <select className="w-full bg-gray-50 border border-gray-200 px-3 py-2 rounded-lg text-sm text-gray-900 outline-none focus:border-rose-400 focus:bg-white transition-colors" value={formData.lenderType} onChange={e => setFormData({ ...formData, lenderType: e.target.value as LiabilityType })}>
                  <option value="credit_line">마이너스 통장</option>
                  <option value="bank_loan">일반 대출</option>
                  <option value="auction_settlement_loan">경락잔금대출</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-gray-600">잔액 (원)</label>
                <input type="number" required className="w-full bg-gray-50 border border-gray-200 px-3 py-2 rounded-lg text-sm text-gray-900 outline-none focus:border-rose-400 focus:bg-white transition-colors" placeholder="0" value={formData.principal} onChange={e => setFormData({ ...formData, principal: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 items-end">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-gray-600">금리 (%)</label>
                <input type="number" step="0.01" required className="w-full bg-gray-50 border border-gray-200 px-3 py-2 rounded-lg text-sm text-gray-900 outline-none focus:border-rose-400 focus:bg-white transition-colors" placeholder="0.00" value={formData.interestRate} onChange={e => setFormData({ ...formData, interestRate: e.target.value })} />
              </div>
              <div className="flex items-end">
                <button type="submit" className="w-full bg-rose-500 text-white px-4 py-2 rounded-lg text-xs font-semibold hover:bg-rose-600 transition-colors">
                  {editingId ? '수정 저장' : '저장'}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      <section className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-2.5">
          <div className="p-1.5 bg-rose-50 border border-rose-200 rounded-lg">
            <CreditCard className="text-rose-500" size={16} />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-gray-900">활성 부채 포트폴리오</h3>
            <p className="text-gray-400 text-xs mt-0.5">대출 및 신용 한도 현황</p>
          </div>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 text-gray-500 text-xs font-medium border-b border-gray-100">
              <th className="px-6 py-3 text-left">부채 내역</th>
              <th className="px-6 py-3 text-left">금융기관</th>
              <th className="px-6 py-3 text-right">금리</th>
              <th className="px-6 py-3 text-right">월 이자</th>
              <th className="px-6 py-3 text-right">잔액</th>
              <th className="px-4 py-3 w-16"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {store.liabilities.length === 0 ? (
              <tr><td colSpan={6} className="px-6 py-8 text-center text-xs text-gray-400">등록된 부채가 없습니다.</td></tr>
            ) : (
              store.liabilities.map((liability) => (
                <tr key={liability.id} className="group hover:bg-gray-50 transition-colors">
                  <td className="px-6 py-3.5">
                    <p className="text-gray-800 font-medium">{liability.name}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{lenderTypeLabel(liability.lenderType)}</p>
                  </td>
                  <td className="px-6 py-3.5 text-gray-600">{liability.lender}</td>
                  <td className="px-6 py-3.5 text-right">
                    <div className="flex items-center justify-end gap-1 text-rose-500 font-semibold">
                      <Percent size={12} />{liability.interestRate}%
                    </div>
                  </td>
                  <td className="px-6 py-3.5 text-right text-gray-600 tabular-nums">{formatKRW(liability.monthlyInterest)}</td>
                  <td className="px-6 py-3.5 text-right font-semibold text-rose-500 tabular-nums">{formatKRW(liability.principal)}</td>
                  <td className="px-4 py-3.5">
                    <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => handleEdit(liability)} className="p-1 text-gray-400 hover:text-blue-500 transition-colors"><Pencil size={14} /></button>
                      <button onClick={() => handleDelete(liability.id)} className="p-1 text-gray-400 hover:text-rose-500 transition-colors"><Trash2 size={14} /></button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>

      <section className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
        <div className="flex items-center gap-2 mb-4">
          <AlertTriangle size={16} className="text-amber-500" />
          <h3 className="text-sm font-semibold text-gray-900">다음 납입 예정</h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {store.liabilities.map((liability) => (
            <div key={liability.id} className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-200 hover:border-gray-300 transition-colors">
              <div>
                <p className="text-sm text-gray-800 font-medium">{liability.name}</p>
                <p className="text-xs text-gray-400 mt-0.5">연 {liability.interestRate}% 적용</p>
              </div>
              <div className="text-right">
                <p className="text-sm font-semibold text-amber-600 tabular-nums">{formatKRW(liability.monthlyInterest)}</p>
                <p className="text-xs text-gray-400 mt-0.5">월 이자</p>
              </div>
            </div>
          ))}
          {store.liabilities.length === 0 && (
            <p className="text-xs text-gray-400 col-span-2 text-center py-4">등록된 부채가 없습니다.</p>
          )}
        </div>
      </section>
    </div>
  );
}
