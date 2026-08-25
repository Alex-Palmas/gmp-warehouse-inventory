import { beforeEach, describe, expect, it } from 'vitest';
import type { ESign, InventoryRecord, Material, Session } from '../types';
import { resetDbConnection, getDb } from '../lib/db';
import { buildDefaultMatrixDocument, setMatrixCacheForTests } from '../lib/permissions';
import { receiveGoods, qaDisposition, samplePull, listInventory, getInventory, listMovements } from '../lib/inventory';
import { submitRequest, pickSerialForRequest, confirmFulfillment, approveRequestSupervisor } from '../lib/requests';
import { proposeFefo } from '../lib/fefo';
import { locationCode, parseLocationCode } from '../lib/locations';
import { listAudit } from '../lib/audit';
import { emptyLocation } from '../components/fields';

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

function reqEsign(session: Session, meaning = 'I request this material transfer.'): ESign {
  return {
    userId: session.userId,
    printedName: session.fullName,
    signedAtUtc: '2026-08-24T12:00:00.000Z',
    meaningOfSignature: meaning,
  };
}

const transferBase = {
  materialCode: 'API-001' as const,
  qtyRequested: 1,
  uom: 'vial' as const,
  neededBy: '2026-09-01',
  toLocation: 'LVM' as const,
  classification: ['GMP'] as ('GMP' | 'High Quality')[],
  intendedUse: 'batch A',
  priority: 'Routine' as const,
};

async function resetTestDb(): Promise<void> {
  await resetDbConnection();
  setMatrixCacheForTests(null);
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase('gmp-wh-inv');
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
  setMatrixCacheForTests(buildDefaultMatrixDocument());
  await getDb();
}

function receiveInput(over: Partial<{ materialCode: string; numberOfContainers: number; qtyPerContainer: number; expiryDate: string; containerType: InventoryRecord['containerType']; uom: InventoryRecord['uom'] }> = {}) {
  return {
    materialCode: over.materialCode ?? 'API-001',
    materialName: 'Ibuprofen',
    itemType: 'API' as const,
    gradeSpec: 'USP',
    pharmacopeia: 'USP' as const,
    manufacturer: 'Demo',
    manufacturerLot: 'L1',
    supplier: 'Sup',
    supplierLot: 'S1',
    poDeliveryNote: 'PO-1',
    coaNumber: 'COA-1',
    internalLot: 'IL-1',
    numberOfContainers: over.numberOfContainers ?? 1,
    containerType: over.containerType ?? 'Vial',
    qtyPerContainer: over.qtyPerContainer ?? 1,
    uom: over.uom ?? 'vial',
    dateOfManufacture: '2026-01-01',
    receiptDate: '2026-08-01',
    expiryDate: over.expiryDate ?? '2028-01-01',
    retestDate: '',
    location: emptyLocation(),
    storageCondition: 'CRT 15–25 °C' as const,
    samplingRequired: false,
    linkedSampleIds: '',
    comments: 'test',
  };
}

async function putMaterial(code = 'API-001', name = 'Ibuprofen'): Promise<void> {
  const db = await getDb();
  const rec: Material = {
    materialCode: code,
    materialName: name,
    itemType: 'API',
    gradeSpec: 'USP',
    pharmacopeia: 'USP',
    defaultUom: 'vial',
    defaultStorage: 'CRT 15–25 °C',
    samplingRequiredDefault: false,
    active: true,
    createdBy: 'admin',
    createdOnUtc: '2026-01-01T00:00:00.000Z',
    modifiedBy: 'admin',
    modifiedOnUtc: '2026-01-01T00:00:00.000Z',
  };
  await db.put('materials', rec);
}

const esign = {
  userId: 'qa',
  printedName: 'Jordan QA',
  signedAtUtc: '2026-08-24T00:00:00.000Z',
  meaningOfSignature: 'I attest this receipt batch meets specification and is Released for GMP use.',
};

describe('per-container serialization', () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  it('5 vials → 5 unique serials same receiptBatchId', async () => {
    const recs = await receiveGoods(sess('operator', 'wh'), receiveInput({ numberOfContainers: 5, qtyPerContainer: 1, containerType: 'Vial' }));
    expect(recs).toHaveLength(5);
    const serials = new Set(recs.map((r) => r.serial));
    expect(serials.size).toBe(5);
    const batch = recs[0].receiptBatchId;
    expect(batch).toMatch(/^RCV-\d{4}-\d{6}$/);
    expect(recs.every((r) => r.receiptBatchId === batch)).toBe(true);
    expect(recs.every((r) => r.status === 'Quarantine')).toBe(true);
    expect(recs.map((r) => r.containerIndex).sort()).toEqual([1, 2, 3, 4, 5]);
    expect(recs.every((r) => r.recordKind === 'container')).toBe(true);
    expect(recs.every((r) => r.qtyPerContainer === 1 && r.currentQty === 1)).toBe(true);
  });

  it('lot-release updates siblings in the receipt batch', async () => {
    const recs = await receiveGoods(sess('operator', 'wh'), receiveInput({ numberOfContainers: 3 }));
    const updated = await qaDisposition(sess('qa'), recs[0].serial, 'Release', esign, 'CoA review', 'batch');
    expect(updated).toHaveLength(3);
    expect(updated.every((r) => r.status === 'Released')).toBe(true);
    const all = await listInventory();
    const sibs = all.filter((r) => r.receiptBatchId === recs[0].receiptBatchId);
    expect(sibs.every((r) => r.status === 'Released')).toBe(true);
  });

  it('sample child links parent and decrements parent qty', async () => {
    const [parent] = await receiveGoods(
      sess('operator', 'wh'),
      receiveInput({ numberOfContainers: 1, qtyPerContainer: 25, containerType: 'Drum', uom: 'kg' }),
    );
    await qaDisposition(sess('qa'), parent.serial, 'Release', esign, 'ok', 'container');
    const child = await samplePull(sess('qa'), parent.serial, 0.5, 'sample', 'QC sample');
    expect(child.recordKind).toBe('sample');
    expect(child.parentSerial).toBe(parent.serial);
    expect(child.currentQty).toBe(0.5);
    const after = await getInventory(parent.serial);
    expect(after?.currentQty).toBe(24.5);
    expect(after?.linkedSampleIds).toContain(child.serial);
  });
});

