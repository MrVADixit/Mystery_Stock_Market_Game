import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { currentParticipant } from '@/server/auth';
import { imposeSecret } from '@/server/secrets-service';
import { publish } from '@/server/events';
import { buildGameState } from '@/server/state';
import { errorResponse, handleError, json, parseBody, rateLimit } from '@/server/http';

export const dynamic = 'force-dynamic';

const schema = z.object({ stockId: z.string().min(1).max(32) });

export async function POST(request: NextRequest) {
  try {
    const me = await currentParticipant();
    if (!me) return errorResponse('Please sign in to play.', 401);
    const limited = await rateLimit(`secret:${me.participantId}`, 10, 60);
    if (limited) return limited;

    const body = await parseBody(request, schema);
    const receipt = await imposeSecret(me.gameId, me.participantId, body.stockId);
    // The event says a secret changed, never which participant imposed it.
    await publish({ gameId: me.gameId, type: 'secret', round: receipt.activatedRound });
    const state = await buildGameState(me.gameId, 'participant', me.participantId);
    return json({ receipt, state });
  } catch (e) {
    return handleError(e);
  }
}
