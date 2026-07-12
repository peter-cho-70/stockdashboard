'use client';

import { useFinanceStore } from '@/lib/finance/store/finance-store';
import {
  Plus, Wallet, Briefcase, Building2, History, Trash2, Pencil, X,
  RefreshCw, Landmark, Check, AlertCircle, Zap,
} from 'lucide-react';
import { useEffect, useState, useCallback } from 'react';
import { CashAccountType, CashAsset, CashSyncSource, IlliquidAsset, RealEstateAsset, RealEstateType, RealEstateValuation } from '@/lib/finance/types';
import { detectSecuritiesOverlap, securitiesOverlapMessage } from '@/lib/finance/asset-warnings';
import { api } from '@/lib/api';

type SyncStatus = 'idle' | 'loading' | 'done' | 'error';

function SyncBadge({ source }: { source?: CashSyncSource }) {
  if (!source || source === 'manual') return null;
  const labels: Record<CashSyncSource, string> = {
    manual: '',
    openbanking: '오픈뱅킹',
    kis_deposit: 'KIS',
    kiwoom_deposit: '키움',
  };
  const colors: Record<CashSyncSource, string> = {
    manual: '',
    openbanking: 'text-blue-600 bg-blue-50 border-blue-200',
    kis_deposit: 'text-indigo-600 bg-indigo-50 border-indigo-200',
    kiwoom_deposit: 'text-purple-600 bg-purple-50 border-purple-200',
  };
  return (
    <span className={`ml-1.5 text-[10px] font-semibold px-1.5 py-0.5 rounded border ${colors[source]}`}>
      {labels[source]}
    </span>
  );
}

