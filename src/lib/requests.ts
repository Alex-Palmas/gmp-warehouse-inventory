import type { MaterialRequest, PickedLine, RequestPriority, Session, Uom } from '../types';
import { getDb } from './db';
import { appendAudit, listAudit } from './audit';
import { nowUtcIso, todayIsoDateInTz } from './dates';
import { availableReleasedQty, isIssueBlocked, proposeFefo, proposeFefoAllocations, shouldWarnFefo } from './fefo';
import {
  clearReservationsForRequest,
  getInventory,
  issueDispense,
  listInventory,
  reserveSerialsForRequest,
} from './inventory';
import { notifyCapability, notifyUser } from './inbox';
import { assertCapability } from './permissions';
import { formatRequestId } from './serial';
import { getMaterial } from './materials';
import type { SerialCounter } from '../types';

async function nextRequestId(): Promise<string> {
  const db = await getDb();
  const year = new Date().getUTCFullYear();
  const c = ((await db.get('meta', 'requestCounter')) as SerialCounter | undefined) ?? { year, lastN: 0 };
  const n = c.year === year ? c.lastN + 1 : 1;
  const id = formatRequestId(year, n);
  await db.put('meta', { year, lastN: n }, 'requestCounter');
  return id;
}

export async function listRequests(): Promise<MaterialRequest[]> {
  const db = await getDb();
  const all = (await db.getAll('materialRequests')) as MaterialRequest[];
  all.sort((a, b) => b.requestedOnUtc.localeCompare(a.requestedOnUtc));
  return all;
}

export async function getRequest(requestId: string): Promise<MaterialRequest | undefined> {
  const db = await getDb();
  return (await db.get('materialRequests', requestId)) as MaterialRequest | undefined;
}

export async function listOpenRequests(): Promise<MaterialRequest[]> {
  const all = await listRequests();
  return all.filter((r) => ['Submitted', 'Picking', 'Partially Issued'].includes(r.status));
}

export type SubmitRequestInput = {
  materialCode: string;
  qtyRequested: number;
  uom: Uom;
  neededBy: string;
  destination: string;
  purpose: string;
  priority: RequestPriority;
  comments?: string;
};

export async function submitRequest(session: Session, input: SubmitRequestInput): Promise<MaterialRequest> {
  await assertCapability(session, 'submitRequest', 'Role cannot submit material requests');
  if (!input.materialCode) throw new Error('Material is required');
  if (!(input.qtyRequested > 0)) throw new Error('Requested quantity must be > 0');
  if (!input.destination.trim()) throw new Error('Destination is required');
  if (!input.purpose.trim()) throw new Error('Purpose / batch is required');
  const mat = await getMaterial(input.materialCode);
  if (!mat || !mat.active) throw new Error('Material is not on the approved Material Master');
  const asOf = todayIsoDateInTz();
  const inv = await listInventory();
  const avail = availableReleasedQty(inv, input.materialCode, asOf);
  const stockWarning =
    avail < input.qtyRequested
      ? `Insufficient Released FEFO stock: requested ${input.qtyRequested} ${input.uom}, available ${avail} ${input.uom}. Request still accepted.`
      : '';
  const requestId = await nextRequestId();
  const utc = nowUtcIso();
  const rec: MaterialRequest = {
    requestId,
    materialCode: mat.materialCode,
    materialName: mat.materialName,
    qtyRequested: input.qtyRequested,
    qtyIssued: 0,
    uom: input.uom || mat.defaultUom,
    neededBy: input.neededBy,
    destination: input.destination.trim(),
    purpose: input.purpose.trim(),
    priority: input.priority || 'Routine',
    status: 'Submitted',
    requestedBy: session.userId,
    requestedOnUtc: utc,
    pickedSerials: [],
    reservedSerials: [],
    comments: input.comments ?? '',
    stockWarning: stockWarning || undefined,
  };
  const allocations = proposeFefoAllocations(inv, rec.materialCode, rec.qtyRequested, asOf);
  rec.reservedSerials = allocations;
  const db = await getDb();
  await db.add('materialRequests', rec);
  if (allocations.length) {
    await reserveSerialsForRequest(session, requestId, allocations);
  }
  await appendAudit(session, {
    action: 'REQUEST_SUBMIT',
    recordId: requestId,
    field: 'status',
    oldValue: '',
    newValue: 'Submitted',
    reasonForChange: `${mat.materialCode} qty ${input.qtyRequested} ${rec.uom} → ${rec.destination}`,
  });
  await notifyCapability(
    'fulfillRequest',
    `Request ${requestId} submitted`,
    `${session.fullName} requested ${input.qtyRequested} ${rec.uom} of ${mat.materialCode} ${mat.materialName} for ${rec.purpose}.`,
    'request_submitted',
    requestId,
    session.userId,
  );
  if (stockWarning) {
    await notifyUser(
      session.userId,
      `Insufficient stock for ${requestId}`,
      stockWarning,
      'insufficient_stock',
      requestId,
    );
    await notifyCapability(
      'fulfillRequest',
      `Insufficient stock: ${requestId}`,
      stockWarning,
      'insufficient_stock',
      requestId,
      session.userId,
    );
  }
  return rec;
}

