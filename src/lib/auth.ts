import type { AccessLogEntry, RoleId, Session, UserRecord } from '../types';
import {
  LOCKOUT_ATTEMPTS,
  LOCKOUT_MS,
  PASSWORD_EXPIRY_DAYS,
  SESSION_IDLE_MS,
} from '../types';
import { getDb } from './db';
import { hashPassword, randomSalt, verifyPasswordFlexible } from './crypto';
import { nowUtcIso } from './dates';
import { newId } from './ids';
import { appendAudit } from './audit';
import { assertCapability, assertMayAssignRole, getRole, hasCapability, resolveRoleId } from './permissions';
import {
  assertPasswordPolicy,
  nextPasswordHistory,
  passwordExpired,
  passwordInHistory,
} from './passwordPolicy';

const SESSION_KEY = 'gmp-wh-session';
export const GENERIC_LOGIN_ERROR = 'Invalid user ID or password';

export function applyFailedLogin(user: UserRecord, nowMs: number): { user: UserRecord; locked: boolean } {
  const next: UserRecord = { ...user, failedAttempts: (user.failedAttempts ?? 0) + 1 };
  if (next.failedAttempts >= LOCKOUT_ATTEMPTS) {
    next.lockedUntilUtc = new Date(nowMs + LOCKOUT_MS).toISOString();
    next.lockReason = 'Too many failed login attempts';
    return { user: next, locked: true };
  }
  return { user: next, locked: false };
}

export function isAccountLocked(user: UserRecord, nowMs: number = Date.now()): boolean {
  if (!user.lockedUntilUtc) return false;
  const until = Date.parse(user.lockedUntilUtc);
  return !Number.isNaN(until) && until > nowMs;
}

export function loadSession(): Session | null {
  const raw = sessionStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as Session;
    const last = Date.parse(s.lastActivityUtc);
    if (Number.isNaN(last) || Date.now() - last > SESSION_IDLE_MS) {
      sessionStorage.removeItem(SESSION_KEY);
      return null;
    }
    s.role = resolveRoleId(s.role);
    return s;
  } catch {
    return null;
  }
}

export function touchSession(s: Session): Session {
  const next = { ...s, lastActivityUtc: nowUtcIso() };
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(next));
  return next;
}

export function clearSession(): void {
  sessionStorage.removeItem(SESSION_KEY);
}

export function persistSession(s: Session): void {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(s));
}

export async function logAccess(
  userId: string,
  userName: string,
  event: string,
  detail: string,
): Promise<void> {
  const db = await getDb();
  const entry: AccessLogEntry = {
    id: newId('ACC'),
    timestampUtc: nowUtcIso(),
    userId,
    userName,
    event,
    detail,
  };
  await db.add('accessLog', entry);
}

function normalizeUser(raw: UserRecord): UserRecord {
  return {
    ...raw,
    role: resolveRoleId(raw.role),
    algorithm: raw.algorithm ?? 'sha256-salt',
    failedAttempts: raw.failedAttempts ?? 0,
    passwordHistory: raw.passwordHistory ?? [],
    mustChangePassword: Boolean(raw.mustChangePassword),
  };
}

export async function login(userId: string, password: string): Promise<Session> {
  const db = await getDb();
  const raw = (await db.get('users', userId.trim())) as UserRecord | undefined;
  const fail = async (uid: string, name: string, detail: string, event = 'LOGIN_FAIL') => {
    await logAccess(uid, name, event, detail);
    throw new Error(GENERIC_LOGIN_ERROR);
  };
  if (!raw || !raw.active) {
    await fail(userId.trim(), '', 'Unknown or inactive user');
  }
  const user = normalizeUser(raw as UserRecord);
  if (isAccountLocked(user)) {
    await logAccess(user.userId, user.fullName, 'LOCKOUT', user.lockReason ?? 'Account locked');
    throw new Error(GENERIC_LOGIN_ERROR);
  }
  const check = await verifyPasswordFlexible(password, user.salt, user.passwordHash, user.algorithm);
  if (!check.ok) {
    const { user: next, locked } = applyFailedLogin(user, Date.now());
    await db.put('users', next);
    await logAccess(user.userId, user.fullName, 'LOGIN_FAIL', 'Bad password');
    if (locked) {
      await logAccess(user.userId, user.fullName, 'LOCKOUT', next.lockReason ?? 'Too many failed login attempts');
    }
    throw new Error(GENERIC_LOGIN_ERROR);
  }

  user.failedAttempts = 0;
  user.lockedUntilUtc = undefined;
  user.lockReason = undefined;
  user.lastLoginUtc = nowUtcIso();
  if (check.used === 'sha256-salt') {
    const salt = randomSalt();
    user.salt = salt;
    user.passwordHash = await hashPassword(password, salt);
    user.algorithm = 'pbkdf2-sha256';
  }
  if (passwordExpired(user.passwordChangedUtc ?? user.createdOnUtc, Date.now(), PASSWORD_EXPIRY_DAYS)) {
    user.mustChangePassword = true;
  }
  await db.put('users', user);

  const role = await getRole(user.role);
  const session: Session = {
    userId: user.userId,
    fullName: user.fullName,
    role: user.role,
    roleName: role?.name ?? user.role,
    startedUtc: nowUtcIso(),
    lastActivityUtc: nowUtcIso(),
    mustChangePassword: user.mustChangePassword,
  };
  persistSession(session);
  await logAccess(user.userId, user.fullName, 'LOGIN', `role=${user.role}`);
  await appendAudit(session, { action: 'LOGIN', recordId: user.userId, newValue: user.role });
  return session;
}

