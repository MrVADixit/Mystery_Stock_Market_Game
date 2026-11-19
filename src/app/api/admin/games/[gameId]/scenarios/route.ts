import type { NextRequest } from 'next/server';
import { requireGameAdmin } from '@/server/auth';
import { listScenarios } from '@/server/simulation';
import { quickTestIds } from '@/engine/scenarios';
import { handleError, json } from '@/server/http';

export const dynamic = 'force-dynamic';

export async function GET(_request: NextRequest, context: { params: Promise<{ gameId: string }> }) {
  try {
    const { gameId } = await context.params;
    await requireGameAdmin(gameId);
    return json({ scenarios: await listScenarios(gameId), quickTests: quickTestIds() });
  } catch (e) {
    return handleError(e);
  }
}
