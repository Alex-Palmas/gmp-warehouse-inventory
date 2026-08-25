import { describe, expect, it } from 'vitest';
import { shouldWarnFefo, isIssueBlocked } from '../lib/fefo';

const asOf = '2026-08-24';

describe('FEFO warning', () => {
  const lots = [
    { serial: 'WH-2026-000001', materialCode: 'API-001', status: 'Released', expiryDate: '2028-06-30', currentQty: 25 },
    { serial: 'WH-2026-000002', materialCode: 'API-001', status: 'Released', expiryDate: '2027-03-15', currentQty: 25 },
    { serial: 'WH-2026-000003', materialCode: 'API-001', status: 'Quarantine', expiryDate: '2026-09-01', currentQty: 25 },
    { serial: 'WH-2026-000005', materialCode: 'RM-002', status: 'Released', expiryDate: '2026-09-01', currentQty: 40 },
  ];

  it('warns when issuing later-expiry lot while earlier Released lot exists', () => {
    const r = shouldWarnFefo(lots[0], lots, asOf);
    expect(r.warn).toBe(true);
    expect(r.earlier.map((e) => e.serial)).toContain('WH-2026-000002');
  });

  it('does not warn when issuing the earliest-expiry Released lot', () => {
    const r = shouldWarnFefo(lots[1], lots, asOf);
    expect(r.warn).toBe(false);
  });

  it('ignores quarantine earlier lots for FEFO', () => {
    const r = shouldWarnFefo(lots[1], lots, asOf);
    expect(r.earlier.map((e) => e.serial)).not.toContain('WH-2026-000003');
  });

  it('does not warn across different materials', () => {
    const r = shouldWarnFefo(lots[0], lots, asOf);
    expect(r.earlier.map((e) => e.serial)).not.toContain('WH-2026-000005');
  });

  it('blocks expired regardless of FEFO', () => {
    expect(
      isIssueBlocked(
        { serial: 'X', materialCode: 'API-001', status: 'Released', expiryDate: '2020-01-01', currentQty: 1 },
        asOf,
      ).blocked,
    ).toBe(true);
  });
});
