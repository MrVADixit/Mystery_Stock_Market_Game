import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireGameAdmin } from '@/server/auth';
import {
  archiveGame,
  openRegistration,
  pauseGame,
  resumeGame,
  setWarningsAcknowledged,
  startGame,
} from '@/server/games';
import { advanceIfDue } from '@/server/rounds';
import { publish } from '@/server/events';
import { query } from '@/server/db';
import { recordAudit } from '@/server/audit';
import { handleError, json, parseBody } from '@/server/http';

export const dynamic = 'force-dynamic';

const schema = z.object({
  action: z.enum([
    'open-registration',
    'start',
    'pause',
    'resume',
    'force-advance',
    'finish',
    'archive',
    'acknowledge-warnings',
  ]),
  secondsLeft: z.number().int().min(5).max(7200).optional(),
});

export async function POST(request: NextRequest, context: { params: Promise<{ gameId: string }> }) {
  try {
    const { gameId } = await context.params;
    const admin = await requireGameAdmin(gameId);
    const body = await parseBody(request, schema);

    switch (body.action) {
      case 'open-registration':
        await openRegistration(gameId, admin.userId);
        break;
      case 'start':
        await startGame(gameId, admin.userId);
        break;
      case 'pause':
        await pauseGame(gameId, admin.userId);
        break;
      case 'resume':
        await resumeGame(gameId, admin.userId, body.secondsLeft ?? 60);
        break;
      case 'force-advance':
        // End the current round now; settlement then runs normally.
        await query(
          `UPDATE rounds SET ends_at = now()
             WHERE game_id = $1 AND round = (SELECT current_round FROM games WHERE id = $1) AND status = 'open'`,
          [gameId],
        );
        await query('UPDATE games SET round_ends_at = now() WHERE id = $1', [gameId]);
        await advanceIfDue(gameId);
        await recordAudit({
          gameId,
          userId: admin.userId,
          actorType: 'admin',
          eventType: 'round.force_advanced',
        });
        break;
      case 'finish':
        // Close every remaining round immediately.
        await query(
          `UPDATE rounds SET ends_at = now() WHERE game_id = $1 AND status = 'open'`,
          [gameId],
        );
        await query('UPDATE games SET round_ends_at = now() WHERE id = $1', [gameId]);
        await advanceIfDue(gameId);
        await recordAudit({ gameId, userId: admin.userId, actorType: 'admin', eventType: 'game.finish_requested' });
        break;
      case 'archive':
        await archiveGame(gameId, admin.userId);
        break;
      case 'acknowledge-warnings':
        await setWarningsAcknowledged(gameId, true);
        break;
    }

    await publish({ gameId, type: 'game.status' });
    return json({ ok: true, action: body.action });
  } catch (e) {
    return handleError(e);
  }
}
