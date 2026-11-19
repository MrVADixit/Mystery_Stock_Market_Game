import { configuredProviders } from '@/server/oauth';
import { handleError, json } from '@/server/http';

export const dynamic = 'force-dynamic';

/** Which sign-in buttons the login screen should show. */
export async function GET() {
  try {
    return json({ providers: configuredProviders() });
  } catch (e) {
    return handleError(e);
  }
}
