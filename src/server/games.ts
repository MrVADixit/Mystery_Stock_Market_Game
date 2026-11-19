/**
 * Game session lifecycle.
 */

import type { PoolClient } from 'pg';
import { query, withTransaction } from './db';
import { generateJoinCode, generateToken } from './ids';
import { loadConfig, saveConfig, getGame } from './config-store';
import type { GameRow } from './config-store';
import { recordAuditIn } from './audit';
import { configForTemplate } from './game-templates';
import type { TemplateSource } from './game-templates';
import { scrambleConfig, randomSeed } from '@/engine/scramble';
import { initialPrices } from '@/engine/settle';
import { hasBlockingErrors, validateConfig } from '@/engine/validate';
import { runReadinessCheck } from '@/engine/readiness';
import type { SessionConfig } from '@/engine/types';

export class GameStateError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export interface CreateGameOptions {
  name: string;
  /** Which template to start from. */
  template: { source: TemplateSource; id?: string; stocks?: number };
  rounds?: number;
  roundSeconds?: number;
  /**
   * Re-assign the mechanics and vary the numbers, so that a participant who
   * has played this template before gets no advantage. On by default.
   */
  scramble?: boolean;
  /** A specific seed, for reproducing a session exactly. */
  seed?: number;
}

/** Creates a draft game from a built-in template, a saved one, or nothing. */
export async function createGame(
  adminUserId: string,
  options: CreateGameOptions,
): Promise<{ gameId: string; joinCode: string; scrambleSeed: number | null; templateName: string }> {
  const { config: base, templateName } = await configForTemplate(adminUserId, options.template, {
    name: options.name,
    rounds: options.rounds,
    roundSeconds: options.roundSeconds,
  });

  // A blank game has nothing to scramble.
  const shouldScramble = (options.scramble ?? true) && options.template.source !== 'blank';
  const scrambleSeed = shouldScramble ? (options.seed ?? randomSeed()) : null;
  const config = scrambleSeed != null ? scrambleConfig(base, { seed: scrambleSeed }) : base;

  return withTransaction(async (client) => {
    // Retry on the astronomically unlikely join-code collision.
    let joinCode = generateJoinCode();
    for (let attempt = 0; attempt < 5; attempt++) {
      const clash = await client.query('SELECT 1 FROM games WHERE upper(join_code) = upper($1)', [joinCode]);
      if (clash.rowCount === 0) break;
      joinCode = generateJoinCode();
    }

    const rows = await client.query<{ id: string }>(
      `INSERT INTO games (name, admin_user_id, status, join_code, display_token,
                          template_id, template_source, template_name, scramble_seed)
         VALUES ($1, $2, 'draft', $3, $4, $5, $6, $7, $8) RETURNING id`,
      [
        config.name,
        adminUserId,
        joinCode,
        generateToken(),
        options.template.id ?? null,
        options.template.source,
        templateName,
        scrambleSeed,
      ],
    );
    const gameId = rows.rows[0].id;
    await saveConfig(client, gameId, config);
    await recordAuditIn(client, {
      gameId,
      userId: adminUserId,
      actorType: 'admin',
      eventType: 'game.created',
      payload: {
        template: options.template,
        templateName,
        scrambleSeed,
        name: config.name,
        stocks: config.stocks.length,
      },
    });
    return { gameId, joinCode, scrambleSeed, templateName };
  });
}

/** Replaces a game's configuration. Only possible before it starts. */
export async function updateConfig(
  gameId: string,
  adminUserId: string,
  config: SessionConfig,
): Promise<void> {
  const game = await getGame(gameId);
  if (!game) throw new GameStateError('That game does not exist.', 404);
  if (game.status !== 'draft' && game.status !== 'registration') {
    throw new GameStateError('The configuration cannot be changed once the game has started.', 409);
  }
  const issues = validateConfig(config);
  if (hasBlockingErrors(issues)) {
    throw new GameStateError(
      `This configuration has ${issues.filter((i) => i.level === 'error').length} problem(s) that must be fixed first.`,
      422,
    );
  }
  await withTransaction(async (client) => {
    await saveConfig(client, gameId, config);
    await recordAuditIn(client, {
      gameId,
      userId: adminUserId,
      actorType: 'admin',
      eventType: 'game.config_updated',
      payload: { rounds: config.rounds, stocks: config.stocks.length },
    });
  });
}

