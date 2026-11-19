import { logoutAdmin } from '@/server/auth';
import { handleError, json } from '@/server/http';

export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    await logoutAdmin();
    return json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
