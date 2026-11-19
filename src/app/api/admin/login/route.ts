import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { loginAdmin } from '@/server/auth';
import { recordAudit } from '@/server/audit';
import { clientIp, clientIpHash, errorResponse, handleError, json, parseBody, rateLimit } from '@/server/http';

export const dynamic = 'force-dynamic';

const schema = z.object({ email: z.string().email().max(200), password: z.string().min(1).max(256) });

export async function POST(request: NextRequest) {
  try {
    const limited = await rateLimit(`admin-login:${clientIp(request)}`, 10, 300);
    if (limited) return limited;

    const body = await parseBody(request, schema);
    const admin = await loginAdmin(body.email, body.password);
    if (!admin) {
      await recordAudit({
        actorType: 'admin',
        eventType: 'admin.login_failed',
        payload: { email: body.email },
        ipHash: clientIpHash(request),
      });
      return errorResponse('That email and password do not match.', 401);
    }
    await recordAudit({
      userId: admin.userId,
      actorType: 'admin',
      eventType: 'admin.login',
      ipHash: clientIpHash(request),
    });
    return json({ email: admin.email, role: admin.role });
  } catch (e) {
    return handleError(e);
  }
}
