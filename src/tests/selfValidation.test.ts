import { beforeEach, describe, expect, it } from 'vitest';
import { getDb, OQ_DB_NAME, PROD_DB_NAME, currentDbName, resetDbConnection } from '../lib/db';
import { buildDefaultMatrixDocument, defaultAllows, setMatrixCacheForTests } from '../lib/permissions';
import { runSelfValidation, type ValidationReport } from '../lib/selfValidation';
import { buildValidationPdf } from '../lib/validationReport';
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

describe('validation role defaults', () => {
  it('validation can runValidation and cannot receive', () => {
    expect(defaultAllows('validation', 'runValidation')).toBe(true);
    expect(defaultAllows('validation', 'receive')).toBe(false);
    expect(defaultAllows('validation', 'issue')).toBe(false);
    expect(defaultAllows('validation', 'qaDisposition')).toBe(false);
    expect(defaultAllows('validation', 'fulfillRequest')).toBe(false);
    expect(defaultAllows('validation', 'editPermissionMatrix')).toBe(false);
    expect(defaultAllows('validation', 'adminUsers')).toBe(false);
    expect(defaultAllows('sysadmin', 'runValidation')).toBe(true);
    expect(defaultAllows('super', 'runValidation')).toBe(true);
    expect(defaultAllows('operator', 'runValidation')).toBe(false);
  });
});

describe('runSelfValidation sandbox isolation', () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  it('operator cannot runSelfValidation', async () => {
    await expect(runSelfValidation(sess('operator', 'wh'))).rejects.toThrow(/runValidation/);
    expect(currentDbName()).toBe(PROD_DB_NAME);
  });

  it('validation session produces OQ evidence and leaves production DB pointed at gmp-wh-inv', async () => {
    const db = await getDb();
    await db.put('meta', 'prod-marker', 'oq-isolation-test');
    await db.put('meta', { year: 1999, lastN: 42 }, 'prodIsolationSerial');

    sessionStorage.setItem(
      'gmp-wh-session',
      JSON.stringify({
        userId: 'super',
        fullName: 'super',
        role: 'super',
        roleName: 'super',
        startedUtc: new Date().toISOString(),
        lastActivityUtc: new Date().toISOString(),
        mustChangePassword: false,
      }),
    );
    sessionStorage.setItem('gmp-wh-view-as', 'super');

    const report = await runSelfValidation(sess('validation', 'val'));

    const storedRaw = sessionStorage.getItem('gmp-wh-session');
    expect(storedRaw).toBeTruthy();
    const stored = JSON.parse(storedRaw as string) as Session;
    expect(stored.userId).toBe('super');
    expect(sessionStorage.getItem('gmp-wh-view-as')).toBe('super');

    expect(currentDbName()).toBe(PROD_DB_NAME);
    const after = await getDb();
    expect(await after.get('meta', 'oq-isolation-test')).toBe('prod-marker');
    expect(await after.get('meta', 'prodIsolationSerial')).toEqual({ year: 1999, lastN: 42 });

    const ids = report.results.map((r) => r.id);
    const required = [
      'IQ-01', 'IQ-02', 'IQ-03',
      'OQ-01', 'OQ-02', 'OQ-03', 'OQ-04', 'OQ-05', 'OQ-06', 'OQ-07', 'OQ-08', 'OQ-09', 'OQ-10',
      'OQ-11', 'OQ-12', 'OQ-13', 'OQ-14', 'OQ-15', 'OQ-16', 'OQ-17', 'OQ-18', 'OQ-19', 'OQ-20',
      'OQ-21', 'OQ-22', 'OQ-23', 'OQ-24', 'OQ-25', 'OQ-26', 'OQ-27', 'OQ-28', 'OQ-29',
      'OQ-ATT', 'OQ-EXT-HOLD', 'OQ-EXT-RETURN', 'OQ-EXT-COUNT',
      'PQ-01', 'PQ-02', 'PQ-03', 'PQ-04', 'PQ-05', 'PQ-06', 'PQ-07', 'PQ-08',
      'VAL-SOD',
    ];
    for (const id of required) {
      expect(ids).toContain(id);
    }
    const automatedRequired = report.results.filter((r) => required.includes(r.id));
    const failed = automatedRequired.filter((r) => r.verdict === 'Fail');
    if (failed.length) {
      throw new Error(failed.map((r) => `${r.id}: ${r.actual}`).join('\n'));
    }
    expect(automatedRequired.every((r) => r.verdict !== 'Fail')).toBe(true);
    expect(automatedRequired.filter((r) => r.verdict === 'Pass').length).toBe(automatedRequired.length);

    expect(report.sandboxDb).toBe(OQ_DB_NAME);
    // Production inventory was empty except meta; sandbox receipts must not land here.
    const inv = (await after.getAll('inventory')) as { serial: string }[];
    expect(inv.length).toBe(0);
  }, 60_000);
});

const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

describe('validation PDF evidence', () => {
  it('buildValidationPdf returns a PDF blob', async () => {
    const report: ValidationReport = {
      executedUtc: '2026-08-25T18:00:00.000Z',
      executedBy: 'Taylor Validation (val)',
      appVersion: '1.4.1',
      docId: 'DOC-WH-INV-001',
      sandboxDb: 'gmp-wh-inv-oq',
      results: [
        {
          id: 'OQ-01',
          urs: 'URS-01',
          title: 'Serial uniqueness',
          expected: 'Unique serials',
          actual: 'WH-2026-000025, WH-2026-000026',
          verdict: 'Pass',
          ms: 12,
          images: [{ caption: 'CODE128 WH-2026-000025', dataUrl: TINY_PNG }],
        },
      ],
      passed: 1,
      failed: 0,
      manual: 0,
      printedName: 'Taylor Validation',
      signedUserId: 'val',
      signedAtUtc: '2026-08-25T18:00:00.000Z',
      meaningOfSignature: 'Automated sandbox evidence with screenshots',
    };
    const blob = await buildValidationPdf(report);
    expect(blob.type).toBe('application/pdf');
    expect(blob.size).toBeGreaterThan(500);
    const head = await new Promise<string>((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result || '').slice(0, 4));
      fr.onerror = () => reject(fr.error);
      fr.readAsText(blob.slice(0, 8));
    });
    expect(head).toBe('%PDF');
  });
});
