/**
 * Exhaustive IQ / remaining OQ / PQ-style cases for sandbox self-validation.
 */
import type { ESign, Location, Material, Session } from '../types';
import {
  APP_VERSION,
  CAPABILITIES,
  DEFAULT_SOD,
  DOC_ID,
  ITEM_TYPES,
  SESSION_IDLE_MS,
  STATUSES,
  VALIDATION_BANNER,
} from '../types';
import { addAttachment } from './attachments';
import { listAudit, listAuditForRecord } from './audit';
import { listUsers, logout } from './auth';
import { exportBackup, importBackup } from './backup';
import { isExpired, locationToString, todayIsoDateInTz } from './dates';
import { getDb } from './db';
import {
  cycleCount,
  destroyContainer,
  getInventory,
  issueDispense,
  listByReceiptBatch,
  listInventory,
  listMovements,
  qaDisposition,
  receiveGoods,
  returnToStock,
  setHold,
  transferLocation,
  type ReceiveInput,
} from './inventory';
import { matchesRegisterKpi } from './kpiFilter';
import { isLocationCode, locationCode } from './locations';
import { saveMaterial } from './materials';
import { captureBarcode, captureRecordProof, takeImages, type OqImage } from './oqProof';
import { validatePasswordPolicy } from './passwordPolicy';
import { cloneRows, defaultAllows, defaultMatrixRows, validateMatrixSave } from './permissions';
import { approveRequestSupervisor, confirmFulfillment, pickSerialForRequest, submitRequest } from './requests';
import { isValidSerial, parseScanPayload } from './serial';
import { approveMaterialSubmission, submitMaterial } from './submissions';
import type { OqResult } from './selfValidation';

export type CaseRunner = (
  results: OqResult[],
  id: string,
  urs: string,
  title: string,
  expected: string,
  fn: () => Promise<{ actual: string; pass: boolean; images?: OqImage[] }>,
  onResult?: (r: OqResult) => void,
) => Promise<void>;

export type ExtraCtx = {
  results: OqResult[];
  onResult?: (r: OqResult) => void;
  oq: CaseRunner;
  threw: (fn: () => Promise<unknown>) => Promise<{ ok: boolean; message: string }>;
  esign: (session: Session, meaning: string) => ESign;
  receiveInput: (over?: Partial<ReceiveInput>) => ReceiveInput;
  op: Session;
  qa: Session;
  lab: Session;
  sup: Session;
  val: Session;
  s1: string;
  s2: string;
  mtfId: string;
};

function newLoc(): Location {
  return { site: 'MAIN', building: 'WH-1', room: 'OQ', rack: 'R9', shelf: 'S9', bin: 'XFER' };
}

export async function runIqCases(ctx: ExtraCtx): Promise<void> {
  const { results, onResult, oq } = ctx;
  await oq(
    results,
    'IQ-01',
    'URS-00',
    'IndexedDB object stores exist',
    'users, inventory, audit, attachments, materialRequests, materials, movements, accessLog, roles, inbox stores are present.',
    async () => {
      const db = await getDb();
      const names = Array.from(db.objectStoreNames);
      const need = [
        'users',
        'inventory',
        'audit',
        'attachments',
        'materialRequests',
        'materials',
        'movements',
        'accessLog',
        'roles',
        'inbox',
      ];
      const missing = need.filter((n) => !names.includes(n));
      return { actual: missing.length ? `missing ${missing.join(',')}` : `stores ok (${need.length})`, pass: missing.length === 0 };
    },
    onResult,
  );
  await oq(
    results,
    'IQ-02',
    'URS-07,30',
    'Banner strings, idle constant, password policy',
    'APP_VERSION/DOC_ID/VALIDATION_BANNER set; SESSION_IDLE_MS is 15 min; weak password rejected.',
    async () => {
      const weak = validatePasswordPolicy('wh', 'short');
      const idle = SESSION_IDLE_MS === 15 * 60 * 1000;
      const banners = Boolean(APP_VERSION && DOC_ID && VALIDATION_BANNER);
      return {
        actual: `ver=${APP_VERSION} doc=${DOC_ID} idle=${SESSION_IDLE_MS} weakErrs=${weak.length} banner=${VALIDATION_BANNER.slice(0, 40)}`,
        pass: banners && idle && weak.length > 0,
      };
    },
    onResult,
  );
  await oq(
    results,
    'IQ-03',
    'URS-07',
    'Unique seeded userIds',
    'listUsers() has unique userId values.',
    async () => {
      const users = await listUsers();
      const ids = users.map((u) => u.userId);
      const uniq = new Set(ids).size === ids.length && ids.length > 0;
      return { actual: `n=${ids.length} unique=${uniq} ids=${ids.join(',')}`, pass: uniq };
    },
    onResult,
  );
}

