import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { currentAdmin } from '@/server/auth';
import { parseSessionConfig } from '@/server/config-schema';
import { previewSettlement } from '@/engine/preview';
import { errorResponse, handleError, json, parseBody, rateLimit } from '@/server/http';

export const dynamic = 'force-dynamic';

const numberMap = z.record(z.string().max(32), z.number().int().min(0).max(1_000_000_000));
const boolMap = z.record(z.string().max(32), z.boolean());

const schema = z.object({
  config: z.unknown(),
  input: z
    .object({
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
    })
    .default({}),
});

/**
 * A stateless one-round preview.
 *
 * It settles whatever configuration is posted to it, which means the rule
 * editor can preview an unsaved draft — and a template being edited, which
 * has no session behind it at all. Nothing is read from or written to any
 * live game.
 */
export async function POST(request: NextRequest) {
  try {
    const admin = await currentAdmin();
    if (!admin) return errorResponse('Please sign in as an administrator.', 401);
    const limited = await rateLimit(`preview:${admin.userId}`, 120, 60);
    if (limited) return limited;

    const body = await parseBody(request, schema);
    const config = parseSessionConfig(body.config);
    try {
      return json(previewSettlement(config, body.input));
    } catch (e) {
      // An invalid rule combination surfaces as a clear message, not a 500.
      return errorResponse(e instanceof Error ? e.message : 'That rule could not be evaluated.', 422);
    }
  } catch (e) {
    return handleError(e);
  }
}
