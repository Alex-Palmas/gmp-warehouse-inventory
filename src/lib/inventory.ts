/**
 * Single inventory mutation module. All forms MUST call these functions so
 * serial allocation and audit logging cannot be skipped.
 */
import type {
  ContainerType,
  ESign,
  InventoryRecord,
  ItemType,
  Location,
  Movement,
  Pharmacopeia,
  PickedLine,
  QaDisposition,
  RecordKind,
  SerialCounter,
  Session,
  StorageCondition,
  Uom,
} from '../types';
import { getDb } from './db';
import { appendAudit } from './audit';
import { nowUtcIso, locationToString, isExpired, todayIsoDateInTz } from './dates';
import { isIssueBlocked, shouldWarnFefo } from './fefo';
import { newId } from './ids';
import { formatReceiptBatchId, formatSerial } from './serial';
import {
  assertCapability,
  assertNotOwnReceipt,
  getLiveMatrix,
  hasCapability,
  qaStatusFromDisposition,
} from './permissions';

async function getCounter(key: string): Promise<SerialCounter> {
  const db = await getDb();
  const c = (await db.get('meta', key)) as SerialCounter | undefined;
  return c ?? { year: new Date().getUTCFullYear(), lastN: 0 };
}

async function putCounter(key: string, c: SerialCounter): Promise<void> {
  const db = await getDb();
  await db.put('meta', c, key);
}

/** Allocate serial only on successful receive (caller already validated input). */
export async function allocateSerialOnSubmit(): Promise<string> {
  const serials = await allocateSerialsOnSubmit(1);
  return serials[0];
}

export async function allocateSerialsOnSubmit(count: number): Promise<string[]> {
  if (!Number.isInteger(count) || count < 1) throw new Error('Container count must be a positive integer');
  if (count > 9999) throw new Error('Container count exceeds 9999 per receipt');
  const year = new Date().getUTCFullYear();
  const c = await getCounter('serialCounter');
  let n = c.year === year ? c.lastN : 0;
  const db = await getDb();
  const serials: string[] = [];
  for (let i = 0; i < count; i++) {
    n += 1;
    const serial = formatSerial(year, n);
    const existing = await db.get('inventory', serial);
    if (existing) throw new Error(`Serial ${serial} already exists — allocation aborted`);
    serials.push(serial);
  }
  await putCounter('serialCounter', { year, lastN: n });
  return serials;
}

export async function allocateReceiptBatchId(): Promise<string> {
  const year = new Date().getUTCFullYear();
  const c = await getCounter('receiptBatchCounter');
  const n = c.year === year ? c.lastN + 1 : 1;
  const id = formatReceiptBatchId(year, n);
  await putCounter('receiptBatchCounter', { year, lastN: n });
  return id;
}

export async function listInventory(): Promise<InventoryRecord[]> {
  const db = await getDb();
  const all = (await db.getAll('inventory')) as InventoryRecord[];
  all.sort((a, b) => b.createdOnUtc.localeCompare(a.createdOnUtc));
  return all;
}

export async function getInventory(serial: string): Promise<InventoryRecord | undefined> {
  const db = await getDb();
  return (await db.get('inventory', serial)) as InventoryRecord | undefined;
}

export async function listByReceiptBatch(receiptBatchId: string): Promise<InventoryRecord[]> {
  const all = await listInventory();
  return all
    .filter((r) => r.receiptBatchId === receiptBatchId)
    .sort((a, b) => a.containerIndex - b.containerIndex);
}

export async function listMovements(): Promise<Movement[]> {
  const db = await getDb();
  const all = (await db.getAll('movements')) as Movement[];
  all.sort((a, b) => b.performedOnUtc.localeCompare(a.performedOnUtc));
  return all;
}

async function putInventory(rec: InventoryRecord): Promise<void> {
  const db = await getDb();
  await db.put('inventory', rec);
}

async function addMovement(m: Movement): Promise<void> {
  const db = await getDb();
  await db.add('movements', m);
}

