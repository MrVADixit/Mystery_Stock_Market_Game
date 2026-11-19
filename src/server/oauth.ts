/**
 * Administrator sign-in with Google or GitHub.
 *
 * This is an additional door to an administrator account, never a way to
 * create an unexpected one. Password sign-in is untouched and remains the
 * bootstrap route: the owner account still comes from OWNER_EMAIL and
 * OWNER_PASSWORD, and an administrator can always get in that way.
 *
 * The authorisation policy is the part that matters. By default a provider
 * sign-in only succeeds when the verified email already belongs to a user
 * row. Without that rule, anybody on the internet with a Google account
 * could sign in to the administrator screens of a public deployment.
 * ADMIN_ALLOWED_EMAILS widens it deliberately, to named people only.
 *
 * With nothing configured the whole feature is simply absent: no buttons,
 * no routes that do anything, and everything else works exactly as before.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { query, queryOne, withTransaction } from './db';
import { recordAudit } from './audit';

export type OAuthProvider = 'google' | 'github';

/**
 * The cookie carrying the CSRF state and the PKCE verifier between the two
 * legs of the flow. It lives here rather than in a route file because a
 * Next.js route module may only export its handlers and a few known fields.
 */
export const OAUTH_COOKIE = 'msm_oauth';

export class OAuthError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

interface ProviderConfig {
  id: OAuthProvider;
  label: string;
  authorizeUrl: string;
  tokenUrl: string;
  scope: string;
  /** GitHub OAuth Apps do not support PKCE; Google does. */
  usesPkce: boolean;
  clientId: string;
  clientSecret: string;
}

function readProvider(id: OAuthProvider): ProviderConfig | null {
  const clientId = process.env[`${id.toUpperCase()}_CLIENT_ID`]?.trim();
  const clientSecret = process.env[`${id.toUpperCase()}_CLIENT_SECRET`]?.trim();
  if (!clientId || !clientSecret) return null;

  if (id === 'google') {
    return {
      id,
      label: 'Google',
      authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      scope: 'openid email profile',
      usesPkce: true,
      clientId,
      clientSecret,
    };
  }
  return {
    id,
    label: 'GitHub',
    authorizeUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    scope: 'read:user user:email',
    usesPkce: false,
    clientId,
    clientSecret,
  };
}

/** Which providers this deployment has credentials for. */
export function configuredProviders(): { id: OAuthProvider; label: string }[] {
  return (['google', 'github'] as const)
    .map((id) => readProvider(id))
    .filter((p): p is ProviderConfig => p !== null)
    .map((p) => ({ id: p.id, label: p.label }));
}

export function providerConfigured(id: OAuthProvider): boolean {
  return readProvider(id) !== null;
}

/** The exact redirect URI, which must match what is registered with the provider. */
export function redirectUri(id: OAuthProvider, requestOrigin: string): string {
  const base = (process.env.APP_URL?.trim() || requestOrigin).replace(/\/$/, '');
  return `${base}/api/auth/oauth/${id}/callback`;
}

/* ------------------------------------------------------------------ */
/* The authorisation request                                           */
/* ------------------------------------------------------------------ */

export interface PendingAuth {
  provider: OAuthProvider;
  state: string;
  codeVerifier: string;
}

const base64url = (b: Buffer) => b.toString('base64url');

/** Builds the URL to send the administrator to, and the state to remember. */
export function beginAuthorisation(
  id: OAuthProvider,
  origin: string,
): { url: string; pending: PendingAuth } {
  const provider = readProvider(id);
  if (!provider) throw new OAuthError(`Sign in with ${id} is not configured on this server.`, 404);

  const state = base64url(randomBytes(32));
  const codeVerifier = base64url(randomBytes(32));

  const params = new URLSearchParams({
    client_id: provider.clientId,
    redirect_uri: redirectUri(id, origin),
    response_type: 'code',
    scope: provider.scope,
    state,
  });

  if (provider.usesPkce) {
    params.set('code_challenge', base64url(createHash('sha256').update(codeVerifier).digest()));
    params.set('code_challenge_method', 'S256');
    // Ask Google for an account chooser rather than silently reusing one.
    params.set('prompt', 'select_account');
  }

  return { url: `${provider.authorizeUrl}?${params.toString()}`, pending: { provider: id, state, codeVerifier } };
}

