import type { InventoryRecord, Status } from '../types';
import { STATUSES } from '../types';
import { daysUntil, isExpired } from './dates';

export type ExtraRegisterFilter = '' | 'expired' | 'exp30' | 'exp90' | 'reserved';

export const EXTRA_FILTERS: { value: ExtraRegisterFilter; label: string }[] = [
  { value: '', label: 'No extra filter' },
  { value: 'expired', label: 'Expired (not destroyed)' },
  { value: 'exp30', label: 'Expires within 30 days' },
  { value: 'exp90', label: 'Expires in 31–90 days' },
  { value: 'reserved', label: 'Reserved, unpicked' },
];

export function parseRegisterQuery(sp: { get: (k: string) => string | null }): {
  status: Status | '';
  extra: ExtraRegisterFilter;
} {
  const statusRaw = sp.get('status') || '';
  const extraRaw = sp.get('filter') || '';
  const status = (STATUSES as readonly string[]).includes(statusRaw) ? (statusRaw as Status) : '';
  const extra: ExtraRegisterFilter = EXTRA_FILTERS.some((f) => f.value && f.value === extraRaw)
    ? (extraRaw as ExtraRegisterFilter)
    : '';
  return { status, extra };
}

/** Matches dashboard KPI counts so click-through lists agree with the card. */
export function matchesRegisterKpi(
  r: InventoryRecord,
  opts: { status?: string; extra?: ExtraRegisterFilter; asOf: string },
): boolean {
  if (opts.status && r.status !== opts.status) return false;
  const extra = opts.extra || '';
  if (extra === 'expired') {
    return Boolean(r.expiryDate && isExpired(r.expiryDate, opts.asOf) && r.status !== 'Destroyed');
  }
  if (extra === 'exp30') {
    const d = daysUntil(r.expiryDate, opts.asOf);
    return d >= 0 && d <= 30 && r.currentQty > 0 && r.status !== 'Destroyed';
  }
  if (extra === 'exp90') {
    const d = daysUntil(r.expiryDate, opts.asOf);
    return d > 30 && d <= 90 && r.currentQty > 0 && r.status !== 'Destroyed';
  }
  if (extra === 'reserved') {
    return Boolean(r.reservedForRequestId && (r.reservedQty || 0) > 0);
  }
  return true;
}

export function extraFilterLabel(extra: ExtraRegisterFilter): string {
  return EXTRA_FILTERS.find((f) => f.value === extra)?.label ?? extra;
}
