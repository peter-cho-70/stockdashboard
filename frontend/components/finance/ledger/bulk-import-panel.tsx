'use client';

import { useMemo, useState } from 'react';
import { X, ClipboardList } from 'lucide-react';
import { parseBulkLedgerText } from '@/lib/finance/parse-bulk-transactions';
import type { PaymentMethod, Transaction } from '@/lib/finance/types';

const SAMPLE_PLACEHOLDER = `사용일06.19.
씨유논현성원점
8,300원
사용시간17:07
사용일06.17.
씨유논현성원점
3,400원
사용시간17:15`;

interface BulkImportPanelProps {
  expenseCategories: string[];
  cardIssuers: string[];
  users: string[];
  onImport: (items: Transaction[]) => void;
  onClose: () => void;
}

export function BulkImportPanel({
  expenseCategories, cardIssuers, users, onImport, onClose,
}: BulkImportPanelProps) {
  const [text, setText] = useState('');
  const [category, setCategory] = useState(expenseCategories[0] || '');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('credit_card');
  const [cardIssuer, setCardIssuer] = useState('');
  const [user, setUser] = useState('');

  const year = new Date().getFullYear();
  const parsed = useMemo(() => parseBulkLedgerText(text, year), [text, year]);
  const total = parsed.reduce((s, p) => s + p.amount, 0);

  function handleImport() {
    if (parsed.length === 0) return;
    const now = new Date().toISOString();
    const items: Transaction[] = parsed.map((p, i) => ({
      id: `t${Date.now()}${i}`,
      date: p.date,
      amount: p.amount,
      type: 'expense',
      category,
      paymentMethod,
      cardIssuer: paymentMethod === 'credit_card' || paymentMethod === 'check_card' ? (cardIssuer || undefined) : undefined,
      memo: p.memo,
      isFixed: false,
      user: user || undefined,
      createdAt: now,
    }));
    onImport(items);
    setText('');
  }

  return (
    <div className="bg-white rounded-xl border border-blue-200 p-5 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5">
          <ClipboardList size={14} className="text-blue-600" />
          텍스트 일괄 추가
        </h2>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={14} /></button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label className="block text-xs text-gray-500">
            카드사 결제 알림 내역 붙여넣기 ({year}년 기준으로 날짜 해석)
          </label>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={SAMPLE_PLACEHOLDER}
            rows={10}
            className="w-full px-3 py-2 text-xs font-mono border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-400 resize-y"
          />
        </div>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">카테고리 (전체 적용)</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white"
              >
                {expenseCategories.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">결제수단 (전체 적용)</label>
              <select
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white"
              >
                <option value="credit_card">신용카드</option>
                <option value="check_card">체크카드</option>
                <option value="bank_transfer">계좌이체</option>
                <option value="cash">현금</option>
              </select>
            </div>
            {(paymentMethod === 'credit_card' || paymentMethod === 'check_card') && (
              <div>
                <label className="block text-xs text-gray-500 mb-1">카드사 (전체 적용)</label>
                <select
                  value={cardIssuer}
                  onChange={(e) => setCardIssuer(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white"
                >
                  <option value="">선택 안함</option>
                  {cardIssuers.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label className="block text-xs text-gray-500 mb-1">사용자 (전체 적용)</label>
              <select
                value={user}
                onChange={(e) => setUser(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white"
              >
                <option value="">공통</option>
                {users.map((u) => (
                  <option key={u} value={u}>{u}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="border border-gray-100 rounded-md bg-gray-50 max-h-40 overflow-y-auto">
            {parsed.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-6">
                텍스트를 붙여넣으면 인식된 거래가 여기에 표시됩니다.
              </p>
            ) : (
              <div className="divide-y divide-gray-100">
                {parsed.map((p, i) => (
                  <div key={i} className="flex items-center justify-between px-3 py-1.5 text-xs">
                    <span className="text-gray-400 shrink-0 w-14">{p.date.slice(5)}</span>
                    <span className="text-gray-700 truncate flex-1 mx-2">{p.memo}</span>
                    <span className="text-gray-800 font-medium shrink-0">{p.amount.toLocaleString('ko-KR')}원</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between text-xs text-gray-500">
            <span>{parsed.length}건 인식됨</span>
            <span className="font-semibold text-gray-700">합계 {total.toLocaleString('ko-KR')}원</span>
          </div>

          <div className="flex justify-end gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-md hover:bg-gray-50 transition-all"
            >
              취소
            </button>
            <button
              onClick={handleImport}
              disabled={parsed.length === 0}
              className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-40 transition-all"
            >
              {parsed.length}건 가져오기
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
