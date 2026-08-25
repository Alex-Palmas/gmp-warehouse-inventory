import * as auditApi from './audit';
import * as authApi from './auth';
import { AUDIT_MUTATION_API } from './audit';
import { importBackup } from './backup';
import { currentDbName, OQ_DB_NAME } from './db';
import {
  destroyContainer,
  issueDispense,
  qaDisposition,
  receiveGoods,
  samplePull,
  setHold,
  transferLocation,
} from './inventory';
import type { ExtraCtx } from './oqExtra';
import { clearAllReservations, dump, esignOf, mtfInput, roleSess, xferLoc } from './oqSuite';
import { assertNotOwnReceipt } from './permissions';
import { approveRequestSupervisor, submitRequest } from './requests';

export const NEG_OQ_IDS = [
  'NEG-ISSUE-QUARANTINE',
  'NEG-ISSUE-HOLD',
  'NEG-ISSUE-EXPIRED',
  'NEG-ISSUE-DESTROYED',
  'NEG-ISSUE-REJECTED',
  'NEG-QA-OWN-RECEIPT',
  'NEG-SELF-APPROVE',
  'NEG-TRANSFER-DESTROYED',
  'NEG-HOLD-DESTROYED',
  'NEG-SAMPLE-DESTROYED',
  'NEG-DOUBLE-DESTROY',
  'NEG-QA-ALREADY-RELEASED',
  'NEG-RESERVED-ISSUE',
  'NEG-IMPORT-ON-PROD',
  'NEG-AUDIT-MUTABLE',
  'NEG-USER-DELETE',
  'NEG-SAMPLE-CHILD',
] as const;

