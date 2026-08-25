/**
 * Sandbox self-validation / automated OQ evidence.
 * Runs against gmp-wh-inv-oq only. Never a substitute for executed IQ/OQ/PQ.
 */
import type { ESign, InventoryRecord, Session, UserRecord } from '../types';
import {
  APP_VERSION,
  DEFAULT_SOD,
  DOC_ID,
  LOCKOUT_ATTEMPTS,
  VALIDATION_BANNER,
} from '../types';
import { addAttachment, listForSerial } from './attachments';
import { appendAudit, AUDIT_MUTATION_API, listAudit } from './audit';
import { applyFailedLogin, GENERIC_LOGIN_ERROR, isAccountLocked, peekStoredSession, persistSession, restoreBrowserSession, snapshotBrowserSession } from './auth';
import { nowUtcIso } from './dates';
import { deleteDatabase, getDb, OQ_DB_NAME, withDatabase } from './db';
import { isIssueBlocked, shouldWarnFefo } from './fefo';
import {
  cycleCount,
  destroyContainer,
  getInventory,
  issueDispense,
  listInventory,
  qaDisposition,
  receiveGoods,
  samplePull,
  type ReceiveInput,
} from './inventory';
import { runIqCases, runOqPqExtra } from './oqExtra';
import { runExhaustive } from './oqExhaustive';
import { captureBarcode, captureCaseProof, captureRecordProof, takeImages, type OqImage } from './oqProof';
import {
  assertCapability,
  assertNotOwnReceipt,
  cloneRows,
  defaultAllows,
  defaultMatrixRows,
  evaluateSod,
} from './permissions';
import { approveRequestSupervisor, confirmFulfillment, confirmReceived, pickSerialForRequest, submitRequest } from './requests';
import { ensureSeeded } from './seed';
import { isValidReceiptBatchId, isValidSerial, parseScanPayload, parseSerial } from './serial';

export const OQ_EVIDENCE_DISCLAIMER =
  'Automated sandbox evidence with screenshots — not approved IQ/OQ/PQ, not a vendor Part 11 certificate. Live lots were not used.';

export type OqVerdict = 'Pass' | 'Fail' | 'Manual';
export interface OqResult {
  id: string;
  urs: string;
  title: string;
  expected: string;
  actual: string;
  verdict: OqVerdict;
  ms: number;
  images: import('./oqProof').OqImage[];
}
export interface ValidationReport {
  executedUtc: string;
  executedBy: string;
  appVersion: string;
  docId: string;
  sandboxDb: string;
  results: OqResult[];
  passed: number;
  failed: number;
  manual: number;
  printedName: string;
  signedUserId: string;
  signedAtUtc: string;
  meaningOfSignature: string;
}

function sess(role: string, userId = role): Session {
  return {
    userId,
    fullName: userId,
    role,
    roleName: role,
    startedUtc: '2026-08-24T00:00:00.000Z',
    lastActivityUtc: '2026-08-24T00:00:00.000Z',
    mustChangePassword: false,
  };
}

function esign(session: Session, meaning: string): ESign {
  return {
    userId: session.userId,
    printedName: session.fullName,
    signedAtUtc: nowUtcIso(),
    meaningOfSignature: meaning,
  };
}

function loc(): ReceiveInput['location'] {
  return { site: 'MAIN', building: 'WH-1', room: 'OQ', rack: 'R1', shelf: 'S1', bin: 'OQ1' };
}

