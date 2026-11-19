import type { NextRequest } from 'next/server';
import { requireGameAdmin } from '@/server/auth';
import { readinessFor } from '@/server/simulation';
import { recordAudit } from '@/server/audit';
import { errorResponse, handleError, json } from '@/server/http';

export const dynamic = 'force-dynamic';

/** TEST MY GAME. */
export async function POST(_request: NextRequest, context: { params: Promise<{ gameId: string }> }) {
  try {
    const { gameId } = await context.params;
    const admin = await requireGameAdmin(gameId);
    const report = await readinessFor(gameId);
    if (!report) return errorResponse('That game does not exist.', 404);
    await recordAudit({
      gameId,
      userId: admin.userId,
      actorType: 'admin',
      eventType: 'game.readiness_checked',
      payload: { verdict: report.verdict, passed: report.testsPassed, failed: report.testsFailed },
    });
    return json(report);
  } catch (e) {
    return handleError(e);
  }
}
