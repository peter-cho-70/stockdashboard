import type { KrMarketSnapshot, UsMarketReport } from "./api";

const US_REPORT_KEY = "stockmind-us-report-cache";
const KR_SNAPSHOT_KEY = "stockmind-kr-snapshot-cache";

interface CacheEnvelope<T> {
  savedAt: string;
  sessionDate: string;
  data: T;
}

let usReportMemory: UsMarketReport | null = null;
let krSnapshotMemory: KrMarketSnapshot | null = null;

function readCache<T>(key: string): CacheEnvelope<T> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as CacheEnvelope<T>;
  } catch {
    return null;
  }
}

function writeCache<T>(key: string, sessionDate: string, data: T): void {
  if (typeof window === "undefined") return;
  const envelope: CacheEnvelope<T> = {
    savedAt: new Date().toISOString(),
    sessionDate,
    data,
  };
  localStorage.setItem(key, JSON.stringify(envelope));
}

export function loadUsReportCache(): UsMarketReport | null {
  if (usReportMemory?.status === "ready") return usReportMemory;
  const env = readCache<UsMarketReport>(US_REPORT_KEY);
  const data = env?.data?.status === "ready" ? env.data : null;
  if (data) usReportMemory = data;
  return data;
}

export function saveUsReportCache(report: UsMarketReport): void {
  if (report.status !== "ready") return;
  usReportMemory = report;
  writeCache(US_REPORT_KEY, report.report_date, report);
}

export function loadKrSnapshotCache(sessionDate?: string): KrMarketSnapshot | null {
  if (krSnapshotMemory && (!sessionDate || krSnapshotMemory.session_date === sessionDate)) {
    return krSnapshotMemory;
  }
  const env = readCache<KrMarketSnapshot>(KR_SNAPSHOT_KEY);
  if (!env?.data) return null;
  if (sessionDate && env.sessionDate !== sessionDate) return null;
  krSnapshotMemory = env.data;
  return env.data;
}

export function saveKrSnapshotCache(snapshot: KrMarketSnapshot): void {
  krSnapshotMemory = snapshot;
  writeCache(KR_SNAPSHOT_KEY, snapshot.session_date, snapshot);
}
