import { describe, expect, it } from 'vitest';
import { applyViewAs, viewAsOptions } from '../lib/viewAs';
import { defaultAllows } from '../lib/permissions';
import type { Session } from '../types';

function superSession(): Session {
  return {
    userId: 'super',
    fullName: 'Presentation Superuser',
    role: 'super',
    roleName: 'Presentation Superuser',
    startedUtc: '2026-08-25T00:00:00.000Z',
    lastActivityUtc: '2026-08-25T00:00:00.000Z',
    mustChangePassword: false,
  };
}

describe('presentation view-as', () => {
  it('lists All access first', () => {
    expect(viewAsOptions()[0]).toEqual({ roleId: 'super', name: 'All access' });
  });

  it('does not overlay a non-super session', () => {
    const s: Session = { ...superSession(), userId: 'wh', role: 'operator', roleName: 'Warehouse Operator' };
    expect(applyViewAs(s, 'qa').role).toBe('operator');
  });

  it('overlays QA / operator / readonly on super', () => {
    const s = superSession();
    expect(applyViewAs(s, 'qa').role).toBe('qa');
    expect(applyViewAs(s, 'qa').roleName).toBe('QA');
    expect(applyViewAs(s, 'operator').role).toBe('operator');
    expect(applyViewAs(s, 'readonly').role).toBe('readonly');
    expect(applyViewAs(s, 'super').role).toBe('super');
    expect(applyViewAs(s, 'not-a-role').role).toBe('super');
  });

  it('overlaid role matches that role matrix, not all-access', () => {
    const qa = applyViewAs(superSession(), 'qa');
    expect(defaultAllows(qa.role, 'qaDisposition')).toBe(true);
    expect(defaultAllows(qa.role, 'receive')).toBe(false);
    const op = applyViewAs(superSession(), 'operator');
    expect(defaultAllows(op.role, 'receive')).toBe(true);
    expect(defaultAllows(op.role, 'qaDisposition')).toBe(false);
    const ro = applyViewAs(superSession(), 'readonly');
    expect(defaultAllows(ro.role, 'viewDashboard')).toBe(true);
    expect(defaultAllows(ro.role, 'submitRequest')).toBe(false);
  });

  it('applyViewAs keeps userId super while overlaying operator role', () => {
    const overlaid = applyViewAs(superSession(), 'operator');
    expect(overlaid.userId).toBe('super');
    expect(overlaid.role).toBe('operator');
  });
});
