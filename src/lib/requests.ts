import type {
  ESign,
  MaterialClassification,
  MaterialRequest,
  PickedLine,
  RequestPriority,
  RequestStatus,
  Session,
  ToLocation,
  Uom,
} from '../types';
import { PRESENTATION_ROLE_ID, TO_LOCATIONS } from '../types';
import { getDb } from './db';
import { appendAudit, listAudit } from './audit';
import { locationToString, nowUtcIso, todayIsoDateInTz } from './dates';
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

const WAREHOUSE_PICK_STATUSES: RequestStatus[] = ['Approved', 'Picking', 'Partially Issued'];
const CANCELABLE_STATUSES: RequestStatus[] = ['Submitted', 'Pending Supervisor', 'Pending QA'];
const CLASSIFICATION_OK: MaterialClassification[] = ['GMP', 'High Quality'];

async function nextRequestId(): Promise<string> {
  const db = await getDb();
  const year = new Date().getUTCFullYear();
  const c = ((await db.get('meta', 'requestCounter')) as SerialCounter | undefined) ?? { year, lastN: 0 };
  const n = c.year === year ? c.lastN + 1 : 1;
  const id = formatRequestId(year, n);
  await db.put('meta', { year, lastN: n }, 'requestCounter');
  return id;
}

/** Old Submitted rows without a supervisor e-sign are treated as Pending Supervisor. */
export function normalizeRequest(req: MaterialRequest): MaterialRequest {
  if (req.status === 'Submitted' && !req.supervisorEsign) {
    return { ...req, status: 'Pending Supervisor' };
  }
  return req;
}

export function requiresQa(req: Pick<MaterialRequest, 'cellBankOrQuarantine'>): boolean {
  return req.cellBankOrQuarantine === true;
}

function allowedStatusesFor(req: MaterialRequest): string[] {
  if (req.cellBankOrQuarantine && req.qaEsign) return ['Quarantine', 'Released'];
  return ['Released'];
}

function assertEsign(session: Session, esign: ESign | undefined, label: string): asserts esign is ESign {
  if (!esign?.userId || !esign.printedName || !esign.meaningOfSignature || !esign.signedAtUtc) {
    throw new Error(`${label} electronic signature is incomplete`);
  }
  if (esign.userId !== session.userId) throw new Error('Signature user must match session');
}

function assertNotSelfApprove(session: Session, requestedBy: string, action: string): void {
  if (session.role === PRESENTATION_ROLE_ID) return;
  if (session.userId === requestedBy) {
    throw new Error(`Segregation of duties: requestor cannot ${action} their own transfer`);
  }
}

export async function listRequests(): Promise<MaterialRequest[]> {
  const db = await getDb();
  const all = ((await db.getAll('materialRequests')) as MaterialRequest[]).map(normalizeRequest);
  all.sort((a, b) => b.requestedOnUtc.localeCompare(a.requestedOnUtc));
  return all;
}

export async function getRequest(requestId: string): Promise<MaterialRequest | undefined> {
  const db = await getDb();
  const rec = (await db.get('materialRequests', requestId)) as MaterialRequest | undefined;
  return rec ? normalizeRequest(rec) : undefined;
}

export async function listOpenRequests(): Promise<MaterialRequest[]> {
  const all = await listRequests();
  return all.filter((r) => WAREHOUSE_PICK_STATUSES.includes(r.status));
}

export async function listPendingSupervisor(): Promise<MaterialRequest[]> {
  const all = await listRequests();
  return all.filter((r) => r.status === 'Pending Supervisor');
}

export async function listPendingQa(): Promise<MaterialRequest[]> {
  const all = await listRequests();
  return all.filter((r) => r.status === 'Pending QA');
}

export type SubmitRequestInput = {
  materialCode: string;
  qtyRequested: number;
  uom: Uom;
  neededBy: string;
  destination?: string;
  purpose?: string;
  priority: RequestPriority;
  comments?: string;
  toLocation: ToLocation;
  destinationOther?: string;
  classification: MaterialClassification[];
  intendedUse: string;
  cellBankOrQuarantine?: boolean;
  requestorEsign: ESign;
};

