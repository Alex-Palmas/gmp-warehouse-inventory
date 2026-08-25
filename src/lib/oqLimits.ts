import { MAX_BYTES } from './attachments';
import { addAttachment } from './attachments';
import { createUser } from './auth';
import { allocateSerialsOnSubmit, cycleCount, destroyContainer, issueDispense, receiveGoods, returnToStock, samplePull, setHold, transferLocation } from './inventory';
import type { ExtraCtx } from './oqExtra';
import { dump, esignOf, fakeFile, roleSess, tinyPngFile, xferLoc } from './oqSuite';
import { assertSerialUnique, formatReceiptBatchId, formatRequestId, formatSerial, formatSubmissionId } from './serial';

export const LIM_OQ_IDS = [
  'LIM-N-0', 'LIM-N-9999', 'LIM-N-10000',
  'LIM-QTY-0', 'LIM-QTY-NEG',
  'LIM-SAMPLE-EXCEED', 'LIM-ISSUE-EXCEED', 'LIM-COUNT-NEG',
  'LIM-REASON-EMPTY', 'LIM-MATERIAL-REQUIRED',
  'LIM-ATTACH-TYPE', 'LIM-ATTACH-SIZE',
  'LIM-ESIGN-INCOMPLETE', 'LIM-SERIAL-DUP', 'LIM-USERID-DUP',
  'LIM-SERIAL-YEAR', 'LIM-SERIAL-SEQ', 'LIM-RCV-YEAR', 'LIM-MR-YEAR', 'LIM-SUB-YEAR',
  'LIM-ATTACH-RECORD', 'LIM-UNLOCK-REASON',
  'LIM-ATTACH-SCOPE', 'LIM-ATTACH-CATEGORY',
  'LIM-REQUEST-QTY-0', 'LIM-REQUEST-OTHER', 'LIM-REQUEST-INTENDED',
  'LIM-PICK-QTY-0', 'LIM-MATERIAL-DUP', 'LIM-SUBMIT-NAME',
] as const;

