/** ISO(UTC Z) · RFC2822 · 브라우저 파싱 가능 문자열 → Date */
export function parseAnyDateTime(raw: string): Date {
  const s = raw.trim();
  if (!s) return new Date(Number.NaN);

  // ISO 8601 (Z 또는 ±offset)
  if (/^\d{4}-\d{2}-\d{2}/.test(s) && /[zZ]|[+-]\d{2}:\d{2}$/.test(s)) {
    return new Date(s);
  }

  // naive UTC ISO from API (2025-06-17T06:35:00)
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) {
    return new Date(`${s.replace(/\.\d+$/, "")}Z`);
  }

  // RSS / RFC2822 등 (Mon, 17 Jun 2025 12:00:00 GMT)
  const native = new Date(s);
  if (!Number.isNaN(native.getTime())) return native;

  return new Date(Number.NaN);
}

/** @deprecated parseAnyDateTime 사용 권장 */
export function parseUtcIso(iso: string): Date {
  return parseAnyDateTime(iso);
}

export function parseUtcIsoMs(iso: string): number {
  return parseAnyDateTime(iso).getTime();
}

export function formatDateTimeKst(
  iso: string,
  options: Intl.DateTimeFormatOptions = {},
): string {
  const d = parseAnyDateTime(iso);
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
