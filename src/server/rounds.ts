/**
 * The authoritative round clock and settlement.
 *
 * The device countdown is never authoritative. A round closes when the
 * server says it has closed, and trading is validated against the stored
 * `rounds.ends_at`, not against anything the client sends.
 *
 * Settlement is driven lazily: any read of the game state calls
 * `advanceIfDue`, which takes a row lock on the game, checks whether the
 * current round has expired and, if so, closes and settles it inside one
 * transaction. A background ticker calls the same function so a game with
 * nobody watching still advances. Because the whole thing runs under a lock
 * and checks `rounds.status`, a round can never settle twice however many
 * callers race.
 */

import type { PoolClient } from 'pg';
import { query, withTransaction } from './db';
import { loadConfig } from './config-store';
import type { GameRow } from './config-store';
import { recordAuditIn } from './audit';
import { publish } from './events';
import { revealDisclosuresFor } from './games';
import { secretStateForRound, secretWindows } from '@/engine/secrets';
import type { SecretActivation } from '@/engine/secrets';
import { settleRound } from '@/engine/settle';
import type { RoundSnapshot, SessionConfig, StockId } from '@/engine/types';

export interface AdvanceResult {
  advanced: boolean;
  settledRound?: number;
  newRound?: number;
  finished?: boolean;
}

/**
 * Closes and settles the current round if its time has run out, and keeps
 * going while further rounds are also overdue (which happens if the process
 * was asleep). Returns what changed.
 */
export async function advanceIfDue(gameId: string): Promise<AdvanceResult> {
  let result: AdvanceResult = { advanced: false };
  // Bound the catch-up loop so a long-dormant game cannot spin forever.
  for (let i = 0; i < 500; i++) {
    const step = await advanceOnce(gameId);
    if (!step.advanced) break;
    result = {
      advanced: true,
      settledRound: step.settledRound,
      newRound: step.newRound,
      finished: step.finished || result.finished,
    };
    if (step.finished) break;
  }
  if (result.advanced) {
    // Published after the transaction has committed, so a client that
    // refetches on this signal is guaranteed to see the settled state.
    await publish({ gameId, type: 'round.settled', round: result.settledRound });
    if (result.finished) await publish({ gameId, type: 'game.status' });
  }
  return result;
}

