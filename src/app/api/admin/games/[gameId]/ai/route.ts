import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireGameAdmin } from '@/server/auth';
import { askAssistant } from '@/server/ai';
import { aiConfigured } from '@/server/env';
import { handleError, json, parseBody, rateLimit } from '@/server/http';

export const dynamic = 'force-dynamic';

const schema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().min(1).max(8000),
      }),
    )
    .min(1)
    .max(40),
});

/** Whether the assistant is available at all. */
export async function GET(_request: NextRequest, context: { params: Promise<{ gameId: string }> }) {
  try {
    const { gameId } = await context.params;
    await requireGameAdmin(gameId);
    return json({
      configured: aiConfigured(),
      reason: aiConfigured()
        ? undefined
        : 'No ANTHROPIC_API_KEY is configured on this server. The assistant is optional — every other part of the game works without it.',
    });
  } catch (e) {
    return handleError(e);
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ gameId: string }> }) {
  try {
    const { gameId } = await context.params;
    const admin = await requireGameAdmin(gameId);
    const limited = await rateLimit(`ai:${admin.userId}`, 30, 300);
    if (limited) return limited;

    const body = await parseBody(request, schema);
    const reply = await askAssistant(gameId, body.messages);
    return json(reply);
  } catch (e) {
    return handleError(e);
  }
}
