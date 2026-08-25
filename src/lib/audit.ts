/**
 * Append-only audit trail. There is intentionally NO update or delete API.
 * UI must never present edit/delete of audit rows.
 * 21 CFR 11.10(e): computer-generated, time-stamped audit trail of operator
 * entries and actions that create, modify, or delete electronic records.
 */
import type { AuditAction, AuditEntry, Session } from '../types';
import { getDb } from './db';
import { nowUtcIso, toDisplayLocal } from './dates';
import { newId } from './ids';

export interface AuditInput {
  action: AuditAction | string;
  recordId: string;
  field?: string;
  oldValue?: string;
  newValue?: string;
  reasonForChange?: string;
  meaningOfSignature?: string;
}

function buildEntry(
  userId: string,
  userName: string,
  role: string,
  input: AuditInput,
): AuditEntry {
  const utc = nowUtcIso();
  return {
    id: newId('AUD'),
    timestampUtc: utc,
    timestampLocal: toDisplayLocal(utc),
    userId,
    userName,
    role: role ?? '',
    action: input.action,
    recordId: input.recordId,
    field: input.field ?? '',
    oldValue: input.oldValue ?? '',
    newValue: input.newValue ?? '',
    reasonForChange: input.reasonForChange ?? '',
    meaningOfSignature: input.meaningOfSignature ?? '',
  };
}

export async function appendAudit(session: Session, input: AuditInput): Promise<AuditEntry> {
  const entry = buildEntry(session.userId, session.fullName, session.role ?? '', input);
  const db = await getDb();
  await db.add('audit', entry);
  return entry;
}

/**
 * Audit without an authenticated session (LOGIN_FAIL, LOCKOUT). Still writes
 * userId so the trail remains attributable. Add-only, same store.
 * Pass role when the account is known; unknown users get ''.
 */
export async function appendAuditSystem(
  userId: string,
  userName: string,
  input: AuditInput,
  role = '',
): Promise<AuditEntry> {
  const entry = buildEntry(userId || 'unknown', userName || '', role ?? '', input);
  const db = await getDb();
  await db.add('audit', entry);
  return entry;
}

export async function listAudit(limit?: number): Promise<AuditEntry[]> {
  const db = await getDb();
  const all = (await db.getAll('audit')) as AuditEntry[];
  all.sort((a, b) => b.timestampUtc.localeCompare(a.timestampUtc));
  return limit ? all.slice(0, limit) : all;
}

export async function listAuditForRecord(recordId: string): Promise<AuditEntry[]> {
  const all = await listAudit();
  return all.filter((e) => e.recordId === recordId);
}

export const AUDIT_CSV_HEADERS = [
  'id',
  'timestampUtc',
  'timestampLocal',
  'userId',
  'userName',
  'role',
  'action',
  'recordId',
  'field',
  'oldValue',
  'newValue',
  'reasonForChange',
  'meaningOfSignature',
] as const;

export function formatAuditCsv(rows: AuditEntry[]): string {
  const headers = [...AUDIT_CSV_HEADERS];
  const esc = (v: string) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [headers.join(',')];
  for (const r of rows) {
    lines.push(
      [
        r.id,
        r.timestampUtc,
        r.timestampLocal,
        r.userId,
        r.userName,
        r.role || '',
        r.action,
        r.recordId,
        r.field,
        r.oldValue,
        r.newValue,
        r.reasonForChange,
        r.meaningOfSignature,
      ]
        .map(esc)
        .join(','),
    );
  }
  return lines.join('\n');
}

/** Exported only so tests can prove these do not exist on the public module. */
export const AUDIT_MUTATION_API = {
  appendAudit: true,
  appendAuditSystem: true,
  listAudit: true,
  listAuditForRecord: true,
  formatAuditCsv: true,
  updateAudit: false,
  deleteAudit: false,
} as const;