export async function reserveSerialsForRequest(
  session: Session,
  requestId: string,
  lines: PickedLine[],
): Promise<void> {
  for (const line of lines) {
    const rec = await getInventory(line.serial);
    if (!rec) throw new Error(`Serial ${line.serial} not found`);
    if (rec.reservedForRequestId && rec.reservedForRequestId !== requestId && (rec.reservedQty || 0) > 0) {
      throw new Error(`Serial ${line.serial} is reserved for ${rec.reservedForRequestId}`);
    }
    rec.reservedForRequestId = requestId;
    rec.reservedQty = line.qty;
    rec.modifiedBy = session.userId;
    rec.modifiedOnUtc = nowUtcIso();
    await putInventory(rec);
    await appendAudit(session, {
      action: 'REQUEST_RESERVE',
      recordId: rec.serial,
      field: 'reservedForRequestId',
      oldValue: '',
      newValue: `${requestId}:${line.qty}`,
      reasonForChange: `FEFO auto-reserve for ${requestId}`,
    });
  }
}

export async function clearReservationsForRequest(session: Session, requestId: string): Promise<number> {
  const all = await listInventory();
  let n = 0;
  for (const rec of all) {
    if (rec.reservedForRequestId !== requestId) continue;
    const old = rec.reservedForRequestId;
    rec.reservedForRequestId = undefined;
    rec.reservedQty = 0;
    rec.modifiedBy = session.userId;
    rec.modifiedOnUtc = nowUtcIso();
    await putInventory(rec);
    await appendAudit(session, {
      action: 'REQUEST_RESERVE',
      recordId: rec.serial,
      field: 'reservedForRequestId',
      oldValue: old,
      newValue: '',
      reasonForChange: `Clear reservation for ${requestId}`,
    });
    n++;
  }
  return n;
}

export function countReservedUnpicked(rows: InventoryRecord[]): number {
  return rows.filter((r) => r.reservedForRequestId && (r.reservedQty || 0) > 0).length;
}

export type ReceiveInput = {
  materialCode: string;
  materialName: string;
  itemType: ItemType;
  gradeSpec: string;
  pharmacopeia: Pharmacopeia;
  manufacturer: string;
  manufacturerLot: string;
  supplier: string;
  supplierLot: string;
  poDeliveryNote: string;
  coaNumber: string;
  internalLot: string;
  numberOfContainers: number;
  containerType: ContainerType;
  qtyPerContainer: number;
  uom: Uom;
  dateOfManufacture: string;
  receiptDate: string;
  expiryDate: string;
  retestDate: string;
  location: Location;
  storageCondition: StorageCondition;
  samplingRequired: boolean;
  linkedSampleIds: string;
  comments: string;
};

function migrateShape(rec: InventoryRecord): InventoryRecord {
  if (!rec.receiptBatchId) rec.receiptBatchId = rec.serial;
  if (!rec.containerIndex) rec.containerIndex = 1;
  if (!rec.recordKind) rec.recordKind = 'container';
  if (rec.qtyPerContainer == null) rec.qtyPerContainer = rec.qtyReceived;
  return rec;
}

export function normalizeInventory(rec: InventoryRecord): InventoryRecord {
  return migrateShape(rec);
}

