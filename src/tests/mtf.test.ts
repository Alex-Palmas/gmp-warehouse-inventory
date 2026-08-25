import { beforeEach, describe, expect, it } from 'vitest';
import type { ESign, InventoryRecord, Material, Session } from '../types';
import { resetDbConnection, getDb } from '../lib/db';
import { buildDefaultMatrixDocument, defaultAllows, setMatrixCacheForTests } from '../lib/permissions';
import { emptyLocation } from '../components/fields';
import { getInventory, qaDisposition, receiveGoods } from '../lib/inventory';
import {
  approveRequestQa,
  approveRequestSupervisor,
  confirmFulfillment,
  confirmReceived,
  pickSerialForRequest,
  submitRequest,
} from '../lib/requests';
import { isIssueBlocked } from '../lib/fefo';

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
    signedAtUtc: '2026-08-24T12:00:00.000Z',
    meaningOfSignature: meaning,
  };
}

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

function receiveInput(
  over: Partial<{
    materialCode: string;
    numberOfContainers: number;
    qtyPerContainer: number;
    expiryDate: string;
    containerType: InventoryRecord['containerType'];
    uom: InventoryRecord['uom'];
  }> = {},
) {
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
    comments: 'mtf test',
  };
}

const qaLotEsign: ESign = {
  userId: 'qa',
  printedName: 'qa',
  signedAtUtc: '2026-08-24T00:00:00.000Z',
  meaningOfSignature: 'I attest this receipt batch meets specification and is Released for GMP use.',
};

async function submitTransfer(
  requester: Session,
  extra: Partial<Parameters<typeof submitRequest>[1]> = {},
) {
  return submitRequest(requester, {
    materialCode: 'API-001',
    qtyRequested: 1,
    uom: 'vial',
    neededBy: '2026-09-01',
    toLocation: 'LVM',
    classification: ['GMP'],
    intendedUse: 'SOP-001 / MBR lot A',
    priority: 'Routine',
    requestorEsign: esign(requester, 'I request this material transfer.'),
    ...extra,
  });
}