function displayDestination(toLocation: ToLocation, destinationOther?: string): string {
  if (toLocation === 'Other') return (destinationOther || '').trim();
  return toLocation;
}

async function applyFefoReserve(session: Session, rec: MaterialRequest): Promise<void> {
  const asOf = todayIsoDateInTz();
  const inv = await listInventory();
  const statuses = allowedStatusesFor(rec);
  const allocations = proposeFefoAllocations(
    inv,
    rec.materialCode,
    rec.qtyRequested,
    asOf,
    rec.requestId,
    statuses,
  );
  rec.reservedSerials = allocations;
  if (allocations.length) {
    await reserveSerialsForRequest(session, rec.requestId, allocations);
  }
  const reservedQty = allocations.reduce((s, a) => s + a.qty, 0);
  if (reservedQty + 1e-9 < rec.qtyRequested) {
    rec.stockWarning = `Insufficient ${statuses.join('/')} FEFO stock: requested ${rec.qtyRequested} ${rec.uom}, reserved ${reservedQty} ${rec.uom}. Transfer still approved.`;
    await notifyUser(
      rec.requestedBy,
      `Insufficient stock for ${rec.requestId}`,
      rec.stockWarning,
      'insufficient_stock',
      rec.requestId,
    );
  }
}

export async function submitRequest(session: Session, input: SubmitRequestInput): Promise<MaterialRequest> {
  await assertCapability(session, 'submitRequest', 'Role cannot submit material requests');
  if (!input.materialCode) throw new Error('Material is required');
  if (!(input.qtyRequested > 0)) throw new Error('Requested quantity must be > 0');
  if (!input.toLocation || !(TO_LOCATIONS as readonly string[]).includes(input.toLocation)) {
    throw new Error('To location is required');
  }
  if (input.toLocation === 'Other' && !input.destinationOther?.trim()) {
    throw new Error('Specify Other destination');
  }
  const classification = (input.classification || []).filter((c) => CLASSIFICATION_OK.includes(c));
  if (classification.length < 1) throw new Error('Classification is required (GMP and/or High Quality)');
  const intendedUse = (input.intendedUse || input.purpose || '').trim();
  if (!intendedUse) throw new Error('Intended use is required');
  assertEsign(session, input.requestorEsign, 'Requestor');
  const mat = await getMaterial(input.materialCode);
  if (!mat || !mat.active) throw new Error('Material is not on the approved Material Master');
  const asOf = todayIsoDateInTz();
  const inv = await listInventory();
  const avail = availableReleasedQty(inv, input.materialCode, asOf);
  const destination = displayDestination(input.toLocation, input.destinationOther);
  const stockWarning =
    avail < input.qtyRequested
      ? `Insufficient Released FEFO stock: requested ${input.qtyRequested} ${input.uom}, available ${avail} ${input.uom}. Transfer still accepted pending approval.`
      : '';
  const requestId = await nextRequestId();
  const utc = nowUtcIso();
  const rec: MaterialRequest = {
    requestId,
    materialCode: mat.materialCode,
    materialName: mat.materialName,
    qtyRequested: input.qtyRequested,
    qtyIssued: 0,
    qtyReceived: 0,
    uom: input.uom || mat.defaultUom,
    neededBy: input.neededBy,
    destination,
    purpose: intendedUse,
    intendedUse,
    toLocation: input.toLocation,
    destinationOther: input.toLocation === 'Other' ? input.destinationOther?.trim() : undefined,
    classification,
    cellBankOrQuarantine: Boolean(input.cellBankOrQuarantine),
    priority: input.priority || 'Routine',
    status: 'Pending Supervisor',
    requestedBy: session.userId,
    requestedOnUtc: utc,
    pickedSerials: [],
    reservedSerials: [],
    comments: input.comments ?? '',
    stockWarning: stockWarning || undefined,
    requestorEsign: input.requestorEsign,
  };
  const db = await getDb();
  await db.add('materialRequests', rec);
  await appendAudit(session, {
    action: 'REQUEST_SUBMIT',
    recordId: requestId,
    field: 'status',
    oldValue: '',
    newValue: 'Pending Supervisor',
    reasonForChange: `${mat.materialCode} qty ${input.qtyRequested} ${rec.uom} → ${rec.destination}`,
    meaningOfSignature: input.requestorEsign.meaningOfSignature,
  });
  await notifyCapability(
    'approveRequest',
    `Material transfer ${requestId} pending supervisor`,
    `${session.fullName} requested ${input.qtyRequested} ${rec.uom} of ${mat.materialCode} ${mat.materialName} for ${rec.intendedUse}.`,
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
  }
  return rec;
}

