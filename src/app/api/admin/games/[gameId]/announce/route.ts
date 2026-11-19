import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireGameAdmin } from '@/server/auth';
import { query } from '@/server/db';
import { publish } from '@/server/events';
import { handleError, json, parseBody } from '@/server/http';

export const dynamic = 'force-dynamic';

const schema = z.object({ body: z.string().min(1).max(500) });

export async function POST(request: NextRequest, context: { params: Promise<{ gameId: string }> }) {
  try {
    const { gameId } = await context.params;
    await requireGameAdmin(gameId);
    const input = await parseBody(request, schema);
    await query(
      `INSERT INTO announcements (game_id, body, round)
         VALUES ($1, $2, (SELECT current_round FROM games WHERE id = $1))`,
      [gameId, input.body],
    );
    await publish({ gameId, type: 'announcement' });
    return json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
