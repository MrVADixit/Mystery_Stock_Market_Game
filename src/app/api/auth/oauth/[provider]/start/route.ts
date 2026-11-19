import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { beginAuthorisation, providerConfigured, OAUTH_COOKIE } from '@/server/oauth';
import type { OAuthProvider } from '@/server/oauth';
import { clientIp, errorResponse, handleError, rateLimit } from '@/server/http';
import { isProduction } from '@/server/env';

export const dynamic = 'force-dynamic';

function isProvider(value: string): value is OAuthProvider {
  return value === 'google' || value === 'github';
}

export async function GET(request: NextRequest, context: { params: Promise<{ provider: string }> }) {
  try {
    const { provider } = await context.params;
    if (!isProvider(provider)) return errorResponse('Unknown sign-in provider.', 404);
    if (!providerConfigured(provider)) {
      return errorResponse(`Sign in with ${provider} is not configured on this server.`, 404);
    }

    const limited = await rateLimit(`oauth-start:${clientIp(request)}`, 20, 300);
    if (limited) return limited;

    const { url, pending } = beginAuthorisation(provider, request.nextUrl.origin);

    const response = NextResponse.redirect(url);
    // Short-lived and HttpOnly: it only has to survive the round trip to the
    // provider and back.
    response.cookies.set(OAUTH_COOKIE, JSON.stringify(pending), {
      httpOnly: true,
      sameSite: 'lax',
      secure: isProduction(),
      path: '/',
      maxAge: 600,
    });
    return response;
  } catch (e) {
    return handleError(e);
  }
}
