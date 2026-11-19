/**
 * PostgreSQL access.
 *
 * Every monetary column is BIGINT. node-postgres returns BIGINT as a string
 * by default to avoid silent precision loss; because every figure in this
 * game is well inside the safe-integer range we parse them to numbers here,
 * once, so the rest of the server only ever sees integers.
 */

import { Pool, types } from 'pg';
import type { PoolClient, QueryResultRow } from 'pg';

// 20 = int8/bigint, 1700 = numeric.
types.setTypeParser(20, (v) => {
  const n = Number(v);
  if (!Number.isSafeInteger(n)) {
    throw new Error(`Database returned a bigint outside the safe integer range: ${v}`);
  }
  return n;
});
types.setTypeParser(1700, (v) => Number(v));

let pool: Pool | null = null;

export function getPool(): Pool {
  if (pool) return pool;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set. Copy .env.example to .env and fill it in.');
  }
  pool = new Pool({
    connectionString,
    max: Number(process.env.PGPOOL_MAX ?? 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    ssl: connectionString.includes('sslmode=require') ? { rejectUnauthorized: true } : undefined,
  });
  pool.on('error', (err) => {
    console.error('[db] idle client error', err);
  });
  return pool;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const result = await getPool().query<T>(sql, params as never[]);
  return result.rows;
}

export async function queryOne<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

/**
 * Runs `fn` inside a single transaction. Used for every state change that
 * must be atomic — trades above all, where the cash check and the ledger
 * write have to happen together or not at all.
 */
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* the connection is already broken; nothing to roll back */
    }
    throw e;
  } finally {
    client.release();
  }
}

/** True when the error is a unique-constraint violation on `constraint`. */
export function isUniqueViolation(e: unknown, constraint?: string): boolean {
  const err = e as { code?: string; constraint?: string };
  if (err?.code !== '23505') return false;
  return constraint ? err.constraint === constraint : true;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
