"use client";

import { useState } from "react";
import { Download, Upload, Loader2, AlertTriangle } from "lucide-react";
import { auctionApi, type AuctionBackupRestoreResult } from "@/lib/auctionApi";

export default function AuctionBackupPage() {
  const [restoring, setRestoring] = useState(false);
  const [result, setResult] = useState<AuctionBackupRestoreResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleRestore(file: File) {
    if (
      !confirm(
        "백업 파일로 복구하면 현재 등록된 모든 물건·세입자·비교사례·PDF·이미지가 삭제되고 백업 시점 데이터로 교체됩니다. 계속하시겠습니까?",
      )
    ) {
      return;
    }
    setRestoring(true);
    setError(null);
    setResult(null);
    try {
      const res = await auctionApi.restoreBackup(file);
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "복구 실패");
    } finally {
      setRestoring(false);
    }
  }

  return (
    <div className="max-w-xl space-y-5">
      <h1 className="text-lg font-bold text-neutral-900 dark:text-neutral-100">경매허브 백업</h1>

      <div className="rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-5 space-y-3">
        <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">백업 다운로드</h2>
        <p className="text-xs text-neutral-400">
          등록된 모든 물건·세입자 기록·비교사례·첨부 PDF·표지 썸네일을 ZIP 한 파일로 받습니다. 다른 PC에서도 이 파일로 동일한 데이터를 복구할 수 있습니다.
        </p>
        <a
          href={auctionApi.downloadBackupUrl()}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-amber-600 text-white rounded-md hover:bg-amber-700 transition-colors"
        >
          <Download size={14} />
          ZIP 백업 다운로드
        </a>
      </div>

      <div className="rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-5 space-y-3">
        <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">백업 복구</h2>
        <p className="text-xs text-amber-600 dark:text-amber-400 flex items-start gap-1.5">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          복구하면 현재 데이터는 모두 삭제되고 백업 시점 데이터로 완전히 교체됩니다.
        </p>
        <label className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium border border-neutral-200 dark:border-neutral-700 rounded-md hover:bg-neutral-50 dark:hover:bg-neutral-800 cursor-pointer transition-colors">
          {restoring ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
          ZIP 파일 선택
          <input
            type="file"
            accept=".zip,application/zip"
            className="hidden"
            disabled={restoring}
            onChange={(e) => e.target.files?.[0] && handleRestore(e.target.files[0])}
          />
        </label>

        {error && <p className="text-xs text-rose-500">{error}</p>}
        {result && (
          <div className="text-xs text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 rounded-md p-3">
            복구 완료 — 물건 {result.summary.cases}건, PDF {result.summary.source_documents}건, 세입자 기록{" "}
            {result.summary.tenant_records}건, 비교사례 {result.summary.sale_comparables}건
          </div>
        )}
      </div>
    </div>
  );
}
