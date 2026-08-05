"use client";

import { useEffect, useMemo, useState } from "react";
import { Lock, Check, Inbox, AlertCircle } from "lucide-react";
import { api, type LedgerInboxItemDraft } from "@/lib/api";
import type { LedgerSettings, TransactionType } from "@/lib/finance/types";

const PIN_STORAGE_KEY = "ledgerMobilePin";

function todayYmd() {
  return new Date().toISOString().slice(0, 10);
}

// 모바일에서는 아래 5개 필드만 입력받는다. 결제수단·세부분류·카드사·고정비·
// 사용자·부채연결 같은 세부 항목은 기본값으로 채워 받은상자로 보내고,
// PC의 받은상자 화면에서 나중에 채워 넣는다.
interface DraftForm {
  date: string;
  amount: string;
  type: TransactionType;
  category: string;
  memo: string;
}

function emptyDraft(defaultCategory: string): DraftForm {
  return {
    date: todayYmd(),
    amount: "",
    type: "expense",
    category: defaultCategory,
    memo: "",
  };
}

interface SentItem {
  key: string;
  label: string;
  amount: number;
  type: TransactionType;
}

// ─── PIN 입력 화면 ────────────────────────────────────────────────────────
function PinGate({
  onSubmit,
  error,
}: {
  onSubmit: (pin: string) => void;
  error: string | null;
}) {
  const [value, setValue] = useState("");
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
        <Lock size={20} />
      </div>
      <div>
        <h1 className="text-base font-bold text-gray-900">가계부 빠른입력</h1>
        <p className="mt-1 text-xs text-gray-400">PC의 backend/.env에 설정한 PIN을 입력하세요.</p>
      </div>
      <form
        className="w-full max-w-xs space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (value.trim()) onSubmit(value.trim());
        }}
      >
        <input
          type="password"
          inputMode="numeric"
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="PIN"
          className="w-full rounded-lg border border-gray-200 px-4 py-3 text-center text-lg tracking-widest focus:outline-none focus:ring-2 focus:ring-emerald-400"
        />
        {error && (
          <p className="flex items-center justify-center gap-1 text-xs text-rose-500">
            <AlertCircle size={12} />
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={!value.trim()}
          className="w-full rounded-lg bg-emerald-600 py-3 text-sm font-semibold text-white disabled:opacity-40"
        >
          확인
        </button>
      </form>
    </div>
  );
}

