import { CAPABILITIES, SYSTEM_ROLE_IDS, type Capability } from '../types';
import { addAttachment } from './attachments';
import { unlockUser, updateUser } from './auth';
import { exportBackup } from './backup';
import {
  cycleCount,
  destroyContainer,
  issueDispense,
  qaDisposition,
  receiveGoods,
  reprintLabel,
  returnToStock,
  samplePull,
  setHold,
  transferLocation,
} from './inventory';
import { saveMaterial } from './materials';
import type { ExtraCtx } from './oqExtra';
import { clearAllReservations, dump, esignOf, mtfInput, probeRoles, roleSess, tinyPngFile, xferLoc } from './oqSuite';
import { assertCapability, defaultAllows, defaultMatrixRows, hasCapability } from './permissions';
import {
  approveRequestSupervisor,
  cancelRequest,
  confirmFulfillment,
  confirmReceived,
  pickSerialForRequest,
  rejectRequest,
  submitRequest,
} from './requests';
import { approveMaterialSubmission, rejectMaterialSubmission, submitMaterial } from './submissions';
import { NAV_ITEMS } from './traceMatrix';

export const RBAC_OQ_IDS = [
  'RBAC-MATRIX',
  'RBAC-NAV',
  'RBAC-VIEW',
  'RBAC-RECEIVE',
  'RBAC-TRANSFER',
  'RBAC-ISSUE',
  'RBAC-RETURN',
  'RBAC-COUNT',
  'RBAC-HOLD',
  'RBAC-QA',
  'RBAC-DESTROY',
  'RBAC-SAMPLE',
  'RBAC-MATERIAL',
  'RBAC-SUBMIT-MAT',
  'RBAC-APPROVE-MAT',
  'RBAC-REJECT-MAT',
  'RBAC-MTF-SUBMIT',
  'RBAC-MTF-APPROVE',
  'RBAC-MTF-FULFILL',
  'RBAC-MTF-CONFIRM',
  'RBAC-MTF-CANCEL',
  'RBAC-MTF-REJECT',
  'RBAC-ATTACH',
  'RBAC-BACKUP',
  'RBAC-VAL',
  'RBAC-UNLOCK',
  'RBAC-RESET',
  'RBAC-REPRINT',
] as const;

