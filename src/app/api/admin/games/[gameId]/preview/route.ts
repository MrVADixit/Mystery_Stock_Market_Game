import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireGameAdmin } from '@/server/auth';
import { previewFor } from '@/server/simulation';
import { errorResponse, handleError, json, parseBody } from '@/server/http';

export const dynamic = 'force-dynamic';

const numberMap = z.record(z.string().max(32), z.number().int().min(0).max(1_000_000_000));
const boolMap = z.record(z.string().max(32), z.boolean());

const schema = z.object({
  round: z.number().int().min(1).max(200).optional(),
  prices: numberMap.optional(),
  previousPrices: numberMap.optional(),
  holdings: numberMap.optional(),
  previousHoldings: numberMap.optional(),
  grossBuys: numberMap.optional(),
  grossSells: numberMap.optional(),
  secretActive: boolMap.optional(),
  forceRisingCount: z.number().int().min(0).max(64).optional(),
  forceFallingCount: z.number().int().min(0).max(64).optional(),
});

/** One-round what-if, used by the rule editor's Preview button. */
export async function POST(request: NextRequest, context: { params: Promise<{ gameId: string }> }) {
  try {
    const { gameId } = await context.params;
    await requireGameAdmin(gameId);
    const body = await parseBody(request, schema);
    try {
      const result = await previewFor(gameId, body);
      if (!result) return errorResponse('That game does not exist.', 404);
      return json(result);
    } catch (e) {
      // An invalid rule configuration (overlapping sentiment thresholds,
      // a missing scripted price) surfaces here as a clear message rather
      // than a 500.
      return errorResponse(e instanceof Error ? e.message : 'That rule could not be evaluated.', 422);
    }
  } catch (e) {
    return handleError(e);
  }
}