export function proposeFefoForRequest(
  req: MaterialRequest,
  inventory: {
    serial: string;
    materialCode: string;
    status: string;
    expiryDate: string;
    currentQty: number;
    reservedForRequestId?: string;
    reservedQty?: number;
  }[],
  asOf: string,
) {
  return proposeFefo(inventory, req.materialCode, req.qtyRequested - req.qtyIssued, asOf, req.requestId);
}

export async function pickSerialForRequest(
  session: Session,
  requestId: string,
  serial: string,
  qty: number,
): Promise<MaterialRequest> {
  await assertCapability(session, 'fulfillRequest', 'Role cannot fulfill material requests');
  if (!(qty > 0)) throw new Error('Pick quantity must be > 0');
  const req = await getRequest(requestId);
  if (!req) throw new Error('Request not found');
  if (!['Submitted', 'Picking', 'Partially Issued'].includes(req.status)) {
    throw new Error(`Cannot pick for a ${req.status} request`);
  }
  const rec = await getInventory(serial);
  if (!rec) throw new Error('Serial not found');
  if (rec.materialCode !== req.materialCode) {
    throw new Error(`Wrong material: scanned ${rec.materialCode}, request is ${req.materialCode}`);
  }
  if (rec.reservedForRequestId && rec.reservedForRequestId !== requestId && (rec.reservedQty || 0) > 0) {
    throw new Error(`Serial ${serial} is reserved for request ${rec.reservedForRequestId}`);
  }
  const asOf = todayIsoDateInTz();
  const block = isIssueBlocked(rec, asOf, requestId);
  if (block.blocked) throw new Error(block.reason);
  const already = req.pickedSerials.find((p) => p.serial === serial)?.qty ?? 0;
  if (qty + already > rec.currentQty) throw new Error('Pick quantity exceeds remaining container quantity');
  const remainingNeed = req.qtyRequested - req.qtyIssued - req.pickedSerials.reduce((s, p) => s + p.qty, 0);
  if (qty > remainingNeed && remainingNeed > 0) {
    // allow over-pick of a unit vial (qtyPerContainer=1) but not more than remaining need for bulk
    if ((rec.qtyPerContainer || rec.qtyReceived) > 1) {
      throw new Error(`Pick quantity ${qty} exceeds remaining request need ${remainingNeed}`);
    }
  }
  const nextPicked: PickedLine[] = req.pickedSerials.filter((p) => p.serial !== serial);
  nextPicked.push({ serial, qty: already + qty });
  req.pickedSerials = nextPicked;
  req.status = 'Picking';
  req.fulfilledBy = session.userId;
  const reservedQty = nextPicked.find((p) => p.serial === serial)?.qty ?? qty;
  if (!req.reservedSerials) req.reservedSerials = [];
  const rest = req.reservedSerials.filter((p) => p.serial !== serial);
  rest.push({ serial, qty: reservedQty });
  req.reservedSerials = rest;
  await reserveSerialsForRequest(session, requestId, [{ serial, qty: reservedQty }]);
  const db = await getDb();
  await db.put('materialRequests', req);
  await appendAudit(session, {
    action: 'REQUEST_PICK',
    recordId: requestId,
    field: 'pickedSerials',
    oldValue: already ? `${serial}:${already}` : '',
    newValue: `${serial}:${already + qty}`,
    reasonForChange: `Scan pick for ${requestId}`,
  });
  return req;
}

