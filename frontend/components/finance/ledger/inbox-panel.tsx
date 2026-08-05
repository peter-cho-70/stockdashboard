'use client';

import { useState } from 'react';
import { X, Inbox as InboxIcon, Check, Trash2, Smartphone } from 'lucide-react';
import type { CategoryInfo, Liability, PaymentMethod, TransactionType } from '@/lib/finance/types';
import type { LedgerInboxItem } from '@/lib/api';

interface LedgerInboxPanelProps {
  items: LedgerInboxItem[];
  categories: CategoryInfo[];
  cardIssuers: string[];
  users: string[];
  liabilities: Liability[];
  onCommit: (item: LedgerInboxItem) => void;
  onDiscard: (id: string) => void;
  onClose: () => void;
}

export function LedgerInboxPanel({
  items, categories, cardIssuers, users, liabilities, onCommit, onDiscard, onClose,
}: LedgerInboxPanelProps) {
  return (
    <div className="bg-white rounded-xl border border-emerald-200 p-5 shadow-sm">
      <div className="flex items-center justify-between mb-1.5">
        <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5">
          <InboxIcon size={14} className="text-emerald-600" />
          모바일 받은상자
          {items.length > 0 && <span className="text-emerald-600">({items.length}건)</span>}
        </h2>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={14} /></button>
      </div>
      <p className="mb-4 text-[11px] text-gray-400 flex items-center gap-1">
        <Smartphone size={11} />
        폰에서 &quot;가계부 빠른입력&quot;(/mobile/ledger)으로 보낸 항목입니다. 내용을 확인·수정한 뒤 가계부에 추가하세요.
      </p>

      {items.length === 0 ? (
        <p className="text-xs text-gray-400 text-center py-8">
          받은 항목이 없습니다.
        </p>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <InboxItemRow
              key={item.id}
              item={item}
              categories={categories}
              cardIssuers={cardIssuers}
              users={users}
              liabilities={liabilities}
              onCommit={onCommit}
              onDiscard={onDiscard}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface EditedDraft {
  date: string;
  amount: string;
  type: TransactionType;
  category: string;
  subCategory: string;
  paymentMethod: PaymentMethod;
  cardIssuer: string;
  memo: string;
  isFixed: boolean;
  user: string;
  linkedLiabilityId: string;
}

function InboxItemRow({
  item, categories, cardIssuers, users, liabilities, onCommit, onDiscard,
}: {
  item: LedgerInboxItem;
  categories: CategoryInfo[];
  cardIssuers: string[];
  users: string[];
  liabilities: Liability[];
  onCommit: (item: LedgerInboxItem) => void;
  onDiscard: (id: string) => void;
}) {
  const [edited, setEdited] = useState<EditedDraft>({
    date: item.date,
    amount: String(item.amount),
    type: item.type,
    category: item.category ?? '',
    subCategory: item.subCategory ?? '',
    paymentMethod: item.paymentMethod,
    cardIssuer: item.cardIssuer ?? '',
    memo: item.memo ?? '',
    isFixed: item.isFixed,
    user: item.user ?? '',
    linkedLiabilityId: item.linkedLiabilityId ?? '',
  });

  const expenseCategories = categories.filter((c) => !c.incomeOk);
  const incomeCategories = categories.filter((c) => c.incomeOk);
  const currentCategories = edited.type === 'income' ? incomeCategories : expenseCategories;
  const currentCategoryInfo = categories.find((c) => c.name === edited.category);

  const selectCls =
    'w-full px-2 py-1.5 text-xs border border-gray-200 rounded-md bg-white focus:outline-none focus:ring-1 focus:ring-emerald-400';
  const inputCls =
    'w-full px-2 py-1.5 text-xs border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-emerald-400';

  function selectType(t: TransactionType) {
    const list = t === 'income' ? incomeCategories : expenseCategories;
    setEdited((s) => ({ ...s, type: t, category: list[0]?.name ?? '', subCategory: '' }));
  }

  function handleCommit() {
    const amount = Number(edited.amount.replace(/[^0-9]/g, ''));
    if (!amount || amount <= 0) return;
    onCommit({
      ...item,
      date: edited.date,
      amount,
      type: edited.type,
      category: edited.category || null,
      subCategory: edited.subCategory || null,
      paymentMethod: edited.paymentMethod,
      cardIssuer: edited.cardIssuer || null,
      memo: edited.memo || null,
      isFixed: edited.isFixed,
      user: edited.user || null,
      linkedLiabilityId: edited.type === 'expense' && edited.linkedLiabilityId ? edited.linkedLiabilityId : null,
    });
  }

  return (
    <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
      <div className="mb-2 flex items-center justify-between text-[11px] text-gray-400">
        <span>{item.receivedAt.slice(0, 16).replace('T', ' ')} 수신</span>
        <button
          onClick={() => onDiscard(item.id)}
          className="flex items-center gap-1 text-gray-400 hover:text-rose-500"
        >
          <Trash2 size={11} /> 삭제
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <select
          value={edited.type}
          onChange={(e) => selectType(e.target.value as TransactionType)}
          className={selectCls}
        >
          <option value="expense">지출</option>
          <option value="income">수입</option>
          <option value="transfer">이체</option>
        </select>
        <input
          type="date"
          value={edited.date}
          onChange={(e) => setEdited((s) => ({ ...s, date: e.target.value }))}
          className={inputCls}
        />
        <input
          type="text"
          inputMode="numeric"
          value={edited.amount}
          onChange={(e) => setEdited((s) => ({ ...s, amount: e.target.value.replace(/[^0-9]/g, '') }))}
          className={`${inputCls} text-right font-medium`}
        />
        {users.length > 0 && (
          <select
            value={edited.user}
            onChange={(e) => setEdited((s) => ({ ...s, user: e.target.value }))}
            className={selectCls}
          >
            <option value="">공통</option>
            {users.map((u) => (
              <option key={u} value={u}>{u}</option>
            ))}
          </select>
        )}
        <select
          value={edited.category}
          onChange={(e) => setEdited((s) => ({ ...s, category: e.target.value, subCategory: '' }))}
          className={selectCls}
        >
          {currentCategories.map((c) => (
            <option key={c.name} value={c.name}>{c.name}</option>
          ))}
        </select>
        {currentCategoryInfo && currentCategoryInfo.sub.length > 0 ? (
          <select
            value={edited.subCategory}
            onChange={(e) => setEdited((s) => ({ ...s, subCategory: e.target.value }))}
            className={selectCls}
          >
            <option value="">세부 분류 없음</option>
            {currentCategoryInfo.sub.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        ) : (
          <input
            type="text"
            placeholder="세부 분류"
            value={edited.subCategory}
            onChange={(e) => setEdited((s) => ({ ...s, subCategory: e.target.value }))}
            className={inputCls}
          />
        )}
        <select
          value={edited.paymentMethod}
          onChange={(e) => setEdited((s) => ({ ...s, paymentMethod: e.target.value as PaymentMethod }))}
          className={selectCls}
        >
          <option value="cash">현금</option>
          <option value="check_card">체크카드</option>
          <option value="credit_card">신용카드</option>
          <option value="bank_transfer">계좌이체</option>
        </select>
        {edited.paymentMethod === 'credit_card' && (
          <select
            value={edited.cardIssuer}
            onChange={(e) => setEdited((s) => ({ ...s, cardIssuer: e.target.value }))}
            className={selectCls}
          >
            <option value="">카드사 선택</option>
            {cardIssuers.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        )}
        {edited.type === 'expense' && liabilities.length > 0 && (
          <select
            value={edited.linkedLiabilityId}
            onChange={(e) => setEdited((s) => ({ ...s, linkedLiabilityId: e.target.value }))}
            className={selectCls}
          >
            <option value="">부채이자 연결 안함</option>
            {liabilities.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
        )}
        <input
          type="text"
          placeholder="메모"
          value={edited.memo}
          onChange={(e) => setEdited((s) => ({ ...s, memo: e.target.value }))}
          className={`${inputCls} col-span-2 md:col-span-4`}
        />
      </div>

      <div className="mt-2 flex items-center justify-between">
        <label className="flex items-center gap-1.5 text-[11px] text-gray-500">
          <input
            type="checkbox"
            checked={edited.isFixed}
            onChange={(e) => setEdited((s) => ({ ...s, isFixed: e.target.checked }))}
            className="h-3 w-3 accent-emerald-600"
          />
          고정비
        </label>
        <button
          onClick={handleCommit}
          className="flex items-center gap-1 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 transition-all"
        >
          <Check size={12} /> 가계부에 추가
        </button>
      </div>
    </div>
  );
}
