import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { completeAuthorisation, stateMatches, OAuthError, OAUTH_COOKIE } from '@/server/oauth';
import type { OAuthProvider, PendingAuth } from '@/server/oauth';
import { issueAdminSession } from '@/server/auth';
import { clientIp, handleError, rateLimit } from '@/server/http';

export const dynamic = 'force-dynamic';

function isProvider(value: string): value is OAuthProvider {
  return value === 'google' || value === 'github';
}

/** Sends the administrator back to the login screen with a readable reason. */
function back(request: NextRequest, message: string) {
  const url = new URL('/admin', request.nextUrl.origin);
  url.searchParams.set('error', message);
  const response = NextResponse.redirect(url);
  response.cookies.delete(OAUTH_COOKIE);
  return response;
}

export async function GET(request: NextRequest, context: { params: Promise<{ provider: string }> }) {
  try {
    const { provider } = await context.params;
    if (!isProvider(provider)) return back(request, 'Unknown sign-in provider.');

    const limited = await rateLimit(`oauth-callback:${clientIp(request)}`, 20, 300);
    if (limited) return limited;

    const params = request.nextUrl.searchParams;

    // The provider reports its own failures here, including the one that
    // matters most: the person pressed cancel.
    const providerError = params.get('error');
    if (providerError) {
      return back(
        request,
        providerError === 'access_denied'
          ? 'Sign-in was cancelled.'
          : `The provider refused the sign-in (${providerError}).`,
      );
    }

    const code = params.get('code');
    const state = params.get('state');
    if (!code || !state) return back(request, 'That sign-in link was incomplete. Please try again.');

    const raw = request.cookies.get(OAUTH_COOKIE)?.value;
    if (!raw) {
      return back(request, 'The sign-in took too long and expired. Please try again.');
    }

    let pending: PendingAuth;
    try {
      pending = JSON.parse(raw) as PendingAuth;
    } catch {
      return back(request, 'That sign-in could not be verified. Please try again.');
    }

    // The state check is what stops a sign-in being forged from another site.
    if (pending.provider !== provider || !stateMatches(pending.state, state)) {
      return back(request, 'That sign-in could not be verified. Please try again.');
    }

    const result = await completeAuthorisation(
      provider,
      code,
      request.nextUrl.origin,
      pending.codeVerifier,
    );
    const principal = await issueAdminSession(result.userId);
    if (!principal) return back(request, 'That administrator account no longer exists.');

    const response = NextResponse.redirect(new URL('/admin', request.nextUrl.origin));
    response.cookies.delete(OAUTH_COOKIE);
    return response;
  } catch (e) {
    if (e instanceof OAuthError) return back(request, e.message);
    return handleError(e);
  }
}