/** Constant-time comparison of the returned state against the remembered one. */
export function stateMatches(expected: string, actual: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(actual);
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}

/* ------------------------------------------------------------------ */
/* The profile                                                         */
/* ------------------------------------------------------------------ */

export interface ProviderProfile {
  providerUserId: string;
  /** Only ever set when the provider says the address is verified. */
  email: string | null;
  displayName: string;
  avatarUrl: string | null;
}

async function exchangeCode(
  provider: ProviderConfig,
  code: string,
  origin: string,
  codeVerifier: string,
): Promise<string> {
  const body = new URLSearchParams({
    client_id: provider.clientId,
    client_secret: provider.clientSecret,
    code,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri(provider.id, origin),
  });
  if (provider.usesPkce) body.set('code_verifier', codeVerifier);

  const response = await fetch(provider.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body,
  });

  const payload = (await response.json().catch(() => null)) as
    | { access_token?: string; error_description?: string; error?: string }
    | null;

  if (!response.ok || !payload?.access_token) {
    // Never echo the provider's raw response: it can contain the secret.
    throw new OAuthError(
      `${provider.label} did not accept the sign-in attempt. Check the client id, secret and redirect URI.`,
      502,
    );
  }
  return payload.access_token;
}

async function fetchProfile(provider: ProviderConfig, accessToken: string): Promise<ProviderProfile> {
  if (provider.id === 'google') {
    const response = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) throw new OAuthError('Could not read your Google profile.', 502);
    const p = (await response.json()) as {
      sub: string;
      email?: string;
      email_verified?: boolean;
      name?: string;
      picture?: string;
    };
    return {
      providerUserId: p.sub,
      // An unverified address proves nothing about who owns it.
      email: p.email && p.email_verified ? p.email.toLowerCase() : null,
      displayName: p.name || p.email || 'Google user',
      avatarUrl: p.picture ?? null,
    };
  }

  const headers = { Authorization: `Bearer ${accessToken}`, Accept: 'application/vnd.github+json' };
  const userResponse = await fetch('https://api.github.com/user', { headers });
  if (!userResponse.ok) throw new OAuthError('Could not read your GitHub profile.', 502);
  const user = (await userResponse.json()) as {
    id: number;
    login: string;
    name?: string;
    avatar_url?: string;
  };

  // The profile email may be unverified or hidden, so ask for the verified
  // primary address explicitly.
  let email: string | null = null;
  const emailResponse = await fetch('https://api.github.com/user/emails', { headers });
  if (emailResponse.ok) {
    const emails = (await emailResponse.json()) as { email: string; primary: boolean; verified: boolean }[];
    email = emails.find((e) => e.primary && e.verified)?.email?.toLowerCase() ?? null;
  }

  return {
    providerUserId: String(user.id),
    email,
    displayName: user.name || user.login,
    avatarUrl: user.avatar_url ?? null,
  };
}

/* ------------------------------------------------------------------ */
/* The policy                                                          */
/* ------------------------------------------------------------------ */