export async function receiveGoods(session: Session, input: ReceiveInput): Promise<InventoryRecord[]> {
  await assertCapability(session, 'receive', 'Role cannot receive goods');
  if (!input.materialCode || !input.materialName) throw new Error('Material is required');
  const n = Number(input.numberOfContainers);
  if (!Number.isInteger(n) || n < 1) throw new Error('Number of containers must be an integer ≥ 1');
  if (!(input.qtyPerContainer > 0)) throw new Error('Quantity per container must be > 0');
  const serials = await allocateSerialsOnSubmit(n);
  const receiptBatchId = await allocateReceiptBatchId();
  const utc = nowUtcIso();
  const created: InventoryRecord[] = [];
  for (let i = 0; i < n; i++) {
    const serial = serials[i];
    const rec: InventoryRecord = {
      materialCode: input.materialCode,
      materialName: input.materialName,
      itemType: input.itemType,
      gradeSpec: input.gradeSpec,
      pharmacopeia: input.pharmacopeia,
      manufacturer: input.manufacturer,
      manufacturerLot: input.manufacturerLot,
      supplier: input.supplier,
      supplierLot: input.supplierLot,
      poDeliveryNote: input.poDeliveryNote,
      coaNumber: input.coaNumber,
      internalLot: input.internalLot,
      uom: input.uom,
      numberOfContainers: n,
      containerType: input.containerType,
      dateOfManufacture: input.dateOfManufacture,
      receiptDate: input.receiptDate,
      expiryDate: input.expiryDate,
      retestDate: input.retestDate,
      location: input.location,
      storageCondition: input.storageCondition,
      samplingRequired: input.samplingRequired,
      linkedSampleIds: input.linkedSampleIds,
      comments: input.comments,
      serial,
      barcode: serial,
      qtyReceived: input.qtyPerContainer,
      currentQty: input.qtyPerContainer,
      qtyPerContainer: input.qtyPerContainer,
      receiptBatchId,
      containerIndex: i + 1,
      recordKind: 'container',
      status: 'Quarantine',
      createdBy: session.userId,
      createdOnUtc: utc,
      modifiedBy: session.userId,
      modifiedOnUtc: utc,
    };
    await putInventory(rec);
    await addMovement({
      id: newId('MOV'),
      serial,
      action: 'RECEIVE',
      qty: rec.qtyReceived,
      fromLocation: '',
      toLocation: locationToString(rec.location),
      performedBy: session.userId,
      performedOnUtc: utc,
      reason: `Goods receipt ${receiptBatchId} container ${i + 1} of ${n}`,
      comments: rec.comments,
    });
    await appendAudit(session, {
      action: 'RECEIVE',
      recordId: serial,
      field: 'status',
      oldValue: '',
      newValue: 'Quarantine',
      reasonForChange: `Goods receipt created in Quarantine (${receiptBatchId} ${i + 1} of ${n})`,
    });
    created.push(rec);
  }
  return created;
}

export async function qaDisposition(
  session: Session,
  serial: string,
  disposition: QaDisposition,
  esign: ESign,
  reason: string,
  scope: 'batch' | 'container' = 'batch',
): Promise<InventoryRecord[]> {
  await assertCapability(session, 'qaDisposition', 'QA disposition capability required');
  if (!(await hasCapability(session, 'eSign'))) throw new Error('Electronic signature capability required');
  if (!esign.userId || !esign.printedName || !esign.meaningOfSignature) {
    throw new Error('Electronic signature is incomplete');
  }
  if (esign.userId !== session.userId) throw new Error('Signature user must match session');
  const rec = await getInventory(serial);
  if (!rec) throw new Error('Record not found');
  assertNotOwnReceipt(session.userId, rec.createdBy, session.role);
  const targets: InventoryRecord[] = [];
  if (scope === 'container') {
    targets.push(rec);
  } else {
    const siblings = (await listByReceiptBatch(rec.receiptBatchId || rec.serial)).filter(
      (r) => r.recordKind === 'container' || !r.recordKind,
    );
    if (disposition === 'Release') {
      for (const s of siblings) {
        if (s.status === 'Quarantine') targets.push(s);
      }
      if (!targets.find((t) => t.serial === rec.serial) && !['Destroyed', 'Issued', 'Consumed'].includes(rec.status)) {
        targets.push(rec);
      }
    } else {
      // Reject / Restricted on batch: apply to quarantine siblings; still allow applying to the selected container
      for (const s of siblings) {
        if (s.status === 'Quarantine' || s.serial === rec.serial) {
          if (!['Destroyed', 'Issued', 'Consumed'].includes(s.status)) targets.push(s);
        }
      }
    }
  }
  if (!targets.length) throw new Error('No eligible containers for this disposition');
  const newStatus = qaStatusFromDisposition(disposition);
  const updated: InventoryRecord[] = [];
  for (const t of targets) {
    if (t.status === 'Destroyed' || t.status === 'Issued' || t.status === 'Consumed') {
      throw new Error(`Cannot disposition a ${t.status} container (${t.serial})`);
    }
    assertNotOwnReceipt(session.userId, t.createdBy, session.role);
    const old = t.status;
    t.status = newStatus;
    t.qaDisposition = disposition;
    t.qaEsign = esign;
    t.modifiedBy = session.userId;
    t.modifiedOnUtc = nowUtcIso();
    await putInventory(t);
    await appendAudit(session, {
      action: 'QA_DISPOSITION',
      recordId: t.serial,
      field: 'status',
      oldValue: old,
      newValue: newStatus,
      reasonForChange: reason,
      meaningOfSignature: esign.meaningOfSignature,
    });
    updated.push(t);
  }
  return updated;
}

