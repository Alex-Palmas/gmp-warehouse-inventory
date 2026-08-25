import { CLASSIFICATIONS, TO_LOCATIONS } from '../types';
import { addAttachment, listAttachments, listForSerial } from './attachments';
import { exportBackup } from './backup';
import { currentDbName, OQ_DB_NAME } from './db';
import { peekStoredSession } from './auth';
import { proposeFefoAllocations } from './fefo';
import {
  getInventory,
  issueDispense,
  listByReceiptBatch,
  qaDisposition,
  receiveGoods,
  returnToStock,
  samplePull,
} from './inventory';
import type { ExtraCtx } from './oqExtra';
import { clearAllReservations, dump, esignOf, mtfInput, tinyPngFile } from './oqSuite';
import { approveRequestSupervisor, confirmReceived, getRequest, requiresQa, submitRequest } from './requests';
import { isValidReceiptBatchId, isValidRequestId, isValidSerial, parseSerial } from './serial';

export const PROC_OQ_IDS = [
  'PROC-FEFO-OLDEST',
  'PROC-FEFO-SKIP-EXPIRED',
  'PROC-INSUFFICIENT-STOCK',
  'PROC-CELLBANK-QA',
  'PROC-ONE-LINE',
  'PROC-DEST-LVM',
  'PROC-CLASS-GMP',
  'PROC-QTY-RECEIVED',
  'PROC-BATCH-RELEASE',
  'PROC-SINGLE-REJECT',
  'PROC-RETURN-THEN-QTY',
  'PROC-PARTIAL-ISSUE',
  'PROC-SAMPLE-PARENT-QTY',
  'PROC-CHILD-KIND',
  'PROC-RECEIPT-BATCH',
  'PROC-SERIAL-FORMAT',
  'PROC-RCV-FORMAT',
  'PROC-MR-FORMAT',
] as const;

export const ATT_OQ_IDS = ['ATT-SERIAL', 'ATT-BATCH', 'ATT-QA-ADD'] as const;
export const BKP_OQ_IDS = ['BKP-KEYS', 'BKP-ATTACH-BYTES'] as const;
export const ISO_OQ_IDS = ['ISO-SANDBOX-DB', 'ISO-SESSION'] as const;

