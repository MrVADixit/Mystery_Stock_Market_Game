import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireGameAdmin } from '@/server/auth';
import { runAdHoc, runScenarioFor, simulatedStandings } from '@/server/simulation';
import { errorResponse, handleError, json, parseBody } from '@/server/http';

export const dynamic = 'force-dynamic';

const stockId = z.string().min(1).max(32);

const schema = z.union([
  z.object({
    kind: z.literal('scenario'),
    scenarioId: z.string().min(1).max(64),
    maxRounds: z.number().int().min(1).max(200).optional(),
    withStandings: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal('ad-hoc'),
    participants: z.number().int().min(1).max(50).optional(),
    maxRounds: z.number().int().min(1).max(200).optional(),
    buy: z.object({ stockId, quantity: z.number().int().min(1).max(100_000) }).optional(),
    sell: z.object({ stockId, quantity: z.number().int().min(1).max(100_000) }).optional(),
    holdingsTarget: z.object({ stockId, quantity: z.number().int().min(0).max(100_000) }).optional(),
    secret: z.object({ stockId, round: z.number().int().min(1).max(200) }).optional(),
  }),
]);

/**
 * Runs a simulation. These never alter the real session: the handler reads
 * the stored configuration and runs the engine in memory.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ gameId: string }> }) {
  try {
    const { gameId } = await context.params;
    await requireGameAdmin(gameId);
    const body = await parseBody(request, schema);

    if (body.kind === 'scenario') {
      const result = await runScenarioFor(gameId, body.scenarioId, { maxRounds: body.maxRounds });
      if (!result) return errorResponse('That scenario does not exist for this game.', 404);
      const standings = body.withStandings ? await simulatedStandings(gameId, body.scenarioId) : null;
      return json({ result, standings });
    }

    const result = await runAdHoc(gameId, body);
    if (!result) return errorResponse('That game does not exist.', 404);
    return json({ result, standings: null });
  } catch (e) {
    return handleError(e);
  }
}