export async function logout(session: Session | null): Promise<void> {
  if (session) {
    await logAccess(session.userId, session.fullName, 'LOGOUT', '');
    await appendAudit(session, { action: 'LOGOUT', recordId: session.userId });
  }
  clearSession();
}

export async function reverifyPassword(userId: string, password: string): Promise<boolean> {
  const db = await getDb();
  const user = (await db.get('users', userId)) as UserRecord | undefined;
  if (!user) return false;
  const n = normalizeUser(user);
  const check = await verifyPasswordFlexible(password, n.salt, n.passwordHash, n.algorithm);
  return check.ok;
}

export async function listUsers(): Promise<UserRecord[]> {
  const db = await getDb();
  const all = ((await db.getAll('users')) as UserRecord[]).map(normalizeUser);
  all.sort((a, b) => a.userId.localeCompare(b.userId));
  return all;
}

export async function listAccessLog(): Promise<AccessLogEntry[]> {
  const db = await getDb();
  const all = (await db.getAll('accessLog')) as AccessLogEntry[];
  all.sort((a, b) => b.timestampUtc.localeCompare(a.timestampUtc));
  return all;
}

export async function createUser(
  session: Session,
  input: { userId: string; fullName: string; role: RoleId; password: string },
): Promise<UserRecord> {
  await assertCapability(session, 'adminUsers', 'User administration capability required');
  if (!input.userId.trim() || !input.fullName.trim()) throw new Error('User ID and name required');
  await assertMayAssignRole(session, input.role);
  assertPasswordPolicy(input.userId.trim(), input.password);
  const db = await getDb();
  const existing = await db.get('users', input.userId.trim());
  if (existing) throw new Error('User ID already exists and cannot be reused');
  const salt = randomSalt();
  const rec: UserRecord = {
    userId: input.userId.trim(),
    fullName: input.fullName.trim(),
    role: resolveRoleId(input.role),
    salt,
    passwordHash: await hashPassword(input.password, salt),
    algorithm: 'pbkdf2-sha256',
    active: true,
    mustChangePassword: true,
    createdOnUtc: nowUtcIso(),
    failedAttempts: 0,
    passwordChangedUtc: nowUtcIso(),
    passwordHistory: [],
  };
  await db.add('users', rec);
  await appendAudit(session, {
    action: 'USER_CREATE',
    recordId: rec.userId,
    field: 'role',
    newValue: rec.role,
    reasonForChange: 'User created',
  });
  return rec;
}

