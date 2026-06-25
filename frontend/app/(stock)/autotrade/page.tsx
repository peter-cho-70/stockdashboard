"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, Loader2, Plus, Power, Trash2, X } from "lucide-react";
import {
  api,
  autotradeApi,
  watchlistApi,
  type AutoTradeEventItem,
  type AutoTradeRuleItem,
  type StockItem,
  type WatchlistItem,
} from "@/lib/api";

function fmtWon(v: number | null | undefined) {
  if (v == null) return "—";
  return `${Math.round(v).toLocaleString("ko-KR")}원`;
}

const STATUS_LABEL: Record<string, string> = {
  대기: "매수 대기",
  매수완료: "매수완료 · 익절 대기",
  "매도 진행중": "매도 진행중",
};

export default function AutoTradePage() {
  const [rules, setRules] = useState<AutoTradeRuleItem[]>([]);
  const [events, setEvents] = useState<AutoTradeEventItem[]>([]);
  const [killSwitchOn, setKillSwitchOn] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [pickerOptions, setPickerOptions] = useState<{ symbol: string; name: string }[]>([]);
  const [newSymbol, setNewSymbol] = useState("");
  const [newQty, setNewQty] = useState("1");
  const [newBroker, setNewBroker] = useState<"kis" | "kiwoom">("kis");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const [rulesData, eventsData, killSwitch] = await Promise.all([
        autotradeApi.listRules(),
        autotradeApi.listEvents(),
        autotradeApi.getKillSwitch(),
      ]);
      setRules(rulesData);
      setEvents(eventsData);
      setKillSwitchOn(killSwitch.on);
      setError(null);
    } catch {
      setError("자동매매 데이터를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
  }, [load]);

  async function openAddModal() {
    setShowAddModal(true);
    try {
      const [stocks, watchlist] = await Promise.all([api.getStocks(), watchlistApi.getAll()]);
      const seen = new Set<string>();
      const options: { symbol: string; name: string }[] = [];
      for (const s of stocks as StockItem[]) {
        if (s.symbol && !seen.has(s.symbol)) {
          seen.add(s.symbol);
          options.push({ symbol: s.symbol, name: s.name });
        }
      }
      for (const w of watchlist.items as WatchlistItem[]) {
        if (w.symbol && !seen.has(w.symbol)) {
          seen.add(w.symbol);
          options.push({ symbol: w.symbol, name: w.stock_name });
        }
      }
      setPickerOptions(options);
      if (options.length > 0) setNewSymbol(options[0].symbol);
    } catch {
      setPickerOptions([]);
    }
  }

  async function handleCreateRule() {
    if (!newSymbol || !Number(newQty) || Number(newQty) <= 0) return;
    setSubmitting(true);
    try {
      const picked = pickerOptions.find((o) => o.symbol === newSymbol);
      await autotradeApi.createRule({
        symbol: newSymbol,
        name: picked?.name,
        buy_qty: Number(newQty),
        broker: newBroker,
      });
      setShowAddModal(false);
      setNewQty("1");
      setNewBroker("kis");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "규칙 생성에 실패했습니다.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleToggleEnabled(rule: AutoTradeRuleItem) {
    await autotradeApi.setRuleEnabled(rule.id, !rule.enabled);
    load();
  }

  async function handleDeleteRule(id: number) {
    if (!confirm("이 자동매매 규칙을 삭제하시겠습니까?")) return;
    await autotradeApi.deleteRule(id);
    load();
  }

  async function handleApprove(eventId: number) {
    setActing(eventId);
    try {
      await autotradeApi.approveEvent(eventId);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "승인 처리에 실패했습니다.");
    } finally {
      setActing(null);
    }
  }

  async function handleReject(eventId: number) {
    setActing(eventId);
    try {
      await autotradeApi.rejectEvent(eventId);
      await load();
    } catch {
      setError("거부 처리에 실패했습니다.");
    } finally {
      setActing(null);
    }
  }

  async function handleToggleKillSwitch() {
    const next = !killSwitchOn;
    await autotradeApi.setKillSwitch(next);
    setKillSwitchOn(next);
  }

  const pendingEvents = events.filter((e) => e.status === "PENDING_APPROVAL");
  const historyEvents = events.filter((e) => e.status !== "PENDING_APPROVAL");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">자동매매</h1>
          <p className="mt-0.5 text-xs text-neutral-400">
            전용 KIS 계좌 · 반자동(승인 필요) · 매수적정가/익절 사다리 조건 감시 — Phase 1: 모의투자 전용
          </p>
        </div>
        <button
          type="button"
          onClick={handleToggleKillSwitch}
          className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
            killSwitchOn
              ? "border-red-500 bg-red-500 text-white"
              : "border-[var(--border-subtle)] text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
          }`}
        >
          <Power size={14} />
          {killSwitchOn ? "전체 정지 중 (클릭하여 재개)" : "킬스위치 (클릭하여 전체 정지)"}
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-400">
          <AlertTriangle size={14} />
          {error}
        </div>
      )}

      {pendingEvents.length > 0 && (
        <div className="rounded-lg border border-violet-300 bg-violet-50 p-4 dark:border-violet-800 dark:bg-violet-950/20">
          <h2 className="mb-2 text-sm font-semibold text-violet-700 dark:text-violet-300">
            승인 대기 중 ({pendingEvents.length})
          </h2>
          <ul className="space-y-2">
            {pendingEvents.map((e) => (
              <li
                key={e.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-white px-3 py-2 text-sm dark:bg-neutral-900"
              >
                <span>
                  <span className="font-medium">{e.name || e.symbol}</span>{" "}
                  {e.event_type === "BUY" ? (
                    <span className="text-sky-600 dark:text-sky-400">매수</span>
                  ) : (
                    <span className="text-emerald-600 dark:text-emerald-400">
                      익절 +{e.leg_pct}% 매도
                    </span>
                  )}{" "}
                  {e.qty}주 — {fmtWon(e.trigger_price)}에 조건 충족
                </span>
                <span className="flex items-center gap-1.5">
                  <button
                    type="button"
                    disabled={acting === e.id}
                    onClick={() => handleApprove(e.id)}
                    className="flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                  >
                    <Check size={12} /> 승인
                  </button>
                  <button
                    type="button"
                    disabled={acting === e.id}
                    onClick={() => handleReject(e.id)}
                    className="flex items-center gap-1 rounded-md border border-[var(--border-subtle)] px-2.5 py-1 text-xs font-medium text-neutral-600 hover:bg-neutral-100 disabled:opacity-50 dark:text-neutral-300 dark:hover:bg-neutral-800"
                  >
                    <X size={12} /> 거부
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">규칙</h2>
          <button
            type="button"
            onClick={openAddModal}
            className="flex items-center gap-1 rounded-md bg-neutral-900 px-2.5 py-1.5 text-xs font-medium text-white dark:bg-neutral-100 dark:text-neutral-900"
          >
            <Plus size={12} /> 규칙 추가
          </button>
        </div>

        {loading ? (
          <div className="flex justify-center py-8 text-neutral-400">
            <Loader2 size={18} className="animate-spin" />
          </div>
        ) : rules.length === 0 ? (
          <p className="py-8 text-center text-sm text-neutral-400">아직 등록된 자동매매 규칙이 없습니다.</p>
        ) : (
          <div className="space-y-3">
            {rules.map((rule) => (
              <div
                key={rule.id}
                className="rounded-lg border border-[var(--border-subtle)] p-3 text-sm"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-neutral-800 dark:text-neutral-200">
                      {rule.name} ({rule.symbol})
                    </span>
                    <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-500 dark:bg-neutral-800">
                      {STATUS_LABEL[rule.status] || rule.status}
                    </span>
                    {rule.broker === "kiwoom" && (
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                        키움
                      </span>
                    )}
                    {!rule.enabled && (
                      <span className="rounded bg-neutral-200 px-1.5 py-0.5 text-[10px] text-neutral-500 dark:bg-neutral-700">
                        비활성
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleToggleEnabled(rule)}
                      className={`rounded-md px-2 py-1 text-[11px] font-medium ${
                        rule.enabled
                          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                          : "bg-neutral-100 text-neutral-500 dark:bg-neutral-800"
                      }`}
                    >
                      {rule.enabled ? "감시중" : "감시 중지"}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteRule(rule.id)}
                      className="text-neutral-400 hover:text-red-500"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>

                <div className="mt-2 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
                  <div>
                    <p className="text-neutral-400">현재가</p>
                    <p className="font-medium text-neutral-700 dark:text-neutral-300">{fmtWon(rule.current_price)}</p>
                  </div>
                  <div>
                    <p className="text-neutral-400">매수적정가</p>
                    <p className="font-medium text-neutral-700 dark:text-neutral-300">{fmtWon(rule.computed_buy_price)}</p>
                  </div>
                  <div>
                    <p className="text-neutral-400">매수 체결가</p>
                    <p className="font-medium text-neutral-700 dark:text-neutral-300">{fmtWon(rule.executed_buy_price)}</p>
                  </div>
                  <div>
                    <p className="text-neutral-400">보유수량 / 매수수량</p>
                    <p className="font-medium text-neutral-700 dark:text-neutral-300">
                      {rule.position_qty} / {rule.buy_qty}
                    </p>
                  </div>
                </div>

                {rule.sell_ladder && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {rule.sell_ladder.map((leg) => {
                      const done = rule.sell_leg_done.includes(String(leg.pct));
                      return (
                        <span
                          key={leg.pct}
                          className={`rounded px-1.5 py-0.5 text-[10px] ${
                            done
                              ? "bg-emerald-100 text-emerald-700 line-through dark:bg-emerald-900/30 dark:text-emerald-400"
                              : "bg-[var(--surface-elevated)] text-neutral-500"
                          }`}
                        >
                          +{leg.pct}% {fmtWon(leg.price)}
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] p-4">
        <h2 className="mb-3 text-sm font-semibold text-neutral-800 dark:text-neutral-200">이력</h2>
        {historyEvents.length === 0 ? (
          <p className="py-4 text-center text-xs text-neutral-400">아직 처리된 이벤트가 없습니다.</p>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[var(--border-subtle)] text-neutral-500">
                <th className="px-2 py-1.5 text-left">시간</th>
                <th className="px-2 py-1.5 text-left">종목</th>
                <th className="px-2 py-1.5 text-left">구분</th>
                <th className="px-2 py-1.5 text-right">가격</th>
                <th className="px-2 py-1.5 text-right">수량</th>
                <th className="px-2 py-1.5 text-left">상태</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-subtle)]">
              {historyEvents.map((e) => (
                <tr key={e.id}>
                  <td className="px-2 py-1.5 text-neutral-500">{new Date(e.created_at).toLocaleString("ko-KR")}</td>
                  <td className="px-2 py-1.5">{e.name || e.symbol}</td>
                  <td className="px-2 py-1.5">
                    {e.event_type === "BUY" ? "매수" : `익절 +${e.leg_pct}%`}
                  </td>
                  <td className="px-2 py-1.5 text-right">{fmtWon(e.trigger_price)}</td>
                  <td className="px-2 py-1.5 text-right">{e.qty}</td>
                  <td className="px-2 py-1.5">
                    <span
                      className={
                        e.status === "EXECUTED"
                          ? "text-emerald-600 dark:text-emerald-400"
                          : e.status === "FAILED"
                            ? "text-red-500"
                            : "text-neutral-400"
                      }
                    >
                      {e.status}
                    </span>
                    {e.error_message && (
                      <span className="ml-1 text-[10px] text-neutral-400">({e.error_message})</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-lg bg-[var(--surface)] p-4 shadow-lg">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">규칙 추가</h3>
              <button type="button" onClick={() => setShowAddModal(false)}>
                <X size={16} className="text-neutral-400" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-neutral-500">종목 (보유종목·관심종목)</label>
                {pickerOptions.length === 0 ? (
                  <p className="text-xs text-neutral-400">보유종목·관심종목이 없습니다.</p>
                ) : (
                  <select
                    value={newSymbol}
                    onChange={(e) => setNewSymbol(e.target.value)}
                    className="w-full rounded-md border border-[var(--border-subtle)] bg-[var(--background)] px-3 py-2 text-sm"
                  >
                    {pickerOptions.map((o) => (
                      <option key={o.symbol} value={o.symbol}>
                        {o.name} ({o.symbol})
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-neutral-500">매수 수량</label>
                <input
                  type="number"
                  value={newQty}
                  onChange={(e) => setNewQty(e.target.value)}
                  className="w-full rounded-md border border-[var(--border-subtle)] bg-[var(--background)] px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-neutral-500">증권사</label>
                <select
                  value={newBroker}
                  onChange={(e) => setNewBroker(e.target.value as "kis" | "kiwoom")}
                  className="w-full rounded-md border border-[var(--border-subtle)] bg-[var(--background)] px-3 py-2 text-sm"
                >
                  <option value="kis">한국투자증권 (KIS)</option>
                  <option value="kiwoom">키움증권</option>
                </select>
                <p className="mt-1 text-[11px] text-neutral-400">
                  선택한 증권사의 AUTOTRADE_{newBroker === "kiwoom" ? "KIWOOM_" : ""}ACCOUNT_NO가 .env에 설정되어 있어야 합니다.
                </p>
              </div>
              <p className="text-[11px] text-neutral-400">
                실행 모드는 반자동(승인 필요)으로 고정됩니다. 조건 충족 시 알림이 오고, 직접 승인해야 주문이 나갑니다.
              </p>
              <button
                type="button"
                disabled={submitting || pickerOptions.length === 0}
                onClick={handleCreateRule}
                className="w-full rounded-md bg-neutral-900 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
              >
                {submitting ? "생성 중..." : "규칙 추가"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