export async function samplePull(
  session: Session,
  parentSerial: string,
  qtyTaken: number,
  kind: 'sample' | 'retain',
  comments: string,
): Promise<InventoryRecord> {
  await assertCapability(session, 'samplePull', 'Sample pull capability required');
  if (!(qtyTaken > 0)) throw new Error('Sample quantity must be > 0');
  const parent = await getInventory(parentSerial);
  if (!parent) throw new Error('Parent container not found');
  if (parent.recordKind && parent.recordKind !== 'container') {
    throw new Error('Samples may only be pulled from a container record');
  }
  if (['Destroyed', 'Issued', 'Consumed'].includes(parent.status)) {
    throw new Error(`Cannot sample a ${parent.status} container`);
  }
  if (qtyTaken > parent.currentQty) throw new Error('Sample quantity exceeds current quantity');
  const [childSerial] = await allocateSerialsOnSubmit(1);
  const utc = nowUtcIso();
  const oldQty = parent.currentQty;
  parent.currentQty = roundQty(oldQty - qtyTaken);
  const linked = parent.linkedSampleIds ? parent.linkedSampleIds.split(',').map((s) => s.trim()).filter(Boolean) : [];
  linked.push(childSerial);
  parent.linkedSampleIds = linked.join(', ');
  parent.modifiedBy = session.userId;
  parent.modifiedOnUtc = utc;
  await putInventory(parent);

  const child: InventoryRecord = {
    ...parent,
    serial: childSerial,
    barcode: childSerial,
    qtyReceived: qtyTaken,
    currentQty: qtyTaken,
    qtyPerContainer: qtyTaken,
    numberOfContainers: 1,
    containerIndex: 1,
    containerType: parent.containerType === 'Drum' || parent.containerType === 'Bag' ? 'Bottle' : parent.containerType,
    recordKind: kind,
    parentSerial: parent.serial,
    status: parent.status === 'Released' ? 'Released' : 'Quarantine',
    qaDisposition: parent.status === 'Released' ? parent.qaDisposition : undefined,
    qaEsign: parent.status === 'Released' ? parent.qaEsign : undefined,
    linkedSampleIds: '',
    comments: comments || `${kind} pulled from ${parent.serial}`,
    createdBy: session.userId,
    createdOnUtc: utc,
    modifiedBy: session.userId,
    modifiedOnUtc: utc,
    itemType: kind === 'retain' ? 'Retain Sample' : 'Sample',
  };
  await putInventory(child);
  await addMovement({
    id: newId('MOV'),
    serial: childSerial,
    action: 'SAMPLE_PULL',
    qty: qtyTaken,
    fromLocation: locationToString(parent.location),
    toLocation: locationToString(child.location),
    performedBy: session.userId,
    performedOnUtc: utc,
    reason: `${kind} from ${parent.serial}`,
    comments,
  });
  await appendAudit(session, {
    action: 'SAMPLE_PULL',
    recordId: parent.serial,
    field: 'currentQty',
    oldValue: String(oldQty),
    newValue: String(parent.currentQty),
    reasonForChange: `${kind} ${childSerial} qty ${qtyTaken}`,
  });
  await appendAudit(session, {
    action: 'SAMPLE_PULL',
    recordId: childSerial,
    field: 'parentSerial',
    oldValue: '',
    newValue: parent.serial,
    reasonForChange: `${kind} created from ${parent.serial}`,
  });
  return child;
}

