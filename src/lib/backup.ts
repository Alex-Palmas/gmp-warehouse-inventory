import { APP_VERSION, type Session } from '../types';
import { getDb, resetDbConnection, type BackupPayload } from './db';
import { nowUtcIso } from './dates';
import { appendAudit } from './audit';
import { assertCapability, setMatrixCacheForTests } from './permissions';

export async function exportBackup(session: Session): Promise<BackupPayload> {
  await assertCapability(session, 'backupRestore', 'Backup/restore capability required');
  const db = await getDb();
  const payload: BackupPayload = {
    appVersion: APP_VERSION,
    exportedAtUtc: nowUtcIso(),
    users: await db.getAll('users'),
    materials: await db.getAll('materials'),
    inventory: await db.getAll('inventory'),
    movements: await db.getAll('movements'),
    audit: await db.getAll('audit'),
    accessLog: await db.getAll('accessLog'),
    roles: db.objectStoreNames.contains('roles') ? await db.getAll('roles') : [],
    permissionMatrix: (await db.get('meta', 'permissionMatrix')) ?? null,
    permissionMatrixHistory: db.objectStoreNames.contains('permissionMatrixHistory')
      ? await db.getAll('permissionMatrixHistory')
      : [],
    serialCounter: (await db.get('meta', 'serialCounter')) ?? null,
    seeded: Boolean(await db.get('meta', 'seeded')),
  };
  await appendAudit(session, {
    action: 'BACKUP',
    recordId: 'SYSTEM',
    newValue: payload.exportedAtUtc,
    reasonForChange: 'Full JSON backup exported',
  });
  return payload;
}

export async function importBackup(session: Session, payload: BackupPayload): Promise<void> {
  await assertCapability(session, 'backupRestore', 'Backup/restore capability required');
  if (!payload || !Array.isArray(payload.inventory) || !Array.isArray(payload.users)) {
    throw new Error('Invalid backup file');
  }
  await resetDbConnection();
  const db = await getDb();
  const stores = ['users', 'materials', 'inventory', 'movements', 'audit', 'accessLog', 'meta', 'roles', 'permissionMatrixHistory'] as const;
  const tx = db.transaction([...stores], 'readwrite');
  await tx.objectStore('users').clear();
  await tx.objectStore('materials').clear();
  await tx.objectStore('inventory').clear();
  await tx.objectStore('movements').clear();
  await tx.objectStore('audit').clear();
  await tx.objectStore('accessLog').clear();
  await tx.objectStore('meta').clear();
  if (db.objectStoreNames.contains('roles')) await tx.objectStore('roles').clear();
  if (db.objectStoreNames.contains('permissionMatrixHistory')) await tx.objectStore('permissionMatrixHistory').clear();
  for (const u of payload.users) await tx.objectStore('users').put(u);
  for (const m of payload.materials) await tx.objectStore('materials').put(m);
  for (const i of payload.inventory) await tx.objectStore('inventory').put(i);
  for (const m of payload.movements) await tx.objectStore('movements').put(m);
  for (const a of payload.audit) await tx.objectStore('audit').put(a);
  for (const a of payload.accessLog) await tx.objectStore('accessLog').put(a);
  for (const r of payload.roles ?? []) await tx.objectStore('roles').put(r);
  for (const h of payload.permissionMatrixHistory ?? []) await tx.objectStore('permissionMatrixHistory').put(h);
  if (payload.serialCounter) await tx.objectStore('meta').put(payload.serialCounter, 'serialCounter');
  if (payload.permissionMatrix) await tx.objectStore('meta').put(payload.permissionMatrix, 'permissionMatrix');
  await tx.objectStore('meta').put(true, 'seeded');
  await tx.done;
  setMatrixCacheForTests(null);
  await appendAudit(session, {
    action: 'RESTORE',
    recordId: 'SYSTEM',
    newValue: payload.exportedAtUtc ?? '',
    reasonForChange: 'Full JSON backup restored',
  });
}
