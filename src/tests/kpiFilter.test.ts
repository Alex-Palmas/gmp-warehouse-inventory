import { describe, expect, it } from 'vitest';
import { matchesRegisterKpi, parseRegisterQuery } from '../lib/kpiFilter';
import type { InventoryRecord } from '../types';

const asOf = '2026-08-24';

function rec(p: Partial<InventoryRecord> & { serial: string }): InventoryRecord {
  return {
    serial: p.serial,
    materialCode: 'API-001',
    materialName: 'API',
    itemType: 'API',
    status: p.status ?? 'Released',
    expiryDate: p.expiryDate ?? '2027-01-01',
    currentQty: p.currentQty ?? 10,
    reservedForRequestId: p.reservedForRequestId,
    reservedQty: p.reservedQty,
    recordKind: p.recordKind ?? 'container',
  } as InventoryRecord;
}

describe('parseRegisterQuery', () => {
  it('reads HashRouter status and extra filter', () => {
    const sp = new URLSearchParams('status=Released&filter=exp30');
    expect(parseRegisterQuery(sp)).toEqual({ status: 'Released', extra: 'exp30' });
  });
  it('ignores unknown status/filter', () => {
    const sp = new URLSearchParams('status=Nope&filter=bogus');
    expect(parseRegisterQuery(sp)).toEqual({ status: '', extra: '' });
  });
});

describe('matchesRegisterKpi', () => {
  it('Released includes matching samples, excludes other statuses', () => {
    const sample = rec({ serial: 'S', status: 'Released', recordKind: 'sample' });
    const q = rec({ serial: 'Q', status: 'Quarantine' });
    expect(matchesRegisterKpi(sample, { status: 'Released', asOf })).toBe(true);
    expect(matchesRegisterKpi(q, { status: 'Released', asOf })).toBe(false);
  });
  it('expired is past expiry and not Destroyed', () => {
    expect(matchesRegisterKpi(rec({ serial: 'E', expiryDate: '2026-01-01' }), { extra: 'expired', asOf })).toBe(true);
    expect(
      matchesRegisterKpi(rec({ serial: 'D', expiryDate: '2026-01-01', status: 'Destroyed' }), { extra: 'expired', asOf }),
    ).toBe(false);
    expect(matchesRegisterKpi(rec({ serial: 'F', expiryDate: '2026-12-01' }), { extra: 'expired', asOf })).toBe(false);
  });
  it('exp30 is not expired, within 30 days, not Destroyed', () => {
    expect(matchesRegisterKpi(rec({ serial: 'A', expiryDate: '2026-09-01' }), { extra: 'exp30', asOf })).toBe(true);
    expect(matchesRegisterKpi(rec({ serial: 'B', expiryDate: '2026-08-01' }), { extra: 'exp30', asOf })).toBe(false);
    expect(matchesRegisterKpi(rec({ serial: 'C', expiryDate: '2026-12-01' }), { extra: 'exp30', asOf })).toBe(false);
  });
  it('exp90 is 31–90 days, not overlapping 30d', () => {
    expect(matchesRegisterKpi(rec({ serial: 'A', expiryDate: '2026-10-15' }), { extra: 'exp90', asOf })).toBe(true);
    expect(matchesRegisterKpi(rec({ serial: 'B', expiryDate: '2026-09-01' }), { extra: 'exp90', asOf })).toBe(false);
  });
  it('reserved is reserved-for-request with qty', () => {
    expect(
      matchesRegisterKpi(rec({ serial: 'R', reservedForRequestId: 'MR-1', reservedQty: 1 }), { extra: 'reserved', asOf }),
    ).toBe(true);
    expect(matchesRegisterKpi(rec({ serial: 'N' }), { extra: 'reserved', asOf })).toBe(false);
  });
});
