/**
 * Trading.
 *
 * Every order is executed inside one transaction that locks the
 * participant's row, so two simultaneous requests can never both pass the
 * cash check. The client supplies an idempotency key; a retried submission
 * returns the original result instead of trading twice.
 */

import { withTransaction } from './db';
import { loadConfig } from './config-store';
import type { GameRow } from './config-store';
import { recordAuditIn } from './audit';
import { loadSecretActivations } from './rounds';
import { advanceIfDue } from './rounds';
import { applyOrder } from '@/engine/orders';
import type { Position, Side } from '@/engine/orders';
import { isSecretActive, secretWindows } from '@/engine/secrets';
import type { StockId } from '@/engine/types';

export class TradeError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export interface TradeRequest {
  gameId: string;
  participantId: string;
  stockId: StockId;
  side: Side;
  /** A whole number of shares, or 'max' for MAX BUY / ALL. */
  quantity: number | 'max';
  idempotencyKey: string;
}

export interface TradeReceipt {
  transactionId: number;
  round: number;
  stockId: StockId;
  side: Side;
  quantity: number;
  price: number;
  amount: number;
  cashAfter: number;
  sharesAfter: number;
  /** True when this request matched an earlier one and nothing new happened. */
  replayed: boolean;
}

export async function executeTrade(req: TradeRequest): Promise<TradeReceipt> {
  if (!req.idempotencyKey || req.idempotencyKey.length < 8 || req.idempotencyKey.length > 128) {
    throw new TradeError('A valid idempotency key is required.', 'IDEMPOTENCY_KEY_INVALID', 422);
  }

  // Settle any overdue round first, so an order never lands in a round that
  // has already run out of time.
  await advanceIfDue(req.gameId);

  return withTransaction(async (client) => {
    // An earlier identical submission wins outright.
    const existing = (
      await client.query<{
        id: number;
        round: number;
        stock_id: string;
        side: Side;
        quantity: number;
        price: number;
        amount: number;
        cash_after: number;
        shares_after: number;
      }>(
        `SELECT id, round, stock_id, side, quantity, price, amount, cash_after, shares_after
           FROM transactions WHERE participant_id = $1 AND idempotency_key = $2`,
        [req.participantId, req.idempotencyKey],
      )
    ).rows[0];
    if (existing) {
      return {
        transactionId: existing.id,
        round: existing.round,
        stockId: existing.stock_id,
        side: existing.side,
        quantity: existing.quantity,
        price: existing.price,
        amount: existing.amount,
        cashAfter: existing.cash_after,
        sharesAfter: existing.shares_after,
        replayed: true,
      };
    }

    const game = (await client.query<GameRow>('SELECT * FROM games WHERE id = $1', [req.gameId])).rows[0];
    if (!game) throw new TradeError('That game does not exist.', 'GAME_NOT_FOUND', 404);
    if (game.status !== 'running') {
      throw new TradeError(
        game.status === 'paused'
          ? 'The game is paused. Trading will reopen when the administrator resumes it.'
          : 'Trading is closed.',
        'TRADING_CLOSED',
        409,
      );
    }

    const round = game.current_round;
    const roundRow = (
      await client.query<{ status: string; ends_at: Date }>(
        `SELECT status, ends_at FROM rounds WHERE game_id = $1 AND round = $2`,
        [req.gameId, round],
      )
    ).rows[0];
    if (!roundRow || roundRow.status !== 'open') {
      throw new TradeError('This round has closed.', 'ROUND_CLOSED', 409);
    }
    // The server decides when trading stops, never the device clock.
    const now = (await client.query<{ now: Date }>('SELECT now() AS now')).rows[0].now;
    if (now.getTime() >= roundRow.ends_at.getTime()) {
      throw new TradeError('This round has closed.', 'ROUND_CLOSED', 409);
    }

    const config = await loadConfig(req.gameId, client);
    if (!config) throw new TradeError('That game has no configuration.', 'CONFIG_MISSING', 500);
    if (!config.stocks.some((s) => s.id === req.stockId)) {
      throw new TradeError('That stock is not in this game.', 'UNKNOWN_STOCK', 404);
    }

    // Trading may be suspended on a stock while a secret covers it.
    if (config.secrets.enabled && config.secrets.tradingDuringSecret === 'suspended') {
      const windows = secretWindows(config.secrets, await loadSecretActivations(client, req.gameId));
      if (isSecretActive(windows, req.stockId, round)) {
        throw new TradeError(
          'Trading in this stock is suspended while a secret is in force.',
          'SECRET_SUSPENDED',
          409,
        );
      }
    }

    // Lock the participant so concurrent orders serialise.
    const participant = (
      await client.query<{ id: string; cash: number; is_blocked: boolean }>(
        'SELECT id, cash, is_blocked FROM participants WHERE id = $1 AND game_id = $2 FOR UPDATE',
        [req.participantId, req.gameId],
      )
    ).rows[0];
    if (!participant) throw new TradeError('You are not registered in this game.', 'NOT_REGISTERED', 403);
    if (participant.is_blocked) throw new TradeError('Your account is blocked.', 'BLOCKED', 403);

    const priceRow = (
      await client.query<{ price: number }>(
        'SELECT price FROM stock_prices WHERE game_id = $1 AND stock_id = $2 AND round = $3',
        [req.gameId, req.stockId, round],
      )
    ).rows[0];
    if (!priceRow) throw new TradeError('That stock has no price this round.', 'NO_PRICE', 500);
    const price = priceRow.price;

    const holdingRows = (
      await client.query<{ stock_id: string; quantity: number }>(
        'SELECT stock_id, quantity FROM holdings WHERE participant_id = $1',
        [req.participantId],
      )
    ).rows;
    const position: Position = {
      cash: participant.cash,
      shares: Object.fromEntries(config.stocks.map((s) => [s.id, 0])),
    };
    for (const h of holdingRows) position.shares[h.stock_id] = h.quantity;

    // MAX BUY / ALL are resolved on the server against the real balance.
    let quantity: number;
    if (req.quantity === 'max') {
      quantity =
        req.side === 'buy'
          ? Math.min(
              Math.floor(position.cash / Math.max(1, price)),
              config.trading.maxSharesPerOrder ?? Number.MAX_SAFE_INTEGER,
              config.trading.maxSharesPerParticipantPerStock != null
                ? Math.max(0, config.trading.maxSharesPerParticipantPerStock - (position.shares[req.stockId] ?? 0))
                : Number.MAX_SAFE_INTEGER,
            )
          : Math.min(position.shares[req.stockId] ?? 0, config.trading.maxSharesPerOrder ?? Number.MAX_SAFE_INTEGER);
      if (quantity < 1) {
        throw new TradeError(
          req.side === 'buy' ? 'You cannot afford a single share.' : 'You have no shares of this stock to sell.',
          'QUANTITY_INVALID',
          422,
        );
      }
    } else {
      quantity = req.quantity;
    }

    const outcome = applyOrder(position, req.side, req.stockId, price, quantity, config);
    if (!outcome.ok) {
      throw new TradeError(outcome.message ?? 'That order was rejected.', outcome.rejection ?? 'REJECTED', 422);
    }

    const inserted = (
      await client.query<{ id: number }>(
        `INSERT INTO transactions (
           game_id, participant_id, round, stock_id, side, quantity, price, amount,
           cash_before, cash_after, shares_before, shares_after, idempotency_key
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         RETURNING id`,
        [
          req.gameId,
          req.participantId,
          round,
          req.stockId,
          req.side,
          quantity,
          price,
          outcome.amount,
          outcome.cashBefore,
          outcome.cashAfter,
          outcome.sharesBefore,
          outcome.sharesAfter,
          req.idempotencyKey,
        ],
      )
    ).rows[0];

    await client.query('UPDATE participants SET cash = $2 WHERE id = $1', [
      req.participantId,
      outcome.cashAfter,
    ]);
    await client.query(
      `INSERT INTO holdings (participant_id, game_id, stock_id, quantity) VALUES ($1,$2,$3,$4)
       ON CONFLICT (participant_id, stock_id) DO UPDATE SET quantity = EXCLUDED.quantity`,
      [req.participantId, req.gameId, req.stockId, outcome.sharesAfter],
    );

    await recordAuditIn(client, {
      gameId: req.gameId,
      participantId: req.participantId,
      actorType: 'participant',
      eventType: `trade.${req.side}`,
      round,
      payload: {
        stockId: req.stockId,
        quantity,
        price,
        amount: outcome.amount,
        cashAfter: outcome.cashAfter,
      },
    });

    return {
      transactionId: inserted.id,
      round,
      stockId: req.stockId,
      side: req.side,
      quantity,
      price,
      amount: outcome.amount,
      cashAfter: outcome.cashAfter,
      sharesAfter: outcome.sharesAfter,
      replayed: false,
    };
  });
}
