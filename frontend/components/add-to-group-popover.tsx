"use client";

import { useState } from "react";
import { Plus, Loader2 } from "lucide-react";
import { groupsApi, type StockGroup } from "@/lib/api";

/** 종목 하나를 기존/새 그룹에 빠르게 추가하는 팝오버 — symbol 또는 stockName 중 하나만 있어도 동작 */
export function AddToGroupPopover({
  symbol,
  stockName,
  compact = false,
  onAdded,
}: {
  symbol?: string;
  stockName?: string;
  compact?: boolean;
  onAdded?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [groups, setGroups] = useState<StockGroup[] | null>(null);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function toggleOpen() {
    const next = !open;
    setOpen(next);
    setError(null);
    if (next && !groups) {
      const res = await groupsApi.getAll();
      setGroups(res.groups);
    }
  }

  async function addToExisting(groupId: number) {
    setBusy(true);
    setError(null);
    try {
      await groupsApi.addMember(groupId, symbol ? { symbol } : { stock_name: stockName });
      setGroups(null);
      setDone(true);
      onAdded?.();
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "추가에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function createWithCurrent() {
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    setError(null);
    try {
      const group = await groupsApi.create({ name, symbols: [] });
      await groupsApi.addMember(group.id, symbol ? { symbol } : { stock_name: stockName });
      setNewName("");
      setDone(true);
      onAdded?.();
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "생성에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={toggleOpen}
        title="그룹에 추가"
        className={
          compact
            ? "inline-flex items-center justify-center rounded-full p-0.5 text-neutral-400 hover:bg-violet-100 hover:text-violet-600 dark:hover:bg-violet-900/30"
            : "flex items-center gap-1 rounded-md border border-[var(--border-subtle)] px-2 py-1 text-[11px] text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
        }
      >
        <Plus size={compact ? 10 : 11} />
        {!compact && (done ? "추가됨" : "그룹에 추가")}
      </button>

      {open && (
        <div className="absolute right-0 z-30 mt-1 w-56 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-elevated)] p-2 space-y-2 shadow-lg">
          {error && <p className="text-[11px] text-red-500">{error}</p>}
          {groups === null ? (
            <p className="flex items-center gap-1 text-xs text-neutral-400">
              <Loader2 size={11} className="animate-spin" /> 불러오는 중...
            </p>
          ) : (
            <>
              {groups.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {groups.map((g) => (
                    <button
                      key={g.id}
                      type="button"
                      disabled={busy}
                      onClick={() => addToExisting(g.id)}
                      className="rounded-full border border-[var(--border-subtle)] px-2.5 py-1 text-[11px] disabled:opacity-40 hover:border-violet-300 hover:text-violet-600"
                    >
                      {g.name}
                    </button>
                  ))}
                </div>
              )}
              <div className="flex items-center gap-1.5">
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && createWithCurrent()}
                  placeholder="새 그룹 이름"
                  className="min-w-0 flex-1 rounded-md border border-[var(--border-subtle)] bg-[var(--background)] px-2 py-1 text-[11px]"
                />
                <button
                  type="button"
                  onClick={createWithCurrent}
                  disabled={busy || !newName.trim()}
                  className="shrink-0 rounded-md bg-neutral-900 px-2 py-1 text-[11px] text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
                >
                  생성
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
