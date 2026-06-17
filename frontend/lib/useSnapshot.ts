import { useCallback, useEffect, useState } from "react";
import { useRoutineStore, isSnapshotStale, type SnapshotData } from "./routineStore";
import { morningApi } from "./morningApi";

export type { SnapshotData };

/** API 응답(snake_case) → 스토어 타입(camelCase) 변환 */
function toSnapshotData(raw: Awaited<ReturnType<typeof morningApi.getSnapshot>>): SnapshotData {
  return {
    nasdaq:     raw.nasdaq,
    sp500:      raw.sp500,
    dow:        raw.dow,
    sox:        raw.sox,
    vix:        raw.vix,
    us10yYield: raw.us10y_yield,
    dxy:        raw.dxy,
    usdKrw:     raw.usd_krw,
    wti:        raw.wti,
    fetchedAt:  raw.fetched_at ?? new Date().toISOString(),
  };
}

interface UseSnapshotReturn {
  snapshot: SnapshotData | null;
  loading: boolean;
  error: string;
  /** 캐시가 신선하면 재사용, 5분 초과 or null이면 API 호출 */
  fetch: () => Promise<SnapshotData | null>;
  /** 캐시 무시하고 강제 갱신 */
  refresh: () => Promise<SnapshotData | null>;
}

export function useSnapshot({ autoFetch = false }: { autoFetch?: boolean } = {}): UseSnapshotReturn {
  const { snapshot, setSnapshot } = useRoutineStore();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const doFetch = useCallback(async (): Promise<SnapshotData | null> => {
    setLoading(true);
    setError("");
    try {
      const raw = await morningApi.getSnapshot();
      const snap = toSnapshotData(raw);
      setSnapshot(snap);
      return snap;
    } catch (e) {
      setError((e as Error).message || "자동 조회 실패. 수동 입력하세요.");
      return null;
    } finally {
      setLoading(false);
    }
  }, [setSnapshot]);

  // 마운트 시 캐시가 만료됐을 때만 자동 조회 (autoFetch=true인 경우)
  useEffect(() => {
    if (autoFetch && isSnapshotStale(useRoutineStore.getState().snapshot)) {
      doFetch();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetch = useCallback(async (): Promise<SnapshotData | null> => {
    if (!isSnapshotStale(snapshot)) return snapshot;
    return doFetch();
  }, [snapshot, doFetch]);

  const refresh = useCallback(async (): Promise<SnapshotData | null> => {
    return doFetch();
  }, [doFetch]);

  return { snapshot, loading, error, fetch, refresh };
}
