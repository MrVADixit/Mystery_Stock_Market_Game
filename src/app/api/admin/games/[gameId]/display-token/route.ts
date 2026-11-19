import type { NextRequest } from 'next/server';
import { requireGameAdmin } from '@/server/auth';
import { regenerateDisplayToken, revokeDisplayToken } from '@/server/games';
import { recordAudit } from '@/server/audit';
import { handleError, json } from '@/server/http';

export const dynamic = 'force-dynamic';

/** Generates or regenerates the read-only classroom display link. */
export async function POST(_request: NextRequest, context: { params: Promise<{ gameId: string }> }) {
  try {
    const { gameId } = await context.params;
    const admin = await requireGameAdmin(gameId);
    const token = await regenerateDisplayToken(gameId);
    await recordAudit({ gameId, userId: admin.userId, actorType: 'admin', eventType: 'display.token_regenerated' });
    return json({ token, url: `/display/${gameId}?token=${token}` });
  } catch (e) {
    return handleError(e);
  }
}

/** Revokes it, so the projector link stops working immediately. */
export async function DELETE(_request: NextRequest, context: { params: Promise<{ gameId: string }> }) {
  try {
    const { gameId } = await context.params;
    const admin = await requireGameAdmin(gameId);
    await revokeDisplayToken(gameId);
    await recordAudit({ gameId, userId: admin.userId, actorType: 'admin', eventType: 'display.token_revoked' });
    return json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
