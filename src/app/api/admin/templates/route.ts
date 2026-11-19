import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { currentAdmin } from '@/server/auth';
import { listTemplates, saveTemplate } from '@/server/game-templates';
import { parseSessionConfig } from '@/server/config-schema';
import { errorResponse, handleError, json, parseBody } from '@/server/http';

export const dynamic = 'force-dynamic';

/** Every template this administrator can start a game from. */
export async function GET() {
  try {
    const admin = await currentAdmin();
    if (!admin) return errorResponse('Please sign in as an administrator.', 401);
    return json(await listTemplates(admin.userId));
  } catch (e) {
    return handleError(e);
  }
}

const saveSchema = z.object({
  name: z.string().min(2).max(80),
  description: z.string().max(600).optional(),
  designerNote: z.string().max(600).optional(),
  derivedFrom: z.string().max(120).nullable().optional(),
  isShared: z.boolean().optional(),
  config: z.unknown(),
});

/** Saves the supplied configuration as a reusable template. */
export async function POST(request: NextRequest) {
  try {
    const admin = await currentAdmin();
    if (!admin) return errorResponse('Please sign in as an administrator.', 401);
    const body = await parseBody(request, saveSchema);
    const result = await saveTemplate(admin.userId, {
      name: body.name,
      description: body.description,
      designerNote: body.designerNote,
      derivedFrom: body.derivedFrom ?? null,
      isShared: body.isShared,
      config: parseSessionConfig(body.config),
    });
    return json(result, { status: 201 });
  } catch (e) {
    return handleError(e);
  }
}
