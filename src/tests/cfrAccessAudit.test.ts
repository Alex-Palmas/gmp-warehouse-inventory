import { beforeEach, describe, expect, it } from 'vitest';
import * as audit from '../lib/audit';
import { AUDIT_MUTATION_API, listAudit } from '../lib/audit';
import { changeOwnPassword, logout } from '../lib/auth';
import { hashPassword, randomSalt } from '../lib/crypto';
import { resetDbConnection, getDb } from '../lib/db';
import { emptyLocation } from '../components/fields';
import { receiveGoods } from '../lib/inventory';
import { defaultAllows, buildDefaultMatrixDocument, setMatrixCacheForTests } from '../lib/permissions';
import { submitRequest } from '../lib/requests';
import { approveMaterialSubmission, submitMaterial } from '../lib/submissions';
import type { Material, Session, UserRecord } from '../types';

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

describe('21 CFR 11.10(d)(g) access', () => {
  it('operator cannot qaDisposition', () => {
    expect(defaultAllows('operator', 'qaDisposition')).toBe(false);
    expect(defaultAllows('qa', 'qaDisposition')).toBe(true);
  });

  it('approveMaterial is required to approve a submission', async () => {
    await resetTestDb();
    const op = sess('operator', 'wh');
    const rec = await submitMaterial(op, {
      materialName: 'Test API',
      itemType: 'API',
      gradeSpec: 'USP',
      pharmacopeia: 'USP',
      defaultUom: 'kg',
      defaultStorage: 'CRT 15–25 °C',
      samplingRequiredDefault: false,
      manufacturerHint: '',
      supplierHint: '',
      justification: 'OQ material',
    });
    await expect(approveMaterialSubmission(op, rec.submissionId, 'TST-001', 'should fail')).rejects.toThrow(
      /Approve material capability required/,
    );
    const qa = sess('qa');
    const { submission, material } = await approveMaterialSubmission(qa, rec.submissionId, 'TST-001', 'CoA review');
    expect(submission.status).toBe('Approved');
    expect(material.materialCode).toBe('TST-001');
  });
});

