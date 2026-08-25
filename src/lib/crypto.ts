import type { PasswordAlgorithm } from '../types';
import { PBKDF2_ITERATIONS } from '../types';

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.length % 2 === 0 ? hex : `0${hex}`;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Legacy v1.0: SHA-256(salt:password). Kept so seeded/demo hashes still verify once. */
export async function hashPasswordSha256Salt(password: string, salt: string): Promise<string> {
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(`${salt}:${password}`));
  return bytesToHex(new Uint8Array(buf));
}

/** PBKDF2-SHA-256, 100000 iterations, 256-bit derived key. Salt is hex of 16 random bytes. */
export async function hashPasswordPbkdf2(password: string, saltHex: string): Promise<string> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: Uint8Array.from(hexToBytes(saltHex)),
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    256,
  );
  return bytesToHex(new Uint8Array(bits));
}

/** New hashes are PBKDF2. */
export async function hashPassword(password: string, salt: string): Promise<string> {
  return hashPasswordPbkdf2(password, salt);
}

export function randomSalt(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

export async function verifyPassword(
  password: string,
  salt: string,
  expectedHash: string,
  algorithm: PasswordAlgorithm = 'pbkdf2-sha256',
): Promise<boolean> {
  const got =
    algorithm === 'sha256-salt'
      ? await hashPasswordSha256Salt(password, salt)
      : await hashPasswordPbkdf2(password, salt);
  return timingSafeEqual(got, expectedHash);
}

/** Try declared algorithm first; if it fails and algorithm is missing/legacy, try the other (transparent). */
export async function verifyPasswordFlexible(
  password: string,
  salt: string,
  expectedHash: string,
  algorithm?: PasswordAlgorithm,
): Promise<{ ok: boolean; used: PasswordAlgorithm }> {
  const primary: PasswordAlgorithm = algorithm ?? 'sha256-salt';
  if (await verifyPassword(password, salt, expectedHash, primary)) {
    return { ok: true, used: primary };
  }
  const other: PasswordAlgorithm = primary === 'sha256-salt' ? 'pbkdf2-sha256' : 'sha256-salt';
  if (await verifyPassword(password, salt, expectedHash, other)) {
    return { ok: true, used: other };
  }
  return { ok: false, used: primary };
}