// ─── 메인 입력 폼 ─────────────────────────────────────────────────────────
export default function MobileLedgerPage() {
  const [pin, setPin] = useState<string | null>(null);
  const [pinError, setPinError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  const [settings, setSettings] = useState<LedgerSettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  const [form, setForm] = useState<DraftForm>(emptyDraft(""));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [sentItems, setSentItems] = useState<SentItem[]>([]);

  useEffect(() => {
    const saved = window.localStorage.getItem(PIN_STORAGE_KEY);
    if (saved) setPin(saved);
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!pin) return;
    let cancelled = false;
    api
      .getLedgerState()
      .then((ledger) => {
        if (cancelled) return;
        setSettings(ledger.settings);
        const defaultCat = ledger.settings.categories.find((c) => !c.incomeOk)?.name ?? "";
        setForm(emptyDraft(defaultCat));
        setLoadError(null);
      })
      .catch((e) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : "설정을 불러오지 못했습니다.");
      });
    return () => {
      cancelled = true;
    };
  }, [pin, reloadTick]);

  const categories = settings?.categories ?? [];
  const expenseCategories = useMemo(() => categories.filter((c) => !c.incomeOk), [categories]);
  const incomeCategories = useMemo(() => categories.filter((c) => c.incomeOk), [categories]);
  const currentCategories = form.type === "income" ? incomeCategories : expenseCategories;

  function handlePinSubmit(value: string) {
    window.localStorage.setItem(PIN_STORAGE_KEY, value);
    setPinError(null);
    setPin(value);
  }

  function handlePinRejected(message: string) {
    window.localStorage.removeItem(PIN_STORAGE_KEY);
    setPin(null);
    setPinError(message);
  }

  function selectType(t: TransactionType) {
    const list = t === "income" ? incomeCategories : expenseCategories;
    setForm((f) => ({ ...f, type: t, category: list[0]?.name ?? "" }));
  }

  async function handleSubmit() {
    if (!pin) return;
    const amount = Number(form.amount.replace(/[^0-9]/g, ""));
    if (!amount || amount <= 0) {
      setSaveError("금액을 입력하세요.");
      return;
    }
    setSaving(true);
    setSaveError(null);
    const draft: LedgerInboxItemDraft = {
      date: form.date,
      amount,
      type: form.type,
      category: form.category || null,
      subCategory: null,
      paymentMethod: "cash",
      cardIssuer: null,
      memo: form.memo || null,
      isFixed: false,
      user: null,
      linkedLiabilityId: null,
    };
    try {
      await api.addLedgerInboxItem(pin, draft);
      setSentItems((prev) => [
        { key: `${Date.now()}`, label: form.memo || form.category, amount, type: form.type },
        ...prev,
      ]);
      // 날짜·유형·카테고리는 그대로 두고, 금액·메모만 비워서 연속 입력이 빠르도록
      setForm((f) => ({ ...f, amount: "", memo: "" }));
    } catch (e) {
      const message = e instanceof Error ? e.message : "저장 실패";
      if (message.includes("PIN")) {
        handlePinRejected(message);
      } else {
        setSaveError(message);
      }
    } finally {
      setSaving(false);
    }
  }

  if (!hydrated) return null;

  if (!pin) {
    return <PinGate onSubmit={handlePinSubmit} error={pinError} />;
  }

  if (loadError) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-6 text-center">
        <AlertCircle size={24} className="text-rose-400" />
        <p className="text-sm text-gray-500">{loadError}</p>
        <button
          onClick={() => setReloadTick((v) => v + 1)}
          className="rounded-md border border-gray-200 px-3 py-1.5 text-xs text-gray-500"
        >
          새로고침
        </button>
      </div>
    );
  }

  if (!settings) {
    return <div className="py-16 text-center text-sm text-gray-400">불러오는 중...</div>;
  }

  const inputCls =
    "w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-emerald-400";

  return (
    <div className="max-w-md mx-auto space-y-4 pb-28">
      <div className="flex items-center gap-2 pt-1">
        <Inbox size={16} className="text-emerald-600" />
        <h1 className="text-base font-bold text-gray-900">가계부 빠른입력</h1>
        <span className="ml-auto text-[10px] text-gray-400">받은상자에 저장 → PC에서 확인 후 반영</span>
      </div>

      {/* 유형 */}
      <div className="grid grid-cols-3 gap-2">
        {(["expense", "income", "transfer"] as TransactionType[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => selectType(t)}
            className={`rounded-lg py-2.5 text-sm font-medium transition-all ${
              form.type === t
                ? t === "expense"
                  ? "bg-rose-600 text-white"
                  : t === "income"
                  ? "bg-emerald-600 text-white"
                  : "bg-blue-600 text-white"
                : "bg-gray-100 text-gray-500"
            }`}
          >
            {t === "expense" ? "지출" : t === "income" ? "수입" : "이체"}
          </button>
        ))}
      </div>

      {/* 금액 — 가장 중요한 필드라 크게 */}
      <div>
        <label className="mb-1 block text-xs text-gray-500">금액 (원)</label>
        <input
          type="text"
          inputMode="numeric"
          autoFocus
          value={form.amount}
          onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value.replace(/[^0-9]/g, "") }))}
          placeholder="0"
          className="w-full rounded-lg border border-gray-200 px-3 py-4 text-2xl font-bold tabular-nums focus:outline-none focus:ring-1 focus:ring-emerald-400"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs text-gray-500">날짜</label>
          <input
            type="date"
            value={form.date}
            onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
            className={inputCls}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-gray-500">카테고리</label>
          <select
            value={form.category}
            onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
            className={`${inputCls} bg-white`}
          >
            {currentCategories.map((c) => (
              <option key={c.name} value={c.name}>{c.name}</option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="mb-1 block text-xs text-gray-500">메모</label>
        <input
          type="text"
          placeholder="예: 스타벅스, 마트..."
          value={form.memo}
          onChange={(e) => setForm((f) => ({ ...f, memo: e.target.value }))}
          className={inputCls}
        />
      </div>

      <p className="text-[11px] text-gray-400">
        결제수단·세부분류 등 나머지 항목은 PC 가계부의 받은상자에서 나중에 채울 수 있어요.
      </p>

      {saveError && (
        <p className="flex items-center gap-1 text-xs text-rose-500">
          <AlertCircle size={12} />
          {saveError}
        </p>
      )}

      {/* 이번 접속에서 보낸 항목 (세션 내 기록용, 서버 목록과 무관) */}
      {sentItems.length > 0 && (
        <div className="rounded-lg border border-emerald-100 bg-emerald-50 p-3">
          <p className="mb-1.5 text-[11px] font-medium text-emerald-700">이번에 받은상자로 보낸 항목</p>
          <ul className="space-y-1">
            {sentItems.slice(0, 6).map((item) => (
              <li key={item.key} className="flex items-center justify-between text-xs text-emerald-800">
                <span className="flex items-center gap-1 truncate">
                  <Check size={11} className="shrink-0 text-emerald-500" />
                  {item.label || "(메모 없음)"}
                </span>
                <span className="shrink-0 tabular-nums">
                  {item.type === "income" ? "+" : item.type === "expense" ? "-" : ""}
                  {item.amount.toLocaleString("ko-KR")}원
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 하단 고정 제출 버튼 */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-gray-100 bg-white/95 p-3 backdrop-blur">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={saving || !form.amount}
          className="mx-auto block w-full max-w-md rounded-lg bg-emerald-600 py-3.5 text-sm font-semibold text-white transition-all disabled:opacity-40"
        >
          {saving ? "저장 중..." : "받은상자에 추가"}
        </button>
      </div>
    </div>
  );
}
