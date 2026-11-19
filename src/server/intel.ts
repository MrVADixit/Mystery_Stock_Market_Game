/**
 * BUY RULE INTEL and the Piece economy.
 *
 * A participant always receives the next segment in the predefined
 * disclosure sequence for the stock they pick; they cannot choose an
 * arbitrary hidden fragment. Everything sold comes from the stored rule
 * configuration, so intelligence can never contradict the real rule.
 */

import { query, withTransaction, isUniqueViolation } from './db';
import { loadConfig } from './config-store';
import type { GameRow } from './config-store';
import { recordAuditIn } from './audit';
import { advanceIfDue } from './rounds';
import { nextIntelSegmentIndex, revealedSegmentCount } from '@/engine/disclosure';
import type { SessionConfig, StockId } from '@/engine/types';

export class IntelError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export interface IntelOffer {
  stockId: StockId;
  stockName: string;
  /** Which segment they would get, or null when nothing is left to sell. */
  segmentIndex: number | null;
  costPieces: number;
  costWon: number;
  available: boolean;
  reason?: string;
}

/** What is on sale for this participant right now. */
export async function intelOffers(
  gameId: string,
  participantId: string,
  config: SessionConfig,
  round: number,
): Promise<IntelOffer[]> {
  const publicRevealed = revealedSegmentCount(config, round);
  const owned = await query<{ stock_id: string; segment_index: number }>(
    'SELECT stock_id, segment_index FROM intel_purchases WHERE participant_id = $1',
    [participantId],
  );
  const ownedByStock = new Map<string, number[]>();
  for (const row of owned) {
    const list = ownedByStock.get(row.stock_id) ?? [];
    list.push(row.segment_index);
    ownedByStock.set(row.stock_id, list);
  }

  const pastDeadline = round > config.intel.deadlineRound;
  const costPieces = config.intel.mode === 'pieces' ? 1 : 0;
  const costWon = config.intel.mode === 'cash' ? config.intel.cashPricePerIntelWon : 0;

  return config.stocks.map((stock) => {
    const segmentIndex = nextIntelSegmentIndex(publicRevealed, ownedByStock.get(stock.id) ?? []);
    let available = config.intel.mode !== 'disabled' && segmentIndex !== null && !pastDeadline;
    let reason: string | undefined;
    if (config.intel.mode === 'disabled') reason = 'Intelligence is not available in this game.';
    else if (pastDeadline) reason = `Intelligence closed at the end of round ${config.intel.deadlineRound}.`;
    else if (segmentIndex === null) reason = 'You already know everything about this stock.';
    if (!available) available = false;
    return {
      stockId: stock.id,
      stockName: stock.name,
      segmentIndex,
      costPieces,
      costWon,
      available,
      reason,
    };
  });
}

export interface IntelReceipt {
  stockId: StockId;
  segmentIndex: number;
  text: string;
  piecesRemaining: number;
  cashRemaining: number;
}