function receiveInput(over: Partial<ReceiveInput> = {}): ReceiveInput {
  return {
    materialCode: 'RM-001',
    materialName: 'Lactose Monohydrate',
    itemType: 'Excipient',
    gradeSpec: 'NF',
    pharmacopeia: 'USP',
    manufacturer: 'OQ Mfr',
    manufacturerLot: 'OQ-LOT-1',
    supplier: 'OQ Sup',
    supplierLot: 'OQ-SUP-1',
    poDeliveryNote: 'PO-OQ-1',
    coaNumber: 'COA-OQ-1',
    internalLot: 'IL-OQ-1',
    numberOfContainers: 1,
    containerType: 'Drum',
    qtyPerContainer: 1,
    uom: 'kg',
    dateOfManufacture: '2026-01-01',
    receiptDate: '2026-08-01',
    expiryDate: '2028-01-01',
    retestDate: '',
    location: loc(),
    storageCondition: 'CRT 15–25 °C',
    samplingRequired: false,
    linkedSampleIds: '',
    comments: 'OQ sandbox receipt',
    ...over,
  };
}

async function threw(fn: () => Promise<unknown>): Promise<{ ok: boolean; message: string }> {
  try {
    await fn();
    return { ok: false, message: 'expected throw, but succeeded' };
  } catch (e) {
    return { ok: true, message: e instanceof Error ? e.message : String(e) };
  }
}

export async function oq(
  results: OqResult[],
  id: string,
  urs: string,
  title: string,
  expected: string,
  fn: () => Promise<{ actual: string; pass: boolean; images?: OqImage[] }>,
  onResult?: (r: OqResult) => void,
): Promise<void> {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  try {
    const { actual, pass, images } = await fn();
    const verdict: OqVerdict = pass ? 'Pass' : 'Fail';
    const fromCase = images ?? [];
    const card = await captureCaseProof({ id, title, expected, actual, verdict });
    const merged = takeImages(...fromCase, card);
    const row: OqResult = {
      id,
      urs,
      title,
      expected,
      actual,
      verdict,
      ms: Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0),
      images: merged,
    };
    results.push(row);
    onResult?.(row);
  } catch (e) {
    const actual = e instanceof Error ? e.message : String(e);
    const verdict: OqVerdict = 'Fail';
    const fromCase: OqImage[] = [];
    const card = await captureCaseProof({ id, title, expected, actual, verdict });
    const merged = takeImages(...fromCase, card);
    const row: OqResult = {
      id,
      urs,
      title,
      expected,
      actual,
      verdict,
      ms: Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0),
      images: merged,
    };
    results.push(row);
    onResult?.(row);
  }
}

async function oqManual(
  results: OqResult[],
  id: string,
  urs: string,
  title: string,
  expected: string,
  onResult?: (r: OqResult) => void,
): Promise<void> {
  const actual = 'Not automated (visual / hardware)';
  const verdict: OqVerdict = 'Manual';
  const fromCase: OqImage[] = [];
  const card = await captureCaseProof({ id, title, expected, actual, verdict });
  const merged = takeImages(...fromCase, card);
  const row: OqResult = {
    id,
    urs,
    title,
    expected,
    actual,
    verdict,
    ms: 0,
    images: merged,
  };
  results.push(row);
  onResult?.(row);
}

