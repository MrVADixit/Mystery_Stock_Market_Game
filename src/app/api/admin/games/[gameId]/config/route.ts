import type { NextRequest } from 'next/server';
import { requireGameAdmin } from '@/server/auth';
import { loadConfig, getGame } from '@/server/config-store';
import { updateConfig } from '@/server/games';
import { parseSessionConfig } from '@/server/config-schema';
import { validateConfig } from '@/engine/validate';
import { publish } from '@/server/events';
import { errorResponse, handleError, json } from '@/server/http';

export const dynamic = 'force-dynamic';

export async function GET(_request: NextRequest, context: { params: Promise<{ gameId: string }> }) {
  try {
    const { gameId } = await context.params;
    await requireGameAdmin(gameId);
    const config = await loadConfig(gameId);
    const game = await getGame(gameId);
    if (!config || !game) return errorResponse('That game does not exist.', 404);
    return json({
      config,
      issues: validateConfig(config),
      game: {
        id: game.id,
        status: game.status,
        joinCode: game.join_code,
        currentRound: game.current_round,
        hasDisplayToken: Boolean(game.display_token),
        displayToken: game.display_token,
        warningsAcknowledged: game.warnings_acknowledged,
        templateId: game.template_id,
        templateName: game.template_name,
        scrambleSeed: game.scramble_seed,
      },
    });
  } catch (e) {
    return handleError(e);
  }
}

export async function PUT(request: NextRequest, context: { params: Promise<{ gameId: string }> }) {
  try {
    const { gameId } = await context.params;
    const admin = await requireGameAdmin(gameId);
    const config = parseSessionConfig(await request.json());
    await updateConfig(gameId, admin.userId, config);
    await publish({ gameId, type: 'game.status' });
    return json({ config, issues: validateConfig(config) });
  } catch (e) {
    return handleError(e);
  }
}
