import type { Metadata } from 'next';
import { DisplayBoard } from './DisplayBoard';

export const metadata: Metadata = {
  title: 'Market display — Mystery Stock Market',
  // The classroom board must never be indexed.
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = 'force-dynamic';

/**
 * MARKET DISPLAY BOARD (§13).
 *
 * A read-only, large-screen view of the live game, reachable with an
 * unguessable token and no login at all. It shares the same authoritative
 * state as the rest of the application and goes through the same redaction,
 * so it cannot show a concealed price or a private history, and it has no
 * way to submit a trade or reach an administrator control.
 */
export default async function DisplayPage({
  params,
  searchParams,
}: {
  params: Promise<{ gameId: string }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const { gameId } = await params;
  const { token } = await searchParams;

  if (!token) {
    return (
      <main className="flex min-h-dvh items-center justify-center p-8 text-center">
        <div>
          <h1 className="text-2xl font-bold text-ink">This display link is incomplete</h1>
          <p className="mt-2 text-muted">
            Ask the administrator for the full link, including its token.
          </p>
        </div>
      </main>
    );
  }

  return <DisplayBoard gameId={gameId} token={token} />;
}
