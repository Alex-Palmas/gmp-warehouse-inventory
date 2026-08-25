import { DISPLAY_TZ } from '../types';

export function nowUtcIso(): string {
  return new Date().toISOString();
}

export function toDisplayLocal(isoUtc: string): string {
  const d = new Date(isoUtc);
  if (Number.isNaN(d.getTime())) return isoUtc;
  return new Intl.DateTimeFormat('en-US', {
    timeZone: DISPLAY_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZoneName: 'short',
  }).format(d);
}

export function todayIsoDateInTz(tz: string = DISPLAY_TZ): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === 'year')?.value;
  const m = parts.find((p) => p.type === 'month')?.value;
  const d = parts.find((p) => p.type === 'day')?.value;
  return `${y}-${m}-${d}`;
}

export function isExpired(expiryDate: string, asOf: string = todayIsoDateInTz()): boolean {
  if (!expiryDate) return false;
  return expiryDate < asOf;
}

export function daysUntil(dateIso: string, asOf: string = todayIsoDateInTz()): number {
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${dateIso}T00:00:00Z`);
  return Math.round((b - a) / 86400000);
}

export function locationToString(loc: {
  site: string;
  building: string;
  room: string;
  rack: string;
  shelf: string;
  bin: string;
}): string {
  return [loc.site, loc.building, loc.room, loc.rack, loc.shelf, loc.bin].filter(Boolean).join(' / ');
}
