import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { currentParticipant } from '@/server/auth';
import { executeTrade } from '@/server/trading';
import { publish } from '@/server/events';
import { buildGameState } from '@/server/state';
import { errorResponse, handleError, json, parseBody, rateLimit } from '@/server/http';

export const dynamic = 'force-dynamic';

const schema = z.object({
  stockId: z.string().min(1).max(32),
  side: z.enum(['buy', 'sell']),
  quantity: z.union([z.number().int().min(1).max(1_000_000), z.literal('max')]),
  idempotencyKey: z.string().min(8).max(128),
});

export async function POST(request: NextRequest) {
  try {
    const me = await currentParticipant();
    if (!me) return errorResponse('Please sign in to play.', 401);

    // Generous enough for fast manual trading, tight enough to stop a
    // script hammering the settlement path.
    const limited = await rateLimit(`trade:${me.participantId}`, 60, 20);
    if (limited) return limited;

    const body = await parseBody(request, schema);
    const receipt = await executeTrade({
      gameId: me.gameId,
      participantId: me.participantId,
      stockId: body.stockId,
      side: body.side,
      quantity: body.quantity,
      idempotencyKey: body.idempotencyKey,
    });
    if (!receipt.replayed) await publish({ gameId: me.gameId, type: 'trade', round: receipt.round });
    const state = await buildGameState(me.gameId, 'participant', me.participantId);
    return json({ receipt, state });
  } catch (e) {
    return handleError(e);
  }
}
