import type { Capability, InboxKind, InboxMessage, Session } from '../types';
import { getDb } from './db';
import { nowUtcIso } from './dates';
import { newId } from './ids';
import { getLiveMatrix, hasCapability } from './permissions';
import type { UserRecord } from '../types';

export async function listInbox(userId: string): Promise<InboxMessage[]> {
  const db = await getDb();
  const all = (await db.getAll('inbox')) as InboxMessage[];
  return all.filter((m) => m.userId === userId).sort((a, b) => b.createdOnUtc.localeCompare(a.createdOnUtc));
}

export async function unreadInboxCount(userId: string): Promise<number> {
  const rows = await listInbox(userId);
  return rows.filter((m) => !m.read).length;
}

export async function markInboxRead(id: string, userId: string): Promise<void> {
  const db = await getDb();
  const rec = (await db.get('inbox', id)) as InboxMessage | undefined;
  if (!rec || rec.userId !== userId) return;
  rec.read = true;
  await db.put('inbox', rec);
}

export async function markAllInboxRead(userId: string): Promise<void> {
  const db = await getDb();
  const all = (await db.getAll('inbox')) as InboxMessage[];
  for (const m of all) {
    if (m.userId === userId && !m.read) {
      m.read = true;
      await db.put('inbox', m);
    }
  }
}

export async function notifyUser(
  userId: string,
  title: string,
  body: string,
  kind: InboxKind,
  relatedId: string,
): Promise<InboxMessage> {
  const db = await getDb();
  const msg: InboxMessage = {
    id: newId('INB'),
    userId,
    title,
    body,
    kind,
    relatedId,
    createdOnUtc: nowUtcIso(),
    read: false,
  };
  await db.add('inbox', msg);
  return msg;
}

/** Notify every active user whose live matrix grants the capability. */
export async function notifyCapability(
  cap: Capability,
  title: string,
  body: string,
  kind: InboxKind,
  relatedId: string,
  exceptUserId?: string,
): Promise<void> {
  const db = await getDb();
  const users = (await db.getAll('users')) as UserRecord[];
  const matrix = await getLiveMatrix();
  for (const u of users) {
    if (!u.active) continue;
    if (exceptUserId && u.userId === exceptUserId) continue;
    const allowed = Boolean(matrix.rows[u.role]?.[cap]);
    if (!allowed) continue;
    await notifyUser(u.userId, title, body, kind, relatedId);
  }
}

export async function assertViewInbox(session: Session): Promise<void> {
  if (!(await hasCapability(session, 'viewInbox'))) {
    throw new Error('Capability required: viewInbox');
  }
}
