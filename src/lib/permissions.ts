/**
 * Live permission matrix. All authority checks go through hasCapability(session, cap).
 * Role display names are NOT used for authorization.
 */
import type {
  Capability,
  ESign,
  MatrixCellChange,
  MatrixRows,
  PermissionMatrixDocument,
  PermissionMatrixHistory,
  RoleRecord,
  Session,
  SodRules,
} from '../types';
import {
  CAPABILITIES,
  DEFAULT_SOD,
  LEGACY_ROLE_MAP,
  SYSTEM_ROLE_IDS,
} from '../types';
import { getDb } from './db';
import { appendAudit } from './audit';
import { nowUtcIso } from './dates';
import { newId } from './ids';

export function resolveRoleId(role: string | undefined | null): string {
  if (!role) return '';
  return LEGACY_ROLE_MAP[role] ?? role;
}

export function emptyCaps(): Record<Capability, boolean> {
  const o = {} as Record<Capability, boolean>;
  for (const c of CAPABILITIES) o[c] = false;
  return o;
}

export function allowCaps(caps: Capability[]): Record<Capability, boolean> {
  const o = emptyCaps();
  for (const c of caps) o[c] = true;
  return o;
}

export const DEFAULT_ROLES: RoleRecord[] = [
  {
    roleId: 'sysadmin',
    name: 'System Administrator',
    description: 'Access control and user admin. Not a warehouse or QA actor (SoD).',
    system: true,
    active: true,
  },
  {
    roleId: 'supervisor',
    name: 'Warehouse Supervisor',
    description: 'Warehouse operations, hold, user admin (cannot edit the permission matrix).',
    system: true,
    active: true,
  },
  {
    roleId: 'operator',
    name: 'Warehouse Operator',
    description: 'Receive, transfer, issue, return, cycle count, labels.',
    system: true,
    active: true,
  },
  {
    roleId: 'qa',
    name: 'QA',
    description: 'Disposition, destroy, hold. Does not receive/issue/transfer (SoD).',
    system: true,
    active: true,
  },
  {
    roleId: 'qc',
    name: 'QC',
    description: 'View, scan, cycle count, reprint. No disposition or user admin.',
    system: true,
    active: true,
  },
  {
    roleId: 'readonly',
    name: 'Read-Only',
    description: 'View dashboard, register, scan, audit. No mutations.',
    system: true,
    active: true,
  },
];

export function defaultMatrixRows(): MatrixRows {
  return {
    sysadmin: allowCaps([
      'viewDashboard',
      'viewRegister',
      'viewAudit',
      'viewAccessLog',
      'scanLookup',
      'adminUsers',
      'editPermissionMatrix',
      'exportReports',
      'backupRestore',
    ]),
    supervisor: allowCaps([
      'viewDashboard',
      'viewRegister',
      'viewAudit',
      'viewAccessLog',
      'scanLookup',
      'receive',
      'transfer',
      'issue',
      'returnToStock',
      'cycleCount',
      'reprintLabel',
      'hold',
      'adminMaterials',
      'adminUsers',
      'exportReports',
      'backupRestore',
    ]),
    operator: allowCaps([
      'viewDashboard',
      'viewRegister',
      'scanLookup',
      'receive',
      'transfer',
      'issue',
      'returnToStock',
      'cycleCount',
      'reprintLabel',
    ]),
    qa: allowCaps([
      'viewDashboard',
      'viewRegister',
      'viewAudit',
      'viewAccessLog',
      'scanLookup',
      'qaDisposition',
      'destroy',
      'hold',
      'adminMaterials',
      'exportReports',
      'backupRestore',
      'eSign',
      'reprintLabel',
    ]),
    qc: allowCaps(['viewDashboard', 'viewRegister', 'scanLookup', 'cycleCount', 'reprintLabel']),
    readonly: allowCaps(['viewDashboard', 'viewRegister', 'scanLookup', 'viewAudit']),
  };
}

