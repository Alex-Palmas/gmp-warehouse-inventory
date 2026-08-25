import { describe, expect, it } from 'vitest';
import * as audit from '../lib/audit';
import { AUDIT_MUTATION_API } from '../lib/audit';

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
});