export async function transferLocation(
  session: Session,
  serial: string,
  newLoc: Location,
  reason: string,
): Promise<InventoryRecord> {
  await assertCapability(session, 'transfer', 'Role cannot transfer location');
  if (!reason.trim()) throw new Error('Reason for change is required');
  const rec = await getInventory(serial);
  if (!rec) throw new Error('Record not found');
  if (rec.status === 'Destroyed') throw new Error('Cannot move a destroyed container');
  const oldLoc = locationToString(rec.location);
  rec.location = newLoc;
  rec.modifiedBy = session.userId;
  rec.modifiedOnUtc = nowUtcIso();
  await putInventory(rec);
  const utc = rec.modifiedOnUtc;
  await addMovement({
    id: newId('MOV'),
    serial,
    action: 'TRANSFER',
    qty: rec.currentQty,
    fromLocation: oldLoc,
    toLocation: locationToString(newLoc),
    performedBy: session.userId,
    performedOnUtc: utc,
    reason,
    comments: '',
  });
  await appendAudit(session, {
    action: 'TRANSFER',
    recordId: serial,
    field: 'location',
    oldValue: oldLoc,
    newValue: locationToString(newLoc),
    reasonForChange: reason,
  });
  return rec;
}

export async function issueDispense(
  session: Session,
  serial: string,
  qty: number,
  destination: string,
  reason: string,
  fefoOverrideReason: string,
  requestId?: string,
  opts?: { allowQuarantine?: boolean },
): Promise<{ rec: InventoryRecord; fefoWarning: string }> {
  await assertCapability(session, 'issue', 'Role cannot issue stock');
  if (!(qty > 0)) throw new Error('Issue quantity must be > 0');
  const rec = await getInventory(serial);
  if (!rec) throw new Error('Record not found');
  const asOf = todayIsoDateInTz();
  const block = isIssueBlocked(rec, asOf, requestId, opts);
  if (block.blocked) throw new Error(block.reason);
  if (qty > rec.currentQty) throw new Error('Issue quantity exceeds current quantity');
  const all = await listInventory();
  const { warn, earlier } = shouldWarnFefo(rec, all, asOf, requestId);
  if (warn && !fefoOverrideReason.trim()) {
    throw new Error(
      `FEFO warning: earlier-expiry Released lot(s) exist: ${earlier
        .map((e) => `${e.serial} exp ${e.expiryDate}`)
        .join(', ')}. Provide override reason to continue.`,
    );
  }
  const oldQty = rec.currentQty;
  rec.currentQty = roundQty(oldQty - qty);
  const oldStatus = rec.status;
  if (rec.currentQty === 0) {
    const original = rec.qtyPerContainer || rec.qtyReceived;
    rec.status = oldQty < original ? 'Consumed' : 'Issued';
  }
  if (rec.reservedForRequestId === requestId || (!requestId && rec.reservedForRequestId)) {
    if (rec.reservedForRequestId === requestId) {
      rec.reservedQty = Math.max(0, roundQty((rec.reservedQty || 0) - qty));
      if (rec.reservedQty === 0) rec.reservedForRequestId = undefined;
    }
  }
  rec.modifiedBy = session.userId;
  rec.modifiedOnUtc = nowUtcIso();
  await putInventory(rec);
  const reasonText = warn ? `FEFO override: ${fefoOverrideReason}` : reason;
  await addMovement({
    id: newId('MOV'),
    serial,
    action: 'ISSUE',
    qty,
    fromLocation: locationToString(rec.location),
    toLocation: destination,
    performedBy: session.userId,
    performedOnUtc: rec.modifiedOnUtc,
    reason: reasonText,
    comments: requestId ? `${destination} request ${requestId}` : destination,
    requestId,
  });
  await appendAudit(session, {
    action: requestId ? 'REQUEST_ISSUE' : 'ISSUE',
    recordId: serial,
    field: 'currentQty',
    oldValue: String(oldQty),
    newValue: String(rec.currentQty),
    reasonForChange: requestId ? `${reasonText} [requestId=${requestId}]` : reasonText,
  });
  if (oldStatus !== rec.status) {
    await appendAudit(session, {
      action: requestId ? 'REQUEST_ISSUE' : 'ISSUE',
      recordId: serial,
      field: 'status',
      oldValue: oldStatus,
      newValue: rec.status,
      reasonForChange: requestId
        ? `Quantity issued to zero [requestId=${requestId}]`
        : 'Quantity issued to zero',
    });
  }
  return {
    rec,
    fefoWarning: warn ? `Issued with FEFO override. Earlier lots: ${earlier.map((e) => e.serial).join(', ')}` : '',
  };
}