export async function removePick(
  session: Session,
  requestId: string,
  serial: string,
): Promise<MaterialRequest> {
  await assertCapability(session, 'fulfillRequest', 'Role cannot fulfill material requests');
  const req = await getRequest(requestId);
  if (!req) throw new Error('Request not found');
  if (!['Submitted', 'Picking'].includes(req.status)) {
    throw new Error('Cannot unpick after issue confirmation');
  }
  const oldQty = req.pickedSerials.find((p) => p.serial === serial)?.qty ?? 0;
  req.pickedSerials = req.pickedSerials.filter((p) => p.serial !== serial);
  if (!req.pickedSerials.length) req.status = 'Submitted';
  const db = await getDb();
  await db.put('materialRequests', req);
  await appendAudit(session, {
    action: 'REQUEST_UNPICK',
    recordId: requestId,
    field: 'pickedSerials',
    oldValue: `${serial}:${oldQty}`,
    newValue: '',
    reasonForChange: `Removed pick ${serial} from ${requestId}`,
  });
  return req;
}

export async function confirmFulfillment(
  session: Session,
  requestId: string,
  fefoOverrideReason: string,
): Promise<MaterialRequest> {
  await assertCapability(session, 'fulfillRequest', 'Role cannot fulfill material requests');
  const req = await getRequest(requestId);
  if (!req) throw new Error('Request not found');
  if (!req.pickedSerials.length) throw new Error('No serials picked');
  const asOf = todayIsoDateInTz();
  const all = await listInventory();
  for (const line of req.pickedSerials) {
    const rec = all.find((r) => r.serial === line.serial);
    if (!rec) throw new Error(`Serial ${line.serial} not found`);
    const { warn } = shouldWarnFefo(rec, all, asOf, req.requestId);
    if (warn && !fefoOverrideReason.trim()) {
      throw new Error(
        `FEFO warning on ${line.serial}: earlier-expiry Released stock exists. Provide override reason to confirm.`,
      );
    }
  }
  for (const line of req.pickedSerials) {
    await issueDispense(
      session,
      line.serial,
      line.qty,
      req.destination,
      `Issued against request ${req.requestId} (${req.purpose})`,
      fefoOverrideReason,
      req.requestId,
    );
    req.qtyIssued = Math.round((req.qtyIssued + line.qty) * 10000) / 10000;
  }
  req.pickedSerials = [];
  req.fulfilledBy = session.userId;
  req.fulfilledOnUtc = nowUtcIso();
  req.status = req.qtyIssued + 1e-9 >= req.qtyRequested ? 'Issued' : 'Partially Issued';
  if (req.status === 'Issued') {
    await clearReservationsForRequest(session, req.requestId);
    req.reservedSerials = [];
  }
  const db = await getDb();
  await db.put('materialRequests', req);
  await appendAudit(session, {
    action: 'REQUEST_ISSUE',
    recordId: requestId,
    field: 'status',
    oldValue: 'Picking',
    newValue: req.status,
    reasonForChange: `Confirmed pick for ${requestId}; qtyIssued=${req.qtyIssued}`,
  });
  await notifyUser(
    req.requestedBy,
    `Request ${requestId} ready`,
    `${req.qtyIssued} ${req.uom} of ${req.materialCode} is issued to ${req.destination}. Confirm received to close the chain of custody.`,
    'request_ready',
    requestId,
  );
  return req;
}

