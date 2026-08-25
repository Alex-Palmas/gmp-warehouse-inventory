const SERIAL_RE = /^WH-(\d{4})-(\d{6})$/;

export function formatSerial(year: number, n: number): string {
  if (!Number.isInteger(year) || year < 2000 || year > 9999) {
    throw new Error('Invalid serial year');
  }
  if (!Number.isInteger(n) || n < 1 || n > 999999) {
    throw new Error('Invalid serial sequence');
  }
  return `WH-${year}-${String(n).padStart(6, '0')}`;
}

export function parseSerial(serial: string): { year: number; n: number } | null {
  const m = SERIAL_RE.exec(serial);
  if (!m) return null;
  return { year: Number(m[1]), n: Number(m[2]) };
}

export function isValidSerial(serial: string): boolean {
  return parseSerial(serial) !== null;
}

export function nextSerial(year: number, lastN: number, nowYear: number): { serial: string; year: number; n: number } {
  const y = nowYear;
  const n = y === year ? lastN + 1 : 1;
  return { serial: formatSerial(y, n), year: y, n };
}

export function assertSerialUnique(serial: string, existing: Iterable<string>): void {
  for (const s of existing) {
    if (s === serial) throw new Error(`Serial ${serial} already allocated and must never be reused`);
  }
}