export function buildDefaultMatrixDocument(): PermissionMatrixDocument {
  const utc = '2026-01-15T16:00:00.000Z';
  return {
    version: 1,
    rows: defaultMatrixRows(),
    sod: { ...DEFAULT_SOD },
    modifiedBy: 'system',
    modifiedOnUtc: utc,
    approvedBy: 'system',
    approvedOnUtc: utc,
    reasonForChange: 'Seeded default matrix (DOC-WH-INV-001 v1.1)',
    meaningOfSignature: 'System seed',
  };
}

export function defaultAllows(roleId: string, cap: Capability): boolean {
  return Boolean(defaultMatrixRows()[resolveRoleId(roleId)]?.[cap]);
}

export function capabilityAllowed(matrix: PermissionMatrixDocument, roleId: string, cap: Capability): boolean {
  return Boolean(matrix.rows[resolveRoleId(roleId)]?.[cap]);
}

export interface SodViolation {
  roleId: string;
  rule: keyof SodRules;
  message: string;
}

export function evaluateSod(rows: MatrixRows, sod: SodRules): SodViolation[] {
  const violations: SodViolation[] = [];
  for (const roleId of Object.keys(rows)) {
    const r = rows[roleId];
    if (!r) continue;
    if (sod.qaDispositionXorReceive && r.qaDisposition && r.receive) {
      violations.push({
        roleId,
        rule: 'qaDispositionXorReceive',
        message: `SoD: role "${roleId}" cannot combine qaDisposition and receive (21 CFR 211 release vs receipt).`,
      });
    }
    if (sod.destroyRequiresESign && r.destroy && !r.eSign) {
      violations.push({
        roleId,
        rule: 'destroyRequiresESign',
        message: `SoD: role "${roleId}" has destroy but not eSign.`,
      });
    }
    if (sod.editMatrixXorQaDisposition && r.editPermissionMatrix && r.qaDisposition) {
      violations.push({
        roleId,
        rule: 'editMatrixXorQaDisposition',
        message: `SoD: role "${roleId}" cannot combine editPermissionMatrix and qaDisposition.`,
      });
    }
  }
  return violations;
}

export function validateMatrixSave(
  rows: MatrixRows,
  sod: SodRules,
  sodWaiver?: string,
): { errors: string[]; sodViolations: SodViolation[] } {
  const errors: string[] = [];
  const roleIds = Object.keys(rows);
  if (!roleIds.some((id) => rows[id]?.editPermissionMatrix)) {
    errors.push('Cannot save: zero roles have editPermissionMatrix (lockout prevention).');
  }
  if (!roleIds.some((id) => rows[id]?.adminUsers)) {
    errors.push('Cannot save: zero roles have adminUsers (lockout prevention).');
  }
  const sodViolations = evaluateSod(rows, sod);
  if (sodViolations.length && !sodWaiver?.trim()) {
    for (const v of sodViolations) errors.push(v.message);
  }
  return { errors, sodViolations };
}

export function diffMatrix(oldRows: MatrixRows, newRows: MatrixRows): MatrixCellChange[] {
  const changes: MatrixCellChange[] = [];
  const roleIds = new Set([...Object.keys(oldRows), ...Object.keys(newRows)]);
  for (const roleId of roleIds) {
    for (const cap of CAPABILITIES) {
      const oldValue = Boolean(oldRows[roleId]?.[cap]);
      const newValue = Boolean(newRows[roleId]?.[cap]);
      if (oldValue !== newValue) {
        changes.push({ roleId, capability: cap, oldValue, newValue });
      }
    }
  }
  return changes;
}

let _cache: PermissionMatrixDocument | null = null;

export function setMatrixCacheForTests(doc: PermissionMatrixDocument | null): void {
  _cache = doc;
}

export async function getLiveMatrix(): Promise<PermissionMatrixDocument> {
  if (_cache) return _cache;
  try {
    const db = await getDb();
    const doc = (await db.get('meta', 'permissionMatrix')) as PermissionMatrixDocument | undefined;
    if (doc?.rows) {
      _cache = doc;
      return doc;
    }
  } catch {
    /* tests / first boot — fall through to defaults */
  }
  return buildDefaultMatrixDocument();
}

export async function hasCapability(session: Session | null | undefined, cap: Capability): Promise<boolean> {
  if (!session) return false;
  const matrix = await getLiveMatrix();
  return capabilityAllowed(matrix, session.role, cap);
}

