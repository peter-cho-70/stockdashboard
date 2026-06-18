/** DB/API naive UTC ISO → Date (항상 UTC로 해석) */
export function parseUtcIso(iso: string): Date {
  const s = iso.trim();
  if (!s) return new Date(Number.NaN);
  if (/[zZ]|[+-]\d{2}:\d{2}$/.test(s)) return new Date(s);
  return new Date(`${s.replace(/\.\d+$/, "")}Z`);
}

export function parseUtcIsoMs(iso: string): number {
  return parseUtcIso(iso).getTime();
}

export function formatDateTimeKst(
  iso: string,
  options: Intl.DateTimeFormatOptions = {},
): string {
  const d = parseUtcIso(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    ...options,
  });
}
