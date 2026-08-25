import { beforeEach, describe, expect, it } from 'vitest';
import * as attachments from '../lib/attachments';
import {
  addAttachment,
  base64ToBytes,
  bytesToBase64,
  getAttachment,
  hashFile,
  listForSerial,
  MAX_BYTES,
  readBlobBytes,
} from '../lib/attachments';
import { listAudit } from '../lib/audit';
import { exportBackup, importBackup } from '../lib/backup';
import { resetDbConnection, getDb } from '../lib/db';
import { receiveGoods } from '../lib/inventory';
import { emptyLocation } from '../components/fields';
import { buildDefaultMatrixDocument, setMatrixCacheForTests } from '../lib/permissions';
import type { Session } from '../types';

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

function receiveInput() {
  return {
    materialCode: 'API-001',
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
    numberOfContainers: 1,
    containerType: 'Vial' as const,
    qtyPerContainer: 1,
    uom: 'vial' as const,
    dateOfManufacture: '2026-01-01',
    receiptDate: '2026-08-01',
    expiryDate: '2028-01-01',
    retestDate: '',
    location: emptyLocation(),
    storageCondition: 'CRT 15–25 °C' as const,
    samplingRequired: false,
    linkedSampleIds: '',
    comments: 'attach test',
  };
}

describe('attachments', () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  it('rejects files over 10 MB', async () => {
    const recs = await receiveGoods(sess('operator', 'wh'), receiveInput());
    const big = new File([new Uint8Array(MAX_BYTES + 1)], 'huge.pdf', { type: 'application/pdf' });
    await expect(
      addAttachment(sess('operator', 'wh'), {
        scope: 'serial',
        recordId: recs[0].serial,
        file: big,
        category: 'CoA',
      }),
    ).rejects.toThrow(/10 MB/i);
  });

  it('rejects disallowed types', async () => {
    const recs = await receiveGoods(sess('operator', 'wh'), receiveInput());
    const exe = new File([new Uint8Array([0x4d, 0x5a])], 'virus.exe', { type: 'application/x-msdownload' });
    await expect(
      addAttachment(sess('operator', 'wh'), {
        scope: 'serial',
        recordId: recs[0].serial,
        file: exe,
        category: 'Other',
      }),
    ).rejects.toThrow(/disallowed/i);
  });

  it('operator can attach after receive; listForSerial, audit, blob round-trip', async () => {
    const op = sess('operator', 'wh');
    const recs = await receiveGoods(op, receiveInput());
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]); // %PDF-1.4
    const file = new File([bytes], 'lot-coa.pdf', { type: 'application/pdf' });
    const sha = await hashFile(file);
    const att = await addAttachment(op, {
      scope: 'serial',
      recordId: recs[0].serial,
      file,
      category: 'CoA',
    });
    expect(att.id.startsWith('ATT-')).toBe(true);
    expect(att.sha256).toBe(sha);
    const listed = await listForSerial(recs[0]);
    expect(listed.some((a) => a.id === att.id)).toBe(true);
    const got = await getAttachment(att.id);
    expect(got).toBeTruthy();
    const round = await readBlobBytes(got!.blob);
    expect(Array.from(round)).toEqual(Array.from(bytes));
    const audit = await listAudit();
    const row = audit.find((a) => a.action === 'ATTACHMENT_ADD' && a.recordId === recs[0].serial);
    expect(row).toBeTruthy();
    expect(row!.field).toBe('fileName');
    expect(row!.newValue).toBe(`CoA|lot-coa.pdf|${sha.slice(0, 16)}|${bytes.length}`);
    expect(row!.userId).toBe('wh');
  });

  it('readonly and requester cannot add attachments', async () => {
    const recs = await receiveGoods(sess('operator', 'wh'), receiveInput());
    const file = new File([new Uint8Array([1, 2, 3])], 'coa.pdf', { type: 'application/pdf' });
    await expect(
      addAttachment(sess('readonly', 'ro'), {
        scope: 'serial',
        recordId: recs[0].serial,
        file,
        category: 'CoA',
      }),
    ).rejects.toThrow(/Attach documents capability required/);
    await expect(
      addAttachment(sess('requester', 'lab'), {
        scope: 'serial',
        recordId: recs[0].serial,
        file,
        category: 'CoA',
      }),
    ).rejects.toThrow(/Attach documents capability required/);
  });

  it('backup export/import round-trips file bytes', async () => {
    const op = sess('operator', 'wh');
    const recs = await receiveGoods(op, receiveInput());
    const bytes = new Uint8Array([10, 20, 30, 40, 50]);
    const file = new File([bytes], 'tiny.png', { type: 'image/png' });
    const att = await addAttachment(op, {
      scope: 'serial',
      recordId: recs[0].serial,
      file,
      category: 'Other',
    });
    const supervisor = sess('supervisor', 'admin');
    const payload = await exportBackup(supervisor);
    expect(payload.attachments?.length).toBeGreaterThan(0);
    expect(payload.attachments!.some((a) => a.id === att.id && a.dataBase64 && !('blob' in a))).toBe(true);
    const encoded = payload.attachments!.find((a) => a.id === att.id)!;
    expect(Array.from(base64ToBytes(encoded.dataBase64))).toEqual(Array.from(bytes));
    await importBackup(supervisor, payload);
    const got = await getAttachment(att.id);
    expect(got).toBeTruthy();
    const round = await readBlobBytes(got!.blob);
    expect(Array.from(round)).toEqual(Array.from(bytes));
  });

  it('has no update or delete exports', () => {
    const keys = Object.keys(attachments);
    expect(typeof attachments.addAttachment).toBe('function');
    expect(keys).not.toContain('updateAttachment');
    expect(keys).not.toContain('deleteAttachment');
    expect(keys.filter((k) => /update|delete|remove/i.test(k))).toEqual([]);
  });

  it('allows empty mime when filename extension is pdf', async () => {
    const recs = await receiveGoods(sess('operator', 'wh'), receiveInput());
    const file = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], 'blank-mime.pdf', { type: '' });
    const att = await addAttachment(sess('operator', 'wh'), {
      scope: 'serial',
      recordId: recs[0].serial,
      file,
      category: 'CoA',
    });
    expect(att.mimeType).toBe('application/pdf');
  });

  it('bytesToBase64 round-trips', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255]);
    expect(Array.from(base64ToBytes(bytesToBase64(bytes)))).toEqual(Array.from(bytes));
  });
});
