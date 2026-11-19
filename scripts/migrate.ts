/**
 * Applies every SQL file in db/migrations, in name order, exactly once.
 * Safe to run repeatedly.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { config as loadEnv } from 'dotenv';
import { closePool, query, withTransaction } from '../src/server/db';
import { hashPassword, verifyPassword } from '../src/server/password';

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

  // The OWNER_EMAIL / OWNER_PASSWORD variables are the source of truth for
  // the owner account. The account is created from them if it is missing,
  // and its password is brought back into line with them if they differ.
  //
  // That second part is what makes a forgotten administrator password
  // recoverable: change the variable where the application is hosted,
  // redeploy, and the next start resets it. Without it the only route back
  // in would be editing the database by hand.
  const email = process.env.OWNER_EMAIL;
  const password = process.env.OWNER_PASSWORD;

  if (email && password) {
    const existing = await query<{ id: string; password_hash: string; role: string }>(
      'SELECT id, password_hash, role FROM users WHERE lower(email) = lower($1)',
      [email],
    );

    if (existing.length === 0) {
      await query(
        `INSERT INTO users (email, password_hash, role, display_name) VALUES ($1, $2, 'owner', $3)`,
        [email, await hashPassword(password), 'Owner'],
      );
      console.log(`created owner account ${email}`);
    } else {
      const owner = existing[0];
      // Only rewrite the hash when the configured password no longer opens
      // the account, so an unchanged variable does not churn it on every
      // deployment.
      if (!(await verifyPassword(password, owner.password_hash))) {
        await query('UPDATE users SET password_hash = $2 WHERE id = $1', [
          owner.id,
          await hashPassword(password),
        ]);
        console.log(`owner password for ${email} reset to match OWNER_PASSWORD`);
      }
      if (owner.role !== 'owner') {
        await query(`UPDATE users SET role = 'owner' WHERE id = $1`, [owner.id]);
        console.log(`restored owner role for ${email}`);
      }
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
