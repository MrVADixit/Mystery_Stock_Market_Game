import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { currentAdmin } from '@/server/auth';
import { createGame, listGamesFor } from '@/server/games';
import { errorResponse, handleError, json, parseBody } from '@/server/http';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const admin = await currentAdmin();
    if (!admin) return errorResponse('Please sign in as an administrator.', 401);
    return json({ games: await listGamesFor(admin.userId, admin.role === 'owner') });
  } catch (e) {
    return handleError(e);
  }
}

const schema = z.object({
  name: z.string().min(1).max(120),
  preset: z.enum(['classic', 'custom']).default('classic'),
  rounds: z.number().int().min(1).max(200).optional(),
  roundSeconds: z.number().int().min(5).max(7200).optional(),
});

export async function POST(request: NextRequest) {
  try {
    const admin = await currentAdmin();
    if (!admin) return errorResponse('Please sign in as an administrator.', 401);
    const body = await parseBody(request, schema);
    const result = await createGame(admin.userId, body);
    return json(result, { status: 201 });
  } catch (e) {
    return handleError(e);
  }
}
