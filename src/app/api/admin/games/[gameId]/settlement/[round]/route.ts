import type { NextRequest } from 'next/server';
import { requireGameAdmin } from '@/server/auth';
import { query } from '@/server/db';
import { loadConfig } from '@/server/config-store';
import { errorResponse, handleError, json } from '@/server/http';

export const dynamic = 'force-dynamic';

/** Full settlement transparency for one round (§8.2). */
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ gameId: string; round: string }> },
) {
  try {
    const { gameId, round: roundParam } = await context.params;
    await requireGameAdmin(gameId);
    const round = Number(roundParam);
    if (!Number.isInteger(round) || round < 1) return errorResponse('Invalid round.', 422);

    const config = await loadConfig(gameId);
    if (!config) return errorResponse('That game does not exist.', 404);
    const nameOf = new Map(config.stocks.map((s) => [s.id, s.name]));

    const evaluations = await query<{
      stock_id: string;
      template_id: string;
      branch: string;
      opening_price: number;
      raw_delta: number;
      applied_delta: number;
      final_price: number;
      floored: boolean;
      movement_capped: boolean;
      explanation: string;
      inputs: Record<string, unknown>;
    }>(
      'SELECT * FROM rule_evaluations WHERE game_id = $1 AND round = $2 ORDER BY stock_id',
      [gameId, round],
    );

    const activity = await query<{ stock_id: string; gross_buys: number; gross_sells: number; holdings_end: number }>(
      'SELECT stock_id, gross_buys, gross_sells, holdings_end FROM round_stock_activity WHERE game_id = $1 AND round = $2',
      [gameId, round],
    );
    const previous = await query<{ stock_id: string; holdings_end: number }>(
      'SELECT stock_id, holdings_end FROM round_stock_activity WHERE game_id = $1 AND round = $2',
      [gameId, round - 1],
    );
    const prevHoldings = new Map(previous.map((p) => [p.stock_id, p.holdings_end]));

    const prices = await query<{ stock_id: string; round: number; price: number }>(
      'SELECT stock_id, round, price FROM stock_prices WHERE game_id = $1 AND round = ANY($2::int[])',
      [gameId, [round - 1, round, round + 1]],
    );
    const priceAt = (stockId: string, r: number) =>
      prices.find((p) => p.stock_id === stockId && p.round === r)?.price ?? null;

    const snapshot = await query<{ snapshot: unknown }>(
      'SELECT snapshot FROM market_snapshots WHERE game_id = $1 AND round = $2',
      [gameId, round],
    );

    return json({
      round,
      // Everything §8.2 requires the administrator to be able to see.
      stocks: config.stocks.map((stock) => {
        const act = activity.find((a) => a.stock_id === stock.id);
        const ev = evaluations.find((e) => e.stock_id === stock.id);
        const holdingsEnd = act?.holdings_end ?? 0;
        const holdingsStart = prevHoldings.get(stock.id) ?? 0;
        return {
          stockId: stock.id,
          stockName: stock.name,
          openingPrice: priceAt(stock.id, round),
          previousClosePrice: priceAt(stock.id, round - 1),
          aggregateHoldings: holdingsEnd,
          holdingsChange: holdingsEnd - holdingsStart,
          grossBuys: act?.gross_buys ?? 0,
          grossSells: act?.gross_sells ?? 0,
          template: ev?.template_id ?? null,
          branch: ev?.branch ?? null,
          rawMovement: ev?.raw_delta ?? null,
          appliedMovement: ev?.applied_delta ?? null,
          finalPrice: ev?.final_price ?? priceAt(stock.id, round + 1),
          hitFloor: ev?.floored ?? false,
          movementCapped: ev?.movement_capped ?? false,
          calculation: ev?.explanation ?? 'This round has not been settled yet.',
          inputs: ev?.inputs ?? {},
        };
      }),
      frozenSnapshot: snapshot[0]?.snapshot ?? null,
      stockNames: Object.fromEntries(nameOf),
    });
  } catch (e) {
    return handleError(e);
  }
}
