import type { PasswordAlgorithm } from '../types';
import { PASSWORD_HISTORY_COUNT } from '../types';
import { verifyPassword } from './crypto';

const SPECIAL = /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?`~]/;

export function validatePasswordPolicy(userId: string, password: string): string[] {
  const errors: string[] = [];
  if (password.length < 12) errors.push('Password must be at least 12 characters');
  if (!/[A-Z]/.test(password)) errors.push('Password must contain an uppercase letter');
  if (!/[a-z]/.test(password)) errors.push('Password must contain a lowercase letter');
  if (!/[0-9]/.test(password)) errors.push('Password must contain a digit');
  if (!SPECIAL.test(password)) errors.push('Password must contain a special character');
  if (password.toLowerCase() === userId.trim().toLowerCase()) {
    errors.push('Password must not equal the user ID');
  }
  return errors;
}

export function assertPasswordPolicy(userId: string, password: string): void {
  const errors = validatePasswordPolicy(userId, password);
  if (errors.length) throw new Error(errors[0]);
}

export function passwordExpired(passwordChangedUtc: string | undefined, nowMs: number, expiryDays: number): boolean {
  if (!passwordChangedUtc) return true;
  const t = Date.parse(passwordChangedUtc);
  if (Number.isNaN(t)) return true;
  return nowMs - t > expiryDays * 86400000;
}

/** History entries: algorithm:salt:hash so a new password can be verified against prior salts. */
export function encodePasswordHistory(algorithm: PasswordAlgorithm, salt: string, hash: string): string {
  return `${algorithm}:${salt}:${hash}`;
}

export function parsePasswordHistory(entry: string): { algorithm: PasswordAlgorithm; salt: string; hash: string } | null {
  const i1 = entry.indexOf(':');
  const i2 = entry.indexOf(':', i1 + 1);
  if (i1 < 0 || i2 < 0) return null;
  return {
    algorithm: entry.slice(0, i1) as PasswordAlgorithm,
    salt: entry.slice(i1 + 1, i2),
    hash: entry.slice(i2 + 1),
  };
}

export async function passwordInHistory(
  password: string,
  current: { algorithm: PasswordAlgorithm; salt: string; hash: string },
  history: string[],
): Promise<boolean> {
  if (await verifyPassword(password, current.salt, current.hash, current.algorithm)) return true;
  for (const entry of history.slice(-PASSWORD_HISTORY_COUNT)) {
    const p = parsePasswordHistory(entry);
    if (!p) continue;
    if (await verifyPassword(password, p.salt, p.hash, p.algorithm)) return true;
  }
  return false;
}

export function nextPasswordHistory(
  algorithm: PasswordAlgorithm,
  salt: string,
  hash: string,
  history: string[],
): string[] {
  return [...history, encodePasswordHistory(algorithm, salt, hash)].slice(-PASSWORD_HISTORY_COUNT);
}
