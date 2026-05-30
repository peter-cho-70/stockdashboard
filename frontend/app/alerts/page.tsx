"use client";

import { useEffect, useState, useCallback } from "react";
import { Bell, CheckCheck, TrendingUp, TrendingDown, Newspaper } from "lucide-react";
import { api, type Alert } from "@/lib/api";

function AlertTypeIcon({ type }: { type: Alert["type"] }) {
  if (type === "PRICE_SURGE") return <TrendingUp size={15} className="text-emerald-500" />;
  if (type === "PRICE_DROP") return <TrendingDown size={15} className="text-red-500" />;
  return <Newspaper size={15} className="text-blue-500" />;
}

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [unreadOnly, setUnreadOnly] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api.getAlerts(unreadOnly);
      setAlerts(data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [unreadOnly]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleMarkAll() {
    await api.markAllRead();
    setAlerts((prev) => prev.map((a) => ({ ...a, is_read: true })));
  }

  const unreadCount = alerts.filter((a) => !a.is_read).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">알림</h1>
          <p className="mt-0.5 text-xs text-neutral-400">
            읽지 않은 알림 {unreadCount}건
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-sm text-neutral-500 cursor-pointer">
            <input
              type="checkbox"
              checked={unreadOnly}
              onChange={(e) => setUnreadOnly(e.target.checked)}
              className="rounded"
            />
            미읽음만
          </label>
          {unreadCount > 0 && (
            <button
              onClick={handleMarkAll}
              className="flex items-center gap-1.5 rounded-md border border-[var(--border-subtle)] px-3 py-1.5 text-sm text-neutral-600 transition-colors hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
            >
              <CheckCheck size={14} />
              전체 읽음
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="py-16 text-center text-sm text-neutral-400">불러오는 중...</div>
      ) : alerts.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[var(--border-subtle)] py-16 text-center">
          <Bell size={36} className="mx-auto mb-3 text-neutral-300 dark:text-neutral-600" />
          <p className="text-sm text-neutral-400">알림이 없습니다</p>
        </div>
      ) : (
        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] divide-y divide-[var(--border-subtle)] overflow-hidden">
          {alerts.map((alert) => (
            <div
              key={alert.id}
              className={`flex items-start gap-3 px-4 py-3 transition-colors hover:bg-[var(--surface-elevated)] ${
                !alert.is_read ? "bg-blue-50/50 dark:bg-blue-950/20" : ""
              }`}
            >
              <div className="mt-0.5 shrink-0">
                <AlertTypeIcon type={alert.type} />
              </div>
              <div className="min-w-0 flex-1">
                <p className={`text-sm ${!alert.is_read ? "font-medium text-neutral-900 dark:text-neutral-100" : "text-neutral-600 dark:text-neutral-400"}`}>
                  {alert.message}
                </p>
                <p className="mt-0.5 text-xs text-neutral-400">
                  {new Date(alert.created_at).toLocaleString("ko-KR")}
                </p>
              </div>
              {!alert.is_read && (
                <div className="mt-1.5 shrink-0 h-2 w-2 rounded-full bg-blue-500" />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