/** Emails explicitly permitted to become administrators via a provider. */
export function allowedEmails(): string[] {
  return (process.env.ADMIN_ALLOWED_EMAILS ?? '')
    .split(/[,\s]+/)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export interface SignInDecision {
  allowed: boolean;
  reason?: string;
  userId?: string;
  created?: boolean;
}

/**
 * Decides whether a provider profile may sign in, and to which account.
 *
 * Kept separate from the HTTP flow so it can be tested directly: this is the
 * function that stands between a public deployment and anyone on the
 * internet with a Google account.
 */
export async function decideSignIn(
  provider: OAuthProvider,
  profile: ProviderProfile,
): Promise<SignInDecision> {
  // 1. An identity already linked to an account always signs in to it.
  const linked = await queryOne<{ user_id: string }>(
    'SELECT user_id FROM user_identities WHERE provider = $1 AND provider_user_id = $2',
    [provider, profile.providerUserId],
  );
  if (linked) return { allowed: true, userId: linked.user_id };

  // 2. Everything below needs an address the provider has verified.
  if (!profile.email) {
    return {
      allowed: false,
      reason:
        'Your account has no verified email address, so it cannot be matched to an administrator account.',
    };
  }

  // 3. An existing administrator may link this provider to their account.
  const existing = await queryOne<{ id: string }>('SELECT id FROM users WHERE lower(email) = lower($1)', [
    profile.email,
  ]);
  if (existing) return { allowed: true, userId: existing.id };

  // 4. Otherwise, only an explicitly listed address may create an account.
  if (allowedEmails().includes(profile.email)) {
    const created = await queryOne<{ id: string }>(
      `INSERT INTO users (email, password_hash, role, display_name)
         VALUES ($1, NULL, 'admin', $2) RETURNING id`,
      [profile.email, profile.displayName.slice(0, 80)],
    );
    return { allowed: true, userId: created!.id, created: true };
  }

  return {
    allowed: false,
    reason:
      'That account is not an administrator of this deployment. Ask whoever runs it to add your address to ADMIN_ALLOWED_EMAILS.',
  };
}

/* ------------------------------------------------------------------ */
/* The whole callback                                                  */
/* ------------------------------------------------------------------ */

export interface CompletedSignIn {
  userId: string;
  email: string | null;
  displayName: string;
  created: boolean;
}

export async function completeAuthorisation(
  id: OAuthProvider,
  code: string,
  origin: string,
  codeVerifier: string,
): Promise<CompletedSignIn> {
  const provider = readProvider(id);
  if (!provider) throw new OAuthError(`Sign in with ${id} is not configured on this server.`, 404);

  const accessToken = await exchangeCode(provider, code, origin, codeVerifier);
  const profile = await fetchProfile(provider, accessToken);
  const decision = await decideSignIn(id, profile);

  if (!decision.allowed || !decision.userId) {
    await recordAudit({
      actorType: 'admin',
      eventType: 'admin.oauth_refused',
      payload: { provider: id, email: profile.email, reason: decision.reason },
    });
    throw new OAuthError(decision.reason ?? 'That account may not sign in here.', 403);
  }

  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO user_identities
         (user_id, provider, provider_user_id, email, display_name, avatar_url, last_login_at)
       VALUES ($1, $2, $3, $4, $5, $6, now())
       ON CONFLICT (provider, provider_user_id) DO UPDATE SET
         email = EXCLUDED.email,
         display_name = EXCLUDED.display_name,
         avatar_url = EXCLUDED.avatar_url,
         last_login_at = now()`,
      [
        decision.userId,
        id,
        profile.providerUserId,
        profile.email,
        profile.displayName.slice(0, 120),
        profile.avatarUrl,
      ],
    );
    await client.query('UPDATE users SET last_login_at = now() WHERE id = $1', [decision.userId]);
  });

  await recordAudit({
    userId: decision.userId,
    actorType: 'admin',
    eventType: decision.created ? 'admin.oauth_account_created' : 'admin.oauth_login',
    payload: { provider: id, email: profile.email },
  });

  return {
    userId: decision.userId,
    email: profile.email,
    displayName: profile.displayName,
    created: decision.created ?? false,
  };
}

/** Which providers an administrator has already linked. */
export async function linkedProviders(userId: string): Promise<OAuthProvider[]> {
  const rows = await query<{ provider: OAuthProvider }>(
    'SELECT provider FROM user_identities WHERE user_id = $1',
    [userId],
  );
  return rows.map((r) => r.provider);
}
