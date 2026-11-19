/**
 * Token-bucket rate limiting, held in Postgres so it works across every
 * server instance rather than only the one that happens to serve a request.
 */

import { query } from './db';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/**
 * Consumes one token from `bucket`, refilling `capacity` tokens every
 * `windowSeconds`. Returns whether the caller may proceed.
 */
export async function consume(
  bucket: string,
  capacity: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const rows = await query<{ tokens: number; seconds_left: number }>(
    `INSERT INTO rate_limits (bucket, tokens, window_start)
       VALUES ($1, $2 - 1, now())
     ON CONFLICT (bucket) DO UPDATE SET
       tokens = CASE
         WHEN now() - rate_limits.window_start >= make_interval(secs => $3) THEN $2 - 1
         ELSE GREATEST(rate_limits.tokens - 1, -1)
       END,
       window_start = CASE
         WHEN now() - rate_limits.window_start >= make_interval(secs => $3) THEN now()
         ELSE rate_limits.window_start
       END
     RETURNING tokens,
       GREATEST(0, $3 - EXTRACT(EPOCH FROM (now() - window_start)))::int AS seconds_left`,
    [bucket, capacity, windowSeconds],
  );
  const row = rows[0];
  if (!row) return { allowed: true, remaining: capacity - 1, retryAfterSeconds: 0 };
  return {
    allowed: row.tokens >= 0,
    remaining: Math.max(0, row.tokens),
    retryAfterSeconds: row.tokens >= 0 ? 0 : row.seconds_left,
  };
}

/** Removes stale buckets. Called opportunistically. */
export async function pruneRateLimits(): Promise<void> {
  await query(`DELETE FROM rate_limits WHERE window_start < now() - interval '1 day'`);
}
