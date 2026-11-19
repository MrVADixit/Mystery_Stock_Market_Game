/**
 * Password hashing with scrypt from Node's standard library.
 *
 * scrypt is memory-hard and built in, so there is no native dependency to
 * compile and nothing to keep patched. Parameters follow the current OWASP
 * guidance for interactive logins (N=2^16, r=8, p=1).
 */

import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

const PARAMS = { N: 65_536, r: 8, p: 1, maxmem: 128 * 65_536 * 8 * 2 };
const KEY_LENGTH = 32;

/** Produces `scrypt$N$r$p$salt$hash`, all base64url. */
export async function hashPassword(password: string): Promise<string> {
  if (password.length < 4) throw new Error('Password must be at least 4 characters');
  if (password.length > 256) throw new Error('Password must be at most 256 characters');
  const salt = randomBytes(16);
  const hash = await scryptAsync(password.normalize('NFKC'), salt, KEY_LENGTH, PARAMS);
  return [
    'scrypt',
    PARAMS.N,
    PARAMS.r,
    PARAMS.p,
    salt.toString('base64url'),
    hash.toString('base64url'),
  ].join('$');
}

/** Constant-time verification. Returns false for any malformed stored value. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const parts = stored.split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
    const N = Number(parts[1]);
    const r = Number(parts[2]);
    const p = Number(parts[3]);
    if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
    const salt = Buffer.from(parts[4], 'base64url');
    const expected = Buffer.from(parts[5], 'base64url');
    const actual = await scryptAsync(password.normalize('NFKC'), salt, expected.length, {
      N,
      r,
      p,
      maxmem: 128 * N * r * 2,
    });
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
