import { describe, expect, it } from 'vitest';
import { defaultAllows, qaStatusFromDisposition } from '../lib/permissions';
import { isIssueBlocked } from '../lib/fefo';

describe('status workflow', () => {
  it('operator cannot release (QA-only disposition)', () => {
    expect(defaultAllows('operator', 'qaDisposition')).toBe(false);
    expect(defaultAllows('supervisor', 'qaDisposition')).toBe(false);
    expect(defaultAllows('readonly', 'qaDisposition')).toBe(false);
    expect(defaultAllows('qa', 'qaDisposition')).toBe(true);
  });

  it('operator can receive/move/issue; read-only cannot mutate', () => {
    expect(defaultAllows('operator', 'receive')).toBe(true);
    expect(defaultAllows('operator', 'issue')).toBe(true);
    expect(defaultAllows('readonly', 'receive')).toBe(false);
    expect(defaultAllows('readonly', 'issue')).toBe(false);
    expect(defaultAllows('operator', 'destroy')).toBe(false);
    expect(defaultAllows('qa', 'destroy')).toBe(true);
  });

  it('QA cannot receive/issue/transfer under default SoD matrix', () => {
    expect(defaultAllows('qa', 'receive')).toBe(false);
    expect(defaultAllows('qa', 'issue')).toBe(false);
    expect(defaultAllows('qa', 'transfer')).toBe(false);
  });

  it('disposition maps to controlled statuses', () => {
    expect(qaStatusFromDisposition('Release')).toBe('Released');
    expect(qaStatusFromDisposition('Reject')).toBe('Rejected');
    expect(qaStatusFromDisposition('Restricted')).toBe('Restricted');
  });

  it('cannot issue quarantine stock', () => {
    const r = isIssueBlocked(
      { serial: 'WH-2026-000004', materialCode: 'RM-001', status: 'Quarantine', expiryDate: '2028-01-01', currentQty: 10 },
      '2026-08-24',
    );
    expect(r.blocked).toBe(true);
    expect(r.reason).toMatch(/Quarantine/);
  });

  it('cannot issue expired stock even if Released', () => {
    const r = isIssueBlocked(
      { serial: 'WH-2026-000007', materialCode: 'API-002', status: 'Released', expiryDate: '2025-12-31', currentQty: 30 },
      '2026-08-24',
    );
    expect(r.blocked).toBe(true);
    expect(r.reason).toMatch(/expired/i);
  });

  it('allows issue of Released non-expired stock', () => {
    const r = isIssueBlocked(
      { serial: 'WH-2026-000001', materialCode: 'API-001', status: 'Released', expiryDate: '2028-06-30', currentQty: 25 },
      '2026-08-24',
    );
    expect(r.blocked).toBe(false);
  });
});