export async function updateUser(
  session: Session,
  userId: string,
  patch: {
    fullName?: string;
    role?: RoleId;
    active?: boolean;
    newPassword?: string;
    mustChangePassword?: boolean;
  },
  reason: string,
): Promise<UserRecord> {
  await assertCapability(session, 'adminUsers', 'User administration capability required');
  if (!reason.trim()) throw new Error('Reason for change is required');
  const db = await getDb();
  const rec = (await db.get('users', userId)) as UserRecord | undefined;
  if (!rec) throw new Error('User not found');
  const user = normalizeUser(rec);
  if (patch.fullName !== undefined && patch.fullName !== user.fullName) {
    await appendAudit(session, {
      action: 'USER_UPDATE',
      recordId: userId,
      field: 'fullName',
      oldValue: user.fullName,
      newValue: patch.fullName,
      reasonForChange: reason,
    });
    user.fullName = patch.fullName;
  }
  if (patch.role !== undefined && resolveRoleId(patch.role) !== user.role) {
    await assertMayAssignRole(session, patch.role);
    await appendAudit(session, {
      action: 'USER_UPDATE',
      recordId: userId,
      field: 'role',
      oldValue: user.role,
      newValue: resolveRoleId(patch.role),
      reasonForChange: reason,
    });
    user.role = resolveRoleId(patch.role);
  }
  if (patch.active !== undefined && patch.active !== user.active) {
    await appendAudit(session, {
      action: 'USER_UPDATE',
      recordId: userId,
      field: 'active',
      oldValue: String(user.active),
      newValue: String(patch.active),
      reasonForChange: reason,
    });
    user.active = patch.active;
  }
  if (patch.newPassword) {
    assertPasswordPolicy(user.userId, patch.newPassword);
    if (await passwordInHistory(patch.newPassword, { algorithm: user.algorithm, salt: user.salt, hash: user.passwordHash }, user.passwordHistory)) {
      throw new Error('Password was used recently and cannot be reused');
    }
    const salt = randomSalt();
    const hashed = await hashPassword(patch.newPassword, salt);
    user.passwordHistory = nextPasswordHistory(user.algorithm, user.salt, user.passwordHash, user.passwordHistory);
    user.salt = salt;
    user.passwordHash = hashed;
    user.algorithm = 'pbkdf2-sha256';
    user.mustChangePassword = true;
    user.passwordChangedUtc = nowUtcIso();
    await appendAudit(session, {
      action: 'USER_UPDATE',
      recordId: userId,
      field: 'passwordHash',
      oldValue: '(redacted)',
      newValue: '(redacted)',
      reasonForChange: reason,
    });
  }
  if (patch.mustChangePassword !== undefined) {
    user.mustChangePassword = patch.mustChangePassword;
    await appendAudit(session, {
      action: 'USER_UPDATE',
      recordId: userId,
      field: 'mustChangePassword',
      oldValue: String(!patch.mustChangePassword),
      newValue: String(patch.mustChangePassword),
      reasonForChange: reason,
    });
  }
  await db.put('users', user);
  return user;
}

export async function unlockUser(session: Session, userId: string, reason: string): Promise<UserRecord> {
  await assertCapability(session, 'adminUsers', 'User administration capability required');
  if (!reason.trim()) throw new Error('Reason for change is required');
  const db = await getDb();
  const rec = (await db.get('users', userId)) as UserRecord | undefined;
  if (!rec) throw new Error('User not found');
  const user = normalizeUser(rec);
  const was = user.lockedUntilUtc ?? '';
  user.failedAttempts = 0;
  user.lockedUntilUtc = undefined;
  user.lockReason = undefined;
  await db.put('users', user);
  await appendAudit(session, {
    action: 'USER_UNLOCK',
    recordId: userId,
    field: 'lockedUntilUtc',
    oldValue: was,
    newValue: '',
    reasonForChange: reason,
  });
  await logAccess(session.userId, session.fullName, 'UNLOCK', `unlocked ${userId}`);
  return user;
}

export async function changeOwnPassword(
  session: Session,
  currentPassword: string,
  newPassword: string,
): Promise<Session> {
  const db = await getDb();
  const rec = (await db.get('users', session.userId)) as UserRecord | undefined;
  if (!rec) throw new Error('User not found');
  const user = normalizeUser(rec);
  const check = await verifyPasswordFlexible(currentPassword, user.salt, user.passwordHash, user.algorithm);
  if (!check.ok) throw new Error('Current password is incorrect');
  assertPasswordPolicy(user.userId, newPassword);
  if (await passwordInHistory(newPassword, { algorithm: user.algorithm, salt: user.salt, hash: user.passwordHash }, user.passwordHistory)) {
    throw new Error('Password was used recently and cannot be reused');
  }
  const salt = randomSalt();
  const hashed = await hashPassword(newPassword, salt);
  user.passwordHistory = nextPasswordHistory(user.algorithm, user.salt, user.passwordHash, user.passwordHistory);
  user.salt = salt;
  user.passwordHash = hashed;
  user.algorithm = 'pbkdf2-sha256';
  user.mustChangePassword = false;
  user.passwordChangedUtc = nowUtcIso();
  user.failedAttempts = 0;
  await db.put('users', user);
  await appendAudit(session, {
    action: 'PASSWORD_CHANGE',
    recordId: user.userId,
    field: 'passwordHash',
    oldValue: '(redacted)',
    newValue: '(redacted)',
    reasonForChange: 'User changed password',
  });
  const next: Session = { ...session, mustChangePassword: false, lastActivityUtc: nowUtcIso() };
  persistSession(next);
  return next;
}

export { hasCapability };