describe('material request pick/issue', () => {
  beforeEach(async () => {
    await resetTestDb();
    await putMaterial();
  });

  it('cannot pick quarantine for request', async () => {
    const [q] = await receiveGoods(sess('operator', 'wh'), receiveInput({ numberOfContainers: 1 }));
    const lab = sess('requester', 'lab');
    const req = await submitRequest(lab, { ...transferBase, requestorEsign: reqEsign(lab) });
    const sup = sess('supervisor', 'admin');
    await approveRequestSupervisor(sup, req.requestId, reqEsign(sup, 'I approve this material transfer.'));
    await expect(pickSerialForRequest(sess('operator', 'wh'), req.requestId, q.serial, 1)).rejects.toThrow(/Quarantine/);
  });

  it('FEFO proposes earliest expiry', async () => {
    const late = await receiveGoods(
      sess('operator', 'wh'),
      receiveInput({ numberOfContainers: 1, expiryDate: '2029-01-01' }),
    );
    const early = await receiveGoods(
      sess('operator', 'wh'),
      receiveInput({ numberOfContainers: 1, expiryDate: '2027-06-01' }),
    );
    await qaDisposition(sess('qa'), late[0].serial, 'Release', esign, 'ok', 'container');
    await qaDisposition(sess('qa'), early[0].serial, 'Release', esign, 'ok', 'container');
    const all = await listInventory();
    const proposed = proposeFefo(all, 'API-001', 1, '2026-08-24');
    expect(proposed[0].serial).toBe(early[0].serial);
  });

  it('request issue writes audit+movement with requestId', async () => {
    const recs = await receiveGoods(sess('operator', 'wh'), receiveInput({ numberOfContainers: 1 }));
    await qaDisposition(sess('qa'), recs[0].serial, 'Release', esign, 'ok', 'batch');
    const lab = sess('requester', 'lab');
    const req = await submitRequest(lab, {
      ...transferBase,
      toLocation: 'SVM',
      intendedUse: 'PPQ-1',
      priority: 'Urgent',
      requestorEsign: reqEsign(lab),
    });
    const sup = sess('supervisor', 'admin');
    const approved = await approveRequestSupervisor(sup, req.requestId, reqEsign(sup, 'I approve this material transfer.'));
    expect(approved.reservedSerials.length).toBeGreaterThan(0);
    await pickSerialForRequest(sess('operator', 'wh'), req.requestId, recs[0].serial, 1);
    const wh = sess('operator', 'wh');
    const done = await confirmFulfillment(wh, req.requestId, '', reqEsign(wh, 'I confirm the quantity issued for this material transfer.'), {
      commentsNa: true,
    });
    expect(done.status).toBe('Issued');
    const mov = await listMovements();
    expect(mov.some((m) => m.requestId === req.requestId && m.action === 'ISSUE')).toBe(true);
    const aud = await listAudit();
    expect(
      aud.some(
        (a) =>
          a.action === 'REQUEST_ISSUE' &&
          (a.recordId === recs[0].serial || a.recordId === req.requestId || a.reasonForChange.includes(req.requestId)),
      ),
    ).toBe(true);
  });

  it('FEFO auto-reserve: two requests cannot claim the same serial', async () => {
    const recs = await receiveGoods(sess('operator', 'wh'), receiveInput({ numberOfContainers: 2 }));
    await qaDisposition(sess('qa'), recs[0].serial, 'Release', esign, 'ok', 'batch');
    const lab = sess('requester', 'lab');
    const a0 = await submitRequest(lab, { ...transferBase, intendedUse: 'A', requestorEsign: reqEsign(lab) });
    const b0 = await submitRequest(lab, { ...transferBase, intendedUse: 'B', requestorEsign: reqEsign(lab) });
    const sup = sess('supervisor', 'admin');
    const a = await approveRequestSupervisor(sup, a0.requestId, reqEsign(sup, 'I approve this material transfer.'));
    const b = await approveRequestSupervisor(sup, b0.requestId, reqEsign(sup, 'I approve this material transfer.'));
    expect(a.reservedSerials[0].serial).not.toBe(b.reservedSerials[0].serial);
    const taken = a.reservedSerials[0].serial;
    await expect(pickSerialForRequest(sess('operator', 'wh'), b.requestId, taken, 1)).rejects.toThrow(/reserved/);
  });
});

describe('location barcodes', () => {
  it('formats and parses LOC-SITE-BLDG-ROOM-RACK-SHELF-BIN', () => {
    const loc = { site: 'MAIN', building: 'WH-1', room: 'RM-W01', rack: 'RQ', shelf: 'S1', bin: 'Q1' };
    const code = locationCode(loc);
    expect(code).toBe('LOC-MAIN-WH1-RMW01-RQ-S1-Q1');
    const parsed = parseLocationCode(code);
    expect(parsed?.site).toBe('MAIN');
    expect(parsed?.bin).toBe('Q1');
  });
});
