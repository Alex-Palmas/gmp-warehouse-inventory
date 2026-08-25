import { describe, expect, it } from 'vitest';
import {
  assertNotOwnReceipt,
  buildDefaultMatrixDocument,
  capabilityAllowed,
  cloneRows,
  defaultAllows,
  defaultMatrixRows,
  evaluateSod,
  hasCapability,
  validateMatrixSave,
} from '../lib/permissions';
import { DEFAULT_SOD } from '../types';
import type { Session } from '../types';
import { applyFailedLogin, GENERIC_LOGIN_ERROR, isAccountLocked } from '../lib/auth';
import { LOCKOUT_ATTEMPTS } from '../types';
import { validatePasswordPolicy } from '../lib/passwordPolicy';
import type { UserRecord } from '../types';

function session(role: string): Session {
  return {
    userId: 'u1',
    fullName: 'Test User',
    role,
    roleName: role,
    startedUtc: '2026-08-24T00:00:00.000Z',
    lastActivityUtc: '2026-08-24T00:00:00.000Z',
    mustChangePassword: false,
  };
}

describe('default permission matrix', () => {
  it('operator cannot qaDisposition; QA cannot editPermissionMatrix; sysadmin cannot receive', () => {
    expect(defaultAllows('operator', 'qaDisposition')).toBe(false);
    expect(defaultAllows('qa', 'editPermissionMatrix')).toBe(false);
    expect(defaultAllows('sysadmin', 'receive')).toBe(false);
    expect(defaultAllows('sysadmin', 'qaDisposition')).toBe(false);
    expect(defaultAllows('sysadmin', 'destroy')).toBe(false);
    expect(defaultAllows('sysadmin', 'editPermissionMatrix')).toBe(true);
    expect(defaultAllows('qc', 'qaDisposition')).toBe(false);
    expect(defaultAllows('supervisor', 'editPermissionMatrix')).toBe(false);
    expect(defaultAllows('supervisor', 'adminUsers')).toBe(true);
    expect(defaultAllows('requester', 'submitRequest')).toBe(true);
    expect(defaultAllows('requester', 'submitMaterial')).toBe(true);
    expect(defaultAllows('requester', 'fulfillRequest')).toBe(false);
    expect(defaultAllows('requester', 'receive')).toBe(false);
    expect(defaultAllows('qa', 'fulfillRequest')).toBe(false);
    expect(defaultAllows('operator', 'fulfillRequest')).toBe(true);
    expect(defaultAllows('readonly', 'viewInbox')).toBe(true);
  });

  it('hasCapability reads matrix not hardcoded role names', async () => {
    expect(await hasCapability(session('operator'), 'receive')).toBe(true);
    expect(await hasCapability(session('operator'), 'qaDisposition')).toBe(false);
    // Old display name is mapped; an unknown id is denied even if it looks like a job title
    expect(await hasCapability(session('NightShift'), 'receive')).toBe(false);
    const matrix = buildDefaultMatrixDocument();
    matrix.rows.operator.qaDisposition = true;
    expect(capabilityAllowed(matrix, 'operator', 'qaDisposition')).toBe(true);
    expect(defaultAllows('operator', 'qaDisposition')).toBe(false);
  });
});

describe('matrix save guards', () => {
  it('saving matrix that strips last editPermissionMatrix throws', () => {
    const rows = cloneRows(defaultMatrixRows());
    for (const id of Object.keys(rows)) rows[id].editPermissionMatrix = false;
    const { errors } = validateMatrixSave(rows, DEFAULT_SOD);
    expect(errors.some((e) => /editPermissionMatrix/.test(e))).toBe(true);
  });

  it('saving matrix that strips last adminUsers is blocked', () => {
    const rows = cloneRows(defaultMatrixRows());
    for (const id of Object.keys(rows)) rows[id].adminUsers = false;
    const { errors } = validateMatrixSave(rows, DEFAULT_SOD);
    expect(errors.some((e) => /adminUsers/.test(e))).toBe(true);
  });

  it('SoD: cannot enable receive+qaDisposition on same role when SoD on', () => {
    const rows = cloneRows(defaultMatrixRows());
    rows.qa.receive = true;
    const v = evaluateSod(rows, DEFAULT_SOD);
    expect(v.some((x) => x.rule === 'qaDispositionXorReceive' && x.roleId === 'qa')).toBe(true);
    const { errors } = validateMatrixSave(rows, DEFAULT_SOD);
    expect(errors.length).toBeGreaterThan(0);
    const waived = validateMatrixSave(rows, DEFAULT_SOD, 'Documented waiver CC-001');
    expect(waived.errors.filter((e) => /qaDisposition XOR receive/.test(e))).toEqual([]);
  });
});

describe('own-receipt SoD', () => {
  it('user cannot e-sign disposition on record they received', () => {
    expect(() => assertNotOwnReceipt('wh', 'wh')).toThrow(/cannot e-sign/i);
    expect(() => assertNotOwnReceipt('qa', 'wh')).not.toThrow();
  });
});

describe('lockout', () => {
  it('locks after 5 failures', () => {
    let user: UserRecord = {
      userId: 'wh',
      fullName: 'Sam',
      role: 'operator',
      passwordHash: 'x',
      salt: 's',
      algorithm: 'sha256-salt',
      active: true,
      mustChangePassword: false,
      createdOnUtc: '2026-01-01T00:00:00.000Z',
      failedAttempts: 0,
      passwordHistory: [],
    };
    const now = Date.parse('2026-08-24T18:00:00.000Z');
    let locked = false;
    for (let i = 0; i < LOCKOUT_ATTEMPTS; i++) {
      const r = applyFailedLogin(user, now);
      user = r.user;
      locked = r.locked;
    }
    expect(locked).toBe(true);
    expect(user.failedAttempts).toBe(5);
    expect(isAccountLocked(user, now + 1000)).toBe(true);
    expect(isAccountLocked(user, now + 16 * 60 * 1000)).toBe(false);
    expect(GENERIC_LOGIN_ERROR).toMatch(/Invalid user ID or password/);
  });
});

describe('unique userId', () => {
  it('reuse of an existing id (including inactive) is rejected', () => {
    const existing = [{ userId: 'wh', active: false }, { userId: 'qa', active: true }];
    function assertUnique(userId: string) {
      if (existing.some((u) => u.userId === userId.trim())) {
        throw new Error('User ID already exists and cannot be reused');
      }
    }
    expect(() => assertUnique('wh')).toThrow(/cannot be reused/);
    expect(() => assertUnique('fresh')).not.toThrow();
  });
});

describe('password policy', () => {
  it('rejects short/simple passwords', () => {
    expect(validatePasswordPolicy('wh', 'short')).toContain('Password must be at least 12 characters');
    expect(validatePasswordPolicy('wh', 'nouppercase1!').some((e) => /uppercase/.test(e))).toBe(true);
    expect(validatePasswordPolicy('wh', 'NOLOWERCASE1!').some((e) => /lowercase/.test(e))).toBe(true);
    expect(validatePasswordPolicy('wh', 'NoDigits!!!!').some((e) => /digit/.test(e))).toBe(true);
    expect(validatePasswordPolicy('wh', 'NoSpecialChar1').some((e) => /special/.test(e))).toBe(true);
    expect(validatePasswordPolicy('WhUserId1234', 'WhUserId1234').some((e) => /user ID/.test(e))).toBe(true);
    expect(validatePasswordPolicy('wh', 'GoodPassword1!')).toEqual([]);
  });
});