export async function openRegistration(gameId: string, adminUserId: string): Promise<void> {
  const game = await getGame(gameId);
  if (!game) throw new GameStateError('That game does not exist.', 404);
  if (game.status !== 'draft' && game.status !== 'registration') {
    throw new GameStateError('Registration can only be opened before the game starts.', 409);
  }
  await withTransaction(async (client) => {
    await client.query(`UPDATE games SET status = 'registration' WHERE id = $1`, [gameId]);
    await recordAuditIn(client, {
      gameId,
      userId: adminUserId,
      actorType: 'admin',
      eventType: 'game.registration_opened',
    });
  });
}

export async function setWarningsAcknowledged(gameId: string, acknowledged: boolean): Promise<void> {
  await query('UPDATE games SET warnings_acknowledged = $2 WHERE id = $1', [gameId, acknowledged]);
}

/**
 * Starts the game: closes registration, opens round 1 and writes the
 * opening prices. Refuses if the readiness check finds blocking errors —
 * a game is never started on a configuration that cannot run.
 */
export async function startGame(gameId: string, adminUserId: string): Promise<void> {
  const config = await loadConfig(gameId);
  if (!config) throw new GameStateError('That game does not exist.', 404);

  const report = runReadinessCheck(config);
  if (report.verdict === 'NEEDS_CORRECTION') {
    throw new GameStateError(
      `This game is not ready: ${report.summary} Run TEST MY GAME for the details.`,
      422,
    );
  }

  await withTransaction(async (client) => {
    const locked = await client.query<GameRow>('SELECT * FROM games WHERE id = $1 FOR UPDATE', [gameId]);
    const game = locked.rows[0];
    if (!game) throw new GameStateError('That game does not exist.', 404);
    if (game.status === 'running') return; // already started; idempotent
    if (game.status !== 'draft' && game.status !== 'registration') {
      throw new GameStateError('This game cannot be started from its current state.', 409);
    }

    const participants = await client.query<{ id: string }>(
      'SELECT id FROM participants WHERE game_id = $1',
      [gameId],
    );

    // Grant the configured starting resources.
    for (const p of participants.rows) {
      await client.query(
        `UPDATE participants
            SET cash = $2, starting_cash = $2, pieces = $3, secret_tokens = $4
          WHERE id = $1`,
        [
          p.id,
          config.startingCash,
          config.intel.mode === 'pieces' ? config.intel.startingPieces : 0,
          config.secrets.enabled ? config.secrets.tokensPerParticipant : 0,
        ],
      );
      if (config.intel.mode === 'pieces' && config.intel.startingPieces > 0) {
        await client.query(
          `INSERT INTO piece_ledger (game_id, participant_id, delta, reason, round)
             VALUES ($1, $2, $3, 'starting allocation', 1)`,
          [gameId, p.id, config.intel.startingPieces],
        );
      }
    }

    // Opening prices for round 1.
    const prices = initialPrices(config);
    for (const [stockId, price] of Object.entries(prices)) {
      await client.query(
        `INSERT INTO stock_prices (game_id, stock_id, round, price) VALUES ($1, $2, 1, $3)
         ON CONFLICT (game_id, stock_id, round) DO UPDATE SET price = EXCLUDED.price`,
        [gameId, stockId, price],
      );
    }

    await client.query(
      `INSERT INTO rounds (game_id, round, status, opened_at, ends_at)
         VALUES ($1, 1, 'open', now(), now() + make_interval(secs => $2))
       ON CONFLICT (game_id, round) DO NOTHING`,
      [gameId, config.roundSeconds],
    );

    await client.query(
      `UPDATE games
          SET status = 'running', current_round = 1, started_at = now(),
              round_started_at = now(), round_ends_at = now() + make_interval(secs => $2)
        WHERE id = $1`,
      [gameId, config.roundSeconds],
    );

    // Reveal anything scheduled for round 1.
    await revealDisclosuresFor(client, gameId, config, 1);

    await recordAuditIn(client, {
      gameId,
      userId: adminUserId,
      actorType: 'admin',
      eventType: 'game.started',
      round: 1,
      payload: { participants: participants.rowCount ?? 0, rounds: config.rounds },
    });
  });
}