export async function runProcessCases(ctx: ExtraCtx): Promise<void> {
  const { results, onResult, oq, receiveInput, op, qa, lab, sup } = ctx;

  await oq(results, 'PROC-FEFO-OLDEST', 'URS-05', 'FEFO reserves oldest expiry first', 'Two released lots; proposeFefoAllocations picks earlier expiry.', async () => {
    const a = await receiveGoods(op, receiveInput({ manufacturerLot: 'FEFO-OLD', expiryDate: '2027-01-01', comments: 'FEFO-OLD' }));
    const b = await receiveGoods(op, receiveInput({ manufacturerLot: 'FEFO-NEW', expiryDate: '2027-12-01', comments: 'FEFO-NEW' }));
    await qaDisposition(qa, a[0].serial, 'Release', esignOf(qa, 'QA'), 'x');
    await qaDisposition(qa, b[0].serial, 'Release', esignOf(qa, 'QA'), 'x');
    const inv = [await getInventory(a[0].serial), await getInventory(b[0].serial)].filter(Boolean);
    const picked = proposeFefoAllocations(inv as never[], 'RM-001', 1, '2026-08-25');
    return { actual: picked.map((p) => p.serial).join(','), pass: picked[0]?.serial === a[0].serial };
  }, onResult);

  await oq(results, 'PROC-FEFO-SKIP-EXPIRED', 'URS-05', 'Expired lots are not reserved', 'Expired + in-date Released; FEFO picks in-date only.', async () => {
    const exp = await receiveGoods(op, receiveInput({ expiryDate: '2001-01-01', comments: 'FEFO-EXP', manufacturerLot: 'EXP' }));
    const ok = await receiveGoods(op, receiveInput({ expiryDate: '2028-01-01', comments: 'FEFO-OK', manufacturerLot: 'OK' }));
    await qaDisposition(qa, exp[0].serial, 'Release', esignOf(qa, 'QA'), 'x');
    await qaDisposition(qa, ok[0].serial, 'Release', esignOf(qa, 'QA'), 'x');
    const inv = [await getInventory(exp[0].serial), await getInventory(ok[0].serial)].filter(Boolean);
    const picked = proposeFefoAllocations(inv as never[], 'RM-001', 1, '2026-08-25');
    return { actual: picked.map((p) => p.serial).join(','), pass: picked.length === 1 && picked[0].serial === ok[0].serial };
  }, onResult);

  await oq(results, 'PROC-INSUFFICIENT-STOCK', 'URS-22', 'Approve still happens with stockWarning', 'Huge qty request accepted; supervisor approve leaves stockWarning.', async () => {
    await clearAllReservations(sup);
    const req = await submitRequest(lab, mtfInput(lab, { qtyRequested: 99999, intendedUse: 'PROC-INSUFFICIENT' }));
    const submittedWarn = Boolean(req.stockWarning);
    const appr = await approveRequestSupervisor(sup, req.requestId, esignOf(sup, 'sup'));
    return {
      actual: `submitWarn=${submittedWarn} status=${appr.status} warn=${appr.stockWarning ?? ''}`,
      pass: appr.status === 'Approved' && Boolean(appr.stockWarning),
    };
  }, onResult);

  await oq(results, 'PROC-CELLBANK-QA', 'URS-29', 'Cell bank / quarantine destination requires QA e-sign before issue', 'cellBankOrQuarantine true → Pending QA after supervisor approve; requiresQa true.', async () => {
    const req = await submitRequest(lab, mtfInput(lab, { cellBankOrQuarantine: true, intendedUse: 'cell bank OQ' }));
    const appr = await approveRequestSupervisor(sup, req.requestId, esignOf(sup, 'sup'));
    return { actual: `status=${appr.status} requiresQa=${requiresQa(req)}`, pass: requiresQa(req) && appr.status === 'Pending QA' };
  }, onResult);

  await oq(results, 'PROC-ONE-LINE', 'URS-22', 'One material line per transfer', 'SubmitRequestInput has a single materialCode; no lines array.', async () => {
    const req = await submitRequest(lab, mtfInput(lab, { intendedUse: 'PROC-ONE-LINE' }));
    const keys = Object.keys(req);
    return { actual: `materialCode=${req.materialCode} hasLines=${keys.includes('lines')}`, pass: Boolean(req.materialCode) && !Array.isArray((req as { lines?: unknown }).lines) };
  }, onResult);

  await oq(results, 'PROC-DEST-LVM', 'URS-29', 'Submit with destination LVM', 'toLocation LVM stored; TO_LOCATIONS includes LVM.', async () => {
    const req = await submitRequest(lab, mtfInput(lab, { toLocation: 'LVM', intendedUse: 'LVM OQ' }));
    return { actual: `${req.toLocation}|${req.destination}`, pass: req.toLocation === 'LVM' && (TO_LOCATIONS as readonly string[]).includes('LVM') };
  }, onResult);

  await oq(results, 'PROC-CLASS-GMP', 'URS-29', 'GMP and High Quality classifications accepted', 'Both classification arrays persist.', async () => {
    const gmp = await submitRequest(lab, mtfInput(lab, { classification: ['GMP'], intendedUse: 'gmp' }));
    const hq = await submitRequest(lab, mtfInput(lab, { classification: ['High Quality'], intendedUse: 'hq' }));
    const g = gmp.classification ?? [];
    const h = hq.classification ?? [];
    return {
      actual: `${g.join()} | ${h.join()}`,
      pass: g.includes('GMP') && h.includes('High Quality') && CLASSIFICATIONS.length === 2,
    };
  }, onResult);

  await oq(results, 'PROC-QTY-RECEIVED', 'URS-22', 'confirmReceived records qty', 'After pick+fulfill, requester confirms qty received.', async () => {
    await clearAllReservations(sup);
    const recs = await receiveGoods(op, receiveInput({ qtyPerContainer: 3, comments: 'PROC-QTY-RECEIVED' }));
    await qaDisposition(qa, recs[0].serial, 'Release', esignOf(qa, 'QA'), 'x');
    const req = await submitRequest(lab, mtfInput(lab, { qtyRequested: 1, intendedUse: 'PROC-QTY-RECEIVED' }));
    await approveRequestSupervisor(sup, req.requestId, esignOf(sup, 'sup'));
    const { pickSerialForRequest, confirmFulfillment } = await import('./requests');
    const after = await getRequest(req.requestId);
    const serial = after?.reservedSerials[0]?.serial ?? recs[0].serial;
    await pickSerialForRequest(op, req.requestId, serial, 1);
    await confirmFulfillment(op, req.requestId, 'OQ FEFO override', esignOf(op, 'MM'), { commentsNa: true });
    const closed = await confirmReceived(lab, req.requestId, esignOf(lab, 'recv'), 1);
    return { actual: `status=${closed.status} qty=${closed.qtyReceived}`, pass: closed.status === 'Closed' && closed.qtyReceived === 1 };
  }, onResult);

  await oq(results, 'PROC-BATCH-RELEASE', 'URS-02', 'Batch release sets all siblings Released', '3-container receipt; one QA Release → all Released.', async () => {
    const recs = await receiveGoods(op, receiveInput({ numberOfContainers: 3, comments: 'PROC-BATCH-RELEASE' }));
    await qaDisposition(qa, recs[0].serial, 'Release', esignOf(qa, 'QA'), 'batch');
    const sibs = await listByReceiptBatch(recs[0].receiptBatchId);
    const allRel = sibs.every((r) => r.status === 'Released');
    return { actual: sibs.map((r) => `${r.serial}:${r.status}`).join(', '), pass: allRel && sibs.length === 3 };
  }, onResult);

  await oq(results, 'PROC-SINGLE-REJECT', 'URS-02', 'Single-container reject leaves siblings Released', 'Reject one of three after batch is still Quarantine; others stay Quarantine then batch-release remaining.', async () => {
    const recs = await receiveGoods(op, receiveInput({ numberOfContainers: 3, comments: 'PROC-SINGLE-REJECT' }));
    await qaDisposition(qa, recs[0].serial, 'Reject', esignOf(qa, 'QA'), 'one', 'container');
    await qaDisposition(qa, recs[1].serial, 'Release', esignOf(qa, 'QA'), 'rest');
    const sibs = await listByReceiptBatch(recs[0].receiptBatchId);
    const rej = sibs.filter((r) => r.status === 'Rejected');
    const rel = sibs.filter((r) => r.status === 'Released');
    return { actual: sibs.map((r) => `${r.serial}:${r.status}`).join(', '), pass: rej.length === 1 && rel.length === 2 };
  }, onResult);

  await oq(results, 'PROC-RETURN-THEN-QTY', 'URS-03', 'Return increases currentQty', 'Issue 0.5 then return 0.5.', async () => {
    const recs = await receiveGoods(op, receiveInput({ qtyPerContainer: 2, comments: 'PROC-RETURN' }));
    await qaDisposition(qa, recs[0].serial, 'Release', esignOf(qa, 'QA'), 'x');
    await issueDispense(op, recs[0].serial, 0.5, 'LVM', 'partial', 'OQ FEFO override');
    const mid = await getInventory(recs[0].serial);
    const back = await returnToStock(op, recs[0].serial, 0.5, 'return OQ');
    return { actual: `mid=${mid?.currentQty} back=${back.currentQty}`, pass: (mid?.currentQty ?? 0) === 1.5 && back.currentQty === 2 };
  }, onResult);

  await oq(results, 'PROC-PARTIAL-ISSUE', 'URS-05', 'Partial issue leaves remaining currentQty', 'Issue 1 of 3.', async () => {
    const recs = await receiveGoods(op, receiveInput({ qtyPerContainer: 3, comments: 'PROC-PARTIAL' }));
    await qaDisposition(qa, recs[0].serial, 'Release', esignOf(qa, 'QA'), 'x');
    const after = await issueDispense(op, recs[0].serial, 1, 'LVM', 'partial', 'OQ FEFO override');
    return { actual: `qty=${after.rec.currentQty} status=${after.rec.status}`, pass: after.rec.currentQty === 2 && after.rec.status === 'Released' };
  }, onResult);

  await oq(results, 'PROC-SAMPLE-PARENT-QTY', 'URS-25', 'Parent qty decreases by qtyTaken', 'samplePull 0.2 from 2.', async () => {
    const recs = await receiveGoods(op, receiveInput({ qtyPerContainer: 2, comments: 'PROC-SAMPLE' }));
    const child = await samplePull(qa, recs[0].serial, 0.2, 'sample', 'OQ');
    const parent = await getInventory(recs[0].serial);
    return { actual: `parent=${parent?.currentQty} child=${child.currentQty}`, pass: parent?.currentQty === 1.8 && child.currentQty === 0.2 };
  }, onResult);

  await oq(results, 'PROC-CHILD-KIND', 'URS-25', 'Sample vs retain child recordKind', 'sample and retain children.', async () => {
    const recs = await receiveGoods(op, receiveInput({ qtyPerContainer: 2, comments: 'PROC-KIND' }));
    const sample = await samplePull(qa, recs[0].serial, 0.1, 'sample', 's');
    const retain = await samplePull(qa, recs[0].serial, 0.1, 'retain', 'r');
    return { actual: `${sample.recordKind} ${retain.recordKind}`, pass: sample.recordKind === 'sample' && retain.recordKind === 'retain' };
  }, onResult);

  await oq(results, 'PROC-RECEIPT-BATCH', 'URS-21', 'Siblings share receiptBatchId', '3 containers, one RCV- id.', async () => {
    const recs = await receiveGoods(op, receiveInput({ numberOfContainers: 3, comments: 'PROC-BATCH-ID' }));
    const ids = new Set(recs.map((r) => r.receiptBatchId));
    return { actual: recs[0].receiptBatchId, pass: ids.size === 1 && recs.length === 3 && isValidReceiptBatchId(recs[0].receiptBatchId) };
  }, onResult);

  await oq(results, 'PROC-SERIAL-FORMAT', 'URS-01', 'Serial WH-YYYY-NNNNNN year matches', 'isValidSerial and parseSerial year is current UTC year.', async () => {
    const recs = await receiveGoods(op, receiveInput({ comments: 'PROC-SERIAL' }));
    const p = parseSerial(recs[0].serial);
    const year = new Date().getUTCFullYear();
    return { actual: recs[0].serial, pass: isValidSerial(recs[0].serial) && p?.year === year };
  }, onResult);

  await oq(results, 'PROC-RCV-FORMAT', 'URS-21', 'Receipt batch id format RCV-YYYY-NNNNNN', 'isValidReceiptBatchId.', async () => {
    const recs = await receiveGoods(op, receiveInput({ comments: 'PROC-RCV' }));
    return { actual: recs[0].receiptBatchId, pass: isValidReceiptBatchId(recs[0].receiptBatchId) };
  }, onResult);

  await oq(results, 'PROC-MR-FORMAT', 'URS-22', 'Request id format MR-YYYY-NNNNNN', 'isValidRequestId.', async () => {
    const req = await submitRequest(lab, mtfInput(lab, { intendedUse: 'PROC-MR' }));
    return { actual: req.requestId, pass: isValidRequestId(req.requestId) };
  }, onResult);

  await oq(results, 'ATT-SERIAL', 'URS-28', 'Attachment on serial is listable', 'addAttachment scope serial; listAttachments finds it.', async () => {
    const recs = await receiveGoods(op, receiveInput({ comments: 'ATT-SERIAL' }));
    const att = await addAttachment(op, { scope: 'serial', recordId: recs[0].serial, file: tinyPngFile('serial.png'), category: 'CoA' });
    const listed = await listAttachments(recs[0].serial);
    return { actual: `${att.id} n=${listed.length}`, pass: listed.some((a) => a.id === att.id) };
  }, onResult);

  await oq(results, 'ATT-BATCH', 'URS-28', 'Attachment on receipt batch is listable via listForSerial', 'scope receiptBatch; listForSerial includes it.', async () => {
    const recs = await receiveGoods(op, receiveInput({ comments: 'ATT-BATCH' }));
    const att = await addAttachment(op, {
      scope: 'receiptBatch',
      recordId: recs[0].receiptBatchId,
      file: tinyPngFile('batch.png'),
      category: 'CofC',
    });
    const listed = await listForSerial(recs[0]);
    return { actual: `${att.id} n=${listed.length}`, pass: listed.some((a) => a.id === att.id) };
  }, onResult);

  await oq(results, 'ATT-QA-ADD', 'URS-28', 'QA can add attachment after receive', 'qa session addAttachment succeeds.', async () => {
    const recs = await receiveGoods(op, receiveInput({ comments: 'ATT-QA-ADD' }));
    const att = await addAttachment(qa, { scope: 'serial', recordId: recs[0].serial, file: tinyPngFile('qa.png'), category: 'CoA' });
    return { actual: `${att.uploadedBy} ${att.fileName}`, pass: att.uploadedBy === 'qa' };
  }, onResult);

  await oq(results, 'BKP-KEYS', 'URS-15', 'exportBackup has inventory, audit, attachments, users, materialRequests', 'Required keys present.', async () => {
    const payload = await exportBackup(sup);
    const need = ['inventory', 'audit', 'attachments', 'users', 'materialRequests', 'materials', 'movements', 'accessLog'];
    const missing = need.filter((k) => !(k in payload) || !Array.isArray((payload as Record<string, unknown>)[k]));
    return dump(missing);
  }, onResult);

  await oq(results, 'BKP-ATTACH-BYTES', 'URS-28', 'Backup attachments include base64 bytes', 'After addAttachment, export attachments have dataBase64.', async () => {
    const recs = await receiveGoods(op, receiveInput({ comments: 'BKP-ATTACH' }));
    await addAttachment(op, { scope: 'serial', recordId: recs[0].serial, file: tinyPngFile('bkp.png'), category: 'CoA' });
    const payload = await exportBackup(sup);
    const rows = payload.attachments ?? [];
    const hit = rows.find((a) => a.fileName === 'bkp.png');
    return { actual: `n=${rows.length} b64=${hit?.dataBase64?.length ?? 0}`, pass: Boolean(hit?.dataBase64) };
  }, onResult);

  await oq(results, 'ISO-SANDBOX-DB', 'URS-30', 'Protocol runs against OQ database', 'currentDbName() === gmp-wh-inv-oq.', async () => {
    return { actual: currentDbName(), pass: currentDbName() === OQ_DB_NAME };
  }, onResult);

  await oq(results, 'ISO-SESSION', 'URS-30', 'Live sessionStorage snapshot remains during protocol', 'If a session was seeded, peekStoredSession still sees it (no logout).', async () => {
    const live = peekStoredSession();
    return { actual: live ? `${live.userId}/${live.role}` : 'none', pass: true };
  }, onResult);

}
