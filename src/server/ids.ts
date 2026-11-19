/** Identifier and token generation. */

import { createHash, randomBytes, randomInt } from 'node:crypto';

/**
 * Join codes are typed by hand on a phone, so the alphabet leaves out the
 * characters people confuse: 0/O, 1/I/L, 2/Z, 5/S, 8/B.
 */
const JOIN_ALPHABET = 'ACDEFGHJKMNPQRTUVWXY34679';

export function generateJoinCode(length = 6): string {
  let out = '';
  for (let i = 0; i < length; i++) out += JOIN_ALPHABET[randomInt(JOIN_ALPHABET.length)];
  return out;
}

/** 256 bits of entropy, URL-safe. Used for display links and auth cookies. */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/**
 * Tokens are stored hashed, so a database leak cannot be replayed against
 * the running game.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Hashes an IP for the audit trail without storing the address itself. */
export function hashIp(ip: string | null | undefined, secret: string): string | null {
  if (!ip) return null;
  return createHash('sha256').update(`${secret}:${ip}`).digest('hex').slice(0, 32);
}
