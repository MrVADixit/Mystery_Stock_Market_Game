/**
 * Creates a ready-to-run demonstration session owned by the seeded owner
 * account, with registration already open.
 */

import { config as loadEnv } from 'dotenv';
import { closePool, queryOne } from '../src/server/db';
import { createGame, openRegistration } from '../src/server/games';
import { regenerateDisplayToken } from '../src/server/games';

loadEnv({ path: '.env', quiet: true });

async function main() {
  const owner = await queryOne<{ id: string; email: string }>(
    `SELECT id, email FROM users WHERE role = 'owner' ORDER BY created_at LIMIT 1`,
  );
  if (!owner) throw new Error('No owner account. Run npm run db:migrate first.');

  const { gameId, joinCode } = await createGame(owner.id, {
    name: 'Demonstration — Classic Mystery Stock Market',
    preset: 'classic',
    rounds: 24,
    roundSeconds: 300,
  });
  await openRegistration(gameId, owner.id);
  const token = await regenerateDisplayToken(gameId);

  const base = process.env.APP_URL ?? 'http://localhost:3000';
  console.log('\nDemonstration session created.\n');
  console.log(`  Administrator : ${base}/admin  (sign in as ${owner.email})`);
  console.log(`  Join link     : ${base}/join?code=${joinCode}`);
  console.log(`  Join code     : ${joinCode}`);
  console.log(`  Display board : ${base}/display/${gameId}?token=${token}\n`);

  await closePool();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