export async function approveRequestSupervisor(
  session: Session,
  requestId: string,
  esign: ESign,
): Promise<MaterialRequest> {
  await assertCapability(session, 'approveRequest', 'Role cannot approve material transfers');
  assertEsign(session, esign, 'Supervisor');
  const req = await getRequest(requestId);
  if (!req) throw new Error('Request not found');
  if (req.status !== 'Pending Supervisor') {
    throw new Error(`Cannot supervisor-approve a ${req.status} transfer`);
  }
  assertNotSelfApprove(session, req.requestedBy, 'supervisor-approve');
  const old = req.status;
  req.supervisorEsign = esign;
  if (requiresQa(req)) {
    req.status = 'Pending QA';
    await notifyCapability(
      'qaDisposition',
      `Material transfer ${requestId} pending QA`,
      `${req.materialCode} ${req.qtyRequested} ${req.uom} — cell bank or quarantined material.`,
      'request_submitted',
      requestId,
      session.userId,
    );
  } else {
    req.status = 'Approved';
    await applyFefoReserve(session, req);
    await notifyCapability(
      'fulfillRequest',
      `Material transfer ${requestId} approved`,
      `${req.materialCode} ${req.qtyRequested} ${req.uom} → ${req.destination}. Ready to pick.`,
      'request_issued',
      requestId,
      session.userId,
    );
  }
  const db = await getDb();
  await db.put('materialRequests', req);
  await appendAudit(session, {
    action: 'REQUEST_SUPERVISOR_APPROVE',
    recordId: requestId,
    field: 'status',
    oldValue: old,
    newValue: req.status,
    reasonForChange: `Supervisor approved ${requestId}`,
    meaningOfSignature: esign.meaningOfSignature,
  });
  return req;
}

