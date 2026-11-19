import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { currentAdmin } from '@/server/auth';
import { deleteTemplate, loadTemplateConfig, updateTemplate } from '@/server/game-templates';
import { parseSessionConfig } from '@/server/config-schema';
import { validateConfig } from '@/engine/validate';
import { errorResponse, handleError, json, parseBody } from '@/server/http';

export const dynamic = 'force-dynamic';

/** The full configuration of one saved template, for editing. */
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ templateId: string }> },
) {
  try {
    const admin = await currentAdmin();
    if (!admin) return errorResponse('Please sign in as an administrator.', 401);
    const { templateId } = await context.params;
    const result = await loadTemplateConfig(templateId, admin.userId);
    return json({ ...result, issues: validateConfig(result.config) });
  } catch (e) {
    return handleError(e);
  }
}

const patchSchema = z.object({
  name: z.string().min(2).max(80).optional(),
  description: z.string().max(600).optional(),
  designerNote: z.string().max(600).optional(),
  isShared: z.boolean().optional(),
  config: z.unknown().optional(),
});

export async function PUT(request: NextRequest, context: { params: Promise<{ templateId: string }> }) {
  try {
    const admin = await currentAdmin();
    if (!admin) return errorResponse('Please sign in as an administrator.', 401);
    const { templateId } = await context.params;
    const body = await parseBody(request, patchSchema);
    await updateTemplate(templateId, admin.userId, {
      name: body.name,
      description: body.description,
      designerNote: body.designerNote,
      isShared: body.isShared,
      config: body.config === undefined ? undefined : parseSessionConfig(body.config),
    });
    return json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ templateId: string }> },
) {
  try {
    const admin = await currentAdmin();
    if (!admin) return errorResponse('Please sign in as an administrator.', 401);
    const { templateId } = await context.params;
    await deleteTemplate(templateId, admin.userId);
    return json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