describe('material transfer workflow', () => {
  beforeEach(async () => {
    await resetTestDb();
    await putMaterial();
  });

  it('default matrix: supervisor (not operator) has approveRequest', () => {
    expect(defaultAllows('supervisor', 'approveRequest')).toBe(true);
    expect(defaultAllows('super', 'approveRequest')).toBe(true);
    expect(defaultAllows('operator', 'approveRequest')).toBe(false);
    expect(defaultAllows('requester', 'approveRequest')).toBe(false);
  });

  it('submit → Pending Supervisor; warehouse cannot pick yet; no reserve', async () => {
    const recs = await receiveGoods(sess('operator', 'wh'), receiveInput());
    await qaDisposition(sess('qa'), recs[0].serial, 'Release', qaLotEsign, 'ok', 'batch');
    const lab = sess('requester', 'lab');
    const req = await submitTransfer(lab);
    expect(req.status).toBe('Pending Supervisor');
    expect(req.reservedSerials).toEqual([]);
    expect(req.toLocation).toBe('LVM');
    expect(req.classification).toContain('GMP');
    expect(req.intendedUse).toBe('SOP-001 / MBR lot A');
    expect(req.requestorEsign?.userId).toBe('lab');
    await expect(pickSerialForRequest(sess('operator', 'wh'), req.requestId, recs[0].serial, 1)).rejects.toThrow(
      /Pending Supervisor/,
    );
    const after = await getInventory(recs[0].serial);
    expect(after?.reservedForRequestId).toBeFalsy();
  });

  it('supervisor approve (different user) → Approved and reserve happens', async () => {
    const recs = await receiveGoods(sess('operator', 'wh'), receiveInput({ numberOfContainers: 1 }));
    await qaDisposition(sess('qa'), recs[0].serial, 'Release', qaLotEsign, 'ok', 'batch');
    const lab = sess('requester', 'lab');
    const req = await submitTransfer(lab);
    const sup = sess('supervisor', 'admin');
    const approved = await approveRequestSupervisor(sup, req.requestId, esign(sup, 'I approve this material transfer.'));
    expect(approved.status).toBe('Approved');
    expect(approved.supervisorEsign?.userId).toBe('admin');
    expect(approved.reservedSerials.length).toBeGreaterThan(0);
    expect(approved.reservedSerials[0].serial).toBe(recs[0].serial);
    const inv = await getInventory(recs[0].serial);
    expect(inv?.reservedForRequestId).toBe(req.requestId);
  });

  it('cellBankOrQuarantine → Pending QA; QA approve → Approved', async () => {
    const recs = await receiveGoods(sess('operator', 'wh'), receiveInput());
    await qaDisposition(sess('qa'), recs[0].serial, 'Release', qaLotEsign, 'ok', 'batch');
    const lab = sess('requester', 'lab');
    const req = await submitTransfer(lab, { cellBankOrQuarantine: true });
    const sup = sess('supervisor', 'admin');
    const mid = await approveRequestSupervisor(sup, req.requestId, esign(sup, 'I approve this material transfer.'));
    expect(mid.status).toBe('Pending QA');
    expect(mid.reservedSerials).toEqual([]);
    const qa = sess('qa', 'qa');
    const approved = await approveRequestQa(qa, req.requestId, esign(qa, 'I approve this material transfer of cell bank or quarantined material.'));
    expect(approved.status).toBe('Approved');
    expect(approved.qaEsign?.userId).toBe('qa');
    expect(approved.reservedSerials.length).toBeGreaterThan(0);
  });

  it('requestor cannot supervisor-approve own transfer', async () => {
    const lab = sess('supervisor', 'lab-sup');
    const req = await submitTransfer(lab);
    await expect(
      approveRequestSupervisor(lab, req.requestId, esign(lab, 'I approve this material transfer.')),
    ).rejects.toThrow(/own transfer|Segregation/i);
  });

  it('quarantine serial pick allowed only after QA esign', async () => {
    const [q] = await receiveGoods(sess('operator', 'wh'), receiveInput());
    expect(q.status).toBe('Quarantine');
    const lab = sess('requester', 'lab');
    const req = await submitTransfer(lab, { cellBankOrQuarantine: true });
    await expect(pickSerialForRequest(sess('operator', 'wh'), req.requestId, q.serial, 1)).rejects.toThrow(
      /Pending Supervisor/,
    );
    const sup = sess('supervisor', 'admin');
    await approveRequestSupervisor(sup, req.requestId, esign(sup, 'I approve this material transfer.'));
    await expect(pickSerialForRequest(sess('operator', 'wh'), req.requestId, q.serial, 1)).rejects.toThrow(
      /Pending QA/,
    );
    const qa = sess('qa', 'qa');
    const approved = await approveRequestQa(
      qa,
      req.requestId,
      esign(qa, 'I approve this material transfer of cell bank or quarantined material.'),
    );
    expect(approved.status).toBe('Approved');
    const picked = await pickSerialForRequest(sess('operator', 'wh'), req.requestId, q.serial, 1);
    expect(picked.pickedSerials[0].serial).toBe(q.serial);
    expect(picked.status).toBe('Picking');
  });

  it('confirmReceived stores qtyReceived', async () => {
    const recs = await receiveGoods(sess('operator', 'wh'), receiveInput());
    await qaDisposition(sess('qa'), recs[0].serial, 'Release', qaLotEsign, 'ok', 'batch');
    const lab = sess('requester', 'lab');
    const req = await submitTransfer(lab);
    const sup = sess('supervisor', 'admin');
    await approveRequestSupervisor(sup, req.requestId, esign(sup, 'I approve this material transfer.'));
    await pickSerialForRequest(sess('operator', 'wh'), req.requestId, recs[0].serial, 1);
    const mm = sess('operator', 'wh');
    const issued = await confirmFulfillment(mm, req.requestId, '', esign(mm, 'I confirm the quantity issued for this material transfer.'), {
      commentsNa: true,
    });
    expect(issued.status).toBe('Issued');
    expect(issued.sourceLot).toBeTruthy();
    expect(issued.mmEsign?.userId).toBe('wh');
    const closed = await confirmReceived(lab, req.requestId, esign(lab, 'I confirm receipt of this material transfer.'), 1);
    expect(closed.status).toBe('Closed');
    expect(closed.qtyReceived).toBe(1);
    expect(closed.receiverEsign?.userId).toBe('lab');
  });

  it('isIssueBlocked still blocks quarantine without the flag', () => {
    const r = isIssueBlocked(
      { serial: 'WH-2026-000004', materialCode: 'RM-001', status: 'Quarantine', expiryDate: '2028-01-01', currentQty: 10 },
      '2026-08-24',
    );
    expect(r.blocked).toBe(true);
    expect(r.reason).toMatch(/Quarantine/);
    const allowed = isIssueBlocked(
      { serial: 'WH-2026-000004', materialCode: 'RM-001', status: 'Quarantine', expiryDate: '2028-01-01', currentQty: 10 },
      '2026-08-24',
      undefined,
      { allowQuarantine: true },
    );
    expect(allowed.blocked).toBe(false);
  });
});