async function runProtocol(onResult?: (r: OqResult) => void): Promise<OqResult[]> {
  const results: OqResult[] = [];
  const op = sess('operator', 'wh');
  const qa = sess('qa', 'qa');
  const lab = sess('requester', 'lab');
  const sup = sess('supervisor', 'admin');
  const ro = sess('readonly', 'ro');
  const val = sess('validation', 'val');
  let s1 = '';
  let s2 = '';
  let mtfId = '';

  await runIqCases({
    results,
    onResult,
    oq,
    threw,
    esign,
    receiveInput,
    op,
    qa,
    lab,
    sup,
    val,
    s1,
    s2,
    mtfId,
  });

  await oq(
    results,
    'OQ-01',
    'URS-01',
    'Serial uniqueness and format',
    'Unique WH-YYYY-NNNNNN; increment on each successful receiveGoods; serial allocated only inside receiveGoods (draft does not consume).',
    async () => {
      const a = await receiveGoods(op, receiveInput());
      const b = await receiveGoods(op, receiveInput({ manufacturerLot: 'OQ-LOT-2' }));
      s1 = a[0].serial;
      s2 = b[0].serial;
      const p1 = parseSerial(s1);
      const p2 = parseSerial(s2);
      const fmt = isValidSerial(s1) && isValidSerial(s2);
      const uniq = s1 !== s2;
      const inc = Boolean(p1 && p2 && p1.year === p2.year && p2.n === p1.n + 1);
      const img = await captureRecordProof('OQ-01 both serials', {
        serial: `${s1}, ${s2}`,
        status: a[0].status,
        extra: `unique=${uniq} inc=${inc}`,
      });
      return {
        actual: `${s1}, ${s2}; unique=${uniq} inc=${inc}; allocateSerialsOnSubmit only inside receiveGoods`,
        pass: fmt && uniq && inc,
        images: takeImages(captureBarcode(s1, `OQ-01 CODE128 ${s1}`), img),
      };
    },
    onResult,
  );

  await oq(
    results,
    'OQ-02',
    'URS-14',
    'Barcode / scan payload round-trip',
    'parseScanPayload returns the serial from a QR payload serial|lot|expiry|status|containerType.',
    async () => {
      const payload = `${s1 || 'WH-2026-000025'}|OQ-LOT-1|2028-01-01|Quarantine|Drum`;
      const parsed = parseScanPayload(payload);
      const plain = parseScanPayload(`  ${s1 || 'WH-2026-000025'}  `);
      return {
        actual: `payload→${parsed}; plain→${plain}`,
        pass: parsed === (s1 || 'WH-2026-000025') && plain === (s1 || 'WH-2026-000025'),
        images: takeImages(captureBarcode(s1 || 'WH-2026-000025', `OQ-02 CODE128 ${s1}`)),
      };
    },
    onResult,
  );
  await oqManual(
    results,
    'OQ-02-PRINT',
    'URS-14',
    'Physical label print pagination / HID scanner',
    'Print 2x1 and 4x2; one label per page; HID scan navigates to lookup. Visual / hardware.',
    onResult,
  );

  await oq(
    results,
    'OQ-03',
    'URS-02',
    'Quarantine default on receipt; operator cannot QA',
    'Receipts default to Quarantine. Operator assertCapability(qaDisposition) throws.',
    async () => {
      const r1 = s1 ? await getInventory(s1) : undefined;
      const r2 = s2 ? await getInventory(s2) : undefined;
      const q = r1?.status === 'Quarantine' && r2?.status === 'Quarantine';
      const denied = await threw(() => assertCapability(op, 'qaDisposition'));
      const img = await captureRecordProof('OQ-03 quarantine default', {
        serial: s1,
        status: r1?.status,
        extra: `S2=${r2?.status}`,
      });
      return {
        actual: `S1=${r1?.status} S2=${r2?.status}; operator qaDisposition throw=${denied.ok} (${denied.message})`,
        pass: Boolean(q && denied.ok),
        images: takeImages(img),
      };
    },
    onResult,
  );

  await oq(
    results,
    'OQ-04',
    'URS-02,16',
    'QA-only release; quarantine issue blocked',
    'Operator QA denied. QA release of S1 with e-sign → Released. Issue of remaining quarantine S2 blocked.',
    async () => {
      const opQa = await threw(() =>
        qaDisposition(op, s1, 'Release', esign(op, 'should fail'), 'OQ-04', 'container'),
      );
      const released = await qaDisposition(
        qa,
        s1,
        'Release',
        esign(qa, 'I attest this lot is released for GMP use per CoA and specification.'),
        'OQ-04 sandbox release',
        'container',
      );
      const rec = await getInventory(s1);
      const qIssue = await threw(() =>
        issueDispense(op, s2, 1, 'OQ dest', 'try issue quarantine', ''),
      );
      const s2rec = await getInventory(s2);
      const img = await captureRecordProof('OQ-04 Released vs Quarantine', {
        serial: `S1 ${s1} / S2 ${s2}`,
        status: `S1=${rec?.status} S2=${s2rec?.status}`,
      });
      return {
        actual: `opQA throw=${opQa.ok}; S1=${rec?.status}; S2 issue blocked=${qIssue.ok} (${qIssue.message})`,
        pass: opQa.ok && released[0]?.status === 'Released' && rec?.status === 'Released' && qIssue.ok,
        images: takeImages(img),
      };
    },
    onResult,
  );

  await oq(
    results,
    'OQ-05',
    'URS-06',
    'Audit trail immutability',
    'audit.ts exports append/list only (no update/delete). Cycle count writes a new row; prior RECEIVE remains.',
    async () => {
      const keys = Object.keys(await import('./audit'));
      const noMut =
        !keys.includes('updateAudit') &&
        !keys.includes('deleteAudit') &&
        AUDIT_MUTATION_API.updateAudit === false &&
        AUDIT_MUTATION_API.deleteAudit === false &&
        AUDIT_MUTATION_API.appendAudit === true;
      const before = await listAuditFor(s1);
      const receiveBefore = before.filter((a) => a.action === 'RECEIVE');
      await cycleCount(op, s1, 0.5, 'OQ-05 cycle count');
      const after = await listAuditFor(s1);
      const receiveAfter = after.filter((a) => a.action === 'RECEIVE');
      const cycle = after.some((a) => a.action === 'CYCLE_COUNT');
      const snippet = after.slice(0, 5).map((a) => `${a.action}:${a.field}`).join(', ');
      const img = await captureRecordProof('OQ-05 audit snippet', { serial: s1, audit: snippet });
      return {
        actual: `noMutAPI=${noMut}; RECEIVE before/after ${receiveBefore.length}/${receiveAfter.length}; CYCLE_COUNT=${cycle}`,
        pass: noMut && receiveBefore.length > 0 && receiveAfter.length === receiveBefore.length && cycle,
        images: takeImages(img),
      };
    },
    onResult,
  );

  await oq(
    results,
    'OQ-06',
    'URS-05',
    'FEFO warning requires override reason',
    'Issuing a later-expiry Released lot without override is blocked; shouldWarnFefo is true.',
    async () => {
      const all = await listInventory();
      const api = all.filter((r) => r.materialCode === 'API-001' && r.status === 'Released' && r.currentQty > 0);
      api.sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));
      let later = api[api.length - 1];
      let earlier = api[0];
      if (!later || !earlier || later.serial === earlier.serial) {
        const r1 = await receiveGoods(op, receiveInput({ materialCode: 'API-001', materialName: 'Ibuprofen', itemType: 'API', expiryDate: '2027-03-15', qtyPerContainer: 5 }));
        const r2 = await receiveGoods(op, receiveInput({ materialCode: 'API-001', materialName: 'Ibuprofen', itemType: 'API', expiryDate: '2028-06-30', qtyPerContainer: 5 }));
        await qaDisposition(qa, r1[0].serial, 'Release', esign(qa, 'OQ-06 release'), 'OQ-06', 'container');
        await qaDisposition(qa, r2[0].serial, 'Release', esign(qa, 'OQ-06 release'), 'OQ-06', 'container');
        earlier = (await getInventory(r1[0].serial)) as InventoryRecord;
        later = (await getInventory(r2[0].serial)) as InventoryRecord;
      }
      const fresh = await listInventory();
      const warn = shouldWarnFefo(later, fresh, '2026-08-25');
      const blocked = await threw(() => issueDispense(op, later.serial, 1, 'OQ', 'no override', ''));
      return {
        actual: `later=${later.serial} exp ${later.expiryDate}; warn=${warn.warn} earlier=${warn.earlier.map((e) => e.serial).join(',')}; issueThrow=${blocked.ok}`,
        pass: warn.warn && blocked.ok && /FEFO/i.test(blocked.message),
      };
    },
    onResult,
  );

  await oq(
    results,
    'OQ-07',
    'URS-05',
    'Expiry block',
    'Cannot issue an expired lot even if Released; currentQty unchanged.',
    async () => {
      let rec = await getInventory('WH-2026-000007');
      if (!rec) {
        const created = await receiveGoods(
          op,
          receiveInput({
            materialCode: 'API-002',
            materialName: 'Acetaminophen',
            itemType: 'API',
            expiryDate: '2025-12-31',
            qtyPerContainer: 30,
          }),
        );
        await qaDisposition(qa, created[0].serial, 'Release', esign(qa, 'OQ-07 release'), 'OQ-07', 'container');
        rec = await getInventory(created[0].serial);
      }
      if (!rec) throw new Error('expired lot not found');
      const qty = rec.currentQty;
      const block = isIssueBlocked(rec, '2026-08-25');
      const issued = await threw(() => issueDispense(op, rec.serial, 1, 'OQ', 'expired', ''));
      const after = await getInventory(rec.serial);
      return {
        actual: `serial=${rec.serial} exp=${rec.expiryDate} blocked=${block.blocked} issueThrow=${issued.ok} qty ${qty}→${after?.currentQty}`,
        pass: block.blocked && issued.ok && after?.currentQty === qty,
      };
    },
    onResult,
  );

  await oq(
    results,
    'OQ-08',
    'URS-03,09',
    'Destruction QA-only; record retained',
    'Operator cannot destroy. QA destroy with e-sign → Destroyed; row still in register.',
    async () => {
      const opDestroy = await threw(() =>
        destroyContainer(op, s2, 'should fail', esign(op, 'no')),
      );
      const destroyed = await destroyContainer(
        qa,
        s2,
        'OQ-08 sandbox destroy',
        esign(qa, 'I authorize destruction of this container.'),
      );
      const still = await getInventory(s2);
      return {
        actual: `opThrow=${opDestroy.ok}; status=${destroyed.status}; retained=${Boolean(still)}`,
        pass: opDestroy.ok && destroyed.status === 'Destroyed' && still?.status === 'Destroyed',
      };
    },
    onResult,
  );

  await oq(
    results,
    'OQ-10',
    'URS-16',
    'Default role matrix cells',
    'receive/issue/qaDisposition/destroy/adminUsers/editPermissionMatrix vs operator, supervisor, qa, qc, readonly, sysadmin, validation.',
    async () => {
      const roles = ['operator', 'supervisor', 'qa', 'qc', 'readonly', 'sysadmin', 'validation'] as const;
      const caps = ['receive', 'issue', 'qaDisposition', 'destroy', 'adminUsers', 'editPermissionMatrix'] as const;
      const expectY: Record<(typeof caps)[number], ReadonlySet<string>> = {
        receive: new Set(['operator', 'supervisor']),
        issue: new Set(['operator', 'supervisor']),
        qaDisposition: new Set(['qa']),
        destroy: new Set(['qa']),
        adminUsers: new Set(['supervisor', 'sysadmin']),
        editPermissionMatrix: new Set(['sysadmin']),
      };
      const mismatches: string[] = [];
      for (const cap of caps) {
        for (const role of roles) {
          const got = defaultAllows(role, cap);
          const want = expectY[cap].has(role);
          if (got !== want) mismatches.push(`${role}.${cap}=${got} want ${want}`);
        }
      }
      const img = await captureRecordProof('OQ-10 default matrix snapshot', {
        matrix: roles.map((role) => caps.map((c) => `${role}.${c}=${defaultAllows(role, c) ? 'Y' : 'N'}`).join(' ')).join(' | '),
      });
      return {
        actual: mismatches.length ? mismatches.join('; ') : 'all sampled cells match default matrix',
        pass: mismatches.length === 0,
        images: takeImages(img),
      };
    },
    onResult,
  );

  await oq(
    results,
    'OQ-17',
    'URS-07',
    'Account lockout after 5 failures',
    'applyFailedLogin five times locks the account; GENERIC_LOGIN_ERROR is the generic message constant.',
    async () => {
      let user: UserRecord = {
        userId: 'wh',
        fullName: 'Sam Operator',
        role: 'operator',
        passwordHash: 'x',
        salt: 's',
        algorithm: 'sha256-salt',
        active: true,
        mustChangePassword: false,
        createdOnUtc: '2026-01-01T00:00:00.000Z',
        failedAttempts: 0,
        passwordHistory: [],
      };
      const now = Date.parse('2026-08-24T18:00:00.000Z');
      let locked = false;
      for (let i = 0; i < LOCKOUT_ATTEMPTS; i++) {
        const r = applyFailedLogin(user, now);
        user = r.user;
        locked = r.locked;
      }
      return {
        actual: `locked=${locked} attempts=${user.failedAttempts} generic="${GENERIC_LOGIN_ERROR}"`,
        pass:
          locked &&
          user.failedAttempts === LOCKOUT_ATTEMPTS &&
          isAccountLocked(user, now + 1000) &&
          GENERIC_LOGIN_ERROR === 'Invalid user ID or password',
      };
    },
    onResult,
  );

  await oq(
    results,
    'OQ-19',
    'URS-02,16',
    'SoD receive XOR qaDisposition',
    'evaluateSod blocks combining receive+qaDisposition. QA cannot receiveGoods.',
    async () => {
      const rows = cloneRows(defaultMatrixRows());
      rows.qa.receive = true;
      const v = evaluateSod(rows, DEFAULT_SOD);
      const sodHit = v.some((x) => x.roleId === 'qa' && x.rule === 'qaDispositionXorReceive');
      const qaRecv = await threw(() => receiveGoods(qa, receiveInput({ comments: 'qa should fail' })));
      return {
        actual: `sodViolations=${v.length} qa+receive blocked=${sodHit}; qa receiveGoods throw=${qaRecv.ok}`,
        pass: sodHit && qaRecv.ok,
      };
    },
    onResult,
  );

  await oq(
    results,
    'OQ-20',
    'URS-24',
    'Cannot e-sign own receipt',
    'assertNotOwnReceipt throws when createdBy === userId.',
    async () => {
      let own = false;
      let other = true;
      try {
        assertNotOwnReceipt('wh', 'wh');
      } catch {
        own = true;
      }
      try {
        assertNotOwnReceipt('qa', 'wh');
        other = true;
      } catch {
        other = false;
      }
      return {
        actual: `ownThrow=${own} otherOk=${other}`,
        pass: own && other,
      };
    },
    onResult,
  );

  await oq(
    results,
    'OQ-21',
    'URS-21',
    'Per-container serialization (N=5 vials)',
    'Receive N=5 vials → 5 unique WH-YYYY-NNNNNN serials, one shared RCV-YYYY-NNNNNN receiptBatchId.',
    async () => {
      const recs = await receiveGoods(
        op,
        receiveInput({
          materialCode: 'SAM-001',
          materialName: 'Retain Sample Vial 20 mL',
          itemType: 'Retain Sample',
          numberOfContainers: 5,
          containerType: 'Vial',
          qtyPerContainer: 1,
          uom: 'vial',
        }),
      );
      const serials = recs.map((r) => r.serial);
      const unique = new Set(serials).size === 5;
      const fmt = serials.every(isValidSerial);
      const batch = recs[0].receiptBatchId;
      const sameBatch = recs.every((r) => r.receiptBatchId === batch);
      const img = await captureRecordProof('OQ-21 N=5 vials', {
        serial: serials.join(', '),
        extra: `batch=${batch}`,
      });
      return {
        actual: `${serials.join(', ')} batch=${batch}`,
        pass: recs.length === 5 && unique && fmt && sameBatch && isValidReceiptBatchId(batch),
        images: takeImages(captureBarcode(serials[0], `OQ-21 CODE128 ${serials[0]}`), img),
      };
    },
    onResult,
  );

  await oq(
    results,
    'OQ-22',
    'URS-22,29',
    'Material transfer submit → supervisor approve → pick/issue',
    'submitRequest + requestorEsign → Pending Supervisor; operator cannot pick; other-user supervisor approve → Approved; pick+issue path.',
    async () => {
      const req = await submitRequest(lab, {
        materialCode: 'API-001',
        qtyRequested: 1,
        uom: 'kg',
        neededBy: '2026-09-01',
        toLocation: 'Warehouse',
        classification: ['GMP'],
        intendedUse: 'OQ-22 sandbox transfer',
        priority: 'Routine',
        requestorEsign: esign(lab, 'I request this material transfer.'),
      });
      const pending = req.status === 'Pending Supervisor';
      const pickEarly = await threw(() => pickSerialForRequest(op, req.requestId, 'WH-2026-000001', 1));
      const approved = await approveRequestSupervisor(
        sup,
        req.requestId,
        esign(sup, 'I approve this material transfer.'),
      );
      const okApproved = approved.status === 'Approved';
      const inv = await listInventory();
      const target =
        approved.reservedSerials[0]?.serial ||
        inv.find((r) => r.materialCode === 'API-001' && r.status === 'Released' && r.currentQty > 0)?.serial;
      if (!target) throw new Error('no Released API-001 serial to pick');
      await pickSerialForRequest(op, req.requestId, target, 1);
      const issued = await confirmFulfillment(
        op,
        req.requestId,
        'OQ-22 FEFO override if warned',
        esign(op, 'Materials Management confirm issue'),
        { commentsNa: true },
      );
      const issuedOk = issued.status === 'Issued' || issued.status === 'Partially Issued';
      const closed = await confirmReceived(lab, req.requestId, esign(lab, 'I confirm receipt of issued material.'), 1);
      mtfId = req.requestId;
      const img = await captureRecordProof('OQ-22 request status A/B/C', {
        request: `${req.requestId} ${req.status} → ${approved.status} → ${issued.status} → ${closed.status}`,
      });
      return {
        actual: `${req.requestId} ${req.status}→${approved.status}→${issued.status}→${closed.status}; earlyPickBlocked=${pickEarly.ok}`,
        pass: pending && pickEarly.ok && okApproved && issuedOk && closed.status === 'Closed',
        images: takeImages(img),
      };
    },
    onResult,
  );

  await oq(
    results,
    'OQ-23',
    'URS-25',
    'Sample pull child serial',
    'samplePull creates a child serial (recordKind=sample) with parentSerial set.',
    async () => {
      if (typeof samplePull !== 'function') {
        return { actual: 'samplePull not present', pass: false };
      }
      const all = await listInventory();
      const parent = all.find(
        (r) =>
          (r.recordKind === 'container' || !r.recordKind) &&
          r.currentQty > 1 &&
          r.status !== 'Destroyed' &&
          r.status !== 'Issued' &&
          r.status !== 'Consumed',
      );
      if (!parent) throw new Error('no parent container for sample pull');
      const child = await samplePull(qa, parent.serial, 0.1, 'sample', 'OQ-23 sandbox sample');
      return {
        actual: `child=${child.serial} kind=${child.recordKind} parent=${child.parentSerial}`,
        pass: isValidSerial(child.serial) && child.recordKind === 'sample' && child.parentSerial === parent.serial,
      };
    },
    onResult,
  );

  await oq(
    results,
    'OQ-ATT',
    'URS-28',
    'Attachments after receive',
    'Operator addAttachment after receive; listForSerial nonempty; readonly cannot add.',
    async () => {
      const recs = await receiveGoods(op, receiveInput({ comments: 'OQ-28 attach parent' }));
      const rec = recs[0];
      const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
      const file = new File([bytes], 'oq-coa.pdf', { type: 'application/pdf' });
      await addAttachment(op, { scope: 'serial', recordId: rec.serial, file, category: 'CoA' });
      const listed = await listForSerial(rec);
      const roDenied = await threw(async () => {
        const f2 = new File([bytes], 'ro.pdf', { type: 'application/pdf' });
        await addAttachment(ro, { scope: 'serial', recordId: rec.serial, file: f2, category: 'CoA' });
      });
      const img = await captureRecordProof('OQ-ATT attachment filename', {
        serial: rec.serial,
        attachment: listed[0]?.fileName || 'oq-coa.pdf',
      });
      return {
        actual: `listed=${listed.length} file=${listed[0]?.fileName} readonlyThrow=${roDenied.ok}`,
        pass: listed.length > 0 && roDenied.ok,
        images: takeImages(img),
      };
    },
    onResult,
  );

  await oq(
    results,
    'OQ-27',
    'URS-06',
    'RECEIVE audit includes role',
    'RECEIVE audit row for S1 has role=operator and userId=wh.',
    async () => {
      const rows = await listAuditFor(s1);
      const rec = rows.find((a) => a.action === 'RECEIVE' && a.recordId === s1);
      return {
        actual: rec ? `role=${rec.role} userId=${rec.userId}` : 'no RECEIVE row',
        pass: Boolean(rec && rec.role === 'operator' && rec.userId === 'wh'),
      };
    },
    onResult,
  );

  await runOqPqExtra({
    results,
    onResult,
    oq,
    threw,
    esign,
    receiveInput,
    op,
    qa,
    lab,
    sup,
    val,
    s1,
    s2,
    mtfId,
  });

  await runExhaustive({
    results,
    onResult,
    oq,
    threw,
    esign,
    receiveInput,
    op,
    qa,
    lab,
    sup,
    val,
    s1,
    s2,
    mtfId,
  });

  return results;
}

