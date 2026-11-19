import type { NextRequest } from 'next/server';
import { requireGameAdmin } from '@/server/auth';
import { buildGameState } from '@/server/state';
import { query } from '@/server/db';
import { errorResponse, handleError, json } from '@/server/http';

export const dynamic = 'force-dynamic';

/** The live overview: full information, nothing redacted. */
export async function GET(_request: NextRequest, context: { params: Promise<{ gameId: string }> }) {
  try {
    const { gameId } = await context.params;
    await requireGameAdmin(gameId);
    const state = await buildGameState(gameId, 'admin');
    if (!state) return errorResponse('That game does not exist.', 404);

    const connected = await query<{ connected: number; total: number }>(
      `SELECT count(*) FILTER (WHERE last_seen_at > now() - interval '45 seconds')::int AS connected,
              count(*)::int AS total
         FROM participants WHERE game_id = $1`,
      [gameId],
    );

    const recentTrades = await query<{
      created_at: Date;
      round: number;
      display_name: string;
      stock_id: string;
      side: string;
      quantity: number;
      price: number;
    }>(
      `SELECT t.created_at, t.round, p.display_name, t.stock_id, t.side, t.quantity, t.price
         FROM transactions t JOIN participants p ON p.id = t.participant_id
        WHERE t.game_id = $1 ORDER BY t.id DESC LIMIT 40`,
      [gameId],
    );

    const activeSecrets = await query<{
      stock_id: string;
      first_round: number;
      last_round: number;
      display_name: string;
    }>(
      `SELECT s.stock_id, s.first_round, s.last_round, p.display_name
         FROM secret_activations s JOIN participants p ON p.id = s.participant_id
        WHERE s.game_id = $1 AND s.last_round >= (SELECT current_round FROM games WHERE id = $1)
        ORDER BY s.first_round`,
      [gameId],
    );

    return json({
      ...state,
      admin: {
        connectedParticipants: connected[0]?.connected ?? 0,
        totalParticipants: connected[0]?.total ?? 0,
        recentTrades: recentTrades.map((t) => ({
          at: t.created_at.toISOString(),
          round: t.round,
          participant: t.display_name,
          stockId: t.stock_id,
          side: t.side,
          quantity: t.quantity,
          price: t.price,
        })),
        // The administrator always has full information, including who
        // imposed which secret.
        activeSecrets: activeSecrets.map((s) => ({
          stockId: s.stock_id,
          firstRound: s.first_round,
          lastRound: s.last_round,
          imposedBy: s.display_name,
        })),
      },
    });
  } catch (e) {
    return handleError(e);
  }
}