export async function runNegativeCases(ctx: ExtraCtx): Promise<void> {
  const { results, onResult, oq, threw, receiveInput, op, qa, lab, sup } = ctx;

  await oq(results, 'NEG-ISSUE-QUARANTINE', 'URS-05', 'Cannot issue Quarantine without QA', 'isIssueBlocked / issueDispense throws status is Quarantine.', async () => {
    const recs = await receiveGoods(op, receiveInput({ comments: 'NEG-ISSUE-QUARANTINE' }));
    const r = await threw(() => issueDispense(op, recs[0].serial, 1, 'LVM', 'x', ''));
    return { actual: r.message, pass: r.ok && /Quarantine/i.test(r.message) };
  }, onResult);

  await oq(results, 'NEG-ISSUE-HOLD', 'URS-05', 'Cannot issue Hold status', 'setHold then issue throws status is Hold.', async () => {
    const recs = await receiveGoods(op, receiveInput({ comments: 'NEG-ISSUE-HOLD' }));
    await qaDisposition(qa, recs[0].serial, 'Release', esignOf(qa, 'QA'), 'x');
    await setHold(qa, recs[0].serial, true, 'OQ hold');
    const r = await threw(() => issueDispense(op, recs[0].serial, 1, 'LVM', 'x', ''));
    return { actual: r.message, pass: r.ok && /Hold/i.test(r.message) };
  }, onResult);

  await oq(results, 'NEG-ISSUE-EXPIRED', 'URS-05', 'Cannot issue expired lot', 'expiry in the past then issue throws expired.', async () => {
    const recs = await receiveGoods(op, receiveInput({ expiryDate: '2000-01-01', comments: 'NEG-ISSUE-EXPIRED' }));
    await qaDisposition(qa, recs[0].serial, 'Release', esignOf(qa, 'QA'), 'x');
    const r = await threw(() => issueDispense(op, recs[0].serial, 1, 'LVM', 'x', ''));
    return { actual: r.message, pass: r.ok && /expired/i.test(r.message) };
  }, onResult);

  await oq(results, 'NEG-ISSUE-DESTROYED', 'URS-03', 'Cannot issue Destroyed', 'destroy then issue throws.', async () => {
    const recs = await receiveGoods(op, receiveInput({ comments: 'NEG-ISSUE-DESTROYED' }));
    await destroyContainer(qa, recs[0].serial, 'OQ destroy', esignOf(qa, 'destroy'));
    const r = await threw(() => issueDispense(op, recs[0].serial, 1, 'LVM', 'x', ''));
    return { actual: r.message, pass: r.ok && /Destroyed/i.test(r.message) };
  }, onResult);

  await oq(results, 'NEG-ISSUE-REJECTED', 'URS-02', 'Cannot issue Rejected', 'QA reject then issue throws.', async () => {
    const recs = await receiveGoods(op, receiveInput({ comments: 'NEG-ISSUE-REJECTED' }));
    await qaDisposition(qa, recs[0].serial, 'Reject', esignOf(qa, 'QA'), 'reject', 'container');
    const r = await threw(() => issueDispense(op, recs[0].serial, 1, 'LVM', 'x', ''));
    return { actual: r.message, pass: r.ok && /Rejected/i.test(r.message) };
  }, onResult);

  await oq(results, 'NEG-QA-OWN-RECEIPT', 'URS-24', 'Own-receipt SoD waived only for super', 'assertNotOwnReceipt throws for operator; super allowed.', async () => {
    const mismatches: string[] = [];
    const opOwn = await threw(async () => {
      assertNotOwnReceipt('wh', 'wh', 'operator');
    });
    if (!opOwn.ok) mismatches.push('operator own-receipt allowed');
    const superOwn = await threw(async () => {
      assertNotOwnReceipt('super', 'super', 'super');
    });
    if (superOwn.ok) mismatches.push(`super blocked: ${superOwn.message}`);
    const recs = await receiveGoods(roleSess('super'), receiveInput({ comments: 'NEG-QA-OWN super' }));
    const qaOwn = await threw(() =>
      qaDisposition(roleSess('super'), recs[0].serial, 'Release', esignOf(roleSess('super'), 'QA'), 'own'),
    );
    if (qaOwn.ok) mismatches.push(`super QA own threw: ${qaOwn.message}`);
    return dump(mismatches);
  }, onResult);

  await oq(results, 'NEG-SELF-APPROVE', 'URS-29', 'Requestor cannot supervisor-approve own MTF; super excepted', 'supervisor sess with same userId as requestor throws SoD; super allowed.', async () => {
    await clearAllReservations(sup);
    const req = await submitRequest(lab, mtfInput(lab, { intendedUse: 'NEG-SELF-APPROVE' }));
    const fakeSup = { ...sup, userId: lab.userId, fullName: lab.fullName };
    const blocked = await threw(() => approveRequestSupervisor(fakeSup, req.requestId, esignOf(fakeSup, 'sup')));
    const req2 = await submitRequest(lab, mtfInput(lab, { intendedUse: 'NEG-SELF-APPROVE super' }));
    const superS = roleSess('super');
    const allowed = await threw(() => approveRequestSupervisor(superS, req2.requestId, esignOf(superS, 'sup')));
    return {
      actual: `sod=${blocked.message}; super=${allowed.ok ? allowed.message : 'ok'}`,
      pass: blocked.ok && /own transfer/i.test(blocked.message) && !allowed.ok,
    };
  }, onResult);

  await oq(results, 'NEG-TRANSFER-DESTROYED', 'URS-11', 'Cannot transfer destroyed container', 'destroy then transfer throws.', async () => {
    const recs = await receiveGoods(op, receiveInput({ comments: 'NEG-TRANSFER-DESTROYED' }));
    await destroyContainer(qa, recs[0].serial, 'x', esignOf(qa, 'destroy'));
    const r = await threw(() => transferLocation(op, recs[0].serial, xferLoc(), 'move'));
    return { actual: r.message, pass: r.ok && /destroyed/i.test(r.message) };
  }, onResult);

  await oq(results, 'NEG-HOLD-DESTROYED', 'URS-02', 'Cannot hold destroyed container', 'destroy then setHold throws.', async () => {
    const recs = await receiveGoods(op, receiveInput({ comments: 'NEG-HOLD-DESTROYED' }));
    await destroyContainer(qa, recs[0].serial, 'x', esignOf(qa, 'destroy'));
    const r = await threw(() => setHold(qa, recs[0].serial, true, 'hold'));
    return { actual: r.message, pass: r.ok && /destroyed/i.test(r.message) };
  }, onResult);

  await oq(results, 'NEG-SAMPLE-DESTROYED', 'URS-25', 'Cannot sample Destroyed or Issued', 'destroy then sample; full issue then sample.', async () => {
    const recs = await receiveGoods(op, receiveInput({ comments: 'NEG-SAMPLE-DESTROYED' }));
    await destroyContainer(qa, recs[0].serial, 'x', esignOf(qa, 'destroy'));
    const d = await threw(() => samplePull(qa, recs[0].serial, 0.1, 'sample', 'x'));
    const recs2 = await receiveGoods(op, receiveInput({ comments: 'NEG-SAMPLE-ISSUED' }));
    await qaDisposition(qa, recs2[0].serial, 'Release', esignOf(qa, 'QA'), 'x');
    await issueDispense(op, recs2[0].serial, recs2[0].currentQty, 'LVM', 'all', 'OQ FEFO override');
    const i = await threw(() => samplePull(qa, recs2[0].serial, 0.1, 'sample', 'x'));
    return { actual: `${d.message} | ${i.message}`, pass: d.ok && i.ok };
  }, onResult);

  await oq(results, 'NEG-DOUBLE-DESTROY', 'URS-03', 'Second destroy rejected', 'Already destroyed.', async () => {
    const recs = await receiveGoods(op, receiveInput({ comments: 'NEG-DOUBLE-DESTROY' }));
    await destroyContainer(qa, recs[0].serial, 'first', esignOf(qa, 'destroy'));
    const r = await threw(() => destroyContainer(qa, recs[0].serial, 'second', esignOf(qa, 'destroy')));
    return { actual: r.message, pass: r.ok && /Already destroyed/i.test(r.message) };
  }, onResult);

  await oq(results, 'NEG-QA-ALREADY-RELEASED', 'URS-02', 'Second Release on already-Released is idempotent; Destroyed cannot be dispositioned', 'API re-applies Release to the selected non-terminal serial. Destroyed throws Cannot disposition.', async () => {
    const recs = await receiveGoods(op, receiveInput({ comments: 'NEG-QA-ALREADY-RELEASED' }));
    await qaDisposition(qa, recs[0].serial, 'Release', esignOf(qa, 'QA'), 'first');
    const second = await qaDisposition(qa, recs[0].serial, 'Release', esignOf(qa, 'QA'), 'second');
    const gone = await receiveGoods(op, receiveInput({ comments: 'NEG-QA-DEST' }));
    await destroyContainer(qa, gone[0].serial, 'gone', esignOf(qa, 'destroy'));
    const d = await threw(() => qaDisposition(qa, gone[0].serial, 'Release', esignOf(qa, 'QA'), 'on destroyed', 'container'));
    return {
      actual: `second=${second[0]?.status} dest=${d.message}`,
      pass: second[0]?.status === 'Released' && d.ok && /Destroyed/i.test(d.message),
    };
  }, onResult);

  await oq(results, 'NEG-RESERVED-ISSUE', 'URS-22', 'Cannot issue reserved serial to a different request', 'FEFO reserve then issue without that requestId throws reserved.', async () => {
    await clearAllReservations(sup);
    const recs = await receiveGoods(op, receiveInput({ qtyPerContainer: 2, comments: 'NEG-RESERVED-ISSUE' }));
    await qaDisposition(qa, recs[0].serial, 'Release', esignOf(qa, 'QA'), 'x');
    const req = await submitRequest(lab, mtfInput(lab, { qtyRequested: 1, intendedUse: 'NEG-RESERVED' }));
    await approveRequestSupervisor(sup, req.requestId, esignOf(sup, 'sup'));
    const { getRequest } = await import('./requests');
    const after = await getRequest(req.requestId);
    const serial = after?.reservedSerials[0]?.serial;
    if (!serial) return { actual: 'no reserved serial', pass: false };
    const r = await threw(() => issueDispense(op, serial, 1, 'LVM', 'wrong req', '', 'MR-OTHER'));
    return { actual: `${serial} ${r.message}`, pass: r.ok && /reserved for request/i.test(r.message) };
  }, onResult);

  await oq(results, 'NEG-IMPORT-ON-PROD', 'URS-15', 'importBackup during protocol is on OQ db', 'currentDbName is gmp-wh-inv-oq; invalid payload throws before wipe.', async () => {
    const name = currentDbName();
    const r = await threw(() => importBackup(sup, {} as never));
    return { actual: `db=${name} ${r.message}`, pass: name === OQ_DB_NAME && r.ok && /Invalid backup/i.test(r.message) };
  }, onResult);

  await oq(results, 'NEG-AUDIT-MUTABLE', 'URS-06', 'Audit module has no update/delete export', 'AUDIT_MUTATION_API.updateAudit/deleteAudit false; keys omit them.', async () => {
    const keys = Object.keys(auditApi);
    const mismatches: string[] = [];
    if (keys.includes('updateAudit') || keys.includes('deleteAudit')) mismatches.push(`keys ${keys.join(',')}`);
    if (AUDIT_MUTATION_API.updateAudit !== false || AUDIT_MUTATION_API.deleteAudit !== false) mismatches.push('flag');
    return dump(mismatches);
  }, onResult);

  await oq(results, 'NEG-USER-DELETE', 'URS-07', 'Users cannot be deleted (no deleteUser API)', 'auth module has no deleteUser; deactivate via updateUser only.', async () => {
    const hasDelete = 'deleteUser' in authApi || 'removeUser' in authApi;
    return { actual: `deleteUser=${hasDelete}`, pass: !hasDelete };
  }, onResult);

  await oq(results, 'NEG-SAMPLE-CHILD', 'URS-25', 'Cannot sample a sample/retain child', 'Samples may only be pulled from a container record.', async () => {
    const recs = await receiveGoods(op, receiveInput({ qtyPerContainer: 2, comments: 'NEG-SAMPLE-CHILD' }));
    const child = await samplePull(qa, recs[0].serial, 0.2, 'sample', 'child');
    const r = await threw(() => samplePull(qa, child.serial, 0.05, 'sample', 'nope'));
    return { actual: r.message, pass: r.ok && /container record/i.test(r.message) };
  }, onResult);
}
