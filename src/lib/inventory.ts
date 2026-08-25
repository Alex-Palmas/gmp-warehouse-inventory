/**
 * Single inventory mutation module. All forms MUST call these functions so
 * serial allocation and audit logging cannot be skipped.
 */
import type {
  ESign,
  InventoryRecord,
  Location,
  Movement,
  QaDisposition,
  SerialCounter,
  Session,
} from '../types';
import { getDb } from './db';
import { appendAudit } from './audit';
import { nowUtcIso, locationToString, isExpired, todayIsoDateInTz } from './dates';
import { isIssueBlocked, shouldWarnFefo } from './fefo';
import { newId } from './ids';
import { formatSerial } from './serial';
import {
  assertCapability,
  assertNotOwnReceipt,
  getLiveMatrix,
  hasCapability,
  qaStatusFromDisposition,
} from './permissions';

async function getCounter(): Promise<SerialCounter> {
  const db = await getDb();
  const c = (await db.get('meta', 'serialCounter')) as SerialCounter | undefined;
  return c ?? { year: new Date().getUTCFullYear(), lastN: 0 };
}

async function putCounter(c: SerialCounter): Promise<void> {
  const db = await getDb();
  await db.put('meta', c, 'serialCounter');
}

/** Allocate serial only on successful receive (caller already validated input). */
export async function allocateSerialOnSubmit(): Promise<string> {
  const year = new Date().getUTCFullYear();
  const c = await getCounter();
  const n = c.year === year ? c.lastN + 1 : 1;
  const serial = formatSerial(year, n);
  const db = await getDb();
  const existing = await db.get('inventory', serial);
  if (existing) throw new Error(`Serial ${serial} already exists — allocation aborted`);
  await putCounter({ year, lastN: n });
  return serial;
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

export type ReceiveInput = Omit<
  InventoryRecord,
  | 'serial'
  | 'barcode'
  | 'status'
  | 'createdBy'
  | 'createdOnUtc'
  | 'modifiedBy'
  | 'modifiedOnUtc'
  | 'qaDisposition'
  | 'qaEsign'
  | 'destructionReason'
  | 'destructionEsign'
  | 'holdReason'
  | 'currentQty'
>;

export async function receiveGoods(session: Session, input: ReceiveInput): Promise<InventoryRecord> {
  await assertCapability(session, 'receive', 'Role cannot receive goods');
  if (!input.materialCode || !input.materialName) throw new Error('Material is required');
  if (!(input.qtyReceived > 0)) throw new Error('Quantity received must be > 0');
  const serial = await allocateSerialOnSubmit();
  const utc = nowUtcIso();
  const rec: InventoryRecord = {
    ...input,
    serial,
    barcode: serial,
    currentQty: input.qtyReceived,
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
    reason: 'Goods receipt',
    comments: rec.comments,
  });
  await appendAudit(session, {
    action: 'RECEIVE',
    recordId: serial,
    field: 'status',
    oldValue: '',
    newValue: 'Quarantine',
    reasonForChange: 'Goods receipt created in Quarantine',
  });
  return rec;
}

export async function qaDisposition(
  session: Session,
  serial: string,
  disposition: QaDisposition,
  esign: ESign,
  reason: string,
): Promise<InventoryRecord> {
  await assertCapability(session, 'qaDisposition', 'QA disposition capability required');
  if (!(await hasCapability(session, 'eSign'))) throw new Error('Electronic signature capability required');
  if (!esign.userId || !esign.printedName || !esign.meaningOfSignature) {
    throw new Error('Electronic signature is incomplete');
  }
  if (esign.userId !== session.userId) throw new Error('Signature user must match session');
  const rec = await getInventory(serial);
  if (!rec) throw new Error('Record not found');
  assertNotOwnReceipt(session.userId, rec.createdBy);
  if (rec.status === 'Destroyed' || rec.status === 'Issued' || rec.status === 'Consumed') {
    throw new Error(`Cannot disposition a ${rec.status} container`);
  }
  const newStatus = qaStatusFromDisposition(disposition);
  const old = rec.status;
  rec.status = newStatus;
  rec.qaDisposition = disposition;
  rec.qaEsign = esign;
  rec.modifiedBy = session.userId;
  rec.modifiedOnUtc = nowUtcIso();
  await putInventory(rec);
  await appendAudit(session, {
    action: 'QA_DISPOSITION',
    recordId: serial,
    field: 'status',
    oldValue: old,
    newValue: newStatus,
    reasonForChange: reason,
    meaningOfSignature: esign.meaningOfSignature,
  });
  return rec;
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
): Promise<{ rec: InventoryRecord; fefoWarning: string }> {
  await assertCapability(session, 'issue', 'Role cannot issue stock');
  if (!(qty > 0)) throw new Error('Issue quantity must be > 0');
  const rec = await getInventory(serial);
  if (!rec) throw new Error('Record not found');
  const asOf = todayIsoDateInTz();
  const block = isIssueBlocked(rec, asOf);
  if (block.blocked) throw new Error(block.reason);
  if (qty > rec.currentQty) throw new Error('Issue quantity exceeds current quantity');
  const all = await listInventory();
  const { warn, earlier } = shouldWarnFefo(rec, all, asOf);
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
  if (rec.currentQty === 0) rec.status = 'Issued';
  rec.modifiedBy = session.userId;
  rec.modifiedOnUtc = nowUtcIso();
  await putInventory(rec);
  await addMovement({
    id: newId('MOV'),
    serial,
    action: 'ISSUE',
    qty,
    fromLocation: locationToString(rec.location),
    toLocation: destination,
    performedBy: session.userId,
    performedOnUtc: rec.modifiedOnUtc,
    reason: warn ? `FEFO override: ${fefoOverrideReason}` : reason,
    comments: destination,
  });
  await appendAudit(session, {
    action: 'ISSUE',
    recordId: serial,
    field: 'currentQty',
    oldValue: String(oldQty),
    newValue: String(rec.currentQty),
    reasonForChange: warn ? `FEFO override: ${fefoOverrideReason}` : reason,
  });
  if (oldStatus !== rec.status) {
    await appendAudit(session, {
      action: 'ISSUE',
      recordId: serial,
      field: 'status',
      oldValue: oldStatus,
      newValue: rec.status,
      reasonForChange: 'Quantity issued to zero',
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

export function roundQty(n: number): number {
  return Math.round(n * 10000) / 10000;
}

export { isExpired };
