import type { NextRequest } from 'next/server';
import { requireGameAdmin } from '@/server/auth';
import { exportCsv } from '@/server/results';
import type { ExportKind } from '@/server/results';
import { recordAudit } from '@/server/audit';
import { errorResponse, handleError } from '@/server/http';

export const dynamic = 'force-dynamic';

const KINDS: ExportKind[] = [
  'ranking',
  'portfolios',
  'transactions',
  'prices',
  'statistics',
  'rule-triggers',
  'secrets',
  'intel',
];

export async function GET(request: NextRequest, context: { params: Promise<{ gameId: string }> }) {
  try {
    const { gameId } = await context.params;
    const admin = await requireGameAdmin(gameId);
    const kind = request.nextUrl.searchParams.get('kind') as ExportKind | null;
    if (!kind || !KINDS.includes(kind)) {
      return errorResponse(`kind must be one of: ${KINDS.join(', ')}`, 422);
    }
    const { filename, body } = await exportCsv(gameId, kind);
    await recordAudit({ gameId, userId: admin.userId, actorType: 'admin', eventType: 'export.downloaded', payload: { kind } });
    return new Response(body, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    return handleError(e);
  }
}