/** Records the disclosure segments that become public at the start of `round`. */
export async function revealDisclosuresFor(
  client: PoolClient,
  gameId: string,
  config: SessionConfig,
  round: number,
): Promise<number> {
  let revealed = 0;
  for (const [index, scheduledRound] of config.disclosure.rounds.entries()) {
    if (scheduledRound !== round) continue;
    for (const stock of config.stocks) {
      const res = await client.query(
        `INSERT INTO disclosure_events (game_id, stock_id, segment_index, round)
           VALUES ($1, $2, $3, $4)
         ON CONFLICT (game_id, stock_id, segment_index) DO NOTHING`,
        [gameId, stock.id, index, round],
      );
      revealed += res.rowCount ?? 0;
    }
  }
  return revealed;
}

export async function pauseGame(gameId: string, adminUserId: string): Promise<void> {
  await withTransaction(async (client) => {
    const game = (await client.query<GameRow>('SELECT * FROM games WHERE id = $1 FOR UPDATE', [gameId]))
      .rows[0];
    if (!game) throw new GameStateError('That game does not exist.', 404);
    if (game.status !== 'running') throw new GameStateError('Only a running game can be paused.', 409);
    // Remember how long was left so resuming is fair.
    await client.query(
      `UPDATE games SET status = 'paused',
              round_ends_at = round_ends_at
        WHERE id = $1`,
      [gameId],
    );
    await recordAuditIn(client, {
      gameId,
      userId: adminUserId,
      actorType: 'admin',
      eventType: 'game.paused',
      round: game.current_round,
      payload: { secondsLeft: game.round_ends_at ? Math.max(0, Math.round((game.round_ends_at.getTime() - Date.now()) / 1000)) : null },
    });
  });
}

export async function resumeGame(gameId: string, adminUserId: string, secondsLeft: number): Promise<void> {
  await withTransaction(async (client) => {
    const game = (await client.query<GameRow>('SELECT * FROM games WHERE id = $1 FOR UPDATE', [gameId]))
      .rows[0];
    if (!game) throw new GameStateError('That game does not exist.', 404);
    if (game.status !== 'paused') throw new GameStateError('Only a paused game can be resumed.', 409);
    const seconds = Math.max(5, Math.round(secondsLeft));
    await client.query(
      `UPDATE games SET status = 'running',
              round_started_at = now(),
              round_ends_at = now() + make_interval(secs => $2)
        WHERE id = $1`,
      [gameId, seconds],
    );
    await client.query(
      `UPDATE rounds SET ends_at = now() + make_interval(secs => $3)
        WHERE game_id = $1 AND round = $2`,
      [gameId, game.current_round, seconds],
    );
    await recordAuditIn(client, {
      gameId,
      userId: adminUserId,
      actorType: 'admin',
      eventType: 'game.resumed',
      round: game.current_round,
      payload: { secondsLeft: seconds },
    });
  });
}

export async function archiveGame(gameId: string, adminUserId: string): Promise<void> {
  await withTransaction(async (client) => {
    await client.query(
      `UPDATE games SET status = 'archived', archived_at = now() WHERE id = $1 AND status = 'finished'`,
      [gameId],
    );
    await recordAuditIn(client, { gameId, userId: adminUserId, actorType: 'admin', eventType: 'game.archived' });
  });
}

export async function regenerateDisplayToken(gameId: string): Promise<string> {
  const token = generateToken();
  await query('UPDATE games SET display_token = $2 WHERE id = $1', [gameId, token]);
  return token;
}

export async function revokeDisplayToken(gameId: string): Promise<void> {
  await query('UPDATE games SET display_token = NULL WHERE id = $1', [gameId]);
}

export async function listGamesFor(adminUserId: string, isOwner: boolean) {
  return query<{
    id: string;
    name: string;
    status: string;
    current_round: number;
    join_code: string;
    created_at: Date;
    participant_count: number;
    rounds: number;
    template_name: string | null;
    scramble_seed: number | null;
  }>(
    `SELECT g.id, g.name, g.status, g.current_round, g.join_code, g.created_at,
            g.template_name, g.scramble_seed,
            COALESCE(c.rounds, 0) AS rounds,
            (SELECT count(*) FROM participants p WHERE p.game_id = g.id)::int AS participant_count
       FROM games g
       LEFT JOIN game_configs c ON c.game_id = g.id
      WHERE ($2::boolean OR g.admin_user_id = $1)
      ORDER BY g.created_at DESC
      LIMIT 200`,
    [adminUserId, isOwner],
  );
}

export { loadConfig, getGame };
