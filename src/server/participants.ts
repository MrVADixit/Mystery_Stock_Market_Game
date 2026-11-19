/**
 * Participant registration and reconnection.
 */

import { query, queryOne, withTransaction, isUniqueViolation } from './db';
import { loadConfig } from './config-store';
import type { GameRow } from './config-store';
import { issueParticipantSession } from './auth';
import { hashPassword, verifyPassword } from './password';
import { recordAudit, recordAuditIn } from './audit';

export class RegistrationError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

const NAME_PATTERN = /^[\p{L}\p{N} ._'-]{2,24}$/u;

/**
 * Registers a new participant, or signs an existing one back in with the
 * same name and passphrase. Reconnection restores the account from the
 * database — nothing is kept on the device.
 */
export async function joinGame(input: {
  joinCode: string;
  displayName: string;
  passphrase: string;
}): Promise<{ participantId: string; gameId: string; reconnected: boolean }> {
  const name = input.displayName.trim().replace(/\s+/g, ' ');
  if (!NAME_PATTERN.test(name)) {
    throw new RegistrationError(
      'Please use a name of 2–24 letters, numbers, spaces, dots, apostrophes or hyphens.',
      422,
    );
  }
  if (input.passphrase.length < 4) {
    throw new RegistrationError('Your passphrase needs at least 4 characters.', 422);
  }

  const game = await queryOne<GameRow>('SELECT * FROM games WHERE upper(join_code) = upper($1)', [
    input.joinCode.trim(),
  ]);
  if (!game) throw new RegistrationError('That game code does not match any game.', 404);

  const existing = await queryOne<{ id: string; password_hash: string; is_blocked: boolean }>(
    'SELECT id, password_hash, is_blocked FROM participants WHERE game_id = $1 AND lower(display_name) = lower($2)',
    [game.id, name],
  );

  // Returning player: this is the reconnection path.
  if (existing) {
    if (!(await verifyPassword(input.passphrase, existing.password_hash))) {
      throw new RegistrationError(
        'That name is already taken in this game. If it is yours, check your passphrase.',
        401,
      );
    }
    if (existing.is_blocked) throw new RegistrationError('Your account has been blocked.', 403);
    await issueParticipantSession(existing.id);
    await query('UPDATE participants SET last_seen_at = now() WHERE id = $1', [existing.id]);
    await recordAudit({
      gameId: game.id,
      participantId: existing.id,
      actorType: 'participant',
      eventType: 'participant.reconnected',
      round: game.current_round,
    });
    return { participantId: existing.id, gameId: game.id, reconnected: true };
  }

  // New player: only while registration is open.
  if (game.status !== 'registration') {
    throw new RegistrationError(
      game.status === 'draft'
        ? 'This game has not opened for registration yet.'
        : 'Registration for this game has closed.',
      409,
    );
  }

  const config = await loadConfig(game.id);
  if (!config) throw new RegistrationError('That game has no configuration yet.', 409);

  const passwordHash = await hashPassword(input.passphrase);

  try {
    const participantId = await withTransaction(async (client) => {
      const row = (
        await client.query<{ id: string }>(
          `INSERT INTO participants
             (game_id, display_name, password_hash, cash, starting_cash, pieces, secret_tokens)
             VALUES ($1,$2,$3,$4,$4,$5,$6) RETURNING id`,
          [
            game.id,
            name,
            passwordHash,
            config.startingCash,
            config.intel.mode === 'pieces' ? config.intel.startingPieces : 0,
            config.secrets.enabled ? config.secrets.tokensPerParticipant : 0,
          ],
        )
      ).rows[0];

      for (const stock of config.stocks) {
        await client.query(
          'INSERT INTO holdings (participant_id, game_id, stock_id, quantity) VALUES ($1,$2,$3,0)',
          [row.id, game.id, stock.id],
        );
      }
      if (config.intel.mode === 'pieces' && config.intel.startingPieces > 0) {
        await client.query(
          `INSERT INTO piece_ledger (game_id, participant_id, delta, reason) VALUES ($1,$2,$3,'starting allocation')`,
          [game.id, row.id, config.intel.startingPieces],
        );
      }
      await recordAuditIn(client, {
        gameId: game.id,
        participantId: row.id,
        actorType: 'participant',
        eventType: 'participant.registered',
        payload: { displayName: name },
      });
      return row.id;
    });

    await issueParticipantSession(participantId);
    return { participantId, gameId: game.id, reconnected: false };
  } catch (e) {
    if (isUniqueViolation(e)) {
      throw new RegistrationError('Somebody just took that name. Please pick another.', 409);
    }
    throw e;
  }
}

export interface ParticipantRow {
  id: string;
  game_id: string;
  display_name: string;
  cash: number;
  starting_cash: number;
  pieces: number;
  secret_tokens: number;
  intel_spend_won: number;
  joined_at: Date;
  last_seen_at: Date | null;
}

export async function getParticipant(participantId: string): Promise<ParticipantRow | null> {
  return queryOne<ParticipantRow>('SELECT * FROM participants WHERE id = $1', [participantId]);
}

export async function listParticipants(gameId: string): Promise<ParticipantRow[]> {
  return query<ParticipantRow>(
    'SELECT * FROM participants WHERE game_id = $1 ORDER BY lower(display_name)',
    [gameId],
  );
}

export async function setParticipantBlocked(participantId: string, blocked: boolean): Promise<void> {
  await query('UPDATE participants SET is_blocked = $2 WHERE id = $1', [participantId, blocked]);
}