export default function AssetsPage() {
  const store = useFinanceStore();
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({ name: '', institution: '', accountType: 'securities' as CashAccountType, amount: '' });

  const [isIlliquidFormOpen, setIsIlliquidFormOpen] = useState(false);
  const [editingIlliquidId, setEditingIlliquidId] = useState<string | null>(null);
  const [illiquidFormData, setIlliquidFormData] = useState({ name: '', amount: '' });

  const [isREFormOpen, setIsREFormOpen] = useState(false);
  const [editingREId, setEditingREId] = useState<string | null>(null);
  const [reFormData, setREFormData] = useState({
    name: '',
    address: '',
    realEstateType: 'apartment' as RealEstateType,
    officialPrice: '',
    marketPrice: '',
    valuationType: 'market' as RealEstateValuation,
  });

  // 동기화 상태
  const [brokerSyncStatus, setBrokerSyncStatus] = useState<SyncStatus>('idle');
  const [brokerSyncMsg, setBrokerSyncMsg] = useState('');

  // 페이지 진입 시 브로커 예수금 자동 동기화 (설정된 경우)
  const syncBroker = useCallback(async (silent = false) => {
    if (!silent) setBrokerSyncStatus('loading');
    try {
      const result = await api.syncBrokerDeposits();
      if (result.updated > 0 || result.added > 0) {
        await store.load();
        if (!silent) {
          setBrokerSyncStatus('done');
          setBrokerSyncMsg(`예수금 동기화 완료 (업데이트 ${result.updated}건, 신규 ${result.added}건)`);
        }
      } else {
        if (!silent) {
          setBrokerSyncStatus('done');
          setBrokerSyncMsg('변경사항 없음');
        }
      }
    } catch {
      if (!silent) {
        setBrokerSyncStatus('error');
        setBrokerSyncMsg('브로커 API 미설정 또는 연결 실패');
      }
    } finally {
      if (!silent) setTimeout(() => setBrokerSyncStatus('idle'), 3000);
    }
  }, [store]);

  // 페이지 진입 시 자동 실행 (silent)
  useEffect(() => {
    syncBroker(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name || !formData.amount) return;

    const amount = Number(formData.amount);
    if (formData.accountType === 'securities') {
      const breakdown = store.getAssetBreakdown();
      const projectedSecurities =
        (editingId
          ? store.cashAssets.filter((a) => a.id !== editingId && a.accountType === 'securities')
          : store.cashAssets.filter((a) => a.accountType === 'securities')
        ).reduce((s, a) => s + a.amount, 0) + amount;
      const overlap = detectSecuritiesOverlap(projectedSecurities, breakdown.stockHoldings);
      if (overlap && !confirm(`${securitiesOverlapMessage(overlap)}\n\n그래도 저장하시겠습니까?`)) {
        return;
      }
    }

    if (editingId) {
      store.updateCashAsset(editingId, {
        name: formData.name,
        institution: formData.institution || '기타',
        accountType: formData.accountType,
        amount,
        updatedAt: new Date().toISOString(),
      });
    } else {
      store.addCashAsset({
        id: crypto.randomUUID(),
        name: formData.name,
        institution: formData.institution || '기타',
        accountType: formData.accountType,
        amount,
        updatedAt: new Date().toISOString(),
        syncSource: 'manual',
      });
    }
    resetForm();
  };

  const handleEdit = (asset: CashAsset) => {
    const accountType: CashAccountType =
      asset.accountType ??
      (/증권/.test(`${asset.name}${asset.institution}`) ? 'securities' : 'bank');
    setFormData({
      name: asset.name,
      institution: asset.institution,
      accountType,
      amount: asset.amount.toString(),
    });
    setEditingId(asset.id);
    setIsFormOpen(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDelete = (id: string) => {
    if (confirm('이 자산 항목을 삭제하시겠습니까?')) {
      store.deleteCashAsset(id);
      if (editingId === id) resetForm();
    }
  };

  const resetForm = () => {
    setFormData({ name: '', institution: '', accountType: 'securities', amount: '' });
    setEditingId(null);
    setIsFormOpen(false);
  };

  const handleIlliquidSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!illiquidFormData.name || !illiquidFormData.amount) return;
    if (editingIlliquidId) {
      store.updateIlliquidAsset(editingIlliquidId, {
        name: illiquidFormData.name,
        amount: Number(illiquidFormData.amount),
        updatedAt: new Date().toISOString(),
      });
    } else {
      store.addIlliquidAsset({
        id: crypto.randomUUID(),
        name: illiquidFormData.name,
        amount: Number(illiquidFormData.amount),
        isStatic: true,
        updatedAt: new Date().toISOString(),
      });
    }
    resetIlliquidForm();
  };

  const handleIlliquidEdit = (asset: IlliquidAsset) => {
    setIlliquidFormData({ name: asset.name, amount: asset.amount.toString() });
    setEditingIlliquidId(asset.id);
    setIsIlliquidFormOpen(true);
  };

  const handleIlliquidDelete = (id: string) => {
    if (confirm('이 비유동 자산을 삭제하시겠습니까?')) {
      store.deleteIlliquidAsset(id);
      if (editingIlliquidId === id) resetIlliquidForm();
    }
  };

  const resetIlliquidForm = () => {
    setIlliquidFormData({ name: '', amount: '' });
    setEditingIlliquidId(null);
    setIsIlliquidFormOpen(false);
  };

  const handleRESubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!reFormData.name || !reFormData.officialPrice || !reFormData.marketPrice) return;
    const officialPrice = Number(reFormData.officialPrice);
    const marketPrice = Number(reFormData.marketPrice);
    const estimatedValue = reFormData.valuationType === 'official' ? officialPrice : marketPrice;
    if (editingREId) {
      store.updateRealEstateAsset(editingREId, {
        name: reFormData.name,
        address: reFormData.address || undefined,
        realEstateType: reFormData.realEstateType,
        officialPrice,
        marketPrice,
        valuationType: reFormData.valuationType,
        estimatedValue,
        updatedAt: new Date().toISOString(),
      });
    } else {
      store.addRealEstateAsset({
        id: crypto.randomUUID(),
        name: reFormData.name,
        address: reFormData.address || undefined,
        realEstateType: reFormData.realEstateType,
        source: 'manual',
        officialPrice,
        marketPrice,
        valuationType: reFormData.valuationType,
        estimatedValue,
        acquisitionCost: 0,
        updatedAt: new Date().toISOString(),
      });
    }
    resetREForm();
  };

  const handleREEdit = (asset: RealEstateAsset) => {
    setREFormData({
      name: asset.name,
      address: asset.address ?? '',
      realEstateType: asset.realEstateType,
      officialPrice: asset.officialPrice.toString(),
      marketPrice: asset.marketPrice.toString(),
      valuationType: asset.valuationType,
    });
    setEditingREId(asset.id);
    setIsREFormOpen(true);
  };

  const handleREDelete = (id: string) => {
    if (confirm('이 부동산 자산을 삭제하시겠습니까?')) {
      store.deleteRealEstateAsset(id);
      if (editingREId === id) resetREForm();
    }
  };

  const resetREForm = () => {
    setREFormData({ name: '', address: '', realEstateType: 'apartment', officialPrice: '', marketPrice: '', valuationType: 'market' });
    setEditingREId(null);
    setIsREFormOpen(false);
  };

  const realEstateTypeLabel = (t: RealEstateType) =>
    ({ apartment: '아파트', land: '토지', building: '건물', commercial: '상가', other: '기타' })[t] ?? t;

  const formatKRW = (amount: number) =>
    new Intl.NumberFormat('ko-KR', { style: 'currency', currency: 'KRW' }).format(amount);

  const totalCash = store.cashAssets.reduce((s, a) => s + a.amount, 0);
  const securitiesAssets = store.cashAssets.filter((a) => a.accountType === 'securities');
  const bankAssets = store.cashAssets.filter((a) => a.accountType !== 'securities');
  const totalSecurities = securitiesAssets.reduce((s, a) => s + a.amount, 0);
  const totalBank = bankAssets.reduce((s, a) => s + a.amount, 0);
  const totalIlliquid = store.illiquidAssets.reduce((s, a) => s + a.amount, 0);
  const totalRealEstate = store.realEstateAssets.reduce((s, a) => s + a.estimatedValue, 0);
  const assetBreakdown = store.getAssetBreakdown();
  const securitiesOverlap = detectSecuritiesOverlap(
    assetBreakdown.securitiesCash,
    assetBreakdown.stockHoldings
  );

  // 은행별 그룹핑
  const bankGroups = bankAssets.reduce<Record<string, CashAsset[]>>((acc, a) => {
    const key = a.institution || '기타';
    if (!acc[key]) acc[key] = [];
    acc[key].push(a);
    return acc;
  }, {});

  return (
    <div className="space-y-5 max-w-[1400px] mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">자산 관리</h1>
          <p className="text-gray-400 text-sm mt-0.5">유동 자산 및 비유동 투자 자산 현황</p>
        </div>
        <div className="flex items-center gap-2">
          {/* 동기화 버튼 */}
          <button
            onClick={() => syncBroker(false)}
            disabled={brokerSyncStatus === 'loading'}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-all border ${
              brokerSyncStatus === 'done'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                : brokerSyncStatus === 'error'
                ? 'bg-rose-50 border-rose-200 text-rose-600'
                : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
            } disabled:opacity-60`}
            title="KIS/키움/오픈뱅킹 잔액 동기화"
          >
            {brokerSyncStatus === 'loading' ? (
              <RefreshCw size={12} className="animate-spin" />
            ) : brokerSyncStatus === 'done' ? (
              <Check size={12} />
            ) : brokerSyncStatus === 'error' ? (
              <AlertCircle size={12} />
            ) : (
              <Zap size={12} />
            )}
            {brokerSyncStatus === 'loading' ? '동기화 중…' : brokerSyncStatus === 'done' ? '완료' : brokerSyncStatus === 'error' ? '실패' : '자동 동기화'}
          </button>
          {brokerSyncMsg && brokerSyncStatus !== 'idle' && (
            <span className="text-xs text-gray-400">{brokerSyncMsg}</span>
          )}
          <button
            onClick={() => (isFormOpen ? resetForm() : setIsFormOpen(true))}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-all shadow-sm ${
              isFormOpen
                ? 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
                : 'bg-emerald-600 text-white hover:bg-emerald-500'
            }`}
          >
            {isFormOpen ? <X size={12} /> : <Plus size={12} />}
            {isFormOpen ? '취소' : '자산 등록'}
          </button>
        </div>
      </div>

      {securitiesOverlap && (
        <div className="flex items-start gap-2 px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg text-sm">
          <AlertCircle size={14} className="text-amber-600 shrink-0 mt-0.5" />
          <p className="text-amber-800 text-xs">{securitiesOverlapMessage(securitiesOverlap)}</p>
        </div>
      )}

      {isFormOpen && (
        <div className="bg-white rounded-xl border border-emerald-200 p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">
            {editingId ? '자산 수정' : '신규 유동 자산 등록'}
          </h3>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-gray-600">자산명</label>
              <input
                type="text"
                required
                className="w-full bg-gray-50 border border-gray-200 px-3 py-2 rounded-lg text-sm text-gray-900 outline-none focus:border-emerald-400 focus:bg-white transition-colors"
                placeholder="예: 기업은행 입출금"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-gray-600">계좌 유형</label>
              <select
                className="w-full bg-gray-50 border border-gray-200 px-3 py-2 rounded-lg text-sm text-gray-900 outline-none focus:border-emerald-400 focus:bg-white transition-colors"
                value={formData.accountType}
                onChange={(e) => setFormData({ ...formData, accountType: e.target.value as CashAccountType })}
              >
                <option value="securities">증권사</option>
                <option value="bank">은행</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-gray-600">금융기관</label>
              <input
                type="text"
                className="w-full bg-gray-50 border border-gray-200 px-3 py-2 rounded-lg text-sm text-gray-900 outline-none focus:border-emerald-400 focus:bg-white transition-colors"
                placeholder="예: 기업은행"
                value={formData.institution}
                onChange={(e) => setFormData({ ...formData, institution: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-gray-600">금액 (원)</label>
              <input
                type="number"
                required
                className="w-full bg-gray-50 border border-gray-200 px-3 py-2 rounded-lg text-sm text-gray-900 outline-none focus:border-emerald-400 focus:bg-white transition-colors"
                placeholder="0"
                value={formData.amount}
                onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
              />
            </div>
            <button
              type="submit"
              className="bg-emerald-600 text-white px-4 py-2 rounded-lg text-xs font-semibold hover:bg-emerald-500 transition-colors"
            >
              {editingId ? '수정 저장' : '저장'}
            </button>
          </form>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4">
        {/* Cash Assets */}
        <section className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="p-1.5 bg-emerald-50 border border-emerald-200 rounded-lg">
                <Wallet className="text-emerald-600" size={16} />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-gray-900">유동 자산</h3>
                <p className="text-gray-400 text-xs mt-0.5">
                  증권사·은행 계좌 현황 · StockMind 연동 시 증권 계좌에는 예수금만 입력
                </p>
              </div>
            </div>
            <span className="text-emerald-600 font-semibold text-sm">{formatKRW(totalCash)}</span>
          </div>

          {/* 증권사 계좌 */}
          {securitiesAssets.length > 0 && (
            <div>
              <div className="px-6 py-2 bg-blue-50/60 border-b border-blue-100 flex items-center justify-between">
                <span className="text-[11px] font-semibold text-blue-700 flex items-center gap-1.5">
                  <Wallet size={11} />
                  증권사 계좌
                </span>
                <span className="text-[11px] font-semibold text-blue-700">{formatKRW(totalSecurities)}</span>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-gray-500 text-xs font-medium border-b border-gray-100">
                    <th className="px-6 py-2.5 text-left">자산명</th>
                    <th className="px-6 py-2.5 text-left">금융기관</th>
                    <th className="px-6 py-2.5 text-right">금액</th>
                    <th className="px-6 py-2.5 text-right">최근 업데이트</th>
                    <th className="px-4 py-2.5 w-16"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {securitiesAssets.map((asset) => (
                    <CashAssetRow key={asset.id} asset={asset} formatKRW={formatKRW} onEdit={handleEdit} onDelete={handleDelete} />
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* 은행 계좌 — 기관별 그룹핑 */}
          {bankAssets.length > 0 && (
            <div>
              <div className="px-6 py-2 bg-emerald-50/60 border-b border-emerald-100 flex items-center justify-between">
                <span className="text-[11px] font-semibold text-emerald-700 flex items-center gap-1.5">
                  <Landmark size={11} />
                  은행 계좌
                </span>
                <span className="text-[11px] font-semibold text-emerald-700">{formatKRW(totalBank)}</span>
              </div>
              {Object.entries(bankGroups).map(([bankName, assets]) => {
                const bankTotal = assets.reduce((s, a) => s + a.amount, 0);
                return (
                  <div key={bankName}>
                    <div className="px-6 py-1.5 bg-gray-50/80 border-b border-gray-100 flex items-center justify-between">
                      <span className="text-[11px] font-semibold text-gray-600 flex items-center gap-1">
                        <Building2 size={10} className="text-gray-400" />
                        {bankName}
                      </span>
                      <span className="text-[11px] text-gray-500">{formatKRW(bankTotal)}</span>
                    </div>
                    <table className="w-full text-sm">
                      <tbody className="divide-y divide-gray-100">
                        {assets.map((asset) => (
                          <CashAssetRow key={asset.id} asset={asset} formatKRW={formatKRW} onEdit={handleEdit} onDelete={handleDelete} />
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              })}
            </div>
          )}

          {store.cashAssets.length === 0 && (
            <div className="px-6 py-8 text-center text-xs text-gray-400">
              등록된 자산이 없습니다. 위 버튼으로 추가하거나 오픈뱅킹/브로커를 연동하세요.
            </div>
          )}
        </section>

        {/* Illiquid Assets */}
        <section className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="p-1.5 bg-gray-100 border border-gray-200 rounded-lg">
                <Briefcase className="text-gray-500" size={16} />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-gray-900">비유동 자산</h3>
                <p className="text-gray-400 text-xs mt-0.5">부동산·비상장 투자 (고정 자산)</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-gray-600 font-semibold text-sm">{formatKRW(totalIlliquid)}</span>
              <button
                onClick={() => (isIlliquidFormOpen ? resetIlliquidForm() : setIsIlliquidFormOpen(true))}
                className={`flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md transition-all ${
                  isIlliquidFormOpen
                    ? 'bg-white border border-gray-200 text-gray-500 hover:bg-gray-50'
                    : 'bg-gray-100 border border-gray-200 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {isIlliquidFormOpen ? <X size={11} /> : <Plus size={11} />}
                {isIlliquidFormOpen ? '취소' : '추가'}
              </button>
            </div>
          </div>

          {isIlliquidFormOpen && (
            <div className="px-6 py-4 border-b border-gray-100 bg-gray-50">
              <form onSubmit={handleIlliquidSubmit} className="flex items-end gap-3">
                <div className="space-y-1.5 flex-1">
                  <label className="text-xs font-medium text-gray-600">자산명</label>
                  <input
                    type="text"
                    required
                    autoFocus
                    className="w-full bg-white border border-gray-200 px-3 py-2 rounded-lg text-sm text-gray-900 outline-none focus:border-gray-400 transition-colors"
                    placeholder="예: 강남 오피스텔"
                    value={illiquidFormData.name}
                    onChange={(e) => setIlliquidFormData({ ...illiquidFormData, name: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5 w-48">
                  <label className="text-xs font-medium text-gray-600">평가 금액 (원)</label>
                  <input
                    type="number"
                    required
                    className="w-full bg-white border border-gray-200 px-3 py-2 rounded-lg text-sm text-gray-900 outline-none focus:border-gray-400 transition-colors"
                    placeholder="0"
                    value={illiquidFormData.amount}
                    onChange={(e) => setIlliquidFormData({ ...illiquidFormData, amount: e.target.value })}
                  />
                </div>
                <button
                  type="submit"
                  className="bg-gray-800 text-white px-4 py-2 rounded-lg text-xs font-semibold hover:bg-gray-700 transition-colors whitespace-nowrap"
                >
                  {editingIlliquidId ? '수정 저장' : '저장'}
                </button>
              </form>
            </div>
          )}

          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-gray-500 text-xs font-medium border-b border-gray-100">
                <th className="px-6 py-3 text-left">자산 항목</th>
                <th className="px-6 py-3 text-right">평가 금액</th>
                <th className="px-6 py-3 text-right">구분</th>
                <th className="px-4 py-3 w-16"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {store.illiquidAssets.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-6 py-8 text-center text-xs text-gray-400">
                    등록된 비유동 자산이 없습니다.
                  </td>
                </tr>
              ) : (
                store.illiquidAssets.map((asset) => (
                  <tr key={asset.id} className="group hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-3.5 text-gray-800 font-medium">{asset.name}</td>
                    <td className="px-6 py-3.5 text-right font-semibold text-gray-800 tabular-nums">
                      {formatKRW(asset.amount)}
                    </td>
                    <td className="px-6 py-3.5 text-right">
                      <span className="text-[11px] font-medium text-gray-500 bg-gray-100 px-2 py-0.5 rounded border border-gray-200">
                        고정 자산
                      </span>
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => handleIlliquidEdit(asset)}
                          className="p-1 text-gray-400 hover:text-blue-500 transition-colors"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          onClick={() => handleIlliquidDelete(asset.id)}
                          className="p-1 text-gray-400 hover:text-rose-500 transition-colors"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </section>

        {/* Real Estate Assets */}
        <section className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="p-1.5 bg-amber-50 border border-amber-200 rounded-lg">
                <Building2 className="text-amber-600" size={16} />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-gray-900">부동산 자산</h3>
                <p className="text-gray-400 text-xs mt-0.5">토지·건물·아파트·상가 등</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-amber-600 font-semibold text-sm">{formatKRW(totalRealEstate)}</span>
              <button
                onClick={() => (isREFormOpen ? resetREForm() : setIsREFormOpen(true))}
                className={`flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md transition-all ${
                  isREFormOpen
                    ? 'bg-white border border-gray-200 text-gray-500 hover:bg-gray-50'
                    : 'bg-amber-50 border border-amber-200 text-amber-600 hover:bg-amber-100'
                }`}
              >
                {isREFormOpen ? <X size={11} /> : <Plus size={11} />}
                {isREFormOpen ? '취소' : '추가'}
              </button>
            </div>
          </div>

          {isREFormOpen && (
            <div className="px-6 py-4 border-b border-gray-100 bg-gray-50">
              <h4 className="text-xs font-semibold text-gray-700 mb-3">{editingREId ? '부동산 자산 수정' : '신규 부동산 자산 등록'}</h4>
              <form onSubmit={handleRESubmit} className="space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                  <div className="space-y-1.5 md:col-span-2">
                    <label className="text-xs font-medium text-gray-600">자산명</label>
                    <input
                      type="text" required autoFocus
                      className="w-full bg-white border border-gray-200 px-3 py-2 rounded-lg text-sm text-gray-900 outline-none focus:border-amber-400 transition-colors"
                      placeholder="예: 서울 강남 아파트"
                      value={reFormData.name}
                      onChange={e => setREFormData({ ...reFormData, name: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-gray-600">유형</label>
                    <select
                      className="w-full bg-white border border-gray-200 px-3 py-2 rounded-lg text-sm text-gray-900 outline-none focus:border-amber-400 transition-colors"
                      value={reFormData.realEstateType}
                      onChange={e => setREFormData({ ...reFormData, realEstateType: e.target.value as RealEstateType })}
                    >
                      <option value="apartment">아파트</option>
                      <option value="land">토지</option>
                      <option value="building">건물</option>
                      <option value="commercial">상가</option>
                      <option value="other">기타</option>
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-gray-600">주소 (선택)</label>
                    <input
                      type="text"
                      className="w-full bg-white border border-gray-200 px-3 py-2 rounded-lg text-sm text-gray-900 outline-none focus:border-amber-400 transition-colors"
                      placeholder="예: 서울시 강남구..."
                      value={reFormData.address}
                      onChange={e => setREFormData({ ...reFormData, address: e.target.value })}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-gray-600">공시지가 (원)</label>
                    <input
                      type="number" required
                      className="w-full bg-white border border-gray-200 px-3 py-2 rounded-lg text-sm text-gray-900 outline-none focus:border-amber-400 transition-colors"
                      placeholder="0"
                      value={reFormData.officialPrice}
                      onChange={e => setREFormData({ ...reFormData, officialPrice: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-gray-600">실거래가 (원)</label>
                    <input
                      type="number" required
                      className="w-full bg-white border border-gray-200 px-3 py-2 rounded-lg text-sm text-gray-900 outline-none focus:border-amber-400 transition-colors"
                      placeholder="0"
                      value={reFormData.marketPrice}
                      onChange={e => setREFormData({ ...reFormData, marketPrice: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-gray-600">자산화 기준</label>
                    <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs font-medium h-[38px]">
                      <button
                        type="button"
                        onClick={() => setREFormData({ ...reFormData, valuationType: 'official' })}
                        className={`flex-1 transition-colors ${reFormData.valuationType === 'official' ? 'bg-amber-500 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}
                      >
                        공시지가
                      </button>
                      <button
                        type="button"
                        onClick={() => setREFormData({ ...reFormData, valuationType: 'market' })}
                        className={`flex-1 border-l border-gray-200 transition-colors ${reFormData.valuationType === 'market' ? 'bg-amber-500 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}
                      >
                        실거래가
                      </button>
                    </div>
                  </div>
                  <div>
                    <button type="submit" className="w-full bg-amber-500 text-white px-4 py-2 rounded-lg text-xs font-semibold hover:bg-amber-600 transition-colors">
                      {editingREId ? '수정 저장' : '저장'}
                    </button>
                  </div>
                </div>
              </form>
            </div>
          )}

          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-gray-500 text-xs font-medium border-b border-gray-100">
                <th className="px-6 py-3 text-left">자산 항목</th>
                <th className="px-6 py-3 text-right">공시지가</th>
                <th className="px-6 py-3 text-right">실거래가</th>
                <th className="px-6 py-3 text-center">자산화 기준</th>
                <th className="px-6 py-3 text-right">적용 금액</th>
                <th className="px-4 py-3 w-16"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {store.realEstateAssets.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-xs text-gray-400">
                    등록된 부동산 자산이 없습니다.
                  </td>
                </tr>
              ) : (
                store.realEstateAssets.map((asset) => (
                  <tr key={asset.id} className="group hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-3.5">
                      <div className="flex items-center gap-2">
                        <span className="text-gray-800 font-medium">{asset.name}</span>
                        <span className="text-[11px] font-medium text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200">
                          {realEstateTypeLabel(asset.realEstateType)}
                        </span>
                      </div>
                      {asset.address && <p className="text-xs text-gray-400 mt-0.5">{asset.address}</p>}
                    </td>
                    <td className="px-6 py-3.5 text-right text-gray-500 tabular-nums text-xs">
                      {formatKRW(asset.officialPrice)}
                    </td>
                    <td className="px-6 py-3.5 text-right text-gray-500 tabular-nums text-xs">
                      {formatKRW(asset.marketPrice)}
                    </td>
                    <td className="px-6 py-3.5">
                      <div className="flex justify-center">
                        <div className="flex rounded-lg border border-gray-200 overflow-hidden text-[11px] font-medium">
                          <button
                            onClick={() => store.toggleRealEstateValuation(asset.id, 'official')}
                            className={`px-2.5 py-1 transition-colors ${asset.valuationType === 'official' ? 'bg-amber-500 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}
                          >
                            공시
                          </button>
                          <button
                            onClick={() => store.toggleRealEstateValuation(asset.id, 'market')}
                            className={`px-2.5 py-1 border-l border-gray-200 transition-colors ${asset.valuationType === 'market' ? 'bg-amber-500 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}
                          >
                            실거래
                          </button>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-3.5 text-right font-bold text-amber-600 tabular-nums">
                      {formatKRW(asset.estimatedValue)}
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => handleREEdit(asset)} className="p-1 text-gray-400 hover:text-blue-500 transition-colors">
                          <Pencil size={14} />
                        </button>
                        <button onClick={() => handleREDelete(asset.id)} className="p-1 text-gray-400 hover:text-rose-500 transition-colors">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}

interface CashAssetRowProps {
  asset: CashAsset;
  formatKRW: (amount: number) => string;
  onEdit: (asset: CashAsset) => void;
  onDelete: (id: string) => void;
}

function CashAssetRow({ asset, formatKRW, onEdit, onDelete }: CashAssetRowProps) {
  return (
    <tr className="group hover:bg-gray-50 transition-colors">
      <td className="px-6 py-3.5">
        <div className="flex items-center">
          <span className="text-gray-800 font-medium">{asset.name}</span>
          <SyncBadge source={asset.syncSource} />
        </div>
      </td>
      <td className="px-6 py-3.5">
        <span className="text-[11px] font-medium text-gray-500 bg-gray-100 px-2 py-0.5 rounded border border-gray-200">
          {asset.institution}
        </span>
      </td>
      <td className="px-6 py-3.5 text-right font-semibold text-gray-800 tabular-nums">
        {formatKRW(asset.amount)}
      </td>
      <td className="px-6 py-3.5 text-right">
        <div className="flex items-center justify-end gap-1.5 text-gray-400">
          <History size={11} />
          <span className="text-xs">{new Date(asset.updatedAt).toLocaleDateString('ko-KR')}</span>
        </div>
      </td>
      <td className="px-4 py-3.5">
        <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {(!asset.syncSource || asset.syncSource === 'manual') && (
            <button onClick={() => onEdit(asset)} className="p-1 text-gray-400 hover:text-blue-500 transition-colors">
              <Pencil size={14} />
            </button>
          )}
          <button onClick={() => onDelete(asset.id)} className="p-1 text-gray-400 hover:text-rose-500 transition-colors">
            <Trash2 size={14} />
          </button>
        </div>
      </td>
    </tr>
  );
}