export async function runOqPqExtra(ctx: ExtraCtx): Promise<void> {
  const { results, onResult, oq, threw, esign, receiveInput, op, qa, lab, sup, val } = ctx;
  const s1 = ctx.s1;
  let pqSerial = '';
  let pqBatch = '';

  await oq(
    results,
    'OQ-09',
    'URS-08',
    'E-sign object fields',
    'ESign has printedName, userId, signedAtUtc, meaningOfSignature.',
    async () => {
      const e = esign(qa, 'OQ-09 meaning');
      const ok = Boolean(e.printedName && e.userId && e.signedAtUtc && e.meaningOfSignature);
      return {
        actual: `printedName=${e.printedName} userId=${e.userId} signedAtUtc=${e.signedAtUtc} meaning=${e.meaningOfSignature}`,
        pass: ok,
      };
    },
    onResult,
  );

  await oq(
    results,
    'OQ-11',
    'URS-11',
    'Controlled vocabulary',
    'ITEM_TYPES and STATUSES are closed lists used by receipt (Quarantine / Excipient).',
    async () => {
      const typesOk = ITEM_TYPES.includes('Excipient') && ITEM_TYPES.includes('API') && ITEM_TYPES.length >= 8;
      const stOk = STATUSES.includes('Quarantine') && STATUSES.includes('Released') && STATUSES.includes('Destroyed');
      const rec = s1 ? await getInventory(s1) : undefined;
      const used = rec ? ITEM_TYPES.includes(rec.itemType) && STATUSES.includes(rec.status) : true;
      return {
        actual: `ITEM_TYPES=${ITEM_TYPES.length} STATUSES=${STATUSES.join('|')} recType=${rec?.itemType} recStatus=${rec?.status}`,
        pass: typesOk && stOk && used,
      };
    },
    onResult,
  );

  await oq(
    results,
    'OQ-12',
    'URS-04',
    'Transfer changes location; movement + audit',
    'transferLocation updates location; TRANSFER movement and audit exist.',
    async () => {
      const before = s1 ? await getInventory(s1) : undefined;
      if (!before) throw new Error('S1 missing for transfer');
      const old = locationToString(before.location);
      const dest = newLoc();
      const after = await transferLocation(op, s1, dest, 'OQ-12 sandbox transfer');
      const moved = await listMovements();
      const mv = moved.find((m) => m.serial === s1 && m.action === 'TRANSFER');
      const aud = (await listAuditForRecord(s1)).filter((a) => a.action === 'TRANSFER');
      const img = await captureRecordProof('OQ-12 location before/after', {
        serial: s1,
        location: `${old} → ${locationToString(after.location)}`,
        extra: `movement=${mv?.id ?? 'none'} audit=${aud.length}`,
      });
      return {
        actual: `${old} → ${locationToString(after.location)}; movement=${Boolean(mv)} audit=${aud.length}`,
        pass: locationToString(after.location) !== old && Boolean(mv) && aud.length > 0,
        images: takeImages(img),
      };
    },
    onResult,
  );

  await oq(
    results,
    'OQ-13',
    'URS-15',
    'Backup JSON roundtrip in sandbox',
    'exportBackup then importBackup preserves inventory count (OQ DB only).',
    async () => {
      const before = (await listInventory()).length;
      const payload = await exportBackup(sup);
      await importBackup(sup, payload);
      const after = (await listInventory()).length;
      return {
        actual: `count ${before}→${after} keys inventory/audit/attachments=${Array.isArray(payload.inventory)}/${Array.isArray(payload.audit)}/${Array.isArray(payload.attachments)}`,
        pass: after === before && before > 0,
      };
    },
    onResult,
  );

  await oq(
    results,
    'OQ-14',
    'URS-13',
    'Dashboard counts match register KPI filters',
    'Quarantine and expired counts equal matchesRegisterKpi filters.',
    async () => {
      const all = await listInventory();
      const asOf = todayIsoDateInTz();
      const qA = all.filter((r) => r.status === 'Quarantine').length;
      const qB = all.filter((r) => matchesRegisterKpi(r, { status: 'Quarantine', asOf })).length;
      const eA = all.filter((r) => r.expiryDate && isExpired(r.expiryDate, asOf) && r.status !== 'Destroyed').length;
      const eB = all.filter((r) => matchesRegisterKpi(r, { extra: 'expired', asOf })).length;
      return { actual: `quarantine ${qA}/${qB} expired ${eA}/${eB}`, pass: qA === qB && eA === eB };
    },
    onResult,
  );

  await oq(
    results,
    'OQ-15',
    'URS-30',
    'VALIDATION_BANNER and DOC_ID',
    'VALIDATION_BANNER includes “Not validated”; DOC_ID is DOC-WH-INV-001.',
    async () => {
      const bannerOk = /not validated/i.test(VALIDATION_BANNER);
      return {
        actual: `DOC_ID=${DOC_ID} banner=${VALIDATION_BANNER}`,
        pass: bannerOk && DOC_ID === 'DOC-WH-INV-001',
      };
    },
    onResult,
  );

  await oq(
    results,
    'OQ-16',
    'URS-16',
    'Operator cannot saveMaterial; QA can',
    'saveMaterial(operator) throws; qa saveMaterial of OQ-MAT-1 succeeds.',
    async () => {
      const blank: Material = {
        materialCode: 'OQ-MAT-1',
        materialName: 'OQ Material 1',
        itemType: 'Excipient',
        gradeSpec: 'NF',
        pharmacopeia: 'USP',
        defaultUom: 'kg',
        defaultStorage: 'CRT 15–25 °C',
        samplingRequiredDefault: false,
        active: true,
        createdBy: '',
        createdOnUtc: '',
        modifiedBy: '',
        modifiedOnUtc: '',
      };
      const opDenied = await threw(() => saveMaterial(op, { ...blank, materialCode: 'OQ-MAT-OP' }, true, 'OQ-16'));
      await saveMaterial(qa, blank, true, 'OQ-16 qa create');
      return { actual: `opThrow=${opDenied.ok} (${opDenied.message}); qa saved OQ-MAT-1`, pass: opDenied.ok };
    },
    onResult,
  );

  await oq(
    results,
    'OQ-18',
    'URS-16',
    'Supervisor cannot edit matrix; lockout prevention',
    'supervisor.editPermissionMatrix is false; stripping all editPermissionMatrix fails validateMatrixSave.',
    async () => {
      const supEdit = defaultAllows('supervisor', 'editPermissionMatrix');
      const rows = cloneRows(defaultMatrixRows());
      for (const id of Object.keys(rows)) rows[id].editPermissionMatrix = false;
      const v = validateMatrixSave(rows, DEFAULT_SOD, 'waiver-for-sod-only');
      const lock = v.errors.some((e) => /editPermissionMatrix/i.test(e) && /lockout/i.test(e));
      return {
        actual: `supEdit=${supEdit} lockoutErr=${v.errors.join(' | ')}`,
        pass: supEdit === false && lock,
      };
    },
    onResult,
  );

  await oq(
    results,
    'OQ-24',
    'URS-14',
    'Location barcode isLocationCode',
    'locationCode(S1.location) is a LOC-… code; the serial itself is not.',
    async () => {
      const rec = s1 ? await getInventory(s1) : undefined;
      if (!rec) throw new Error('S1 missing');
      const code = locationCode(rec.location);
      const locOk = isLocationCode(code);
      const serialNot = !isLocationCode(rec.serial);
      return { actual: `code=${code} isLoc=${locOk} serialIsLoc=${!serialNot}`, pass: locOk && serialNot };
    },
    onResult,
  );

  await oq(
    results,
    'OQ-25',
    'URS-22',
    'submitMaterial + approveMaterial as QA',
    'Requester submitMaterial; QA approveMaterialSubmission assigns OQ-API-25.',
    async () => {
      const sub = await submitMaterial(lab, {
        materialName: 'OQ Proposed API',
        itemType: 'API',
        gradeSpec: 'USP',
        pharmacopeia: 'USP',
        defaultUom: 'kg',
        defaultStorage: 'CRT 15–25 °C',
        samplingRequiredDefault: false,
        manufacturerHint: 'OQ',
        supplierHint: 'OQ',
        justification: 'OQ-25 sandbox material',
      });
      const { material } = await approveMaterialSubmission(qa, sub.submissionId, 'OQ-API-25', 'OQ-25 approve');
      return {
        actual: `sub=${sub.submissionId} status=${sub.status} code=${material.materialCode}`,
        pass: material.materialCode === 'OQ-API-25',
      };
    },
    onResult,
  );

  await oq(
    results,
    'OQ-26',
    'URS-16',
    'Split caps cancelRequest and unlockUser exist on matrix',
    'CAPABILITIES includes cancelRequest and unlockUser; requester.cancelRequest; sysadmin.unlockUser.',
    async () => {
      const has =
        (CAPABILITIES as readonly string[]).includes('cancelRequest') &&
        (CAPABILITIES as readonly string[]).includes('unlockUser');
      const req = defaultAllows('requester', 'cancelRequest');
      const sys = defaultAllows('sysadmin', 'unlockUser');
      return { actual: `caps=${has} requester.cancelRequest=${req} sysadmin.unlockUser=${sys}`, pass: has && req && sys };
    },
    onResult,
  );

  await oq(
    results,
    'OQ-28',
    'URS-22,29',
    'Request audit REQUEST_SUBMIT / REQUEST_SUPERVISOR_APPROVE',
    'Material transfer audit includes REQUEST_SUBMIT and REQUEST_SUPERVISOR_APPROVE.',
    async () => {
      const id = ctx.mtfId;
      if (!id) throw new Error('OQ-22 request id missing');
      const rows = await listAuditForRecord(id);
      const submit = rows.some((a) => a.action === 'REQUEST_SUBMIT');
      const appr = rows.some((a) => a.action === 'REQUEST_SUPERVISOR_APPROVE');
      return {
        actual: `${id} SUBMIT=${submit} SUPERVISOR_APPROVE=${appr} n=${rows.length}`,
        pass: submit && appr,
      };
    },
    onResult,
  );

  await oq(
    results,
    'OQ-29',
    'URS-07',
    'SESSION_TIMEOUT audit on idle logout API',
    'logout(..., SESSION_TIMEOUT, { keepBrowserSession: true }) writes SESSION_TIMEOUT; idle is 15 min; does not clear the live tab session.',
    async () => {
      await logout(op, 'SESSION_TIMEOUT', { keepBrowserSession: true });
      const rows = await listAudit();
      const hit = rows.some((a) => a.action === 'SESSION_TIMEOUT' && a.recordId === op.userId);
      return {
        actual: `SESSION_TIMEOUT written=${hit} SESSION_IDLE_MS=${SESSION_IDLE_MS}`,
        pass: hit && SESSION_IDLE_MS === 15 * 60 * 1000,
      };
    },
    onResult,
  );

  await oq(
    results,
    'OQ-EXT-HOLD',
    'URS-03',
    'Hold / unhold',
    'QA setHold true then false on S1; record retained (not Destroyed).',
    async () => {
      if (!s1) throw new Error('S1 missing');
      const held = await setHold(qa, s1, true, 'OQ-EXT hold');
      const free = await setHold(qa, s1, false, 'OQ-EXT unhold');
      const still = await getInventory(s1);
      return {
        actual: `hold=${held.status} unhold=${free.status} retained=${still?.status}`,
        pass: held.status === 'Hold' && free.status !== 'Destroyed' && still?.status !== 'Destroyed',
      };
    },
    onResult,
  );

  await oq(
    results,
    'OQ-EXT-RETURN',
    'URS-04',
    'Issue then return to stock',
    'issueDispense 0.1 from S1 with FEFO override then returnToStock restores qty.',
    async () => {
      if (!s1) throw new Error('S1 missing');
      const before = await getInventory(s1);
      if (!before) throw new Error('S1 missing');
      const qty = before.currentQty;
      const iss = await threw(() => issueDispense(op, s1, 0.1, 'OQ dest', 'OQ-EXT issue', 'OQ-EXT FEFO override'));
      if (iss.ok) throw new Error(`issue failed: ${iss.message}`);
      const mid = await getInventory(s1);
      await returnToStock(op, s1, 0.1, 'OQ-EXT return');
      const after = await getInventory(s1);
      return {
        actual: `qty ${qty}→${mid?.currentQty}→${after?.currentQty}`,
        pass: Boolean(mid && after && Math.abs((mid.currentQty ?? 0) - (qty - 0.1)) < 0.001 && Math.abs(after.currentQty - qty) < 0.001),
      };
    },
    onResult,
  );

  await oq(
    results,
    'OQ-EXT-COUNT',
    'URS-09',
    'Cycle count sets quantity',
    'cycleCount writes counted qty on S1.',
    async () => {
      if (!s1) throw new Error('S1 missing');
      const rec = await cycleCount(op, s1, 0.42, 'OQ-EXT cycle count');
      return { actual: `counted=${rec.currentQty}`, pass: rec.currentQty === 0.42 };
    },
    onResult,
  );

  await oq(
    results,
    'PQ-01',
    'URS-01,21,28',
    'PQ goods receipt of 3 drums with batch CoA',
    '3 unique serials, shared receiptBatchId, CoA attachment at receiptBatch scope.',
    async () => {
      const recs = await receiveGoods(
        op,
        receiveInput({
          materialCode: 'RM-002',
          materialName: 'Microcrystalline Cellulose',
          itemType: 'Excipient',
          numberOfContainers: 3,
          containerType: 'Drum',
          qtyPerContainer: 25,
          uom: 'kg',
          comments: 'PQ-01 sandbox receipt',
        }),
      );
      pqSerial = recs[0].serial;
      pqBatch = recs[0].receiptBatchId;
      const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
      const file = new File([bytes], 'pq-batch-coa.pdf', { type: 'application/pdf' });
      await addAttachment(op, { scope: 'receiptBatch', recordId: pqBatch, file, category: 'CoA' });
      const unique = new Set(recs.map((r) => r.serial)).size === 3;
      const img = await captureRecordProof('PQ-01 three drums', {
        serial: recs.map((r) => r.serial).join(', '),
        extra: `batch=${pqBatch}`,
        attachment: 'pq-batch-coa.pdf',
      });
      const bc = captureBarcode(pqSerial, `PQ-01 CODE128 ${pqSerial}`);
      return {
        actual: `${recs.map((r) => r.serial).join(', ')} batch=${pqBatch}`,
        pass: recs.length === 3 && unique && recs.every((r) => r.receiptBatchId === pqBatch && isValidSerial(r.serial)),
        images: takeImages(bc, img),
      };
    },
    onResult,
  );

  await oq(
    results,
    'PQ-02',
    'URS-02',
    'QA batch release of PQ receiptBatchId',
    'qaDisposition batch → all siblings Released.',
    async () => {
      if (!pqSerial || !pqBatch) throw new Error('PQ-01 receipt missing');
      await qaDisposition(
        qa,
        pqSerial,
        'Release',
        esign(qa, 'I attest this lot is released for GMP use per CoA and specification.'),
        'PQ-02 batch release',
        'batch',
      );
      const sibs = await listByReceiptBatch(pqBatch);
      const allRel = sibs.length === 3 && sibs.every((r) => r.status === 'Released');
      const img = await captureRecordProof('PQ-02 batch Released', {
        serial: sibs.map((r) => `${r.serial}:${r.status}`).join(', '),
        status: 'Released',
        extra: `batch=${pqBatch}`,
      });
      return { actual: sibs.map((r) => `${r.serial}:${r.status}`).join(', '), pass: allRel, images: takeImages(img) };
    },
    onResult,
  );

  await oq(
    results,
    'PQ-03',
    'URS-03,09',
    'Destroy a quarantine test serial; still listed',
    'QA destroy of a new quarantine serial; row remains Destroyed.',
    async () => {
      const recs = await receiveGoods(op, receiveInput({ comments: 'PQ-03 destroy parent', qtyPerContainer: 1 }));
      const serial = recs[0].serial;
      const destroyed = await destroyContainer(qa, serial, 'PQ-03 destroy', esign(qa, 'I authorize destruction of this container.'));
      const still = await getInventory(serial);
      const listed = (await listInventory()).some((r) => r.serial === serial);
      return {
        actual: `${serial} status=${destroyed.status} listed=${listed}`,
        pass: destroyed.status === 'Destroyed' && still?.status === 'Destroyed' && listed,
      };
    },
    onResult,
  );

  await oq(
    results,
    'PQ-04',
    'URS-22,29',
    'MTF to LVM (GMP / protocol) then FEFO issue',
    'submitRequest toLocation LVM, classification GMP, intendedUse protocol; supervisor approve; pick; confirmFulfillment.',
    async () => {
      const req = await submitRequest(lab, {
        materialCode: 'API-001',
        qtyRequested: 1,
        uom: 'kg',
        neededBy: '2026-09-15',
        toLocation: 'LVM',
        classification: ['GMP'],
        intendedUse: 'protocol',
        priority: 'Routine',
        requestorEsign: esign(lab, 'I request this material transfer.'),
      });
      const pending = req.status === 'Pending Supervisor';
      const approved = await approveRequestSupervisor(sup, req.requestId, esign(sup, 'I approve this material transfer.'));
      const target =
        approved.reservedSerials[0]?.serial ||
        (await listInventory()).find((r) => r.materialCode === 'API-001' && r.status === 'Released' && r.currentQty > 0)
          ?.serial;
      if (!target) throw new Error('no Released API-001 for PQ-04');
      await pickSerialForRequest(op, req.requestId, target, 1);
      const issued = await confirmFulfillment(
        op,
        req.requestId,
        'PQ-04 FEFO override',
        esign(op, 'Materials Management confirm issue'),
        { commentsNa: true },
      );
      const img = await captureRecordProof('PQ-04 MTF LVM', {
        request: `${req.requestId} ${req.status}→${approved.status}→${issued.status}`,
        extra: `to=LVM class=GMP use=protocol serial=${target}`,
      });
      return {
        actual: `${req.requestId} ${req.status}→${approved.status}→${issued.status} to=${req.toLocation}`,
        pass:
          pending &&
          req.toLocation === 'LVM' &&
          approved.status === 'Approved' &&
          (issued.status === 'Issued' || issued.status === 'Partially Issued'),
        images: takeImages(img),
      };
    },
    onResult,
  );

  await oq(
    results,
    'PQ-05',
    'URS-06',
    'Audit review RECEIVE then QA_DISPOSITION',
    'listAuditForRecord(PQ-01 serial) has RECEIVE and QA_DISPOSITION; newest-first so QA index < RECEIVE index.',
    async () => {
      if (!pqSerial) throw new Error('PQ-01 serial missing');
      const rows = await listAuditForRecord(pqSerial);
      const qi = rows.findIndex((a) => a.action === 'QA_DISPOSITION');
      const ri = rows.findIndex((a) => a.action === 'RECEIVE');
      return {
        actual: `QA_DISPOSITION idx=${qi} RECEIVE idx=${ri} n=${rows.length}`,
        pass: qi >= 0 && ri >= 0 && qi < ri,
      };
    },
    onResult,
  );

  await oq(
    results,
    'PQ-06',
    'URS-07,16,30',
    'Unique logins; validation cannot receive',
    'Seed users unique; validation role cannot receiveGoods.',
    async () => {
      const users = await listUsers();
      const ids = users.map((u) => u.userId);
      const uniq = new Set(ids).size === ids.length;
      const denied = await threw(() => receiveGoods(val, receiveInput({ comments: 'PQ-06 val should fail' })));
      return {
        actual: `unique=${uniq} valReceiveThrow=${denied.ok} (${denied.message})`,
        pass: uniq && denied.ok,
      };
    },
    onResult,
  );

  await oq(
    results,
    'PQ-07',
    'URS-14',
    'Barcode scan payload equals serial',
    'parseScanPayload of serial-only and QR payload returns the serial.',
    async () => {
      const serial = pqSerial || s1;
      if (!serial) throw new Error('no serial for PQ-07');
      const parsed = parseScanPayload(`${serial}|LOT|2028-01-01|Released|Drum`);
      const plain = parseScanPayload(serial);
      const bc = captureBarcode(serial, `PQ-07 CODE128 ${serial}`);
      return {
        actual: `payload→${parsed} plain→${plain}`,
        pass: parsed === serial && plain === serial,
        images: takeImages(bc),
      };
    },
    onResult,
  );

  await oq(
    results,
    'PQ-08',
    'URS-15',
    'Backup JSON contains inventory, audit, attachments',
    'exportBackup payload has inventory, audit, attachments arrays.',
    async () => {
      const payload = await exportBackup(sup);
      const ok =
        Array.isArray(payload.inventory) && Array.isArray(payload.audit) && Array.isArray(payload.attachments);
      return {
        actual: `inventory=${payload.inventory.length} audit=${payload.audit.length} attachments=${(payload.attachments ?? []).length}`,
        pass: ok,
      };
    },
    onResult,
  );

  await oq(
    results,
    'VAL-SOD',
    'URS-30',
    'Validation session cannot receiveGoods',
    'runValidation true; receive false; receiveGoods throws.',
    async () => {
      const r = await threw(() => receiveGoods(val, receiveInput({ comments: 'VAL-SOD' })));
      return {
        actual: `runValidation=${defaultAllows('validation', 'runValidation')} receive=${defaultAllows('validation', 'receive')} throw=${r.ok}`,
        pass: defaultAllows('validation', 'runValidation') && !defaultAllows('validation', 'receive') && r.ok,
      };
    },
    onResult,
  );

}
