import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { joinGame } from '@/server/participants';
import { publish } from '@/server/events';
import { clientIp, handleError, json, parseBody, rateLimit } from '@/server/http';

export const dynamic = 'force-dynamic';

const schema = z.object({
  joinCode: z.string().min(3).max(16),
  displayName: z.string().min(1).max(32),
  passphrase: z.string().min(4).max(128),
});

export async function POST(request: NextRequest) {
  try {
    // Registration and reconnection are the two things worth brute-forcing,
    // so they are limited per address.
    const limited = await rateLimit(`join:${clientIp(request)}`, 20, 60);
    if (limited) return limited;

    const body = await parseBody(request, schema);
    const result = await joinGame(body);
    if (!result.reconnected) {
      await publish({ gameId: result.gameId, type: 'participant.joined' });
    }
    return json({ gameId: result.gameId, reconnected: result.reconnected });
  } catch (e) {
    return handleError(e);
  }
}