export async function assertCapability(session: Session, cap: Capability, msg?: string): Promise<void> {
  if (!(await hasCapability(session, cap))) {
    throw new Error(msg ?? `Capability required: ${cap}`);
  }
}

export async function listSessionCapabilities(session: Session): Promise<Set<Capability>> {
  const matrix = await getLiveMatrix();
  const row = matrix.rows[resolveRoleId(session.role)] ?? emptyCaps();
  return new Set(CAPABILITIES.filter((c) => row[c]));
}

export function qaStatusFromDisposition(d: 'Release' | 'Reject' | 'Restricted') {
  if (d === 'Release') return 'Released' as const;
  if (d === 'Reject') return 'Rejected' as const;
  return 'Restricted' as const;
}

/** Own-receipt SoD: a user cannot e-sign disposition on a record they created. */
export function assertNotOwnReceipt(userId: string, createdBy: string): void {
  if (userId && createdBy && userId === createdBy) {
    throw new Error(
      'Segregation of duties: you cannot e-sign a QA disposition on a container you received.',
    );
  }
}

export async function listRoles(): Promise<RoleRecord[]> {
  try {
    const db = await getDb();
    const all = (await db.getAll('roles')) as RoleRecord[];
    if (all.length) {
      all.sort((a, b) => a.name.localeCompare(b.name));
      return all;
    }
  } catch {
    /* bootstrap */
  }
  return DEFAULT_ROLES.slice();
}

export async function getRole(roleId: string): Promise<RoleRecord | undefined> {
  const id = resolveRoleId(roleId);
  try {
    const db = await getDb();
    const rec = (await db.get('roles', id)) as RoleRecord | undefined;
    if (rec) return rec;
  } catch {
    /* bootstrap */
  }
  return DEFAULT_ROLES.find((r) => r.roleId === id);
}

export async function roleDisplayName(roleId: string): Promise<string> {
  const r = await getRole(roleId);
  return r?.name ?? roleId;
}

export async function savePermissionMatrix(
  session: Session,
  nextRows: MatrixRows,
  nextSod: SodRules,
  esign: ESign,
  reason: string,
  sodWaiver?: string,
): Promise<PermissionMatrixDocument> {
  await assertCapability(session, 'editPermissionMatrix', 'Only roles with editPermissionMatrix may save the matrix');
  if (!reason.trim()) throw new Error('Reason for change is required');
  if (!esign.userId || !esign.printedName || !esign.meaningOfSignature) {
    throw new Error('Electronic signature is incomplete');
  }
  if (esign.userId !== session.userId) throw new Error('Signature user must match session');
  const { errors, sodViolations } = validateMatrixSave(nextRows, nextSod, sodWaiver);
  if (errors.length) throw new Error(errors[0]);
  if (sodViolations.length && !sodWaiver?.trim()) {
    throw new Error(sodViolations[0].message);
  }

  const current = await getLiveMatrix();
  const changes = diffMatrix(current.rows, nextRows);
  const utc = nowUtcIso();
  const next: PermissionMatrixDocument = {
    version: current.version + 1,
    rows: nextRows,
    sod: { ...nextSod },
    modifiedBy: session.userId,
    modifiedOnUtc: utc,
    approvedBy: session.userId,
    approvedOnUtc: utc,
    reasonForChange: reason.trim(),
    meaningOfSignature: esign.meaningOfSignature,
    sodWaiver: sodWaiver?.trim() || undefined,
  };

  const db = await getDb();
  await db.put('meta', next, 'permissionMatrix');
  const hist: PermissionMatrixHistory = {
    id: newId('MXH'),
    version: next.version,
    snapshot: next,
    savedBy: session.userId,
    savedOnUtc: utc,
    reasonForChange: reason.trim(),
    meaningOfSignature: esign.meaningOfSignature,
    cellChanges: changes,
    sodWaiver: next.sodWaiver,
  };
  await db.add('permissionMatrixHistory', hist);
  _cache = next;

  await appendAudit(session, {
    action: 'MATRIX_SAVE',
    recordId: `matrix-v${next.version}`,
    field: 'version',
    oldValue: String(current.version),
    newValue: String(next.version),
    reasonForChange: reason.trim(),
    meaningOfSignature: esign.meaningOfSignature,
  });
  for (const c of changes) {
    await appendAudit(session, {
      action: 'MATRIX_SAVE',
      recordId: `matrix-v${next.version}`,
      field: `${c.roleId}.${c.capability}`,
      oldValue: String(c.oldValue),
      newValue: String(c.newValue),
      reasonForChange: reason.trim(),
      meaningOfSignature: esign.meaningOfSignature,
    });
  }
  return next;
}