export async function buyIntel(
  gameId: string,
  participantId: string,
  stockId: StockId,
): Promise<IntelReceipt> {
  await advanceIfDue(gameId);

  return withTransaction(async (client) => {
    const game = (await client.query<GameRow>('SELECT * FROM games WHERE id = $1', [gameId])).rows[0];
    if (!game) throw new IntelError('That game does not exist.', 404);
    if (game.status !== 'running') throw new IntelError('Intelligence can only be bought during a live round.', 409);

    const config = await loadConfig(gameId, client);
    if (!config) throw new IntelError('That game has no configuration.', 500);
    if (config.intel.mode === 'disabled') throw new IntelError('Intelligence is not available in this game.', 409);
    if (game.current_round > config.intel.deadlineRound) {
      throw new IntelError(`Intelligence closed at the end of round ${config.intel.deadlineRound}.`, 409);
    }
    const stock = config.stocks.find((s) => s.id === stockId);
    if (!stock) throw new IntelError('That stock is not in this game.', 404);

    const participant = (
      await client.query<{ cash: number; pieces: number }>(
        'SELECT cash, pieces FROM participants WHERE id = $1 AND game_id = $2 FOR UPDATE',
        [participantId, gameId],
      )
    ).rows[0];
    if (!participant) throw new IntelError('You are not registered in this game.', 403);

    const ownedRows = (
      await client.query<{ segment_index: number }>(
        'SELECT segment_index FROM intel_purchases WHERE participant_id = $1 AND stock_id = $2',
        [participantId, stockId],
      )
    ).rows;
    const publicRevealed = revealedSegmentCount(config, game.current_round);
    const segmentIndex = nextIntelSegmentIndex(
      publicRevealed,
      ownedRows.map((r) => r.segment_index),
    );
    if (segmentIndex === null) {
      throw new IntelError('There is nothing left to learn about that stock.', 409);
    }

    let costPieces = 0;
    let costWon = 0;
    if (config.intel.mode === 'pieces') {
      costPieces = 1;
      if (participant.pieces < 1) throw new IntelError('You have no Pieces left.', 409);
    } else {
      costWon = config.intel.cashPricePerIntelWon;
      if (participant.cash < costWon) {
        throw new IntelError(
          `Intelligence costs ${costWon.toLocaleString('en-US')} won and you have ${participant.cash.toLocaleString('en-US')} won.`,
          409,
        );
      }
    }

    try {
      await client.query(
        `INSERT INTO intel_purchases
           (game_id, participant_id, stock_id, segment_index, round, cost_pieces, cost_won)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [gameId, participantId, stockId, segmentIndex, game.current_round, costPieces, costWon],
      );
    } catch (e) {
      if (isUniqueViolation(e)) throw new IntelError('You already own that fragment.', 409);
      throw e;
    }

    const updated = (
      await client.query<{ cash: number; pieces: number }>(
        `UPDATE participants
            SET pieces = pieces - $2, cash = cash - $3, intel_spend_won = intel_spend_won + $3
          WHERE id = $1 RETURNING cash, pieces`,
        [participantId, costPieces, costWon],
      )
    ).rows[0];

    if (costPieces > 0) {
      await client.query(
        `INSERT INTO piece_ledger (game_id, participant_id, delta, reason, round)
           VALUES ($1,$2,$3,'intelligence purchase',$4)`,
        [gameId, participantId, -costPieces, game.current_round],
      );
    }

    await recordAuditIn(client, {
      gameId,
      participantId,
      actorType: 'participant',
      eventType: 'intel.purchased',
      round: game.current_round,
      payload: { stockId, segmentIndex, costPieces, costWon },
    });

    return {
      stockId,
      segmentIndex,
      text: stock.disclosure.segments[segmentIndex],
      piecesRemaining: updated.pieces,
      cashRemaining: updated.cash,
    };
  });
}

/** Converts Pieces into cash at the configured rate, when enabled. */
export async function exchangePieces(
  gameId: string,
  participantId: string,
  pieces: number,
): Promise<{ piecesRemaining: number; cash: number; received: number }> {
  if (!Number.isSafeInteger(pieces) || pieces < 1) {
    throw new IntelError('Choose a whole number of Pieces to exchange.', 422);
  }
  return withTransaction(async (client) => {
    const config = await loadConfig(gameId, client);
    if (!config) throw new IntelError('That game does not exist.', 404);
    if (config.intel.mode !== 'pieces' || !config.intel.allowPieceToCash) {
      throw new IntelError('Pieces cannot be exchanged for cash in this game.', 409);
    }
    const participant = (
      await client.query<{ pieces: number }>(
        'SELECT pieces FROM participants WHERE id = $1 AND game_id = $2 FOR UPDATE',
        [participantId, gameId],
      )
    ).rows[0];
    if (!participant) throw new IntelError('You are not registered in this game.', 403);
    if (participant.pieces < pieces) throw new IntelError(`You only have ${participant.pieces} Piece(s).`, 409);

    const received = pieces * config.intel.pieceToCashWon;
    const updated = (
      await client.query<{ cash: number; pieces: number }>(
        'UPDATE participants SET pieces = pieces - $2, cash = cash + $3 WHERE id = $1 RETURNING cash, pieces',
        [participantId, pieces, received],
      )
    ).rows[0];
    await client.query(
      `INSERT INTO piece_ledger (game_id, participant_id, delta, reason) VALUES ($1,$2,$3,'exchanged for cash')`,
      [gameId, participantId, -pieces],
    );
    await recordAuditIn(client, {
      gameId,
      participantId,
      actorType: 'participant',
      eventType: 'pieces.exchanged',
      payload: { pieces, received },
    });
    return { piecesRemaining: updated.pieces, cash: updated.cash, received };
  });
}