export async function returnToStock(
  session: Session,
  serial: string,
  qty: number,
  reason: string,
): Promise<InventoryRecord> {
  await assertCapability(session, 'returnToStock', 'Role cannot return stock');
  if (!(qty > 0)) throw new Error('Return quantity must be > 0');
  if (!reason.trim()) throw new Error('Reason for change is required');
  const rec = await getInventory(serial);
  if (!rec) throw new Error('Record not found');
  if (rec.status === 'Destroyed' || rec.status === 'Rejected') {
    throw new Error(`Cannot return to a ${rec.status} container`);
  }
  const oldQty = rec.currentQty;
  rec.currentQty = roundQty(oldQty + qty);
  if (rec.status === 'Issued' || rec.status === 'Consumed') rec.status = 'Released';
  rec.modifiedBy = session.userId;
  rec.modifiedOnUtc = nowUtcIso();
  await putInventory(rec);
  await addMovement({
    id: newId('MOV'),
    serial,
    action: 'RETURN',
    qty,
    fromLocation: 'production/return',
    toLocation: locationToString(rec.location),
    performedBy: session.userId,
    performedOnUtc: rec.modifiedOnUtc,
    reason,
    comments: '',
  });
  await appendAudit(session, {
    action: 'RETURN',
    recordId: serial,
    field: 'currentQty',
    oldValue: String(oldQty),
    newValue: String(rec.currentQty),
    reasonForChange: reason,
  });
  return rec;
}

export async function setHold(
  session: Session,
  serial: string,
  hold: boolean,
  reason: string,
): Promise<InventoryRecord> {
  await assertCapability(session, 'hold', 'Hold capability required');
  if (!reason.trim()) throw new Error('Reason for change is required');
  const rec = await getInventory(serial);
  if (!rec) throw new Error('Record not found');
  if (rec.status === 'Destroyed') throw new Error('Cannot hold a destroyed container');
  const old = rec.status;
  if (hold) {
    rec.status = 'Hold';
    rec.holdReason = reason;
  } else {
    rec.status = rec.qaDisposition ? qaStatusFromDisposition(rec.qaDisposition) : 'Quarantine';
    rec.holdReason = '';
  }
  rec.modifiedBy = session.userId;
  rec.modifiedOnUtc = nowUtcIso();
  await putInventory(rec);
  await appendAudit(session, {
    action: hold ? 'HOLD' : 'UNHOLD',
    recordId: serial,
    field: 'status',
    oldValue: old,
    newValue: rec.status,
    reasonForChange: reason,
  });
  return rec;
}