export async function runLimitCases(ctx: ExtraCtx): Promise<void> {
  const { results, onResult, oq, threw, receiveInput, op, qa, sup } = ctx;

  await oq(results, 'LIM-N-0', 'URS-21', 'Container count 0 rejected', 'receiveGoods numberOfContainers 0 throws integer ≥ 1.', async () => {
    const r = await threw(() => receiveGoods(op, receiveInput({ numberOfContainers: 0 })));
    return { actual: r.message, pass: r.ok && r.message.includes('integer ≥ 1') };
  }, onResult);

  await oq(results, 'LIM-N-9999', 'URS-21', 'Valid container count 1 accepted (max 9999)', '1 container receives; 9999 is the documented max (10000 throws exceeds 9999).', async () => {
    const ok = await receiveGoods(op, receiveInput({ comments: 'LIM-N-9999' }));
    const over = await threw(() => allocateSerialsOnSubmit(10000));
    return { actual: `n=${ok.length} over=${over.message}`, pass: ok.length === 1 && over.ok && over.message.includes('9999') };
  }, onResult);

  await oq(results, 'LIM-N-10000', 'URS-21', 'Container count 10000 rejected', 'allocateSerialsOnSubmit(10000) throws exceeds 9999.', async () => {
    const r = await threw(() => allocateSerialsOnSubmit(10000));
    return { actual: r.message, pass: r.ok && r.message.includes('exceeds 9999') };
  }, onResult);

  await oq(results, 'LIM-QTY-0', 'URS-13', 'Zero qty rejected on receive/issue/return/sample', 'qtyPerContainer 0, issue 0, return 0, sample 0 all throw > 0.', async () => {
    const mismatches: string[] = [];
    const rec0 = await threw(() => receiveGoods(op, receiveInput({ qtyPerContainer: 0 })));
    if (!rec0.ok || !rec0.message.includes('> 0')) mismatches.push(`receive ${rec0.message}`);
    const recs = await receiveGoods(op, receiveInput({ comments: 'LIM-QTY-0' }));
    await import('./inventory').then((m) => m.qaDisposition(qa, recs[0].serial, 'Release', esignOf(qa, 'QA'), 'LIM-QTY-0'));
    const iss = await threw(() => issueDispense(op, recs[0].serial, 0, 'LVM', 'x', ''));
    if (!iss.ok || !iss.message.includes('> 0')) mismatches.push(`issue ${iss.message}`);
    const ret = await threw(() => returnToStock(op, recs[0].serial, 0, 'x'));
    if (!ret.ok || !ret.message.includes('> 0')) mismatches.push(`return ${ret.message}`);
    const sam = await threw(() => samplePull(qa, recs[0].serial, 0, 'sample', 'x'));
    if (!sam.ok || !sam.message.includes('> 0')) mismatches.push(`sample ${sam.message}`);
    return dump(mismatches);
  }, onResult);

  await oq(results, 'LIM-QTY-NEG', 'URS-13', 'Negative qty rejected', 'qtyPerContainer -1 and issue -1 throw.', async () => {
    const rec = await threw(() => receiveGoods(op, receiveInput({ qtyPerContainer: -1 })));
    const recs = await receiveGoods(op, receiveInput({ comments: 'LIM-QTY-NEG' }));
    await import('./inventory').then((m) => m.qaDisposition(qa, recs[0].serial, 'Release', esignOf(qa, 'QA'), 'x'));
    const iss = await threw(() => issueDispense(op, recs[0].serial, -1, 'LVM', 'x', ''));
    return { actual: `recv=${rec.message}; issue=${iss.message}`, pass: rec.ok && iss.ok };
  }, onResult);

  await oq(results, 'LIM-SAMPLE-EXCEED', 'URS-25', 'Sample qty cannot exceed parent', 'samplePull qtyTaken > currentQty throws.', async () => {
    const recs = await receiveGoods(op, receiveInput({ qtyPerContainer: 1, comments: 'LIM-SAMPLE-EXCEED' }));
    const r = await threw(() => samplePull(qa, recs[0].serial, 99, 'sample', 'x'));
    return { actual: r.message, pass: r.ok && /exceeds current quantity/i.test(r.message) };
  }, onResult);

  await oq(results, 'LIM-ISSUE-EXCEED', 'URS-05', 'Issue qty cannot exceed currentQty', 'issueDispense 99 on qty 1 throws exceeds current quantity.', async () => {
    const recs = await receiveGoods(op, receiveInput({ qtyPerContainer: 1, comments: 'LIM-ISSUE-EXCEED' }));
    await import('./inventory').then((m) => m.qaDisposition(qa, recs[0].serial, 'Release', esignOf(qa, 'QA'), 'x'));
    const r = await threw(() => issueDispense(op, recs[0].serial, 99, 'LVM', 'x', ''));
    return { actual: r.message, pass: r.ok && /exceeds current quantity/i.test(r.message) };
  }, onResult);

  await oq(results, 'LIM-COUNT-NEG', 'URS-20', 'Cycle count qty cannot be negative', 'countedQty < 0 throws.', async () => {
    const recs = await receiveGoods(op, receiveInput({ comments: 'LIM-COUNT-NEG' }));
    const r = await threw(() => cycleCount(op, recs[0].serial, -1, 'count'));
    return { actual: r.message, pass: r.ok && /cannot be negative/i.test(r.message) };
  }, onResult);

  await oq(results, 'LIM-REASON-EMPTY', 'URS-20', 'Transfer/hold/count/destroy require reason', 'Empty reason throws Reason for change / Destruction reason.', async () => {
    const recs = await receiveGoods(op, receiveInput({ comments: 'LIM-REASON-EMPTY' }));
    const s = recs[0].serial;
    const mismatches: string[] = [];
    const t = await threw(() => transferLocation(op, s, xferLoc(), '  '));
    if (!t.ok) mismatches.push(`transfer ${t.message}`);
    const h = await threw(() => setHold(qa, s, true, ''));
    if (!h.ok) mismatches.push(`hold ${h.message}`);
    const c = await threw(() => cycleCount(op, s, 1, ''));
    if (!c.ok) mismatches.push(`count ${c.message}`);
    const d = await threw(() => destroyContainer(qa, s, '  ', esignOf(qa, 'destroy')));
    if (!d.ok) mismatches.push(`destroy ${d.message}`);
    return dump(mismatches);
  }, onResult);

  await oq(results, 'LIM-MATERIAL-REQUIRED', 'URS-13', 'Receive without materialCode rejected', 'Empty materialCode throws Material is required.', async () => {
    const r = await threw(() => receiveGoods(op, receiveInput({ materialCode: '', materialName: '' })));
    return { actual: r.message, pass: r.ok && /Material is required/i.test(r.message) };
  }, onResult);

  await oq(results, 'LIM-ATTACH-TYPE', 'URS-28', 'Non pdf/jpeg/png/webp/gif rejected', 'Disallowed file type.', async () => {
    const recs = await receiveGoods(op, receiveInput({ comments: 'LIM-ATTACH-TYPE' }));
    const r = await threw(() =>
      addAttachment(op, { scope: 'serial', recordId: recs[0].serial, file: fakeFile('x.exe', 'application/x-msdownload', 16), category: 'CoA' }),
    );
    return { actual: r.message, pass: r.ok && /Disallowed file type/i.test(r.message) };
  }, onResult);

  await oq(results, 'LIM-ATTACH-SIZE', 'URS-28', 'File over 10 MB rejected', 'MAX_BYTES+1 throws File exceeds 10 MB limit.', async () => {
    const recs = await receiveGoods(op, receiveInput({ comments: 'LIM-ATTACH-SIZE' }));
    const r = await threw(() =>
      addAttachment(op, { scope: 'serial', recordId: recs[0].serial, file: fakeFile('big.pdf', 'application/pdf', MAX_BYTES + 1), category: 'CoA' }),
    );
    return { actual: `limit=${MAX_BYTES} ${r.message}`, pass: r.ok && /10 MB/i.test(r.message) };
  }, onResult);

  await oq(results, 'LIM-ESIGN-INCOMPLETE', 'URS-09', 'Empty printedName / userId mismatch', 'Incomplete e-sign and mismatched userId throw.', async () => {
    const recs = await receiveGoods(op, receiveInput({ comments: 'LIM-ESIGN-INCOMPLETE' }));
    const { qaDisposition } = await import('./inventory');
    const inc = await threw(() =>
      qaDisposition(qa, recs[0].serial, 'Release', { userId: qa.userId, printedName: '', signedAtUtc: 'x', meaningOfSignature: 'x' }, 'x'),
    );
    const mis = await threw(() =>
      qaDisposition(qa, recs[0].serial, 'Release', { userId: 'other', printedName: 'x', signedAtUtc: 'x', meaningOfSignature: 'x' }, 'x'),
    );
    return { actual: `${inc.message} | ${mis.message}`, pass: inc.ok && mis.ok && /incomplete|must match/i.test(inc.message + mis.message) };
  }, onResult);

  await oq(results, 'LIM-SERIAL-DUP', 'URS-01', 'Serial cannot be reused', 'assertSerialUnique throws already allocated.', async () => {
    const r = await threw(async () => {
      assertSerialUnique('WH-2026-000001', ['WH-2026-000001']);
    });
    return { actual: r.message, pass: r.ok && /already allocated/i.test(r.message) };
  }, onResult);

  await oq(results, 'LIM-USERID-DUP', 'URS-07', 'Create user with existing id rejected', 'createUser(wh) throws User ID already exists.', async () => {
    const r = await threw(() =>
      createUser(roleSess('sysadmin'), { userId: 'wh', fullName: 'dup', role: 'operator', password: 'DupUser123!x' }),
    );
    return { actual: r.message, pass: r.ok && /already exists/i.test(r.message) };
  }, onResult);

  await oq(results, 'LIM-SERIAL-YEAR', 'URS-01', 'Invalid serial year rejected', 'formatSerial(1999, 1) throws.', async () => {
    const r = await threw(async () => { formatSerial(1999, 1); });
    return { actual: r.message, pass: r.ok && /Invalid serial year/i.test(r.message) };
  }, onResult);

  await oq(results, 'LIM-SERIAL-SEQ', 'URS-01', 'Invalid serial sequence rejected', 'formatSerial(2026, 0) throws.', async () => {
    const r = await threw(async () => { formatSerial(2026, 0); });
    return { actual: r.message, pass: r.ok && /Invalid serial sequence/i.test(r.message) };
  }, onResult);

  await oq(results, 'LIM-RCV-YEAR', 'URS-21', 'Invalid receipt batch year rejected', 'formatReceiptBatchId(1999, 1) throws.', async () => {
    const r = await threw(async () => { formatReceiptBatchId(1999, 1); });
    return { actual: r.message, pass: r.ok };
  }, onResult);

  await oq(results, 'LIM-MR-YEAR', 'URS-22', 'Invalid request year rejected', 'formatRequestId(1999, 1) throws.', async () => {
    const r = await threw(async () => { formatRequestId(1999, 1); });
    return { actual: r.message, pass: r.ok };
  }, onResult);

  await oq(results, 'LIM-SUB-YEAR', 'URS-23', 'Invalid submission year rejected', 'formatSubmissionId(1999, 1) throws.', async () => {
    const r = await threw(async () => { formatSubmissionId(1999, 1); });
    return { actual: r.message, pass: r.ok };
  }, onResult);

  await oq(results, 'LIM-ATTACH-RECORD', 'URS-28', 'Attachment recordId required', 'Empty recordId throws Record ID is required.', async () => {
    const r = await threw(() =>
      addAttachment(op, { scope: 'serial', recordId: '', file: tinyPngFile(), category: 'CoA' }),
    );
    return { actual: r.message, pass: r.ok && /Record ID is required/i.test(r.message) };
  }, onResult);

  await oq(results, 'LIM-UNLOCK-REASON', 'URS-07', 'Unlock requires reason', 'unlockUser empty reason throws.', async () => {
    const { unlockUser } = await import('./auth');
    const r = await threw(() => unlockUser(sup, 'ro', '  '));
    return { actual: r.message, pass: r.ok && /Reason for change is required/i.test(r.message) };
  }, onResult);

  await oq(results, 'LIM-ATTACH-SCOPE', 'URS-28', 'Invalid attachment scope rejected', 'scope other than serial/receiptBatch throws.', async () => {
    const recs = await receiveGoods(op, receiveInput({ comments: 'LIM-ATTACH-SCOPE' }));
    const r = await threw(() =>
      addAttachment(op, { scope: 'other' as never, recordId: recs[0].serial, file: tinyPngFile(), category: 'CoA' }),
    );
    return { actual: r.message, pass: r.ok && /Invalid attachment scope/i.test(r.message) };
  }, onResult);

  await oq(results, 'LIM-ATTACH-CATEGORY', 'URS-28', 'Invalid attachment category rejected', 'Unknown category throws.', async () => {
    const recs = await receiveGoods(op, receiveInput({ comments: 'LIM-ATTACH-CATEGORY' }));
    const r = await threw(() =>
      addAttachment(op, { scope: 'serial', recordId: recs[0].serial, file: tinyPngFile(), category: 'Nope' as never }),
    );
    return { actual: r.message, pass: r.ok && /Invalid attachment category/i.test(r.message) };
  }, onResult);

  await oq(results, 'LIM-REQUEST-QTY-0', 'URS-22', 'Requested quantity must be > 0', 'submitRequest qty 0 throws.', async () => {
    const { submitRequest } = await import('./requests');
    const { mtfInput } = await import('./oqSuite');
    const r = await threw(() => submitRequest(ctx.lab, mtfInput(ctx.lab, { qtyRequested: 0 })));
    return { actual: r.message, pass: r.ok && /> 0/i.test(r.message) };
  }, onResult);

  await oq(results, 'LIM-REQUEST-OTHER', 'URS-22', 'Other destination requires destinationOther', 'toLocation Other without text throws.', async () => {
    const { submitRequest } = await import('./requests');
    const { mtfInput } = await import('./oqSuite');
    const r = await threw(() => submitRequest(ctx.lab, mtfInput(ctx.lab, { toLocation: 'Other', destinationOther: '' })));
    return { actual: r.message, pass: r.ok && /Specify Other destination/i.test(r.message) };
  }, onResult);

  await oq(results, 'LIM-REQUEST-INTENDED', 'URS-22', 'Intended use required', 'empty intendedUse throws.', async () => {
    const { submitRequest } = await import('./requests');
    const { mtfInput } = await import('./oqSuite');
    const r = await threw(() => submitRequest(ctx.lab, mtfInput(ctx.lab, { intendedUse: '   ', purpose: '' })));
    return { actual: r.message, pass: r.ok && /Intended use is required/i.test(r.message) };
  }, onResult);

  await oq(results, 'LIM-PICK-QTY-0', 'URS-22', 'Pick quantity must be > 0', 'pickSerialForRequest qty 0 throws.', async () => {
    const { pickSerialForRequest } = await import('./requests');
    const r = await threw(() => pickSerialForRequest(op, 'MR-2026-000001', 'WH-2026-000001', 0));
    return { actual: r.message, pass: r.ok && /> 0/i.test(r.message) };
  }, onResult);

  await oq(results, 'LIM-MATERIAL-DUP', 'URS-19', 'Material code already exists', 'saveMaterial isNew RM-001 throws.', async () => {
    const { saveMaterial } = await import('./materials');
    const r = await threw(() =>
      saveMaterial(
        ctx.sup,
        {
          materialCode: 'RM-001',
          materialName: 'dup',
          itemType: 'Excipient',
          gradeSpec: 'NF',
          pharmacopeia: 'USP',
          defaultUom: 'kg',
          defaultStorage: 'CRT 15–25 °C',
          samplingRequiredDefault: false,
          active: true,
          createdBy: 'admin',
          createdOnUtc: '2026-08-24T00:00:00.000Z',
          modifiedBy: 'admin',
          modifiedOnUtc: '2026-08-24T00:00:00.000Z',
        },
        true,
        'dup',
      ),
    );
    return { actual: r.message, pass: r.ok && /already exists/i.test(r.message) };
  }, onResult);

  await oq(results, 'LIM-SUBMIT-NAME', 'URS-23', 'Material submission name required', 'submitMaterial empty name throws.', async () => {
    const { submitMaterial } = await import('./submissions');
    const r = await threw(() =>
      submitMaterial(ctx.lab, {
        materialName: '  ',
        itemType: 'Excipient',
        gradeSpec: 'NF',
        pharmacopeia: 'USP',
        defaultUom: 'kg',
        defaultStorage: 'CRT 15–25 °C',
        samplingRequiredDefault: false,
        manufacturerHint: '',
        supplierHint: '',
        justification: 'x',
      }),
    );
    return { actual: r.message, pass: r.ok && /Material name is required/i.test(r.message) };
  }, onResult);
}
