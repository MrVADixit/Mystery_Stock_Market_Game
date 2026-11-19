/**
 * Authentication.
 *
 * Two kinds of principal share one mechanism: an administrator (a row in
 * `users`) and a participant (a row in `participants`). Both get an opaque
 * random token in an HttpOnly cookie; only its SHA-256 hash is stored, so a
 * database leak cannot be replayed against a running game.
 *
 * A participant can always log back in with the same name and passphrase
 * after losing connection, which restores their account from the database
 * rather than from anything held on the device.
 */

import { cookies } from 'next/headers';
import { query, queryOne } from './db';
import { generateToken, hashToken } from './ids';
import { isProduction } from './env';
import { verifyPassword } from './password';

const ADMIN_COOKIE = 'msm_admin';
const PLAYER_COOKIE = 'msm_player';
const ADMIN_TTL_HOURS = 12;
const PLAYER_TTL_HOURS = 24;

export interface AdminPrincipal {
  kind: 'admin';
  userId: string;
  email: string;
  role: 'owner' | 'admin';
}

export interface ParticipantPrincipal {
  kind: 'participant';
  participantId: string;
  gameId: string;
  displayName: string;
}

function cookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: isProduction(),
    path: '/',
    maxAge: maxAgeSeconds,
  };
}

/* ----------------------------- administrators ----------------------------- */

export async function loginAdmin(email: string, password: string): Promise<AdminPrincipal | null> {
  const user = await queryOne<{ id: string; email: string; role: 'owner' | 'admin'; password_hash: string }>(
    'SELECT id, email, role, password_hash FROM users WHERE lower(email) = lower($1)',
    [email],
  );
  if (!user) {
    // Spend comparable time on a missing account so the response time does
    // not reveal whether the address exists.
    await verifyPassword(password, 'scrypt$65536$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
    return null;
  }
  if (!(await verifyPassword(password, user.password_hash))) return null;

  const token = generateToken();
  await query(
    `INSERT INTO auth_sessions (token_hash, user_id, expires_at)
       VALUES ($1, $2, now() + make_interval(hours => $3))`,
    [hashToken(token), user.id, ADMIN_TTL_HOURS],
  );
  await query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);
  (await cookies()).set(ADMIN_COOKIE, token, cookieOptions(ADMIN_TTL_HOURS * 3600));
  return { kind: 'admin', userId: user.id, email: user.email, role: user.role };
}

export async function currentAdmin(): Promise<AdminPrincipal | null> {
  const token = (await cookies()).get(ADMIN_COOKIE)?.value;
  if (!token) return null;
  const row = await queryOne<{ id: string; email: string; role: 'owner' | 'admin' }>(
    `SELECT u.id, u.email, u.role
       FROM auth_sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [hashToken(token)],
  );
  if (!row) return null;
  return { kind: 'admin', userId: row.id, email: row.email, role: row.role };
}

export async function logoutAdmin(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(ADMIN_COOKIE)?.value;
  if (token) await query('DELETE FROM auth_sessions WHERE token_hash = $1', [hashToken(token)]);
  jar.delete(ADMIN_COOKIE);
}

/* ------------------------------ participants ------------------------------ */

export async function issueParticipantSession(participantId: string): Promise<void> {
  const token = generateToken();
  await query(
    `INSERT INTO auth_sessions (token_hash, participant_id, expires_at)
       VALUES ($1, $2, now() + make_interval(hours => $3))`,
    [hashToken(token), participantId, PLAYER_TTL_HOURS],
  );
  (await cookies()).set(PLAYER_COOKIE, token, cookieOptions(PLAYER_TTL_HOURS * 3600));
}

export async function currentParticipant(): Promise<ParticipantPrincipal | null> {
  const token = (await cookies()).get(PLAYER_COOKIE)?.value;
  if (!token) return null;
  const row = await queryOne<{ id: string; game_id: string; display_name: string }>(
    `SELECT p.id, p.game_id, p.display_name
       FROM auth_sessions s JOIN participants p ON p.id = s.participant_id
      WHERE s.token_hash = $1 AND s.expires_at > now() AND p.is_blocked = FALSE`,
    [hashToken(token)],
  );
  if (!row) return null;
  // Touch the heartbeat so the administrator can see who is connected.
  void query('UPDATE participants SET last_seen_at = now() WHERE id = $1', [row.id]).catch(() => {});
  return {
    kind: 'participant',
    participantId: row.id,
    gameId: row.game_id,
    displayName: row.display_name,
  };
}

export async function logoutParticipant(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(PLAYER_COOKIE)?.value;
  if (token) await query('DELETE FROM auth_sessions WHERE token_hash = $1', [hashToken(token)]);
  jar.delete(PLAYER_COOKIE);
}

/* -------------------------------- helpers -------------------------------- */

/** Throws unless the caller administers this game. */
export async function requireGameAdmin(gameId: string): Promise<AdminPrincipal> {
  const admin = await currentAdmin();
  if (!admin) throw new AuthError('Please sign in as an administrator.', 401);
  const game = await queryOne<{ admin_user_id: string }>('SELECT admin_user_id FROM games WHERE id = $1', [
    gameId,
  ]);
  if (!game) throw new AuthError('That game does not exist.', 404);
  // The owner account can administer any game; an admin only their own.
  if (admin.role !== 'owner' && game.admin_user_id !== admin.userId) {
    throw new AuthError('That game belongs to another administrator.', 403);
  }
  return admin;
}

/** Throws unless the caller is a participant in this game. */
export async function requireParticipant(gameId: string): Promise<ParticipantPrincipal> {
  const p = await currentParticipant();
  if (!p) throw new AuthError('Please sign in to play.', 401);
  if (p.gameId !== gameId) throw new AuthError('You are not registered in that game.', 403);
  return p;
}

export class AuthError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Verifies a classroom display token against the game it claims to be for. */
export async function verifyDisplayToken(gameId: string, token: string | null): Promise<boolean> {
  if (!token) return false;
  const row = await queryOne<{ display_token: string | null }>(
    'SELECT display_token FROM games WHERE id = $1',
    [gameId],
  );
  if (!row?.display_token) return false;
  // Constant-time comparison of equal-length hex digests.
  const a = Buffer.from(hashToken(token));
  const b = Buffer.from(hashToken(row.display_token));
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function pruneAuthSessions(): Promise<void> {
  await query('DELETE FROM auth_sessions WHERE expires_at < now()');
}
