"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, X, Loader2, PenLine, Check, Layers, Search } from "lucide-react";
import { groupsApi, type DiscoverRelatedResponse, type StockGroup } from "@/lib/api";
import { krChangeClass } from "@/lib/krMarketColors";

function AddMemberForm({ groupId, onAdded }: { groupId: number; onAdded: (g: StockGroup) => void }) {
  const [input, setInput] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    const raw = input.trim();
    if (!raw) return;
    setAdding(true);
    setError("");
    try {
      const isCode = /^\d{6}$/.test(raw);
      const updated = await groupsApi.addMember(
        groupId,
        isCode ? { symbol: raw } : { stock_name: raw },
      );
      onAdded(updated);
      setInput("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "추가 실패");
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="flex items-center gap-1.5">
      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
        }}
        placeholder="종목코드 또는 종목명"
        className="w-40 rounded-md border border-[var(--border-subtle)] bg-[var(--background)] px-2 py-1 text-xs"
      />
      <button
        type="button"
        onClick={submit}
        disabled={adding || !input.trim()}
        className="flex items-center gap-1 rounded-md bg-neutral-900 px-2.5 py-1 text-[11px] font-medium text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
      >
        {adding ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
        추가
      </button>
      {error && <span className="text-[10px] text-red-500">{error}</span>}
    </div>
  );
}

