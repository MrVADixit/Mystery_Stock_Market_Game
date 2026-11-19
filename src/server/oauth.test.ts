/**
 * Tests for provider sign-in, concentrating on the authorisation policy.
 *
 * These need a database, so they skip when DATABASE_URL is absent. CI runs
 * them in the job that has PostgreSQL.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { config as loadEnv } from 'dotenv';
import {
  allowedEmails,
  configuredProviders,
  decideSignIn,
  providerConfigured,
  redirectUri,
  stateMatches,
} from './oauth';
import type { ProviderProfile } from './oauth';
import { closePool, query } from './db';

loadEnv({ path: '.env', quiet: true });

const hasDb = Boolean(process.env.DATABASE_URL);
const suite = hasDb ? describe : describe.skip;

const unique = () => Math.random().toString(36).slice(2, 10);

function profile(overrides: Partial<ProviderProfile> = {}): ProviderProfile {
  return {
    providerUserId: `sub-${unique()}`,
    email: `someone-${unique()}@example.com`,
    displayName: 'Test Person',
    avatarUrl: null,
    ...overrides,
  };
}

/* ================================================================== */
describe('provider configuration', () => {
  const saved = { ...process.env };
  afterAll(() => {
    process.env = { ...saved };
  });

  it('reports nothing configured when there are no credentials', () => {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.GITHUB_CLIENT_ID;
    delete process.env.GITHUB_CLIENT_SECRET;
    expect(configuredProviders()).toEqual([]);
    expect(providerConfigured('google')).toBe(false);
    expect(providerConfigured('github')).toBe(false);
  });

  it('needs both halves of a credential', () => {
    process.env.GOOGLE_CLIENT_ID = 'id-only';
    delete process.env.GOOGLE_CLIENT_SECRET;
    expect(providerConfigured('google')).toBe(false);

    process.env.GOOGLE_CLIENT_SECRET = 'secret';
    expect(providerConfigured('google')).toBe(true);
    expect(configuredProviders()).toEqual([{ id: 'google', label: 'Google' }]);
  });

  it('builds the redirect URI from APP_URL when it is set', () => {
    process.env.APP_URL = 'https://game.example.com/';
    expect(redirectUri('google', 'http://ignored')).toBe(
      'https://game.example.com/api/auth/oauth/google/callback',
    );
    delete process.env.APP_URL;
    expect(redirectUri('github', 'https://fallback.example.com')).toBe(
      'https://fallback.example.com/api/auth/oauth/github/callback',
    );
  });

  it('reads the allowlist tolerantly', () => {
    process.env.ADMIN_ALLOWED_EMAILS = ' One@Example.com, two@example.com\n three@example.com ';
    expect(allowedEmails()).toEqual(['one@example.com', 'two@example.com', 'three@example.com']);
    process.env.ADMIN_ALLOWED_EMAILS = '';
    expect(allowedEmails()).toEqual([]);
  });
});

/* ================================================================== */
describe('state verification', () => {
  it('accepts only the exact state it issued', () => {
    expect(stateMatches('abc123', 'abc123')).toBe(true);
    expect(stateMatches('abc123', 'abc124')).toBe(false);
    expect(stateMatches('abc123', 'abc12')).toBe(false);
    expect(stateMatches('abc123', '')).toBe(false);
    // An empty expectation must never be satisfiable.
    expect(stateMatches('', '')).toBe(false);
  });
});