async function advanceOnce(gameId: string): Promise<AdvanceResult> {
  return withTransaction(async (client) => {
    const game = (
      await client.query<GameRow>('SELECT * FROM games WHERE id = $1 FOR UPDATE', [gameId])
    ).rows[0];
    if (!game || game.status !== 'running') return { advanced: false };

    const round = game.current_round;
    if (round < 1) return { advanced: false };

    const roundRow = (
      await client.query<{ status: string; ends_at: Date }>(
        'SELECT status, ends_at FROM rounds WHERE game_id = $1 AND round = $2 FOR UPDATE',
        [gameId, round],
      )
    ).rows[0];
    if (!roundRow) return { advanced: false };
    if (roundRow.status === 'settled') return { advanced: false };

    const now = (await client.query<{ now: Date }>('SELECT now() AS now')).rows[0].now;
    if (roundRow.status === 'open' && now.getTime() < roundRow.ends_at.getTime()) {
      return { advanced: false }; // the round is still live
    }

    const config = await loadConfig(gameId, client);
    if (!config) return { advanced: false };

    // 1. Trading closes.
    await client.query(
      `UPDATE rounds SET status = 'closed', closed_at = COALESCE(closed_at, now())
        WHERE game_id = $1 AND round = $2`,
      [gameId, round],
    );

    // 2. Market statistics are frozen.
    const snapshot = await freezeSnapshot(client, gameId, config, round);

    await client.query(
      `INSERT INTO market_snapshots (game_id, round, snapshot) VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (game_id, round) DO UPDATE SET snapshot = EXCLUDED.snapshot`,
      [gameId, round, JSON.stringify(snapshot)],
    );
    for (const stock of config.stocks) {
      await client.query(
        `INSERT INTO round_stock_activity (game_id, round, stock_id, gross_buys, gross_sells, holdings_end)
           VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (game_id, round, stock_id) DO UPDATE SET
           gross_buys = EXCLUDED.gross_buys,
           gross_sells = EXCLUDED.gross_sells,
           holdings_end = EXCLUDED.holdings_end`,
        [
          gameId,
          round,
          stock.id,
          snapshot.grossBuys[stock.id] ?? 0,
          snapshot.grossSells[stock.id] ?? 0,
          snapshot.holdings[stock.id] ?? 0,
        ],
      );
    }

    // 3. Portfolio values and the leaderboard for the round that just closed.
    await recordRoundValues(client, gameId, round, snapshot.prices);

    const isFinalRound = round >= config.rounds;

    if (!isFinalRound) {
      // 4. The seven templates are evaluated and new prices computed
      //    simultaneously from the frozen snapshot.
      const settlement = settleRound(config, snapshot);

      for (const ev of settlement.evaluations) {
        await client.query(
          `INSERT INTO rule_evaluations (
             game_id, round, stock_id, template_id, branch, opening_price,
             raw_delta, applied_delta, final_price, floored, movement_capped, explanation, inputs
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)
           ON CONFLICT (game_id, round, stock_id) DO NOTHING`,
          [
            gameId,
            round,
            ev.stockId,
            ev.template,
            ev.branch,
            ev.openingPrice,
            ev.rawDelta,
            ev.appliedDelta,
            ev.finalPrice,
            ev.flooredAtMin,
            ev.movementCapped,
            ev.explanation,
            JSON.stringify(ev.inputs),
          ],
        );
        await client.query(
          `INSERT INTO stock_prices (game_id, stock_id, round, price) VALUES ($1, $2, $3, $4)
           ON CONFLICT (game_id, stock_id, round) DO NOTHING`,
          [gameId, ev.stockId, round + 1, ev.finalPrice],
        );
      }

      await client.query(
        `UPDATE rounds SET status = 'settled', settled_at = now() WHERE game_id = $1 AND round = $2`,
        [gameId, round],
      );

      // 5. The next round opens.
      await client.query(
        `INSERT INTO rounds (game_id, round, status, opened_at, ends_at)
           VALUES ($1, $2, 'open', now(), now() + make_interval(secs => $3))
         ON CONFLICT (game_id, round) DO NOTHING`,
        [gameId, round + 1, config.roundSeconds],
      );
      await client.query(
        `UPDATE games
            SET current_round = $2, round_started_at = now(),
                round_ends_at = now() + make_interval(secs => $3)
          WHERE id = $1`,
        [gameId, round + 1, config.roundSeconds],
      );

      // 6. Scheduled rule fragments become public at the start of the round.
      const revealed = await revealDisclosuresFor(client, gameId, config, round + 1);

      await recordAuditIn(client, {
        gameId,
        actorType: 'system',
        eventType: 'round.settled',
        round,
        payload: {
          prices: settlement.prices,
          branches: Object.fromEntries(settlement.evaluations.map((e) => [e.stockId, e.branch])),
          disclosuresRevealed: revealed,
        },
      });

      return { advanced: true, settledRound: round, newRound: round + 1 };
    }

    // Final round: there is no next round to price. Value what is held and
    // rank everyone (§21).
    await client.query(
      `UPDATE rounds SET status = 'settled', settled_at = now() WHERE game_id = $1 AND round = $2`,
      [gameId, round],
    );
    await client.query(
      `UPDATE games SET status = 'finished', finished_at = now(), round_ends_at = now() WHERE id = $1`,
      [gameId],
    );
    await recordAuditIn(client, {
      gameId,
      actorType: 'system',
      eventType: 'game.finished',
      round,
      payload: { finalPrices: snapshot.prices },
    });

    return { advanced: true, settledRound: round, finished: true };
  });
}

/**
 * Builds the frozen market record for a completed round.
 *
 * The five market variables §8.1 insists on keeping apart are each read
 * from their own source: current holdings from `holdings`, the previous
 * round's holdings from `round_stock_activity`, and gross buying and
 * selling separately from the transaction ledger.
 */
