import { describe, expect, it } from 'vitest';
import * as audit from '../lib/audit';
import { AUDIT_MUTATION_API, formatAuditCsv } from '../lib/audit';
import type { AuditEntry } from '../types';

describe('audit trail append-only', () => {
  it('public module exposes append and list only', () => {
    expect(typeof audit.appendAudit).toBe('function');
    expect(typeof audit.listAudit).toBe('function');
    expect(typeof audit.listAuditForRecord).toBe('function');
  });

  it('has no update or delete API', () => {
    const keys = Object.keys(audit);
    expect(keys).not.toContain('updateAudit');
    expect(keys).not.toContain('deleteAudit');
    expect(keys).not.toContain('putAudit');
    expect(keys).not.toContain('removeAudit');
    expect(keys.filter((k) => /update|delete|remove|clear/i.test(k))).toEqual([]);
    expect(AUDIT_MUTATION_API.updateAudit).toBe(false);
    expect(AUDIT_MUTATION_API.deleteAudit).toBe(false);
    expect(AUDIT_MUTATION_API.appendAudit).toBe(true);
  });

  it('formatAuditCsv includes a role column; missing role serializes as empty string', () => {
    const row = {
      id: 'AUD-1',
      timestampUtc: '2026-01-01T00:00:00.000Z',
      timestampLocal: '2025-12-31 16:00',
      userId: 'wh',
      userName: 'Sam',
      action: 'RECEIVE',
      recordId: 'WH-2026-000001',
      field: 'status',
      oldValue: '',
      newValue: 'Quarantine',
      reasonForChange: '',
      meaningOfSignature: '',
    } as AuditEntry;
    const csv = formatAuditCsv([row]);
    const [header, data] = csv.split('\n');
    const cols = header.split(',');
    expect(cols).toContain('role');
    expect(cols.indexOf('role')).toBe(cols.indexOf('userName') + 1);
    const cells = data.split(',');
    expect(cells[cols.indexOf('role')]).toBe('""');
  });
});