describe('21 CFR 11.10(e) audit on mutations', () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  it('receive, request submit, and password change each append audit rows', async () => {
    const beforeReceive = (await listAudit()).length;
    const recs = await receiveGoods(sess('operator', 'wh'), {
      materialCode: 'API-001',
      materialName: 'Ibuprofen',
      itemType: 'API',
      gradeSpec: 'USP',
      pharmacopeia: 'USP',
      manufacturer: 'Demo',
      manufacturerLot: 'L1',
      supplier: 'Sup',
      supplierLot: 'S1',
      poDeliveryNote: 'PO-1',
      coaNumber: 'COA-1',
      internalLot: 'IL-1',
      numberOfContainers: 1,
      containerType: 'Vial',
      qtyPerContainer: 1,
      uom: 'vial',
      dateOfManufacture: '2026-01-01',
      receiptDate: '2026-08-01',
      expiryDate: '2028-01-01',
      retestDate: '',
      location: emptyLocation(),
      storageCondition: 'CRT 15–25 °C',
      samplingRequired: false,
      linkedSampleIds: '',
      comments: 'cfr test',
    });
    const afterReceive = await listAudit();
    expect(afterReceive.length).toBeGreaterThan(beforeReceive);
    expect(afterReceive.some((a) => a.action === 'RECEIVE' && a.recordId === recs[0].serial)).toBe(true);

    await putMaterial();
    const beforeReq = (await listAudit()).length;
    const lab = sess('requester', 'lab');
    const req = await submitRequest(lab, {
      materialCode: 'API-001',
      qtyRequested: 1,
      uom: 'vial',
      neededBy: '2026-09-01',
      toLocation: 'Warehouse',
      classification: ['GMP'],
      intendedUse: 'OQ request',
      priority: 'Routine',
      requestorEsign: {
        userId: lab.userId,
        printedName: lab.fullName,
        signedAtUtc: '2026-08-24T12:00:00.000Z',
        meaningOfSignature: 'I request this material transfer.',
      },
    });
    const afterReq = await listAudit();
    expect(afterReq.length).toBeGreaterThan(beforeReq);
    expect(afterReq.some((a) => a.action === 'REQUEST_SUBMIT' && a.recordId === req.requestId)).toBe(true);

    const salt = randomSalt();
    const password = 'OldPassword1!';
    const user: UserRecord = {
      userId: 'wh',
      fullName: 'Sam Operator',
      role: 'operator',
      salt,
      passwordHash: await hashPassword(password, salt),
      algorithm: 'pbkdf2-sha256',
      active: true,
      mustChangePassword: false,
      createdOnUtc: '2026-01-01T00:00:00.000Z',
      failedAttempts: 0,
      passwordHistory: [],
    };
    const db = await getDb();
    await db.put('users', user);
    const beforePw = (await listAudit()).length;
    await changeOwnPassword(sess('operator', 'wh'), password, 'NewPassword1!');
    const afterPw = await listAudit();
    expect(afterPw.length).toBeGreaterThan(beforePw);
    expect(afterPw.some((a) => a.action === 'PASSWORD_CHANGE' && a.recordId === 'wh')).toBe(true);
  });

  it('listAudit still has no update/delete API', () => {
    const keys = Object.keys(audit);
    expect(typeof audit.appendAudit).toBe('function');
    expect(typeof audit.listAudit).toBe('function');
    expect(keys).not.toContain('updateAudit');
    expect(keys).not.toContain('deleteAudit');
    expect(keys.filter((k) => /update|delete|remove|clear/i.test(k))).toEqual([]);
    expect(AUDIT_MUTATION_API.updateAudit).toBe(false);
    expect(AUDIT_MUTATION_API.deleteAudit).toBe(false);
    expect(AUDIT_MUTATION_API.appendAudit).toBe(true);
  });

  it('receiveGoods as operator wh writes RECEIVE with role and userId', async () => {
    const recs = await receiveGoods(sess('operator', 'wh'), {
      materialCode: 'API-001',
      materialName: 'Ibuprofen',
      itemType: 'API',
      gradeSpec: 'USP',
      pharmacopeia: 'USP',
      manufacturer: 'Demo',
      manufacturerLot: 'L1',
      supplier: 'Sup',
      supplierLot: 'S1',
      poDeliveryNote: 'PO-1',
      coaNumber: 'COA-1',
      internalLot: 'IL-1',
      numberOfContainers: 1,
      containerType: 'Vial',
      qtyPerContainer: 1,
      uom: 'vial',
      dateOfManufacture: '2026-01-01',
      receiptDate: '2026-08-01',
      expiryDate: '2028-01-01',
      retestDate: '',
      location: emptyLocation(),
      storageCondition: 'CRT 15–25 °C',
      samplingRequired: false,
      linkedSampleIds: '',
      comments: 'role audit',
    });
    const rows = await listAudit();
    const rec = rows.find((a) => a.action === 'RECEIVE' && a.recordId === recs[0].serial);
    expect(rec).toBeTruthy();
    expect(rec!.role).toBe('operator');
    expect(rec!.userId).toBe('wh');
  });

  it('logout SESSION_TIMEOUT writes SESSION_TIMEOUT; default still writes LOGOUT', async () => {
    await logout(sess('operator', 'wh'), 'SESSION_TIMEOUT');
    let rows = await listAudit();
    expect(rows.some((a) => a.action === 'SESSION_TIMEOUT' && a.userId === 'wh' && a.role === 'operator')).toBe(true);
    await logout(sess('operator', 'wh'));
    rows = await listAudit();
    expect(rows.some((a) => a.action === 'LOGOUT' && a.userId === 'wh' && a.role === 'operator')).toBe(true);
    expect(rows.filter((a) => a.action === 'SESSION_TIMEOUT').length).toBe(1);
  });
});