export async function freezeSnapshot(
  client: PoolClient,
  gameId: string,
  config: SessionConfig,
  round: number,
): Promise<RoundSnapshot> {
  const ids = config.stocks.map((s) => s.id);

  const priceRows = (
    await client.query<{ stock_id: string; round: number; price: number }>(
      'SELECT stock_id, round, price FROM stock_prices WHERE game_id = $1 AND round = ANY($2::int[])',
      [gameId, [round, round - 1]],
    )
  ).rows;

  const prices: Record<StockId, number> = {};
  const previousPrices: Record<StockId, number> = {};
  for (const r of priceRows) {
    if (r.round === round) prices[r.stock_id] = r.price;
    else previousPrices[r.stock_id] = r.price;
  }
  for (const stock of config.stocks) {
    // Round 1 has no earlier round: nothing has moved yet, so the previous
    // price is the opening price.
    if (prices[stock.id] == null) prices[stock.id] = stock.initialPrice;
    if (previousPrices[stock.id] == null) previousPrices[stock.id] = prices[stock.id];
  }

  const holdingRows = (
    await client.query<{ stock_id: string; total: number }>(
      `SELECT stock_id, COALESCE(sum(quantity), 0)::bigint AS total
         FROM holdings WHERE game_id = $1 GROUP BY stock_id`,
      [gameId],
    )
  ).rows;
  const holdings: Record<StockId, number> = Object.fromEntries(ids.map((id) => [id, 0]));
  for (const r of holdingRows) holdings[r.stock_id] = Number(r.total);

  const previousHoldings: Record<StockId, number> = Object.fromEntries(ids.map((id) => [id, 0]));
  if (round > 1) {
    const prev = (
      await client.query<{ stock_id: string; holdings_end: number }>(
        'SELECT stock_id, holdings_end FROM round_stock_activity WHERE game_id = $1 AND round = $2',
        [gameId, round - 1],
      )
    ).rows;
    for (const r of prev) previousHoldings[r.stock_id] = r.holdings_end;
  }

  const volumeRows = (
    await client.query<{ stock_id: string; side: 'buy' | 'sell'; qty: number }>(
      `SELECT stock_id, side, COALESCE(sum(quantity), 0)::bigint AS qty
         FROM transactions WHERE game_id = $1 AND round = $2
        GROUP BY stock_id, side`,
      [gameId, round],
    )
  ).rows;
  const grossBuys: Record<StockId, number> = Object.fromEntries(ids.map((id) => [id, 0]));
  const grossSells: Record<StockId, number> = Object.fromEntries(ids.map((id) => [id, 0]));
  for (const r of volumeRows) {
    if (r.side === 'buy') grossBuys[r.stock_id] = Number(r.qty);
    else grossSells[r.stock_id] = Number(r.qty);
  }

  const activations = await loadSecretActivations(client, gameId);
  const windows = secretWindows(config.secrets, activations);
  const secretActiveNextRound = secretStateForRound(ids, windows, round + 1);

  return {
    round,
    prices,
    previousPrices,
    holdings,
    previousHoldings,
    grossBuys,
    grossSells,
    secretActiveNextRound,
  };
}

export async function loadSecretActivations(
  client: Pick<PoolClient, 'query'>,
  gameId: string,
): Promise<SecretActivation[]> {
  const rows = (
    await client.query<{ activated_round: number; stock_id: string; participant_id: string }>(
      'SELECT activated_round, stock_id, participant_id FROM secret_activations WHERE game_id = $1',
      [gameId],
    )
  ).rows;
  return rows.map((r) => ({
    round: r.activated_round,
    stockId: r.stock_id,
    participantId: r.participant_id,
  }));
}

/** Stores every participant's value and rank for a completed round. */
async function recordRoundValues(
  client: PoolClient,
  gameId: string,
  round: number,
  prices: Record<StockId, number>,
): Promise<void> {
  const participants = (
    await client.query<{ id: string; cash: number }>('SELECT id, cash FROM participants WHERE game_id = $1', [
      gameId,
    ])
  ).rows;
  if (participants.length === 0) return;

  const holdingRows = (
    await client.query<{ participant_id: string; stock_id: string; quantity: number }>(
      'SELECT participant_id, stock_id, quantity FROM holdings WHERE game_id = $1',
      [gameId],
    )
  ).rows;

  const valueByParticipant = new Map<string, number>();
  for (const h of holdingRows) {
    const value = (prices[h.stock_id] ?? 0) * h.quantity;
    valueByParticipant.set(h.participant_id, (valueByParticipant.get(h.participant_id) ?? 0) + value);
  }

  const scored = participants
    .map((p) => {
      const holdingsValue = valueByParticipant.get(p.id) ?? 0;
      return { id: p.id, cash: p.cash, holdingsValue, total: p.cash + holdingsValue };
    })
    .sort((a, b) => b.total - a.total);

  for (const [index, row] of scored.entries()) {
    await client.query(
      `INSERT INTO participant_round_values
         (game_id, participant_id, round, cash, holdings_value, total_assets, rank)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (participant_id, round) DO UPDATE SET
         cash = EXCLUDED.cash, holdings_value = EXCLUDED.holdings_value,
         total_assets = EXCLUDED.total_assets, rank = EXCLUDED.rank`,
      [gameId, row.id, round, row.cash, row.holdingsValue, row.total, index + 1],
    );
  }
}

/** Seconds left in the current round according to the server. */
export async function serverRoundTiming(gameId: string): Promise<{
  round: number;
  endsAt: string | null;
  secondsRemaining: number;
  serverTime: string;
} | null> {
  const rows = await query<{ current_round: number; round_ends_at: Date | null; now: Date; status: string }>(
    'SELECT current_round, round_ends_at, now() AS now, status FROM games WHERE id = $1',
    [gameId],
  );
  const row = rows[0];
  if (!row) return null;
  const remaining =
    row.round_ends_at && row.status === 'running'
      ? Math.max(0, Math.round((row.round_ends_at.getTime() - row.now.getTime()) / 1000))
      : 0;
  return {
    round: row.current_round,
    endsAt: row.round_ends_at?.toISOString() ?? null,
    secondsRemaining: remaining,
    serverTime: row.now.toISOString(),
  };
}