/* ================================================================== */
suite('the authorisation policy', () => {
  const created: string[] = [];

  beforeAll(() => {
    delete process.env.ADMIN_ALLOWED_EMAILS;
  });

  afterAll(async () => {
    for (const email of created) {
      await query('DELETE FROM users WHERE lower(email) = lower($1)', [email]);
    }
    await closePool();
  });

  it('refuses a stranger when no allowlist is set', async () => {
    const decision = await decideSignIn('google', profile());
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/not an administrator/i);
  });

  it('refuses an account with no verified email address', async () => {
    const decision = await decideSignIn('github', profile({ email: null }));
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/verified email/i);
  });

  it('signs in to an administrator account that already has that address', async () => {
    const email = `existing-${unique()}@example.com`;
    created.push(email);
    const row = await query<{ id: string }>(
      `INSERT INTO users (email, password_hash, role, display_name)
         VALUES ($1, 'scrypt$1$1$1$AA$AA', 'admin', 'Existing') RETURNING id`,
      [email],
    );

    const decision = await decideSignIn('google', profile({ email }));
    expect(decision.allowed).toBe(true);
    expect(decision.userId).toBe(row[0].id);
    expect(decision.created).toBeFalsy();
  });

  it('matches the existing account regardless of letter case', async () => {
    const email = `MixedCase-${unique()}@Example.com`;
    created.push(email);
    await query(
      `INSERT INTO users (email, password_hash, role, display_name)
         VALUES ($1, 'scrypt$1$1$1$AA$AA', 'admin', 'Mixed')`,
      [email],
    );
    const decision = await decideSignIn('google', profile({ email: email.toLowerCase() }));
    expect(decision.allowed).toBe(true);
  });

  it('creates an account only for an explicitly allowed address', async () => {
    const email = `allowed-${unique()}@example.com`;
    created.push(email);
    process.env.ADMIN_ALLOWED_EMAILS = email;
    try {
      const decision = await decideSignIn('github', profile({ email }));
      expect(decision.allowed).toBe(true);
      expect(decision.created).toBe(true);

      const row = await query<{ role: string; password_hash: string | null }>(
        'SELECT role, password_hash FROM users WHERE lower(email) = lower($1)',
        [email],
      );
      expect(row[0].role).toBe('admin');
      // A provider-only administrator has no password to guess.
      expect(row[0].password_hash).toBeNull();
    } finally {
      delete process.env.ADMIN_ALLOWED_EMAILS;
    }
  });

  it('still refuses an address that is not on a non-empty allowlist', async () => {
    process.env.ADMIN_ALLOWED_EMAILS = 'somebody-else@example.com';
    try {
      const decision = await decideSignIn('google', profile());
      expect(decision.allowed).toBe(false);
    } finally {
      delete process.env.ADMIN_ALLOWED_EMAILS;
    }
  });

  it('signs a linked identity straight in, even with no email', async () => {
    const email = `linked-${unique()}@example.com`;
    created.push(email);
    const row = await query<{ id: string }>(
      `INSERT INTO users (email, password_hash, role, display_name)
         VALUES ($1, NULL, 'admin', 'Linked') RETURNING id`,
      [email],
    );
    const providerUserId = `sub-${unique()}`;
    await query(
      `INSERT INTO user_identities (user_id, provider, provider_user_id, email, display_name)
         VALUES ($1, 'google', $2, $3, 'Linked')`,
      [row[0].id, providerUserId, email],
    );

    // The identity is authoritative: a hidden email must not break sign-in.
    const decision = await decideSignIn('google', profile({ providerUserId, email: null }));
    expect(decision.allowed).toBe(true);
    expect(decision.userId).toBe(row[0].id);
  });

  it('keeps the two providers separate', async () => {
    const email = `separate-${unique()}@example.com`;
    created.push(email);
    const row = await query<{ id: string }>(
      `INSERT INTO users (email, password_hash, role, display_name)
         VALUES ($1, NULL, 'admin', 'Separate') RETURNING id`,
      [email],
    );
    const providerUserId = `shared-id-${unique()}`;
    await query(
      `INSERT INTO user_identities (user_id, provider, provider_user_id, email, display_name)
         VALUES ($1, 'google', $2, $3, 'Separate')`,
      [row[0].id, providerUserId, email],
    );

    // The same numeric id at GitHub is a different person entirely.
    const decision = await decideSignIn('github', profile({ providerUserId, email: null }));
    expect(decision.allowed).toBe(false);
  });
});
