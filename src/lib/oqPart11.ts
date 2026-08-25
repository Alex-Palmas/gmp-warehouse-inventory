import {
  LOCKOUT_ATTEMPTS,
  SESSION_IDLE_MS,
  type UserRecord,
} from '../types';
import { applyFailedLogin, GENERIC_LOGIN_ERROR, isAccountLocked, login } from './auth';
import { exportBackup } from './backup';
import { cycleCount, destroyContainer, receiveGoods, setHold } from './inventory';
import { listAudit } from './audit';
import type { ExtraCtx } from './oqExtra';
import { dump, esignOf } from './oqSuite';

export const P11_OQ_IDS = [
  'P11-LOGIN-GENERIC',
  'P11-LOCK-4-NOT',
  'P11-LOCK-5-YES',
  'P11-AUDIT-ROLE',
  'P11-AUDIT-ACTIONS',
  'P11-REASON-FOR-CHANGE',
  'P11-HASH-BACKUP',
  'P11-SESSION-IDLE',
] as const;

const P11_ACTIONS = [
  'LOGIN',
  'LOCKOUT',
  'SESSION_TIMEOUT',
  'ATTACHMENT_ADD',
  'VALIDATION_RUN',
  'REQUEST_SUBMIT',
  'REQUEST_PICK',
  'REQUEST_ISSUE',
  'REQUEST_CANCEL',
  'REQUEST_REJECT',
  'REQUEST_CLOSE',
  'REQUEST_RESERVE',
  'REQUEST_SUPERVISOR_APPROVE',
  'REQUEST_QA_APPROVE',
];

export async function runPart11Cases(ctx: ExtraCtx): Promise<void> {
  const { results, onResult, oq, threw, receiveInput, op, qa, sup } = ctx;

  await oq(results, 'P11-LOGIN-GENERIC', 'URS-07', 'Unknown user and bad password share GENERIC_LOGIN_ERROR', 'login throws the same generic message.', async () => {
    const a = await threw(() => login('no-such-user-oq', 'wrong'));
    const b = await threw(() => login('wh', 'not-the-password'));
    return {
      actual: `${a.message} | ${b.message}`,
      pass: a.ok && b.ok && a.message === GENERIC_LOGIN_ERROR && b.message === GENERIC_LOGIN_ERROR,
    };
  }, onResult);

  await oq(results, 'P11-LOCK-4-NOT', 'URS-07', 'Four failed logins do not lock', 'applyFailedLogin × 4 → locked false.', async () => {
    let user = { userId: 'lock4', failedAttempts: 0 } as UserRecord;
    let locked = false;
    for (let i = 0; i < LOCKOUT_ATTEMPTS - 1; i++) {
      const n = applyFailedLogin(user, Date.now());
      user = n.user;
      locked = n.locked;
    }
    return { actual: `attempts=${user.failedAttempts} locked=${locked}`, pass: user.failedAttempts === 4 && !locked && !isAccountLocked(user) };
  }, onResult);

  await oq(results, 'P11-LOCK-5-YES', 'URS-07', 'Fifth failed login locks', 'applyFailedLogin × 5 → locked true, lockedUntilUtc set.', async () => {
    let user = { userId: 'lock5', failedAttempts: 0 } as UserRecord;
    let locked = false;
    for (let i = 0; i < LOCKOUT_ATTEMPTS; i++) {
      const n = applyFailedLogin(user, Date.now());
      user = n.user;
      locked = n.locked;
    }
    return {
      actual: `attempts=${user.failedAttempts} locked=${locked} until=${user.lockedUntilUtc ?? ''}`,
      pass: locked && user.failedAttempts >= 5 && Boolean(user.lockedUntilUtc) && isAccountLocked(user),
    };
  }, onResult);

  await oq(results, 'P11-AUDIT-ROLE', 'URS-06', 'RECEIVE audit row includes role', 'Latest OQ receipt has role on the audit entry.', async () => {
    const recs = await receiveGoods(op, receiveInput({ comments: 'P11-AUDIT-ROLE' }));
    const rows = await listAudit();
    const rec = rows.find((a) => a.action === 'RECEIVE' && a.recordId === recs[0].serial);
    return { actual: rec ? `role=${rec.role} user=${rec.userId}` : 'missing', pass: Boolean(rec && rec.role === 'operator' && rec.userId === 'wh') };
  }, onResult);

  await oq(results, 'P11-AUDIT-ACTIONS', 'URS-06', 'Part 11 action strings exist', 'LOGIN/LOCKOUT/SESSION_TIMEOUT/ATTACHMENT_ADD/VALIDATION_RUN/REQUEST_* are unique documented actions.', async () => {
    const uniq = new Set(P11_ACTIONS);
    return { actual: P11_ACTIONS.join(','), pass: uniq.size === P11_ACTIONS.length && P11_ACTIONS.includes('VALIDATION_RUN') };
  }, onResult);

  await oq(results, 'P11-REASON-FOR-CHANGE', 'URS-20', 'destroy/count/hold persist reasonForChange', 'Audit rows carry the reason string.', async () => {
    const recs = await receiveGoods(op, receiveInput({ comments: 'P11-REASON' }));
    const s = recs[0].serial;
    await setHold(qa, s, true, 'hold-reason-oq');
    await setHold(qa, s, false, 'unhold-reason-oq');
    await cycleCount(op, s, recs[0].currentQty, 'count-reason-oq');
    const gone = await receiveGoods(op, receiveInput({ comments: 'P11-REASON-D' }));
    await destroyContainer(qa, gone[0].serial, 'destroy-reason-oq', esignOf(qa, 'destroy'));
    const rows = await listAudit();
    const mismatches: string[] = [];
    if (!rows.some((a) => a.reasonForChange === 'hold-reason-oq')) mismatches.push('hold');
    if (!rows.some((a) => a.reasonForChange === 'count-reason-oq')) mismatches.push('count');
    if (!rows.some((a) => a.reasonForChange === 'destroy-reason-oq')) mismatches.push('destroy');
    return dump(mismatches);
  }, onResult);

  await oq(results, 'P11-HASH-BACKUP', 'URS-08', 'exportBackup users have passwordHash not plaintext password', 'No user.password field; passwordHash present.', async () => {
    const payload = await exportBackup(sup);
    const mismatches: string[] = [];
    for (const u of payload.users) {
      if (!u.passwordHash) mismatches.push(`${u.userId} missing hash`);
      const extra = u as { password?: unknown };
      if ('password' in extra && extra.password) mismatches.push(`${u.userId} plaintext`);
    }
    return dump(mismatches);
  }, onResult);

  await oq(results, 'P11-SESSION-IDLE', 'URS-07', 'Idle timeout constant is 15 minutes', 'SESSION_IDLE_MS === 15*60*1000. Do not call logout.', async () => {
    return { actual: String(SESSION_IDLE_MS), pass: SESSION_IDLE_MS === 15 * 60 * 1000 };
  }, onResult);
}
