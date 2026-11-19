import type { NextRequest } from 'next/server';
import { requireGameAdmin } from '@/server/auth';
import { query } from '@/server/db';
import { handleError, json } from '@/server/http';

export const dynamic = 'force-dynamic';

export async function GET(_request: NextRequest, context: { params: Promise<{ gameId: string }> }) {
  try {
    const { gameId } = await context.params;
    await requireGameAdmin(gameId);
    const rows = await query<{
      id: string;
      display_name: string;
      cash: number;
      starting_cash: number;
      pieces: number;
      secret_tokens: number;
      intel_spend_won: number;
      joined_at: Date;
      last_seen_at: Date | null;
      is_blocked: boolean;
      trades: number;
      holdings_value: number;
    }>(
      `SELECT p.id, p.display_name, p.cash, p.starting_cash, p.pieces, p.secret_tokens,
              p.intel_spend_won, p.joined_at, p.last_seen_at, p.is_blocked,
              (SELECT count(*) FROM transactions t WHERE t.participant_id = p.id)::int AS trades,
              COALESCE((
                SELECT sum(h.quantity * sp.price)
                  FROM holdings h
                  JOIN stock_prices sp ON sp.game_id = h.game_id AND sp.stock_id = h.stock_id
                   AND sp.round = (SELECT GREATEST(1, current_round) FROM games WHERE id = $1)
                 WHERE h.participant_id = p.id
              ), 0)::bigint AS holdings_value
         FROM participants p
        WHERE p.game_id = $1
        ORDER BY lower(p.display_name)`,
      [gameId],
    );
    return json({
      participants: rows.map((r) => ({
        id: r.id,
        displayName: r.display_name,
        cash: r.cash,
        startingCash: r.starting_cash,
        holdingsValue: Number(r.holdings_value),
        totalAssets: r.cash + Number(r.holdings_value),
        pieces: r.pieces,
        secretTokens: r.secret_tokens,
        intelSpendWon: r.intel_spend_won,
        trades: r.trades,
        joinedAt: r.joined_at.toISOString(),
        lastSeenAt: r.last_seen_at?.toISOString() ?? null,
        connected: r.last_seen_at ? Date.now() - r.last_seen_at.getTime() < 45_000 : false,
        isBlocked: r.is_blocked,
      })),
    });
  } catch (e) {
    return handleError(e);
  }
}
