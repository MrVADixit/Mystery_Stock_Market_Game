import { currentParticipant } from '@/server/auth';
import { buildGameState } from '@/server/state';
import { errorResponse, handleError, json } from '@/server/http';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const me = await currentParticipant();
    if (!me) return errorResponse('Please sign in to play.', 401);
    const state = await buildGameState(me.gameId, 'participant', me.participantId);
    if (!state) return errorResponse('That game no longer exists.', 404);
    return json(state);
  } catch (e) {
    return handleError(e);
  }
}
