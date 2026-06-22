/**
 * 카드사 결제 알림 텍스트("사용일MM.DD. / 가맹점명 / 금액원 / 사용시간HH:MM" 반복)를
 * 거래 내역으로 일괄 파싱. 날짜 줄은 같은 날짜의 첫 거래에만 나오고,
 * 같은 날 다음 거래부터는 생략되는 형식을 지원한다.
 */
export interface ParsedBulkTransaction {
  date: string; // YYYY-MM-DD
  memo: string;
  amount: number;
  time?: string; // HH:MM
}

const DATE_RE = /^사용일\s*(\d{1,2})\.(\d{1,2})\.?$/;
const AMOUNT_RE = /^([\d,]+)\s*원$/;
const TIME_RE = /^사용시간\s*(\d{1,2}):(\d{2})$/;

export function parseBulkLedgerText(raw: string, year: number): ParsedBulkTransaction[] {
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const results: ParsedBulkTransaction[] = [];
  let currentDate: string | null = null;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    const dateMatch = line.match(DATE_RE);
    if (dateMatch) {
      const month = dateMatch[1].padStart(2, '0');
      const day = dateMatch[2].padStart(2, '0');
      currentDate = `${year}-${month}-${day}`;
      i++;
      continue;
    }

    if (AMOUNT_RE.test(line) || TIME_RE.test(line)) {
      // 가맹점명 없이 단독으로 나온 금액/시간 줄 — 매칭 불가, 건너뜀
      i++;
      continue;
    }

    const amountMatch = lines[i + 1]?.match(AMOUNT_RE);
    if (currentDate && amountMatch) {
      const amount = Number(amountMatch[1].replace(/,/g, ''));
      let consumed = 2;
      const timeMatch = lines[i + 2]?.match(TIME_RE);
      let time: string | undefined;
      if (timeMatch) {
        time = `${timeMatch[1].padStart(2, '0')}:${timeMatch[2]}`;
        consumed = 3;
      }
      results.push({ date: currentDate, memo: line, amount, time });
      i += consumed;
      continue;
    }

    // 금액 줄이 뒤따르지 않는 미완성 줄 — 건너뜀
    i++;
  }

  return results;
}
