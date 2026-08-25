import ExcelJS from 'exceljs';
import {
  APP_VERSION,
  CAPABILITIES,
  CAPABILITY_LABELS,
  DOC_ID,
  DOC_VERSION,
  VALIDATION_BANNER,
  type Session,
} from '../types';
import { listInventory, listMovements } from './inventory';
import { listMaterials } from './materials';
import { listAudit } from './audit';
import { isAccountLocked, listAccessLog, listUsers } from './auth';
import { nowUtcIso, toDisplayLocal, locationToString } from './dates';
import { assertCapability, getLiveMatrix, listRoles } from './permissions';
import { listRequests } from './requests';
import { listSubmissions } from './submissions';

function footer(ws: ExcelJS.Worksheet, exportedBy: string, n: number): void {
  const r = n + 2;
  ws.getCell(r, 1).value = `${DOC_ID} v${DOC_VERSION} | ${VALIDATION_BANNER}`;
  ws.getCell(r + 1, 1).value =
    `Exported by ${exportedBy} | ${nowUtcIso()} | App ${APP_VERSION} | REPORT — not the system of record`;
}

function styleHeader(ws: ExcelJS.Worksheet, cols: number): void {
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols } };
  for (let c = 1; c <= cols; c++) {
    const cell = ws.getCell(1, c);
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A365D' } };
  }
}