export async function runRbacCases(ctx: ExtraCtx): Promise<void> {
  const { results, onResult, oq, threw, receiveInput, op, qa, lab, sup } = ctx;

  await oq(results, 'RBAC-MATRIX', 'URS-16', 'defaultAllows matches defaultMatrixRows for every role × cap', 'Dump mismatches.', async () => {
    const rows = defaultMatrixRows();
    const mismatches: string[] = [];
    for (const role of SYSTEM_ROLE_IDS) {
      for (const cap of CAPABILITIES) {
        const a = defaultAllows(role, cap);
        const b = Boolean(rows[role]?.[cap]);
        if (a !== b) mismatches.push(`${role}.${cap} allows=${a} row=${b}`);
      }
    }
    return dump(mismatches);
  }, onResult);

  await oq(results, 'RBAC-NAV', 'URS-16', 'Visible nav caps per role from defaultAllows', 'Proof table of role → visible NAV tos.', async () => {
    const lines: string[] = [];
    for (const role of SYSTEM_ROLE_IDS) {
      const vis = NAV_ITEMS.filter((item) => {
        if (item.to === '/access') return defaultAllows(role, 'adminUsers') || defaultAllows(role, 'editPermissionMatrix');
        if (item.to === '/requests') {
          return (
            defaultAllows(role, 'submitRequest') ||
            defaultAllows(role, 'fulfillRequest') ||
            defaultAllows(role, 'approveRequest') ||
            defaultAllows(role, 'qaDisposition')
          );
        }
        return defaultAllows(role, item.cap as Capability);
      }).map((i) => i.to);
      lines.push(`${role}:${vis.join(',')}`);
    }
    const ro = NAV_ITEMS.filter((i) => i.to === '/receive' && defaultAllows('readonly', 'receive'));
    return { actual: lines.join(' || '), pass: ro.length === 0 && defaultAllows('validation', 'runValidation') };
  }, onResult);

  await oq(results, 'RBAC-VIEW', 'URS-16', 'viewRegister / viewAudit / scanLookup per role', 'hasCapability and assertCapability follow defaultAllows.', async () => {
    const mismatches: string[] = [];
    for (const cap of ['viewRegister', 'viewAudit', 'scanLookup'] as Capability[]) {
      for (const role of SYSTEM_ROLE_IDS) {
        const s = roleSess(role);
        const allowed = defaultAllows(role, cap);
        const has = await hasCapability(s, cap);
        if (has !== allowed) mismatches.push(`${role}.${cap} has=${has} allows=${allowed}`);
        const r = await threw(() => assertCapability(s, cap));
        if (allowed && r.ok) mismatches.push(`${role}.${cap} assert threw`);
        if (!allowed && !r.ok) mismatches.push(`${role}.${cap} assert succeeded`);
      }
    }
    return dump(mismatches);
  }, onResult);

  await oq(results, 'RBAC-RECEIVE', 'URS-02', 'receiveGoods every role vs defaultAllows(receive)', 'Readonly/validation/sysadmin/qa throw; operator/supervisor/super succeed.', async () => {
    return probeRoles(threw, 'receive', (s) => receiveGoods(s, receiveInput({ comments: `RBAC-RECEIVE ${s.role}` })));
  }, onResult);

  const recs = await receiveGoods(op, receiveInput({ comments: 'RBAC-stock', qtyPerContainer: 5, numberOfContainers: 2 }));
  await qaDisposition(qa, recs[0].serial, 'Release', esignOf(qa, 'QA'), 'RBAC stock');
  const released = recs[0].serial;
  const other = recs[1].serial;

  await oq(results, 'RBAC-TRANSFER', 'URS-11', 'transferLocation every role', 'Denied roles throw; allowed succeed.', async () => {
    return probeRoles(threw, 'transfer', (s) => transferLocation(s, released, xferLoc(), `RBAC-TRANSFER ${s.role}`));
  }, onResult);

  await oq(results, 'RBAC-ISSUE', 'URS-05', 'issueDispense every role', 'Denied throw; allowed issue qty 0.01 (keep stock).', async () => {
    return probeRoles(threw, 'issue', (s) => issueDispense(s, released, 0.01, 'LVM', `RBAC-ISSUE ${s.role}`, 'OQ FEFO override'));
  }, onResult);

  await oq(results, 'RBAC-RETURN', 'URS-03', 'returnToStock every role', 'Denied throw; allowed return 0.01.', async () => {
    return probeRoles(threw, 'returnToStock', (s) => returnToStock(s, released, 0.01, `RBAC-RETURN ${s.role}`));
  }, onResult);

  await oq(results, 'RBAC-COUNT', 'URS-20', 'cycleCount every role', 'Denied throw; allowed count current qty.', async () => {
    return probeRoles(threw, 'cycleCount', async (s) => {
      const { getInventory } = await import('./inventory');
      const rec = await getInventory(released);
      return cycleCount(s, released, rec?.currentQty ?? 1, `RBAC-COUNT ${s.role}`);
    });
  }, onResult);

  await oq(results, 'RBAC-HOLD', 'URS-02', 'setHold every role', 'Denied throw; allowed place then remove hold.', async () => {
    const r = await probeRoles(threw, 'hold', (s) => setHold(s, other, true, `RBAC-HOLD ${s.role}`));
    if (r.pass) {
      const rec = await import('./inventory').then((m) => m.getInventory(other));
      if (rec && rec.status === 'Hold') await setHold(qa, other, false, 'RBAC-HOLD unhold');
    }
    return r;
  }, onResult);

  await oq(results, 'RBAC-QA', 'URS-02', 'qaDisposition every role', 'Sysadmin/operator throw; qa/super succeed on dedicated receipts.', async () => {
    const mismatches: string[] = [];
    for (const role of SYSTEM_ROLE_IDS) {
      const allowed = defaultAllows(role, 'qaDisposition');
      const s = roleSess(role);
      const batch = await receiveGoods(op, receiveInput({ comments: `RBAC-QA ${role}` }));
      const r = await threw(() => qaDisposition(s, batch[0].serial, 'Release', esignOf(s, 'QA'), 'RBAC-QA'));
      if (allowed && r.ok) mismatches.push(`${role}: allowed but threw: ${r.message}`);
      if (!allowed && !r.ok) mismatches.push(`${role}: denied but succeeded`);
    }
    return dump(mismatches);
  }, onResult);

  await oq(results, 'RBAC-DESTROY', 'URS-03', 'destroyContainer every role', 'Operator throws; qa/super succeed on dedicated receipts.', async () => {
    const mismatches: string[] = [];
    for (const role of SYSTEM_ROLE_IDS) {
      const allowed = defaultAllows(role, 'destroy');
      const s = roleSess(role);
      const batch = await receiveGoods(op, receiveInput({ comments: `RBAC-DESTROY ${role}` }));
      const r = await threw(() => destroyContainer(s, batch[0].serial, `RBAC-DESTROY ${role}`, esignOf(s, 'destroy')));
      if (allowed && r.ok) mismatches.push(`${role}: allowed but threw: ${r.message}`);
      if (!allowed && !r.ok) mismatches.push(`${role}: denied but succeeded`);
    }
    return dump(mismatches);
  }, onResult);

  await oq(results, 'RBAC-SAMPLE', 'URS-25', 'samplePull every role', 'Denied throw; qa/qc/super succeed.', async () => {
    const mismatches: string[] = [];
    for (const role of SYSTEM_ROLE_IDS) {
      const allowed = defaultAllows(role, 'samplePull');
      const s = roleSess(role);
      const batch = await receiveGoods(op, receiveInput({ qtyPerContainer: 2, comments: `RBAC-SAMPLE ${role}` }));
      const r = await threw(() => samplePull(s, batch[0].serial, 0.1, 'sample', 'RBAC-SAMPLE'));
      if (allowed && r.ok) mismatches.push(`${role}: allowed but threw: ${r.message}`);
      if (!allowed && !r.ok) mismatches.push(`${role}: denied but succeeded`);
    }
    return dump(mismatches);
  }, onResult);

  await oq(results, 'RBAC-MATERIAL', 'URS-19', 'saveMaterial every role', 'Denied throw; supervisor/qa/super succeed new codes.', async () => {
    const mismatches: string[] = [];
    let n = 0;
    for (const role of SYSTEM_ROLE_IDS) {
      const allowed = defaultAllows(role, 'adminMaterials');
      const s = roleSess(role);
      n += 1;
      const code = `OQ-RBAC-M${n}`;
      const r = await threw(() =>
        saveMaterial(
          s,
          {
            materialCode: code,
            materialName: `RBAC ${role}`,
            itemType: 'Excipient',
            gradeSpec: 'NF',
            pharmacopeia: 'USP',
            defaultUom: 'kg',
            defaultStorage: 'CRT 15–25 °C',
            samplingRequiredDefault: false,
            active: true,
            createdBy: s.userId,
            createdOnUtc: '2026-08-24T00:00:00.000Z',
            modifiedBy: s.userId,
            modifiedOnUtc: '2026-08-24T00:00:00.000Z',
          },
          true,
          'RBAC-MATERIAL',
        ),
      );
      if (allowed && r.ok) mismatches.push(`${role}: allowed but threw: ${r.message}`);
      if (!allowed && !r.ok) mismatches.push(`${role}: denied but succeeded`);
    }
    return dump(mismatches);
  }, onResult);

  await oq(results, 'RBAC-SUBMIT-MAT', 'URS-23', 'submitMaterial every role', 'Denied throw; allowed succeed.', async () => {
    let n = 0;
    const mismatches: string[] = [];
    for (const role of SYSTEM_ROLE_IDS) {
      const allowed = defaultAllows(role, 'submitMaterial');
      const s = roleSess(role);
      n += 1;
      const r = await threw(() =>
        submitMaterial(s, {
          materialName: `RBAC sub ${n}`,
          itemType: 'Excipient',
          gradeSpec: 'NF',
          pharmacopeia: 'USP',
          defaultUom: 'kg',
          defaultStorage: 'CRT 15–25 °C',
          samplingRequiredDefault: false,
          manufacturerHint: '',
          supplierHint: '',
          justification: 'OQ RBAC',
        }),
      );
      if (allowed && r.ok) mismatches.push(`${role}: allowed but threw: ${r.message}`);
      if (!allowed && !r.ok) mismatches.push(`${role}: denied but succeeded`);
    }
    return dump(mismatches);
  }, onResult);

  await oq(results, 'RBAC-APPROVE-MAT', 'URS-23', 'approveMaterialSubmission every role', 'Denied throw; allowed approve dedicated submissions.', async () => {
    const mismatches: string[] = [];
    let n = 0;
    for (const role of SYSTEM_ROLE_IDS) {
      const allowed = defaultAllows(role, 'approveMaterial');
      const s = roleSess(role);
      n += 1;
      const sub = await submitMaterial(lab, {
        materialName: `RBAC appr ${n}`,
        itemType: 'Excipient',
        gradeSpec: 'NF',
        pharmacopeia: 'USP',
        defaultUom: 'kg',
        defaultStorage: 'CRT 15–25 °C',
        samplingRequiredDefault: false,
        manufacturerHint: '',
        supplierHint: '',
        justification: 'OQ',
      });
      const r = await threw(() => approveMaterialSubmission(s, sub.submissionId, `OQ-APPR-${n}`, 'RBAC'));
      if (allowed && r.ok) mismatches.push(`${role}: allowed but threw: ${r.message}`);
      if (!allowed && !r.ok) mismatches.push(`${role}: denied but succeeded`);
    }
    return dump(mismatches);
  }, onResult);

  await oq(results, 'RBAC-REJECT-MAT', 'URS-23', 'rejectMaterialSubmission every role', 'Denied throw; allowed reject dedicated submissions.', async () => {
    const mismatches: string[] = [];
    for (const role of SYSTEM_ROLE_IDS) {
      const allowed = defaultAllows(role, 'rejectMaterial');
      const s = roleSess(role);
      const sub = await submitMaterial(lab, {
        materialName: `RBAC rej ${role}`,
        itemType: 'Excipient',
        gradeSpec: 'NF',
        pharmacopeia: 'USP',
        defaultUom: 'kg',
        defaultStorage: 'CRT 15–25 °C',
        samplingRequiredDefault: false,
        manufacturerHint: '',
        supplierHint: '',
        justification: 'OQ',
      });
      const r = await threw(() => rejectMaterialSubmission(s, sub.submissionId, 'RBAC reject'));
      if (allowed && r.ok) mismatches.push(`${role}: allowed but threw: ${r.message}`);
      if (!allowed && !r.ok) mismatches.push(`${role}: denied but succeeded`);
    }
    return dump(mismatches);
  }, onResult);

  await oq(results, 'RBAC-MTF-SUBMIT', 'URS-22', 'submitRequest every role', 'Denied throw; allowed submit.', async () => {
    return probeRoles(threw, 'submitRequest', (s) => submitRequest(s, mtfInput(s)));
  }, onResult);

  await oq(results, 'RBAC-MTF-APPROVE', 'URS-29', 'approveRequestSupervisor every role', 'Requestor SoD: lab submits; each role tries supervisor approve.', async () => {
    const mismatches: string[] = [];
    for (const role of SYSTEM_ROLE_IDS) {
      const allowed = defaultAllows(role, 'approveRequest');
      const s = roleSess(role);
      const req = await submitRequest(lab, mtfInput(lab, { intendedUse: `RBAC-APPR ${role}` }));
      const r = await threw(() => approveRequestSupervisor(s, req.requestId, esignOf(s, 'sup')));
      if (allowed && r.ok) mismatches.push(`${role}: allowed but threw: ${r.message}`);
      if (!allowed && !r.ok) mismatches.push(`${role}: denied but succeeded`);
      if (!r.ok) await clearAllReservations(sup);
    }
    return dump(mismatches);
  }, onResult);

  await oq(results, 'RBAC-MTF-FULFILL', 'URS-22', 'pickSerialForRequest every role', 'Denied throw; allowed pick 0.01 from reserved serial.', async () => {
    await clearAllReservations(sup);
    const stock = await receiveGoods(op, receiveInput({ qtyPerContainer: 5, comments: 'RBAC-FULFILL' }));
    await qaDisposition(qa, stock[0].serial, 'Release', esignOf(qa, 'QA'), 'x');
    const req = await submitRequest(lab, mtfInput(lab, { qtyRequested: 1, intendedUse: 'RBAC-FULFILL' }));
    await approveRequestSupervisor(sup, req.requestId, esignOf(sup, 'sup'));
    const mismatches: string[] = [];
    for (const role of SYSTEM_ROLE_IDS) {
      const allowed = defaultAllows(role, 'fulfillRequest');
      const s = roleSess(role);
      const r = await threw(() => pickSerialForRequest(s, req.requestId, stock[0].serial, 0.01));
      if (allowed && r.ok) mismatches.push(`${role}: allowed but threw: ${r.message}`);
      if (!allowed && !r.ok) mismatches.push(`${role}: denied but succeeded`);
    }
    return dump(mismatches);
  }, onResult);

  await oq(results, 'RBAC-MTF-CONFIRM', 'URS-22', 'confirmReceived every role vs confirmRequestReceipt', 'Denied throw; requester/supervisor/super succeed after issue.', async () => {
    await clearAllReservations(sup);
    const stock = await receiveGoods(op, receiveInput({ qtyPerContainer: 2, comments: 'RBAC-CONFIRM' }));
    await qaDisposition(qa, stock[0].serial, 'Release', esignOf(qa, 'QA'), 'x');
    const mismatches: string[] = [];
    for (const role of SYSTEM_ROLE_IDS) {
      const allowed = defaultAllows(role, 'confirmRequestReceipt');
      const s = roleSess(role);
      const req = await submitRequest(lab, mtfInput(lab, { qtyRequested: 0.1, intendedUse: `CONF ${role}` }));
      await approveRequestSupervisor(sup, req.requestId, esignOf(sup, 'sup'));
      await pickSerialForRequest(op, req.requestId, stock[0].serial, 0.1);
      await confirmFulfillment(op, req.requestId, 'OQ FEFO override', esignOf(op, 'MM'), { commentsNa: true });
      const r = await threw(() => confirmReceived(s, req.requestId, esignOf(s, 'recv'), 0.1));
      // requester must be lab unless supervisor; extra SoD: only requester or supervisor
      const chainOk = s.userId === 'lab' || s.role === 'supervisor';
      if (allowed && chainOk && r.ok) mismatches.push(`${role}: allowed/chain but threw: ${r.message}`);
      if (allowed && !chainOk && !r.ok) mismatches.push(`${role}: cap ok but chain should throw`);
      if (!allowed && !r.ok) mismatches.push(`${role}: denied but succeeded`);
    }
    return dump(mismatches);
  }, onResult);

  await oq(results, 'RBAC-MTF-CANCEL', 'URS-22', 'cancelRequest every role', 'Denied throw; requester/supervisor/super cancel pending.', async () => {
    const mismatches: string[] = [];
    for (const role of SYSTEM_ROLE_IDS) {
      const allowed = defaultAllows(role, 'cancelRequest');
      const s = roleSess(role);
      const req = await submitRequest(lab, mtfInput(lab, { intendedUse: `CAN ${role}` }));
      const r = await threw(() => cancelRequest(s, req.requestId, 'RBAC cancel'));
      const chainOk = s.userId === 'lab' || s.role === 'supervisor';
      if (allowed && chainOk && r.ok) mismatches.push(`${role}: allowed/chain but threw: ${r.message}`);
      if (allowed && !chainOk && !r.ok) mismatches.push(`${role}: cap ok but chain should throw`);
      if (!allowed && !r.ok) mismatches.push(`${role}: denied but succeeded`);
    }
    return dump(mismatches);
  }, onResult);

  await oq(results, 'RBAC-MTF-REJECT', 'URS-22', 'rejectRequest every role', 'Denied throw; allowed reject pending.', async () => {
    const mismatches: string[] = [];
    for (const role of SYSTEM_ROLE_IDS) {
      const allowed = defaultAllows(role, 'rejectRequest');
      const s = roleSess(role);
      const req = await submitRequest(lab, mtfInput(lab, { intendedUse: `REJ ${role}` }));
      const r = await threw(() => rejectRequest(s, req.requestId, 'RBAC reject'));
      if (allowed && r.ok) mismatches.push(`${role}: allowed but threw: ${r.message}`);
      if (!allowed && !r.ok) mismatches.push(`${role}: denied but succeeded`);
    }
    return dump(mismatches);
  }, onResult);

  await oq(results, 'RBAC-ATTACH', 'URS-28', 'addAttachment receive OR qaDisposition', 'Readonly/validation throw; operator/qa/super succeed.', async () => {
    const batch = await receiveGoods(op, receiveInput({ comments: 'RBAC-ATTACH' }));
    const mismatches: string[] = [];
    for (const role of SYSTEM_ROLE_IDS) {
      const allowed = defaultAllows(role, 'receive') || defaultAllows(role, 'qaDisposition');
      const s = roleSess(role);
      const r = await threw(() =>
        addAttachment(s, { scope: 'serial', recordId: batch[0].serial, file: tinyPngFile(`a-${role}.png`), category: 'CoA' }),
      );
      if (allowed && r.ok) mismatches.push(`${role}: allowed but threw: ${r.message}`);
      if (!allowed && !r.ok) mismatches.push(`${role}: denied but succeeded`);
    }
    return dump(mismatches);
  }, onResult);

  await oq(results, 'RBAC-BACKUP', 'URS-15', 'exportBackup every role', 'Denied throw; allowed export.', async () => {
    return probeRoles(threw, 'backupRestore', (s) => exportBackup(s));
  }, onResult);

  await oq(results, 'RBAC-VAL', 'URS-30', 'assertCapability runValidation every role', 'Do not recurse into runSelfValidation. Operator throws; validation/sysadmin/super succeed.', async () => {
    return probeRoles(threw, 'runValidation', (s) => assertCapability(s, 'runValidation', 'Capability required: runValidation'));
  }, onResult);

  await oq(results, 'RBAC-UNLOCK', 'URS-07', 'unlockUser every role', 'Denied throw; allowed unlock ro.', async () => {
    return probeRoles(threw, 'unlockUser', (s) => unlockUser(s, 'ro', `RBAC-UNLOCK ${s.role}`));
  }, onResult);

  await oq(results, 'RBAC-RESET', 'URS-07', 'reset password via updateUser every role', 'Denied throw; allowed reset qc password (policy-compliant).', async () => {
    return probeRoles(threw, 'resetUserPassword', (s) =>
      updateUser(s, 'qc', { newPassword: `Reset${s.role}123!xx` }, `RBAC-RESET ${s.role}`),
    );
  }, onResult);

  await oq(results, 'RBAC-REPRINT', 'URS-14', 'reprintLabel every role', 'Denied throw; allowed reprint released serial.', async () => {
    return probeRoles(threw, 'reprintLabel', (s) => reprintLabel(s, released));
  }, onResult);
}