export async function approveRequestQa(
  session: Session,
  requestId: string,
  esign: ESign,
): Promise<MaterialRequest> {
  await assertCapability(session, 'qaDisposition', 'QA disposition capability required');
  assertEsign(session, esign, 'QA');
  const req = await getRequest(requestId);
  if (!req) throw new Error('Request not found');
  if (req.status !== 'Pending QA') {
    throw new Error(`Cannot QA-approve a ${req.status} transfer`);
  }
  assertNotSelfApprove(session, req.requestedBy, 'QA-approve');
  const old = req.status;
  req.qaEsign = esign;
  req.status = 'Approved';
  await applyFefoReserve(session, req);
  await notifyCapability(
    'fulfillRequest',
    `Material transfer ${requestId} approved`,
    `${req.materialCode} ${req.qtyRequested} ${req.uom} → ${req.destination}. Ready to pick.`,
    'request_issued',
    requestId,
    session.userId,
  );
  const db = await getDb();
  await db.put('materialRequests', req);
  await appendAudit(session, {
    action: 'REQUEST_QA_APPROVE',
    recordId: requestId,
    field: 'status',
    oldValue: old,
    newValue: 'Approved',
    reasonForChange: `QA approved ${requestId}`,
    meaningOfSignature: esign.meaningOfSignature,
  });
  return req;
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
  return proposeFefo(
    inventory,
    req.materialCode,
    req.qtyRequested - req.qtyIssued,
    asOf,
    req.requestId,
    allowedStatusesFor(req),
  );
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
  if (!WAREHOUSE_PICK_STATUSES.includes(req.status)) {
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
  const allowQuarantine = Boolean(req.cellBankOrQuarantine && req.qaEsign);
  const block = isIssueBlocked(rec, asOf, requestId, { allowQuarantine });
  if (block.blocked) throw new Error(block.reason);
  const already = req.pickedSerials.find((p) => p.serial === serial)?.qty ?? 0;
  if (qty + already > rec.currentQty) throw new Error('Pick quantity exceeds remaining container quantity');
  const remainingNeed = req.qtyRequested - req.qtyIssued - req.pickedSerials.reduce((s, p) => s + p.qty, 0);
  if (qty > remainingNeed && remainingNeed > 0) {
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
  if (!['Approved', 'Picking'].includes(req.status)) {
    throw new Error('Cannot unpick after issue confirmation');
  }
  const oldQty = req.pickedSerials.find((p) => p.serial === serial)?.qty ?? 0;
  req.pickedSerials = req.pickedSerials.filter((p) => p.serial !== serial);
  if (!req.pickedSerials.length) req.status = 'Approved';
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

function uniqueJoin(values: string[]): string {
  return [...new Set(values.filter(Boolean))].join(', ');
}

export async function confirmFulfillment(
  session: Session,
  requestId: string,
  fefoOverrideReason: string,
  mmEsign: ESign,
  mm?: { comments?: string; commentsNa?: boolean },
): Promise<MaterialRequest> {
  await assertCapability(session, 'fulfillRequest', 'Role cannot fulfill material requests');
  assertEsign(session, mmEsign, 'Materials Management');
  const hasComments = Boolean(mm?.comments?.trim());
  const na = Boolean(mm?.commentsNa);
  if (hasComments === na) {
    throw new Error('Materials Management comments or N/A is required (not both)');
  }
  const req = await getRequest(requestId);
  if (!req) throw new Error('Request not found');
  if (!req.pickedSerials.length) throw new Error('No serials picked');
  const asOf = todayIsoDateInTz();
  const all = await listInventory();
  const allowQuarantine = Boolean(req.cellBankOrQuarantine && req.qaEsign);
  const pickedRecs = req.pickedSerials
    .map((line) => all.find((r) => r.serial === line.serial))
    .filter((r): r is NonNullable<typeof r> => Boolean(r));
  req.sourceLot = uniqueJoin(pickedRecs.map((r) => r.internalLot || r.manufacturerLot));
  req.sourceExpiry = uniqueJoin(pickedRecs.map((r) => r.expiryDate));
  req.sourceLocation = uniqueJoin(pickedRecs.map((r) => locationToString(r.location)));
  req.mmComments = hasComments ? mm!.comments!.trim() : '';
  req.mmCommentsNa = na;
  req.mmEsign = mmEsign;
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
      { allowQuarantine },
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
    meaningOfSignature: mmEsign.meaningOfSignature,
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

export async function confirmReceived(
  session: Session,
  requestId: string,
  esign: ESign,
  qtyReceived: number,
): Promise<MaterialRequest> {
  await assertCapability(session, 'confirmRequestReceipt', 'Role cannot confirm request receipt');
  assertEsign(session, esign, 'Receiver');
  if (!(qtyReceived >= 0) || Number.isNaN(qtyReceived)) {
    throw new Error('Quantity received is required and must be ≥ 0');
  }
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
  req.qtyReceived = qtyReceived;
  req.receiverEsign = esign;
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
    reasonForChange: `Requester confirmed received qty ${qtyReceived} ${req.uom} (chain of custody)`,
    meaningOfSignature: esign.meaningOfSignature,
  });
  return req;
}

export async function cancelRequest(session: Session, requestId: string, reason: string): Promise<MaterialRequest> {
  await assertCapability(session, 'cancelRequest', 'Role cannot cancel requests');
  if (!reason.trim()) throw new Error('Cancel reason is required');
  const req = await getRequest(requestId);
  if (!req) throw new Error('Request not found');
  if (!CANCELABLE_STATUSES.includes(req.status)) throw new Error('Only pending-approval transfers may be cancelled');
  if (req.requestedBy !== session.userId && session.role !== 'supervisor') {
    throw new Error('Only the requester (or a supervisor) may cancel');
  }
  const old = req.status;
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
    oldValue: old,
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
  const rejectable: RequestStatus[] = [
    'Submitted',
    'Pending Supervisor',
    'Pending QA',
    'Approved',
    'Picking',
    'Partially Issued',
  ];
  if (!rejectable.includes(req.status)) {
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