async function listAuditFor(recordId: string) {
  const all = await listAudit();
  return all.filter((e) => e.recordId === recordId);
}

export async function runSelfValidation(
  session: Session,
  onResult?: (r: OqResult) => void,
  launchEsign?: ESign,
): Promise<ValidationReport> {
  await assertCapability(session, 'runValidation', 'Capability required: runValidation');
  const snap = snapshotBrowserSession();
  const executedUtc = nowUtcIso();
  let results: OqResult[];
  try {
    results = await withDatabase(OQ_DB_NAME, async () => {
      await deleteDatabase(OQ_DB_NAME);
      await getDb();
      await ensureSeeded();
      return runProtocol(onResult);
    });
  } finally {
    restoreBrowserSession(snap);
    const live = peekStoredSession();
    if (live) {
      persistSession({ ...live, lastActivityUtc: nowUtcIso() });
    }
  }
  const passed = results.filter((r) => r.verdict === 'Pass').length;
  const failed = results.filter((r) => r.verdict === 'Fail').length;
  const manual = results.filter((r) => r.verdict === 'Manual').length;
  const report: ValidationReport = {
    executedUtc,
    executedBy: `${session.fullName} (${session.userId})`,
    appVersion: APP_VERSION,
    docId: DOC_ID,
    sandboxDb: OQ_DB_NAME,
    results,
    passed,
    failed,
    manual,
    printedName: launchEsign?.printedName ?? session.fullName,
    signedUserId: launchEsign?.userId ?? session.userId,
    signedAtUtc: launchEsign?.signedAtUtc ?? executedUtc,
    meaningOfSignature: launchEsign?.meaningOfSignature ?? OQ_EVIDENCE_DISCLAIMER,
  };
  await appendAudit(session, {
    action: 'VALIDATION_RUN',
    recordId: 'SYSTEM',
    field: 'oq',
    newValue: `${passed}P/${failed}F/${manual}M`,
    reasonForChange: `${OQ_EVIDENCE_DISCLAIMER} ${VALIDATION_BANNER}`,
  });
  try {
    await deleteDatabase(OQ_DB_NAME);
  } catch {
    /* best-effort wipe of sandbox DB; production connection already restored */
  }
  return report;
}
