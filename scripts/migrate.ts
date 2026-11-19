/**
 * Applies every SQL file in db/migrations, in name order, exactly once.
 * Safe to run repeatedly.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { config as loadEnv } from 'dotenv';
import { closePool, query, withTransaction } from '../src/server/db';
import { hashPassword } from '../src/server/password';

loadEnv({ path: '.env', quiet: true });

const DIR = join(process.cwd(), 'db', 'migrations');

async function main() {
  await query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       TEXT PRIMARY KEY,
      checksum   TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const applied = new Map(
    (await query<{ name: string; checksum: string }>('SELECT name, checksum FROM schema_migrations')).map(
      (r) => [r.name, r.checksum],
    ),
  );

  const files = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
  let count = 0;

  for (const file of files) {
    const sql = readFileSync(join(DIR, file), 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    const existing = applied.get(file);
    if (existing) {
      if (existing !== checksum) {
        throw new Error(
          `Migration ${file} has changed since it was applied. Add a new migration instead of editing an old one.`,
        );
      }
      continue;
    }
    console.log(`applying ${file}`);
    await withTransaction(async (client) => {
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [file, checksum]);
    });
    count++;
  }

  console.log(count === 0 ? 'schema already up to date' : `${count} migration(s) applied`);

  // Seed the owner account if it does not exist yet.
  const email = process.env.OWNER_EMAIL;
  const password = process.env.OWNER_PASSWORD;
  if (email && password) {
    const existing = await query('SELECT id FROM users WHERE lower(email) = lower($1)', [email]);
    if (existing.length === 0) {
      await query(
        `INSERT INTO users (email, password_hash, role, display_name) VALUES ($1, $2, 'owner', $3)`,
        [email, await hashPassword(password), 'Owner'],
      );
      console.log(`created owner account ${email}`);
    }
  } else {
    console.log('OWNER_EMAIL / OWNER_PASSWORD not set; no owner account created');
  }

  await closePool();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
