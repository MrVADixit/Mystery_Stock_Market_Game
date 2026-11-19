import type { NextRequest } from 'next/server';
import { requireGameAdmin } from '@/server/auth';
import { participantAudit } from '@/server/results';
import { errorResponse, handleError, json } from '@/server/http';

export const dynamic = 'force-dynamic';

/**
 * The private per-participant audit. Only the game's administrator (or the
 * owner account) can reach this; participants have no route to each
 * other's trading history.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ gameId: string; participantId: string }> },
) {
  try {
    const { gameId, participantId } = await context.params;
    await requireGameAdmin(gameId);

    const sp = request.nextUrl.searchParams;
    const roundParam = sp.get('round');
    const audit = await participantAudit(gameId, participantId, {
      round: roundParam ? Number(roundParam) : undefined,
      stockId: sp.get('stockId') ?? undefined,
      side: (sp.get('side') as 'buy' | 'sell' | null) ?? undefined,
      from: sp.get('from') ?? undefined,
      to: sp.get('to') ?? undefined,
    });
    if (!audit) return errorResponse('That participant is not in this game.', 404);
    return json(audit);
  } catch (e) {
    return handleError(e);
  }
}
