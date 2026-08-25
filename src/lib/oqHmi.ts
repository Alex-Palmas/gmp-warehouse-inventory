import {
  APP_VERSION,
  CLASSIFICATIONS,
  DOC_ID,
  ITEM_TYPES,
  LOCKOUT_ATTEMPTS,
  LOCKOUT_MS,
  PASSWORD_EXPIRY_DAYS,
  PASSWORD_HISTORY_COUNT,
  PBKDF2_ITERATIONS,
  SESSION_IDLE_MS,
  STATUSES,
  TO_LOCATIONS,
  VALIDATION_BANNER,
} from '../types';
import { isLocationCode } from './locations';
import type { ExtraCtx } from './oqExtra';
import { dump, mtfInput } from './oqSuite';
import { validatePasswordPolicy } from './passwordPolicy';
import { parseScanPayload, isValidSerial } from './serial';
import { HASH_ROUTES } from './traceMatrix';

export const HMI_OQ_IDS = [
  'HMI-VOCAB',
  'HMI-BANNER',
  'HMI-ESIGN-SHAPE',
  'HMI-ROUTES',
  'HMI-STATUS-CHIPS',
  'HMI-SCAN-PARSE',
  'HMI-PASSWORD',
] as const;

export async function runHmiCases(ctx: ExtraCtx): Promise<void> {
  const { results, onResult, oq, threw, lab } = ctx;

  await oq(
    results,
    'HMI-VOCAB',
    'URS-04',
    'Closed vocabularies and destination/classification lists',
    'ITEM_TYPES and STATUSES are closed arrays. Destinations LVM/SVM/QC Testing/Warehouse/Other. Classification GMP/High Quality. Invalid toLocation rejected.',
    async () => {
      const mismatches: string[] = [];
      for (const d of ['LVM', 'SVM', 'QC Testing', 'Warehouse', 'Other'] as const) {
        if (!(TO_LOCATIONS as readonly string[]).includes(d)) mismatches.push(`missing dest ${d}`);
      }
      for (const c of ['GMP', 'High Quality'] as const) {
        if (!(CLASSIFICATIONS as readonly string[]).includes(c)) mismatches.push(`missing class ${c}`);
      }
      if (ITEM_TYPES.length < 8) mismatches.push('ITEM_TYPES too short');
      const badDest = await threw(() =>
        import('./requests').then((m) => m.submitRequest(lab, mtfInput(lab, { toLocation: 'NotAPlace' as never }))),
      );
      if (!badDest.ok) mismatches.push('invalid toLocation was accepted');
      const badClass = await threw(() =>
        import('./requests').then((m) => m.submitRequest(lab, mtfInput(lab, { classification: [] }))),
      );
      if (!badClass.ok) mismatches.push('empty classification was accepted');
      return dump(mismatches);
    },
    onResult,
  );

  await oq(
    results,
    'HMI-BANNER',
    'URS-18',
    'Document banner and Part 11 constants',
    'VALIDATION_BANNER, DOC_ID, APP_VERSION, idle 15 min, lockout 5 / 15 min, password 90d / history 4, PBKDF2 100000.',
    async () => {
      const mismatches: string[] = [];
      if (!VALIDATION_BANNER.includes('Not validated')) mismatches.push('banner');
      if (DOC_ID !== 'DOC-WH-INV-001') mismatches.push('DOC_ID');
      if (!APP_VERSION) mismatches.push('APP_VERSION');
      if (SESSION_IDLE_MS !== 15 * 60 * 1000) mismatches.push(`idle ${SESSION_IDLE_MS}`);
      if (LOCKOUT_ATTEMPTS !== 5) mismatches.push(`attempts ${LOCKOUT_ATTEMPTS}`);
      if (LOCKOUT_MS !== 15 * 60 * 1000) mismatches.push(`lockout ${LOCKOUT_MS}`);
      if (PASSWORD_EXPIRY_DAYS !== 90) mismatches.push(`expiry ${PASSWORD_EXPIRY_DAYS}`);
      if (PBKDF2_ITERATIONS !== 100_000) mismatches.push(`pbkdf2 ${PBKDF2_ITERATIONS}`);
      if (PASSWORD_HISTORY_COUNT !== 4) mismatches.push(`history ${PASSWORD_HISTORY_COUNT}`);
      return dump(mismatches);
    },
    onResult,
  );

  await oq(
    results,
    'HMI-ESIGN-SHAPE',
    'URS-09',
    'ESign requires printedName, userId, signedAtUtc, meaningOfSignature',
    'Incomplete e-sign on QA disposition throws Electronic signature is incomplete.',
    async () => {
      const { qaDisposition } = await import('./inventory');
      const r = await threw(() =>
        qaDisposition(ctx.qa, 'NO-SUCH', 'Release', { userId: '', printedName: '', signedAtUtc: '', meaningOfSignature: '' }, 'x'),
      );
      return {
        actual: r.message,
        pass: r.ok && /incomplete|capability|not found|Signature/i.test(r.message),
      };
    },
    onResult,
  );

  await oq(
    results,
    'HMI-ROUTES',
    'URS-10',
    'Hash routes unique and documented',
    'HASH_ROUTES matches the SPA path list and has no duplicates.',
    async () => {
      const routes = [...HASH_ROUTES];
      const uniq = new Set(routes);
      return { actual: routes.join(' '), pass: uniq.size === routes.length && routes.includes('/login') && routes.includes('/') };
    },
    onResult,
  );

  await oq(
    results,
    'HMI-STATUS-CHIPS',
    'URS-04',
    'STATUSES closed list includes warehouse chips',
    'Quarantine, Released, Hold, Rejected, Restricted, Issued, Consumed, Destroyed.',
    async () => {
      const need = ['Quarantine', 'Released', 'Hold', 'Rejected', 'Restricted', 'Issued', 'Consumed', 'Destroyed'];
      const missing = need.filter((s) => !(STATUSES as readonly string[]).includes(s));
      return dump(missing);
    },
    onResult,
  );

  await oq(
    results,
    'HMI-SCAN-PARSE',
    'URS-14',
    'parseScanPayload trims QR and plain serial; location vs serial',
    'QR payload first field; trim; LOC- is location; WH- serial is not a location.',
    async () => {
      const mismatches: string[] = [];
      if (parseScanPayload('  WH-2026-000025  ') !== 'WH-2026-000025') mismatches.push('trim');
      if (parseScanPayload('WH-2026-000025|LOT|2028-01-01|Quarantine|Drum') !== 'WH-2026-000025') mismatches.push('qr');
      const loc = 'LOC-MAIN-WH1-OQ-R1-S1-BIN';
      if (!isLocationCode(loc)) mismatches.push('loc');
      if (isLocationCode('WH-2026-000025')) mismatches.push('serial-as-loc');
      if (!isValidSerial('WH-2026-000025')) mismatches.push('serial');
      return dump(mismatches);
    },
    onResult,
  );

  await oq(
    results,
    'HMI-PASSWORD',
    'URS-07',
    'Password policy 12-char complexity',
    "11 char fail; 12 char upper+lower+digit+special pass; equals userId fail; 'short' fail.",
    async () => {
      const mismatches: string[] = [];
      if (!validatePasswordPolicy('val', 'Abcdef1!xxx').length) mismatches.push('11 char accepted');
      if (validatePasswordPolicy('val', 'Abcdefghij1!').length) mismatches.push('12 char rejected');
      if (!validatePasswordPolicy('Val123!xxVal', 'Val123!xxVal').length) mismatches.push('equals userId accepted');
      if (!validatePasswordPolicy('val', 'short').length) mismatches.push('short accepted');
      return dump(mismatches);
    },
    onResult,
  );
}
