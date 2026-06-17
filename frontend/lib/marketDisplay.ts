/** KST 시각·요일 파싱 */
export function getKstParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    weekday: "short",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  const weekdayStr = parts.find((p) => p.type === "weekday")?.value ?? "";
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return {
    hour,
    minute,
    totalMinutes: hour * 60 + minute,
    weekday: weekdayMap[weekdayStr] ?? 0,
  };
}

export function todayKst(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
}

/** KST 08:30~22:59 → 대시보드 시장 블록 하단 */
export function isUsReportAtBottomKST(now = new Date()): boolean {
  const { totalMinutes } = getKstParts(now);
  return totalMinutes >= 8 * 60 + 30 && totalMinutes < 23 * 60;
}

/**
 * 국내 장 마감(15:30) 이후·주말 → 국내 지수 표시
 * 그 외(아침·장중) → 미국 증시(저장 리포트) 표시
 */
export function isKrMarketFocusKST(now = new Date()): boolean {
  const { weekday, totalMinutes } = getKstParts(now);
  if (weekday === 0 || weekday === 6) return true;
  return totalMinutes >= 15 * 60 + 30;
}