export async function confirmReceived(session: Session, requestId: string): Promise<MaterialRequest> {
  await assertCapability(session, 'confirmRequestReceipt', 'Role cannot confirm request receipt');
  const req = await getRequest(requestId);
  if (!req) throw new Error('Request not found');
  if (req.status !== 'Issued' && req.status !== 'Partially Issued') {
    throw new Error('Only issued requests can be confirmed received');
  }
  if (req.requestedBy !== session.userId && session.role !== 'supervisor') {
    throw new Error('Only the requester (or a supervisor) may confirm chain of custody');
  }
  const old = req.status;
  req.status = 'Closed';
  req.receivedBy = session.userId;
  req.receivedOnUtc = nowUtcIso();
  const db = await getDb();
  await db.put('materialRequests', req);
  await appendAudit(session, {
    action: 'REQUEST_CLOSE',
    recordId: requestId,
    field: 'status',
    oldValue: old,
    newValue: 'Closed',
    reasonForChange: 'Requester confirmed received (chain of custody)',
  });
  return req;
}

export async function cancelRequest(session: Session, requestId: string, reason: string): Promise<MaterialRequest> {
  await assertCapability(session, 'cancelRequest', 'Role cannot cancel requests');
  if (!reason.trim()) throw new Error('Cancel reason is required');
  const req = await getRequest(requestId);
  if (!req) throw new Error('Request not found');
  if (req.status !== 'Submitted') throw new Error('Only Submitted requests may be cancelled');
  if (req.requestedBy !== session.userId && session.role !== 'supervisor') {
    throw new Error('Only the requester (or a supervisor) may cancel');
  }
  req.status = 'Cancelled';
  req.rejectReason = reason.trim();
  await clearReservationsForRequest(session, requestId);
  req.reservedSerials = [];
  const db = await getDb();
  await db.put('materialRequests', req);
  await appendAudit(session, {
    action: 'REQUEST_CANCEL',
    recordId: requestId,
    field: 'status',
    oldValue: 'Submitted',
    newValue: 'Cancelled',
    reasonForChange: reason,
  });
  await notifyCapability(
    'fulfillRequest',
    `Request ${requestId} cancelled`,
    reason,
    'request_cancelled',
    requestId,
    session.userId,
  );
  return req;
}

export async function rejectRequest(session: Session, requestId: string, reason: string): Promise<MaterialRequest> {
  await assertCapability(session, 'rejectRequest', 'Role cannot reject requests');
  if (!reason.trim()) throw new Error('Reject reason is required');
  const req = await getRequest(requestId);
  if (!req) throw new Error('Request not found');
  if (!['Submitted', 'Picking', 'Partially Issued'].includes(req.status)) {
    throw new Error(`Cannot reject a ${req.status} request`);
  }
  const old = req.status;
  req.status = 'Rejected';
  req.rejectReason = reason.trim();
  req.fulfilledBy = session.userId;
  await clearReservationsForRequest(session, requestId);
  req.reservedSerials = [];
  const db = await getDb();
  await db.put('materialRequests', req);
  await appendAudit(session, {
    action: 'REQUEST_REJECT',
    recordId: requestId,
    field: 'status',
    oldValue: old,
    newValue: 'Rejected',
    reasonForChange: reason,
  });
  await notifyUser(
    req.requestedBy,
    `Request ${requestId} rejected`,
    reason,
    'request_rejected',
    requestId,
  );
  return req;
}

export async function requestHasIssueAudit(requestId: string): Promise<boolean> {
  const all = await listAudit();
  return all.some((a) => a.action === 'REQUEST_ISSUE' && (a.recordId === requestId || a.reasonForChange.includes(requestId)));
}
