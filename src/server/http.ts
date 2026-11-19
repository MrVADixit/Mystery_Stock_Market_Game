/** Shared helpers for the route handlers. */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { ZodError } from 'zod';
import type { ZodType } from 'zod';
import { AuthError } from './auth';
import { GameStateError } from './games';
import { TradeError } from './trading';
import { SecretError } from './secrets-service';
import { IntelError } from './intel';
import { RegistrationError } from './participants';
import { TemplateError } from './game-templates';
import { consume } from './ratelimit';
import { hashIp } from './ids';
import { authSecret } from './env';

export function json(body: unknown, init?: ResponseInit): NextResponse {
  return NextResponse.json(body as Record<string, unknown>, {
    ...init,
    headers: { 'Cache-Control': 'no-store', ...(init?.headers ?? {}) },
  });
}

export function errorResponse(message: string, status = 400, extra?: Record<string, unknown>) {
  return json({ error: message, ...extra }, { status });
}

/** Maps the service-layer error types onto HTTP statuses. */
export function handleError(e: unknown): NextResponse {
  if (
    e instanceof AuthError ||
    e instanceof GameStateError ||
    e instanceof SecretError ||
    e instanceof IntelError ||
    e instanceof RegistrationError ||
    e instanceof TemplateError
  ) {
    return errorResponse(e.message, e.status);
  }
  if (e instanceof TradeError) {
    return errorResponse(e.message, e.status, { code: e.code });
  }
  if (e instanceof ZodError) {
    return errorResponse(e.issues.map((i) => i.message).join('; ') || 'Invalid request.', 422);
  }
  console.error('[api] unhandled error', e);
  return errorResponse('Something went wrong on the server.', 500);
}

export async function parseBody<T>(request: NextRequest, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new ZodError([
      { code: 'custom', path: [], message: 'Expected a JSON request body.' },
    ] as never);
  }
  return schema.parse(raw);
}

/** Best-effort client address, for rate-limit buckets and the audit trail. */
export function clientIp(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return request.headers.get('x-real-ip') ?? 'unknown';
}

export function clientIpHash(request: NextRequest): string | null {
  try {
    return hashIp(clientIp(request), authSecret());
  } catch {
    return null;
  }
}

/**
 * Applies a rate limit and returns a 429 response when exceeded, or null to
 * carry on.
 */
export async function rateLimit(
  key: string,
  capacity: number,
  windowSeconds: number,
): Promise<NextResponse | null> {
  const result = await consume(key, capacity, windowSeconds);
  if (result.allowed) return null;
  return json(
    { error: 'Too many requests. Please slow down.' },
    {
      status: 429,
      headers: { 'Retry-After': String(Math.max(1, result.retryAfterSeconds)) },
    },
  );
}
