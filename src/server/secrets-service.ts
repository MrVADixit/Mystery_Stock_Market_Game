/**
 * The IMPOSE A SECRET action.
 */

import { withTransaction } from './db';
import { loadConfig } from './config-store';
import type { GameRow } from './config-store';
import { recordAuditIn } from './audit';
import { advanceIfDue, loadSecretActivations } from './rounds';
import { canActivateSecret, secretWindows } from '@/engine/secrets';
import type { StockId } from '@/engine/types';

export class SecretError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export interface SecretReceipt {
  stockId: StockId;
  activatedRound: number;
  firstRound: number;
  lastRound: number;
  tokensRemaining: number;
}

export async function imposeSecret(
  gameId: string,
  participantId: string,
  stockId: StockId,
): Promise<SecretReceipt> {
  await advanceIfDue(gameId);

  return withTransaction(async (client) => {
    const game = (await client.query<GameRow>('SELECT * FROM games WHERE id = $1', [gameId])).rows[0];
    if (!game) throw new SecretError('That game does not exist.', 404);
    if (game.status !== 'running') throw new SecretError('Secrets can only be imposed during a live round.', 409);

    const config = await loadConfig(gameId, client);
    if (!config) throw new SecretError('That game has no configuration.', 500);
    if (!config.stocks.some((s) => s.id === stockId)) {
      throw new SecretError('That stock is not in this game.', 404);
    }

    const participant = (
      await client.query<{ secret_tokens: number }>(
        'SELECT secret_tokens FROM participants WHERE id = $1 AND game_id = $2 FOR UPDATE',
        [participantId, gameId],
      )
    ).rows[0];
    if (!participant) throw new SecretError('You are not registered in this game.', 403);

    const windows = secretWindows(config.secrets, await loadSecretActivations(client, gameId));
    const permission = canActivateSecret(
      config.secrets,
      windows,
      stockId,
      game.current_round,
      participant.secret_tokens,
    );
    if (!permission.allowed) throw new SecretError(permission.reason ?? 'You cannot do that now.', 409);

    const firstRound = game.current_round + 1;
    const lastRound = game.current_round + config.secrets.durationRounds;

    await client.query(
      `INSERT INTO secret_activations
         (game_id, participant_id, stock_id, activated_round, first_round, last_round)
         VALUES ($1,$2,$3,$4,$5,$6)`,
      [gameId, participantId, stockId, game.current_round, firstRound, lastRound],
    );
    const updated = (
      await client.query<{ secret_tokens: number }>(
        'UPDATE participants SET secret_tokens = secret_tokens - 1 WHERE id = $1 RETURNING secret_tokens',
        [participantId],
      )
    ).rows[0];

    await recordAuditIn(client, {
      gameId,
      participantId,
      actorType: 'participant',
      eventType: 'secret.imposed',
      round: game.current_round,
      payload: { stockId, firstRound, lastRound },
    });

    return {
      stockId,
      activatedRound: game.current_round,
      firstRound,
      lastRound,
      tokensRemaining: updated.secret_tokens,
    };
  });
}
