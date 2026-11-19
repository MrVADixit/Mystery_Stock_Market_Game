import type { NextRequest } from 'next/server';
import { currentAdmin, currentParticipant, verifyDisplayToken } from '@/server/auth';
import { finalResults } from '@/server/results';
import { getGame } from '@/server/config-store';
import { errorResponse, handleError, json } from '@/server/http';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, context: { params: Promise<{ gameId: string }> }) {
  try {
    const { gameId } = await context.params;
    const game = await getGame(gameId);
    if (!game) return errorResponse('That game does not exist.', 404);

    const isAdmin = Boolean(await currentAdmin());
    const participant = await currentParticipant();
    const token = request.nextUrl.searchParams.get('token');
    const allowed =
      isAdmin || participant?.gameId === gameId || (await verifyDisplayToken(gameId, token));
    if (!allowed) return errorResponse('Not authorised to see these results.', 403);

    // Results are only published once the game is over.
    if (game.status !== 'finished' && game.status !== 'archived' && !isAdmin) {
      return errorResponse('The game has not finished yet.', 409);
    }

    const results = await finalResults(gameId);
    if (!results) return errorResponse('That game has no results.', 404);
    return json({
      gameName: results.config.name,
      status: game.status,
      finalRound: results.finalRound,
      totalRounds: results.config.rounds,
      prices: results.prices,
      stocks: results.config.stocks.map((s) => ({ id: s.id, name: s.name })),
      standings: results.standings,
    });
  } catch (e) {
    return handleError(e);
  }
}