export async function listMatrixHistory(): Promise<PermissionMatrixHistory[]> {
  const db = await getDb();
  const all = (await db.getAll('permissionMatrixHistory')) as PermissionMatrixHistory[];
  all.sort((a, b) => b.version - a.version);
  return all;
}

export async function createCustomRole(
  session: Session,
  input: { roleId: string; name: string; description: string },
): Promise<RoleRecord> {
  await assertCapability(session, 'editPermissionMatrix', 'Only matrix editors may create roles');
  const roleId = input.roleId.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
  if (!roleId) throw new Error('Role ID is required (letters, digits, _ -)');
  if ((SYSTEM_ROLE_IDS as readonly string[]).includes(roleId)) {
    throw new Error('Cannot reuse a system role ID');
  }
  const db = await getDb();
  const existing = await db.get('roles', roleId);
  if (existing) throw new Error('Role ID already exists');
  const rec: RoleRecord = {
    roleId,
    name: input.name.trim(),
    description: input.description.trim(),
    system: false,
    active: true,
  };
  if (!rec.name) throw new Error('Role name is required');
  await db.add('roles', rec);
  const matrix = await getLiveMatrix();
  matrix.rows[roleId] = emptyCaps();
  matrix.rows[roleId].viewDashboard = true;
  matrix.rows[roleId].viewRegister = true;
  matrix.rows[roleId].scanLookup = true;
  await db.put('meta', matrix, 'permissionMatrix');
  _cache = matrix;
  await appendAudit(session, {
    action: 'ROLE_CREATE',
    recordId: roleId,
    field: 'name',
    newValue: rec.name,
    reasonForChange: 'Custom role created',
  });
  return rec;
}

export async function setRoleActive(
  session: Session,
  roleId: string,
  active: boolean,
  reason: string,
): Promise<RoleRecord> {
  await assertCapability(session, 'editPermissionMatrix', 'Only matrix editors may change roles');
  if (!reason.trim()) throw new Error('Reason for change is required');
  const db = await getDb();
  const rec = (await db.get('roles', roleId)) as RoleRecord | undefined;
  if (!rec) throw new Error('Role not found');
  if (rec.system && !active) throw new Error('System roles cannot be deactivated');
  if (!active) {
    const users = (await db.getAll('users')) as { role: string }[];
    const assigned = users.filter((u) => resolveRoleId(u.role) === roleId);
    if (assigned.length) {
      throw new Error(`Cannot deactivate: ${assigned.length} user(s) still assigned to this role`);
    }
  }
  const old = String(rec.active);
  rec.active = active;
  await db.put('roles', rec);
  await appendAudit(session, {
    action: 'ROLE_UPDATE',
    recordId: roleId,
    field: 'active',
    oldValue: old,
    newValue: String(active),
    reasonForChange: reason,
  });
  return rec;
}

/** Supervisor may create/deactivate users but must not assign a role that can edit the matrix. */
export async function assertMayAssignRole(session: Session, targetRoleId: string): Promise<void> {
  const matrix = await getLiveMatrix();
  const targetHasMatrix = Boolean(matrix.rows[resolveRoleId(targetRoleId)]?.editPermissionMatrix);
  if (targetHasMatrix && !(await hasCapability(session, 'editPermissionMatrix'))) {
    throw new Error('Cannot assign a role that may edit the permission matrix');
  }
}

export function cloneRows(rows: MatrixRows): MatrixRows {
  const out: MatrixRows = {};
  for (const [id, row] of Object.entries(rows)) {
    out[id] = { ...emptyCaps(), ...row };
  }
  return out;
}

export { SYSTEM_ROLE_IDS };