export async function exportExcelWorkbook(session: Session): Promise<Blob> {
  await assertCapability(session, 'exportReports', 'Export reports capability required');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'GMP Warehouse Inventory';
  wb.created = new Date();

  const inv = await listInventory();
  const mats = await listMaterials();
  const mov = await listMovements();
  const aud = await listAudit();
  const acc = await listAccessLog();

  const invHeaders = [
    'Serial',
    'Receipt Batch',
    'Container Index',
    'Record Kind',
    'Parent Serial',
    'Container Type',
    'Material Code',
    'Material Name',
    'Item Type',
    'Status',
    'Internal Lot',
    'Mfr Lot',
    'Qty Received',
    'Qty Per Container',
    'Current Qty',
    'UOM',
    'Expiry',
    'Receipt Date',
    'Location',
    'Storage',
    'QA Disposition',
    'QA Signed By',
    'QA Signed At',
  ];
  const ws1 = wb.addWorksheet('Inventory Register');
  ws1.addRow(invHeaders);
  for (const r of inv) {
    ws1.addRow([
      r.serial,
      r.receiptBatchId ?? '',
      r.containerIndex ?? '',
      r.recordKind ?? 'container',
      r.parentSerial ?? '',
      r.containerType,
      r.materialCode,
      r.materialName,
      r.itemType,
      r.status,
      r.internalLot,
      r.manufacturerLot,
      r.currentQty === undefined ? '' : r.qtyReceived,
      r.qtyPerContainer ?? '',
      r.currentQty,
      r.uom,
      r.expiryDate,
      r.receiptDate,
      locationToString(r.location),
      r.storageCondition,
      r.qaDisposition ?? '',
      r.qaEsign?.printedName ?? '',
      r.qaEsign ? toDisplayLocal(r.qaEsign.signedAtUtc) : '',
    ]);
  }
  styleHeader(ws1, invHeaders.length);
  footer(ws1, session.userId, inv.length + 1);

  const ws2 = wb.addWorksheet('Material Master');
  const mh = ['Code', 'Name', 'Type', 'Grade/Spec', 'Pharmacopeia', 'UOM', 'Storage', 'Sampling', 'Active'];
  ws2.addRow(mh);
  for (const m of mats) {
    ws2.addRow([
      m.materialCode,
      m.materialName,
      m.itemType,
      m.gradeSpec,
      m.pharmacopeia,
      m.defaultUom,
      m.defaultStorage,
      m.samplingRequiredDefault ? 'Y' : 'N',
      m.active ? 'Y' : 'N',
    ]);
  }
  styleHeader(ws2, mh.length);
  footer(ws2, session.userId, mats.length + 1);

  const ws3 = wb.addWorksheet('Movement Log');
  const mvh = ['ID', 'Serial', 'Action', 'Qty', 'From', 'To', 'By', 'On UTC', 'Reason', 'Comments', 'Request ID'];
  ws3.addRow(mvh);
  for (const m of mov) {
    ws3.addRow([
      m.id,
      m.serial,
      m.action,
      m.qty,
      m.fromLocation,
      m.toLocation,
      m.performedBy,
      m.performedOnUtc,
      m.reason,
      m.comments,
      m.requestId ?? '',
    ]);
  }
  styleHeader(ws3, mvh.length);
  footer(ws3, session.userId, mov.length + 1);

  const ws4 = wb.addWorksheet('Audit Trail');
  const ah = [
    'ID',
    'UTC',
    'Local',
    'User ID',
    'User Name',
    'Action',
    'Record',
    'Field',
    'Old',
    'New',
    'Reason',
    'Meaning of Signature',
  ];
  ws4.addRow(ah);
  for (const a of aud) {
    ws4.addRow([
      a.id,
      a.timestampUtc,
      a.timestampLocal,
      a.userId,
      a.userName,
      a.action,
      a.recordId,
      a.field,
      a.oldValue,
      a.newValue,
      a.reasonForChange,
      a.meaningOfSignature,
    ]);
  }
  styleHeader(ws4, ah.length);
  footer(ws4, session.userId, aud.length + 1);

  const ws5 = wb.addWorksheet('User Access Log');
  const uh = ['ID', 'UTC', 'User ID', 'User Name', 'Event', 'Detail'];
  ws5.addRow(uh);
  for (const a of acc) {
    ws5.addRow([a.id, a.timestampUtc, a.userId, a.userName, a.event, a.detail]);
  }
  styleHeader(ws5, uh.length);
  footer(ws5, session.userId, acc.length + 1);

  const reqs = await listRequests();
  const subs = await listSubmissions();

  const wsReq = wb.addWorksheet('Request Log');
  const reqh = [
    'Request ID',
    'Status',
    'Material',
    'Name',
    'Qty Requested',
    'Qty Issued',
    'UOM',
    'Needed By',
    'Destination',
    'Purpose',
    'Priority',
    'Requested By',
    'Requested On UTC',
    'Fulfilled By',
    'Stock Warning',
  ];
  wsReq.addRow(reqh);
  for (const r of reqs) {
    wsReq.addRow([
      r.requestId,
      r.status,
      r.materialCode,
      r.materialName,
      r.qtyRequested,
      r.qtyIssued,
      r.uom,
      r.neededBy,
      r.destination,
      r.purpose,
      r.priority,
      r.requestedBy,
      r.requestedOnUtc,
      r.fulfilledBy ?? '',
      r.stockWarning ?? '',
    ]);
  }
  styleHeader(wsReq, reqh.length);
  footer(wsReq, session.userId, reqs.length + 1);

  const wsSub = wb.addWorksheet('Material Submissions');
  const subh = [
    'Submission ID',
    'Status',
    'Code',
    'Name',
    'Type',
    'Grade',
    'UOM',
    'Justification',
    'Submitted By',
    'Submitted On UTC',
    'Reviewed By',
    'Reject Reason',
  ];
  wsSub.addRow(subh);
  for (const s of subs) {
    wsSub.addRow([
      s.submissionId,
      s.status,
      s.materialCode,
      s.materialName,
      s.itemType,
      s.gradeSpec,
      s.defaultUom,
      s.justification,
      s.submittedBy,
      s.submittedOnUtc,
      s.reviewedBy ?? '',
      s.rejectReason ?? '',
    ]);
  }
  styleHeader(wsSub, subh.length);
  footer(wsSub, session.userId, subs.length + 1);

  const roles = await listRoles();
  const matrix = await getLiveMatrix();
  const users = await listUsers();

  const ws6 = wb.addWorksheet('Roles');
  const rh = ['Role ID', 'Name', 'Description', 'System', 'Active'];
  ws6.addRow(rh);
  for (const r of roles) {
    ws6.addRow([r.roleId, r.name, r.description, r.system ? 'Y' : 'N', r.active ? 'Y' : 'N']);
  }
  styleHeader(ws6, rh.length);
  footer(ws6, session.userId, roles.length + 1);

  const ws7 = wb.addWorksheet('Permission Matrix');
  const ph = ['Capability', 'Capability ID', ...roles.map((r) => r.name)];
  ws7.addRow(ph);
  for (const cap of CAPABILITIES) {
    ws7.addRow([
      CAPABILITY_LABELS[cap],
      cap,
      ...roles.map((r) => (matrix.rows[r.roleId]?.[cap] ? 'Y' : 'N')),
    ]);
  }
  ws7.addRow([]);
  ws7.addRow([
    `Matrix v${matrix.version}`,
    `Approved by ${matrix.approvedBy}`,
    matrix.approvedOnUtc,
    `SoD receive XOR QA: ${matrix.sod.qaDispositionXorReceive ? 'ON' : 'OFF'}`,
  ]);
  styleHeader(ws7, ph.length);
  footer(ws7, session.userId, CAPABILITIES.length + 1);

  const ws8 = wb.addWorksheet('User Access List');
  const uh2 = [
    'User ID',
    'Full Name',
    'Role ID',
    'Active',
    'Locked',
    'Lock reason',
    'Failed attempts',
    'Last login UTC',
    'Password changed UTC',
    'Must change password',
    'Algorithm',
  ];
  ws8.addRow(uh2);
  for (const u of users) {
    ws8.addRow([
      u.userId,
      u.fullName,
      u.role,
      u.active ? 'Y' : 'N',
      isAccountLocked(u) ? 'Y' : 'N',
      u.lockReason ?? '',
      u.failedAttempts ?? 0,
      u.lastLoginUtc ?? '',
      u.passwordChangedUtc ?? '',
      u.mustChangePassword ? 'Y' : 'N',
      u.algorithm ?? '',
    ]);
  }
  styleHeader(ws8, uh2.length);
  footer(ws8, session.userId, users.length + 1);

  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

export async function exportUserAccessWorkbook(session: Session): Promise<Blob> {
  return exportExcelWorkbook(session);
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