export async function cycleCount(
  session: Session,
  serial: string,
  countedQty: number,
  reason: string,
): Promise<InventoryRecord> {
  await assertCapability(session, 'cycleCount', 'Role cannot cycle count');
  if (countedQty < 0) throw new Error('Counted quantity cannot be negative');
  if (!reason.trim()) throw new Error('Reason for change is required on quantity adjustment');
  const rec = await getInventory(serial);
  if (!rec) throw new Error('Record not found');
  if (rec.status === 'Destroyed') throw new Error('Cannot adjust a destroyed container');
  const oldQty = rec.currentQty;
  rec.currentQty = roundQty(countedQty);
  rec.modifiedBy = session.userId;
  rec.modifiedOnUtc = nowUtcIso();
  await putInventory(rec);
  await addMovement({
    id: newId('MOV'),
    serial,
    action: 'CYCLE_COUNT',
    qty: rec.currentQty - oldQty,
    fromLocation: locationToString(rec.location),
    toLocation: locationToString(rec.location),
    performedBy: session.userId,
    performedOnUtc: rec.modifiedOnUtc,
    reason,
    comments: `Counted ${countedQty}`,
  });
  await appendAudit(session, {
    action: 'CYCLE_COUNT',
    recordId: serial,
    field: 'currentQty',
    oldValue: String(oldQty),
    newValue: String(rec.currentQty),
    reasonForChange: reason,
  });
  return rec;
}

export async function destroyContainer(
  session: Session,
  serial: string,
  reason: string,
  esign: ESign,
): Promise<InventoryRecord> {
  await assertCapability(session, 'destroy', 'Destruction capability required');
  const matrix = await getLiveMatrix();
  if (matrix.sod.destroyRequiresESign && !(await hasCapability(session, 'eSign'))) {
    throw new Error('Destruction requires electronic signature capability');
  }
  if (!reason.trim()) throw new Error('Destruction reason is required');
  if (!esign.userId || !esign.printedName || !esign.meaningOfSignature) {
    throw new Error('Electronic signature is incomplete');
  }
  if (esign.userId !== session.userId) throw new Error('Signature user must match session');
  const rec = await getInventory(serial);
  if (!rec) throw new Error('Record not found');
  if (rec.status === 'Destroyed') throw new Error('Already destroyed');
  const old = rec.status;
  rec.status = 'Destroyed';
  rec.destructionReason = reason;
  rec.destructionEsign = esign;
  rec.modifiedBy = session.userId;
  rec.modifiedOnUtc = nowUtcIso();
  await putInventory(rec);
  await appendAudit(session, {
    action: 'DESTROY',
    recordId: serial,
    field: 'status',
    oldValue: old,
    newValue: 'Destroyed',
    reasonForChange: reason,
    meaningOfSignature: esign.meaningOfSignature,
  });
  return rec;
}

export async function reprintLabel(session: Session, serial: string): Promise<void> {
  await assertCapability(session, 'reprintLabel', 'Role cannot reprint labels');
  const rec = await getInventory(serial);
  if (!rec) throw new Error('Record not found');
  await appendAudit(session, {
    action: 'PRINT_LABEL',
    recordId: serial,
    field: 'label',
    oldValue: '',
    newValue: 'reprinted',
    reasonForChange: 'Label reprint',
  });
}

export async function reprintBatchLabels(session: Session, receiptBatchId: string): Promise<InventoryRecord[]> {
  await assertCapability(session, 'reprintLabel', 'Role cannot reprint labels');
  const rows = await listByReceiptBatch(receiptBatchId);
  if (!rows.length) throw new Error('Receipt batch not found');
  for (const r of rows) {
    await appendAudit(session, {
      action: 'PRINT_LABEL',
      recordId: r.serial,
      field: 'label',
      oldValue: '',
      newValue: 'reprinted',
      reasonForChange: `Label reprint (batch ${receiptBatchId})`,
    });
  }
  return rows;
}

export function roundQty(n: number): number {
  return Math.round(n * 10000) / 10000;
}

export { isExpired };
export type { RecordKind };
