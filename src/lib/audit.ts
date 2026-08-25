/**
 * Append-only audit trail. There is intentionally NO update or delete API.
 * UI must never present edit/delete of audit rows.
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

export async function appendAudit(session: Session, input: AuditInput): Promise<AuditEntry> {
  const utc = nowUtcIso();
  const entry: AuditEntry = {
    id: newId('AUD'),
    timestampUtc: utc,
    timestampLocal: toDisplayLocal(utc),
    userId: session.userId,
    userName: session.fullName,
    action: input.action,
    recordId: input.recordId,
    field: input.field ?? '',
    oldValue: input.oldValue ?? '',
    newValue: input.newValue ?? '',
    reasonForChange: input.reasonForChange ?? '',
    meaningOfSignature: input.meaningOfSignature ?? '',
  };
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

/** Exported only so tests can prove these do not exist on the public module. */
export const AUDIT_MUTATION_API = {
  appendAudit: true,
  listAudit: true,
  listAuditForRecord: true,
  updateAudit: false,
  deleteAudit: false,
} as const;
