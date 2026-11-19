import { logoutParticipant } from '@/server/auth';
import { handleError, json } from '@/server/http';

export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    await logoutParticipant();
    return json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
