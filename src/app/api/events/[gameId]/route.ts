/**
 * Server-sent events for one game.
 *
 * The stream carries signals only — never market data — so a client that
 * is not allowed to see a concealed price cannot learn it from here. On
 * each signal the client refetches through its own state endpoint, which
 * applies the redaction rules.
 *
 * Each open stream also nudges the round clock forward, so a game keeps
 * advancing as long as anybody (including the classroom display) is
 * watching it.
 */

import type { NextRequest } from 'next/server';
import { currentAdmin, currentParticipant, verifyDisplayToken } from '@/server/auth';
import { subscribe } from '@/server/events';
import type { GameEvent } from '@/server/events';
import { advanceIfDue } from '@/server/rounds';
import { errorResponse } from '@/server/http';

export const dynamic = 'force-dynamic';

const HEARTBEAT_MS = 15_000;
const TICK_MS = 2_000;

export async function GET(request: NextRequest, context: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await context.params;
  const token = request.nextUrl.searchParams.get('token');

  // Any of the three audiences may watch, but each has to prove it.
  const allowed =
    (await verifyDisplayToken(gameId, token)) ||
    (await currentParticipant())?.gameId === gameId ||
    Boolean(await currentAdmin());
  if (!allowed) return errorResponse('Not authorised to watch this game.', 403);

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let ticker: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          /* the client has gone away */
        }
      };

      send('hello', { gameId, serverTime: new Date().toISOString() });

      unsubscribe = await subscribe(gameId, (e: GameEvent) => send('game', e));

      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': keep-alive\n\n'));
        } catch {
          /* ignore */
        }
      }, HEARTBEAT_MS);

      // The server, not the device, decides when a round ends.
      ticker = setInterval(() => {
        void advanceIfDue(gameId).catch(() => {});
      }, TICK_MS);
    },
    cancel() {
      unsubscribe?.();
      if (heartbeat) clearInterval(heartbeat);
      if (ticker) clearInterval(ticker);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
