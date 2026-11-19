import type { NextRequest } from 'next/server';
import { verifyDisplayToken } from '@/server/auth';
import { buildGameState } from '@/server/state';
import { errorResponse, handleError, json, rateLimit, clientIp } from '@/server/http';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, context: { params: Promise<{ gameId: string }> }) {
  try {
    const { gameId } = await context.params;
    const limited = await rateLimit(`display:${clientIp(request)}`, 120, 60);
    if (limited) return limited;

    const token = request.nextUrl.searchParams.get('token');
    if (!(await verifyDisplayToken(gameId, token))) {
      return errorResponse('This display link is not valid. Ask the administrator for a new one.', 403);
    }
    // The display board is read-only and sees exactly what the public is
    // allowed to see: no hidden rules, no private histories, secrets
    // respected.
    const state = await buildGameState(gameId, 'display');
    if (!state) return errorResponse('That game no longer exists.', 404);
    return json(state);
  } catch (e) {
    return handleError(e);
  }
}
