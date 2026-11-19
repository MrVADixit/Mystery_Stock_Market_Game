/**
 * Drops every table and re-applies the migrations. Development only.
 */

import { config as loadEnv } from 'dotenv';
import { closePool, query } from '../src/server/db';

loadEnv({ path: '.env', quiet: true });

async function main() {
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DB_RESET !== 'yes') {
    throw new Error('Refusing to reset a production database. Set ALLOW_DB_RESET=yes to override.');
  }
  console.log(`resetting ${process.env.DATABASE_URL?.replace(/:[^:@]*@/, ':***@')}`);
  await query('DROP SCHEMA public CASCADE');
  await query('CREATE SCHEMA public');
  await closePool();
  console.log('schema dropped — now run: npm run db:migrate');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
