import type { FinanceHubBackup, FinanceBackupRestoreResult } from "@/lib/api";
import { api } from "@/lib/api";

export function downloadFinanceBackup(backup: FinanceHubBackup) {
  const date = new Date().toISOString().slice(0, 10);
  const blob = new Blob([JSON.stringify(backup, null, 2)], {
    type: "application/json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `financehub-backup-${date}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function exportAndDownloadFinanceBackup() {
  const backup = await api.exportFinanceBackup();
  downloadFinanceBackup(backup);
  return backup;
}

export async function parseFinanceBackupFile(file: File): Promise<Record<string, unknown>> {
  const text = await file.text();
  const parsed = JSON.parse(text) as unknown;
  if (!parsed || typeof parsed !== "object") {
    throw new Error("백업 파일 형식이 올바르지 않습니다.");
  }
  const data = parsed as Record<string, unknown>;
  const hasFinance = data.finance && typeof data.finance === "object";
  const hasLedger = data.ledger && typeof data.ledger === "object";
  if (!hasFinance && !hasLedger) {
    throw new Error("finance 또는 ledger 데이터가 포함된 백업 파일이 필요합니다.");
  }
  return data;
}

export function formatBackupSummary(summary: FinanceBackupRestoreResult["summary"]) {
  return [
    `가계부 ${summary.transactions}건`,
    `자산 ${summary.cashAssets + summary.illiquidAssets + summary.realEstateAssets}건`,
    `부채 ${summary.liabilities}건`,
    `수입 ${summary.incomes}건`,
    `고정지출 ${summary.fixedExpenses}건`,
    `자금계획 ${summary.fundingNeeds}건`,
  ].join(" · ");
}
