import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { currentParticipant } from '@/server/auth';
import { exchangePieces } from '@/server/intel';
import { buildGameState } from '@/server/state';
import { errorResponse, handleError, json, parseBody, rateLimit } from '@/server/http';

export const dynamic = 'force-dynamic';

const schema = z.object({ pieces: z.number().int().min(1).max(1000) });

export async function POST(request: NextRequest) {
  try {
    const me = await currentParticipant();
    if (!me) return errorResponse('Please sign in to play.', 401);
    const limited = await rateLimit(`pieces:${me.participantId}`, 10, 60);
    if (limited) return limited;

    const body = await parseBody(request, schema);
    const receipt = await exchangePieces(me.gameId, me.participantId, body.pieces);
    const state = await buildGameState(me.gameId, 'participant', me.participantId);
    return json({ receipt, state });
  } catch (e) {
    return handleError(e);
  }
}
