"use client";

import { useEffect, useState } from "react";
import { X, Search, Loader2, Star } from "lucide-react";
import { watchlistApi, type SymbolLookup } from "@/lib/api";

export type WatchlistRegisterDraft = {
  stock_name: string;
  symbol?: string | null;
  sector?: string;
  source_type?: string;
  source_id?: number;
};

type Props = {
  draft: WatchlistRegisterDraft | null;
  open: boolean;
  onClose: () => void;
  onRegistered: () => void;
};

export function WatchlistRegisterModal({ draft, open, onClose, onRegistered }: Props) {
  const [symbol, setSymbol] = useState("");
  const [name, setName] = useState("");
  const [lookup, setLookup] = useState<SymbolLookup | null>(null);
  const [looking, setLooking] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open || !draft) return;
    let cancelled = false;

    setName(draft.stock_name);
    setSymbol((draft.symbol ?? "").replace(/\D/g, "").slice(0, 6));
    setLookup(null);
    setError("");
    setLooking(true);

    (async () => {
      try {
        if (draft.symbol && draft.symbol.replace(/\D/g, "").length === 6) {
          const sym = draft.symbol.replace(/\D/g, "").slice(0, 6);
          const r = await watchlistApi.lookupSymbol(sym);
          if (!cancelled) {
            setLookup(r);
            setSymbol(r.symbol);
            setName(r.stock_name);
          }
        } else {
          const r = await watchlistApi.lookupName(draft.stock_name);
          if (!cancelled) {
            setLookup(r);
            setSymbol(r.symbol);
            setName(r.stock_name);
          }
        }
      } catch (e) {
        if (!cancelled) {
          setError(
            e instanceof Error
              ? e.message
              : "자동 조회에 실패했습니다. 종목코드를 입력한 뒤 조회해 주세요.",
          );
        }
      } finally {
        if (!cancelled) setLooking(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, draft?.stock_name, draft?.symbol]);

  if (!open || !draft) return null;

  async function lookupBySymbol() {
    const sym = symbol.trim();
    if (sym.length !== 6) {
      setError("6자리 종목코드를 입력하세요.");
      return;
    }
    setLooking(true);
    setError("");
    try {
      const r = await watchlistApi.lookupSymbol(sym);
      setLookup(r);
      setName(r.stock_name);
    } catch (e) {
      setLookup(null);
      setError(e instanceof Error ? e.message : "코드 조회 실패");
    } finally {
      setLooking(false);
    }
  }

  async function lookupByName() {
    const nm = name.trim();
    if (!nm) {
      setError("종목명을 입력하세요.");
      return;
    }
    setLooking(true);
    setError("");
    try {
      const r = await watchlistApi.lookupName(nm);
      setLookup(r);
      setSymbol(r.symbol);
      setName(r.stock_name);
    } catch (e) {
      setLookup(null);
      setError(e instanceof Error ? e.message : "이름 조회 실패");
    } finally {
      setLooking(false);
    }
  }

  async function doRegister() {
    const sym = symbol.trim();
    if (sym.length !== 6) {
      setError("6자리 종목코드를 확인한 뒤 등록하세요.");
      return;
    }
    setRegistering(true);
    setError("");
    try {
      await watchlistApi.add({
        stock_name: name.trim() || lookup?.stock_name || draft!.stock_name,
        symbol: sym,
        sector: lookup?.sector || draft!.sector,
        source_type: draft!.source_type ?? "sector",
        source_id: draft!.source_id,
      });
      onRegistered();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "등록 실패");
    } finally {
      setRegistering(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl border border-[var(--border-subtle)] bg-[var(--surface)] p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
            지켜보기 등록
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            <X size={18} />
          </button>
        </div>

        <p className="mb-3 text-xs text-neutral-500">
          종목코드를 검색·확인한 뒤 등록합니다. AI 분석·차트는 이 코드로 연결됩니다.
        </p>

        <div className="space-y-3">
          <label className="block text-xs font-medium text-neutral-500">
            종목명
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 block w-full rounded-md border border-[var(--border-subtle)] bg-[var(--background)] px-3 py-2 text-sm"
            />
          </label>

          <label className="block text-xs font-medium text-neutral-500">
            종목코드 (6자리)
            <input
              value={symbol}
              onChange={(e) => setSymbol(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="005930"
              className="mt-1 block w-full rounded-md border border-[var(--border-subtle)] bg-[var(--background)] px-3 py-2 text-sm font-mono"
            />
          </label>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={lookupByName}
              disabled={looking}
              className="flex items-center gap-1 rounded-md border border-[var(--border-subtle)] px-3 py-1.5 text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:opacity-50"
            >
              {looking ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />}
              이름으로 코드 찾기
            </button>
            <button
              type="button"
              onClick={lookupBySymbol}
              disabled={looking || symbol.length !== 6}
              className="flex items-center gap-1 rounded-md border border-[var(--border-subtle)] px-3 py-1.5 text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:opacity-50"
            >
              {looking ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />}
              코드로 확인
            </button>
          </div>

          {lookup && (
            <div className="rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300">
              ✓ <span className="font-mono">{lookup.symbol}</span> {lookup.stock_name}
              {lookup.sector && ` · ${lookup.sector}`}
              {lookup.current_price != null &&
                ` · ${lookup.current_price.toLocaleString("ko-KR")}원`}
            </div>
          )}

          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-2 text-sm text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
          >
            취소
          </button>
          <button
            type="button"
            onClick={doRegister}
            disabled={registering || symbol.length !== 6}
            className="flex items-center gap-1.5 rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
          >
            {registering ? <Loader2 size={14} className="animate-spin" /> : <Star size={14} />}
            지켜보기 등록
          </button>
        </div>
      </div>
    </div>
  );
}
