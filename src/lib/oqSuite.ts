/**
 * Shared helpers for exhaustive sandbox OQ. Not a substitute for executed IQ/OQ/PQ.
 */
import type { Capability, ESign, Location, Session } from '../types';
import { SYSTEM_ROLE_IDS } from '../types';
import { nowUtcIso } from './dates';
import { defaultAllows } from './permissions';
import type { ExtraCtx } from './oqExtra';
import type { SubmitRequestInput } from './requests';

export function roleSess(role: string): Session {
  const userId =
    role === 'operator'
      ? 'wh'
      : role === 'supervisor'
        ? 'admin'
        : role === 'requester'
          ? 'lab'
          : role === 'readonly'
            ? 'ro'
            : role === 'validation'
              ? 'val'
              : role;
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

export function dump(mismatches: string[]): { actual: string; pass: boolean } {
  return { actual: mismatches.length ? mismatches.join(' | ') : 'ok', pass: mismatches.length === 0 };
}

export async function probeRoles(
  threw: ExtraCtx['threw'],
  cap: Capability,
  fn: (s: Session) => Promise<unknown>,
): Promise<{ actual: string; pass: boolean }> {
  const mismatches: string[] = [];
  for (const role of SYSTEM_ROLE_IDS) {
    const allowed = defaultAllows(role, cap);
    const r = await threw(() => fn(roleSess(role)));
    if (allowed && r.ok) mismatches.push(`${role}: allowed but threw: ${r.message}`);
    if (!allowed && !r.ok) mismatches.push(`${role}: denied but succeeded`);
  }
  return dump(mismatches);
}

export function xferLoc(): Location {
  return { site: 'MAIN', building: 'WH-1', room: 'OQ', rack: 'R8', shelf: 'S8', bin: 'EXH' };
}

export function esignOf(session: Session, meaning: string): ESign {
  return {
    userId: session.userId,
    printedName: session.fullName,
    signedAtUtc: nowUtcIso(),
    meaningOfSignature: meaning,
  };
}

export function mtfInput(session: Session, over: Partial<SubmitRequestInput> = {}): SubmitRequestInput {
  return {
    materialCode: 'RM-001',
    qtyRequested: 1,
    uom: 'kg',
    neededBy: '2026-12-01',
    priority: 'Routine',
    toLocation: 'Warehouse',
    classification: ['GMP'],
    intendedUse: 'OQ exhaustive',
    requestorEsign: esignOf(session, 'Requestor OQ'),
    ...over,
  };
}

const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

export function tinyPngFile(name = 'coa.png'): File {
  const bin = atob(PNG_B64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], name, { type: 'image/png' });
}

export function fakeFile(name: string, type: string, size: number): File {
  const bytes = new Uint8Array(size);
  return new File([bytes], name, { type });
}

export async function clearAllReservations(session: Session): Promise<void> {
  const { listInventory, clearReservationsForRequest } = await import('./inventory');
  const ids = new Set(
    (await listInventory())
      .map((r) => r.reservedForRequestId)
      .filter((id): id is string => Boolean(id)),
  );
  for (const id of ids) await clearReservationsForRequest(session, id);
}