function DiscoverRelatedStocks({
  groups,
  onGroupsChanged,
}: {
  groups: StockGroup[];
  onGroupsChanged: () => void;
}) {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<DiscoverRelatedResponse | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [targetGroupId, setTargetGroupId] = useState<number | "new">("new");
  const [newGroupName, setNewGroupName] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function search() {
    const q = query.trim();
    if (!q) return;
    setLoading(true);
    setError("");
    setMessage("");
    setResult(null);
    setSelected(new Set());
    try {
      const res = await groupsApi.discover(q, 12);
      setResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "검색 실패");
    } finally {
      setLoading(false);
    }
  }

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function addSelected() {
    if (!result || selected.size === 0) return;
    setAdding(true);
    setError("");
    setMessage("");
    try {
      const members = result.candidates
        .filter((c) => selected.has(c.symbol ?? c.name))
        .map((c) => (c.symbol ? { symbol: c.symbol } : { stock_name: c.name }));

      let groupId = targetGroupId;
      if (groupId === "new") {
        const name = newGroupName.trim() || `${result.base_name ?? query} 관련주`;
        const created = await groupsApi.create({ name, symbols: [] });
        groupId = created.id;
      }
      const updated = await groupsApi.addMembersBulk(groupId as number, members);
      setMessage(`${updated.added}개 추가됨 (중복·미확인 ${updated.skipped}개 제외)`);
      setSelected(new Set());
      setNewGroupName("");
      onGroupsChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "추가 실패");
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Search size={15} className="text-violet-500" />
        <h2 className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">관련 종목 찾기</h2>
      </div>
      <p className="text-xs text-neutral-400">
        종목명을 입력하면 함께 언급된 종목 · 뉴스 기반 관련주를 찾아드립니다. 골라서 그룹에 한 번에 추가하세요.
      </p>
      <div className="flex items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && search()}
          placeholder="종목명 (예: 삼성전자)"
          className="w-52 rounded-md border border-[var(--border-subtle)] bg-[var(--background)] px-3 py-2 text-sm"
        />
        <button
          type="button"
          onClick={search}
          disabled={loading || !query.trim()}
          className="flex items-center gap-1.5 rounded-md border border-[var(--border-subtle)] px-3 py-2 text-sm font-medium hover:bg-[var(--surface-elevated)] disabled:opacity-50"
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
          검색
        </button>
      </div>

      {error && <p className="text-xs text-red-500">{error}</p>}
      {message && <p className="text-xs text-emerald-600">{message}</p>}

      {loading && <p className="text-xs text-neutral-400">관련 종목을 찾는 중... (뉴스 검색이 포함되면 다소 걸릴 수 있어요)</p>}

      {result &&
        (result.candidates.length === 0 ? (
          <p className="text-xs text-neutral-400">
            &quot;{result.base_name ?? result.query}&quot;와 관련된 종목을 찾지 못했습니다.
          </p>
        ) : (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              {result.candidates.map((c) => {
                const key = c.symbol ?? c.name;
                const isSel = selected.has(key);
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => toggle(key)}
                    title={c.reason ?? undefined}
                    className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-left text-xs ${
                      isSel
                        ? "border-violet-400 bg-violet-50 dark:border-violet-600 dark:bg-violet-900/20"
                        : "border-[var(--border-subtle)] bg-[var(--surface-elevated)]"
                    }`}
                  >
                    <span
                      className={`size-1.5 shrink-0 rounded-full ${
                        c.source === "co_mention" ? "bg-violet-500" : "bg-sky-500"
                      }`}
                    />
                    <span className="font-medium text-neutral-800 dark:text-neutral-200">{c.name}</span>
                    {c.change_rate != null && (
                      <span className={`tabular-nums ${krChangeClass(c.change_rate)}`}>
                        {c.change_rate > 0 ? "+" : ""}
                        {c.change_rate.toFixed(2)}%
                      </span>
                    )}
                    {!c.symbol && <span className="text-[10px] text-amber-500">심볼 미확인</span>}
                  </button>
                );
              })}
            </div>
            <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-neutral-400">
              <span className="flex items-center gap-1">
                <span className="size-1.5 rounded-full bg-violet-500" /> 함께 언급된 종목
              </span>
              <span className="flex items-center gap-1">
                <span className="size-1.5 rounded-full bg-sky-500" /> 뉴스 기반 관련주
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border-subtle)] pt-2">
              <select
                value={targetGroupId}
                onChange={(e) => setTargetGroupId(e.target.value === "new" ? "new" : Number(e.target.value))}
                className="rounded-md border border-[var(--border-subtle)] bg-[var(--background)] px-2 py-1.5 text-xs"
              >
                <option value="new">새 그룹 만들기</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
              {targetGroupId === "new" && (
                <input
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  placeholder={`${result.base_name ?? query} 관련주`}
                  className="w-40 rounded-md border border-[var(--border-subtle)] bg-[var(--background)] px-2 py-1.5 text-xs"
                />
              )}
              <button
                type="button"
                onClick={addSelected}
                disabled={adding || selected.size === 0}
                className="flex items-center gap-1.5 rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
              >
                {adding ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
                선택한 {selected.size}개 추가
              </button>
            </div>
          </div>
        ))}
    </div>
  );
}

function GroupCard({
  group,
  onUpdate,
  onDelete,
}: {
  group: StockGroup;
  onUpdate: (g: StockGroup) => void;
  onDelete: (id: number) => void;
}) {
  const router = useRouter();
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(group.name);
  const [saving, setSaving] = useState(false);

  async function saveName() {
    const name = nameInput.trim();
    if (!name || name === group.name) {
      setEditingName(false);
      return;
    }
    setSaving(true);
    try {
      const updated = await groupsApi.rename(group.id, name);
      onUpdate(updated);
    } finally {
      setSaving(false);
      setEditingName(false);
    }
  }

  async function removeMember(symbol: string) {
    const updated = await groupsApi.removeMember(group.id, symbol);
    onUpdate(updated);
  }

  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] p-4">
      <div className="flex items-center justify-between gap-2">
        {editingName ? (
          <div className="flex items-center gap-1.5">
            <input
              autoFocus
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && saveName()}
              className="rounded-md border border-[var(--border-subtle)] bg-[var(--background)] px-2 py-1 text-sm"
            />
            <button type="button" onClick={saveName} disabled={saving} className="rounded p-1 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20">
              <Check size={14} />
            </button>
            <button type="button" onClick={() => { setEditingName(false); setNameInput(group.name); }} className="rounded p-1 text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800">
              <X size={14} />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-1.5">
            <Layers size={15} className="text-violet-500" />
            <button
              type="button"
              onClick={() => router.push(`/groups/${group.id}`)}
              className="text-sm font-semibold text-neutral-900 hover:text-violet-600 dark:text-neutral-100 dark:hover:text-violet-400"
            >
              {group.name}
            </button>
            <span className="text-xs text-neutral-400">{group.members.length}종목</span>
            <button
              type="button"
              onClick={() => setEditingName(true)}
              className="rounded p-1 text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            >
              <PenLine size={12} />
            </button>
          </div>
        )}
        <button
          type="button"
          onClick={() => onDelete(group.id)}
          className="rounded p-1.5 text-neutral-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
        >
          <Trash2 size={14} />
        </button>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {group.members.length === 0 && (
          <p className="text-xs text-neutral-400">아직 등록된 종목이 없습니다.</p>
        )}
        {group.members.map((m) => (
          <div
            key={m.symbol}
            className="flex items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-2.5 py-1.5"
          >
            <button
              type="button"
              onClick={() => router.push(`/chart?symbol=${m.symbol}`)}
              className="text-xs font-medium text-neutral-800 hover:text-violet-600 dark:text-neutral-200 dark:hover:text-violet-400"
            >
              {m.name}
            </button>
            {m.change_rate != null && (
              <span className={`text-[11px] tabular-nums ${krChangeClass(m.change_rate)}`}>
                {m.change_rate > 0 ? "+" : ""}
                {m.change_rate.toFixed(2)}%
              </span>
            )}
            {m.is_holding && (
              <span className="rounded bg-neutral-200 px-1 py-0.5 text-[9px] text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300">
                보유
              </span>
            )}
            <button
              type="button"
              onClick={() => removeMember(m.symbol)}
              className="text-neutral-300 hover:text-red-500"
            >
              <X size={11} />
            </button>
          </div>
        ))}
      </div>

      <div className="mt-3 border-t border-[var(--border-subtle)] pt-3">
        <AddMemberForm groupId={group.id} onAdded={onUpdate} />
      </div>
    </div>
  );
}

export default function GroupsPage() {
  const [groups, setGroups] = useState<StockGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [newGroupName, setNewGroupName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await groupsApi.getAll();
      setGroups(res.groups);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
    const syncKey = "group-price-synced";
    const lastSynced = localStorage.getItem(syncKey);
    if (lastSynced !== today) {
      groupsApi.syncPrices()
        .then((r) => {
          localStorage.setItem(syncKey, today);
          if (r.updated > 0) load();
        })
        .catch(() => {});
    }
    load();
  }, [load]);

  function handleUpdate(updated: StockGroup) {
    setGroups((prev) => prev.map((g) => (g.id === updated.id ? updated : g)));
  }

  async function handleDelete(id: number) {
    await groupsApi.remove(id);
    setGroups((prev) => prev.filter((g) => g.id !== id));
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const name = newGroupName.trim();
    if (!name) return;
    setCreating(true);
    setError("");
    try {
      const group = await groupsApi.create({ name });
      setGroups((prev) => [group, ...prev]);
      setNewGroupName("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "생성 실패");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">종목 그룹</h1>
        <p className="mt-0.5 text-xs text-neutral-400">
          서로 관계 있다고 생각하는 종목들을 직접 묶어서 관리하세요 (예: 반도체 3사, 공급망 관련주)
        </p>
      </div>

      <form onSubmit={handleCreate} className="flex items-center gap-2">
        <input
          value={newGroupName}
          onChange={(e) => setNewGroupName(e.target.value)}
          placeholder="새 그룹 이름 (예: AI 반도체 3사)"
          className="w-64 rounded-md border border-[var(--border-subtle)] bg-[var(--background)] px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={creating || !newGroupName.trim()}
          className="flex items-center gap-1.5 rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
        >
          {creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
          그룹 만들기
        </button>
      </form>
      {error && <p className="text-xs text-red-500">{error}</p>}

      <DiscoverRelatedStocks groups={groups} onGroupsChanged={load} />

      {loading ? (
        <div className="py-16 text-center text-sm text-neutral-400">불러오는 중...</div>
      ) : groups.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[var(--border-subtle)] py-16 text-center text-sm text-neutral-400 space-y-1">
          <Search size={24} className="mx-auto text-neutral-300 dark:text-neutral-600" />
          <p>아직 만든 그룹이 없습니다.</p>
          <p className="text-xs">위에서 그룹 이름을 입력해 만들어 보세요.</p>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {groups.map((g) => (
            <GroupCard key={g.id} group={g} onUpdate={handleUpdate} onDelete={handleDelete} />
          ))}
        </div>
      )}
    </div>
  );
}
