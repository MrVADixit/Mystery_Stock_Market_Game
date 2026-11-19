'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import { api } from '@/lib/client';
import { Card, Chip, Spinner } from '@/components/ui';
import { moveClass, pct, signed, won } from '@/lib/format';

interface ResultsResponse {
  gameName: string;
  status: string;
  finalRound: number;
  totalRounds: number;
  standings: {
    rank: number;
    participantId: string;
    displayName: string;
    startingCash: number;
    finalCash: number;
    holdingsValue: number;
    netWorth: number;
    gain: number;
    returnPct: number;
    holdings: { stockName: string; quantity: number; price: number; value: number }[];
  }[];
}

/** The winner screen and the full final table (§21). */
export function ResultsScreen({ gameId }: { gameId: string }) {
  const [results, setResults] = useState<ResultsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<ResultsResponse>(`/api/results/${gameId}`)
      .then(setResults)
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load the results.'));
  }, [gameId]);

  if (error) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-3 px-4 text-center">
        <p className="text-ink">{error}</p>
        <Link href="/play" className="btn-secondary">
          Back to the game
        </Link>
      </main>
    );
  }

  if (!results) {
    return (
      <main className="flex min-h-dvh items-center justify-center text-muted">
        <Spinner className="mr-2" /> Counting up…
      </main>
    );
  }

  const winner = results.standings[0];

  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      <div className="text-xs font-semibold uppercase tracking-[0.3em] text-lavender">
        {results.status === 'finished' || results.status === 'archived'
          ? 'Final results'
          : `After round ${results.finalRound} of ${results.totalRounds}`}
      </div>
      <h1 className="mt-1 text-3xl font-bold text-ink">{results.gameName}</h1>

      {winner ? (
        <div className="card mt-6 bg-violet/15 p-6 text-center">
          <div className="text-xs font-semibold uppercase tracking-[0.25em] text-lavender">Winner</div>
          <div className="mt-1 text-4xl font-bold text-ink">{winner.displayName}</div>
          <div className="tabular mt-2 text-2xl font-semibold text-ink">{won(winner.netWorth)} WON</div>
          <div className={clsx('tabular mt-1 text-sm font-semibold', moveClass(winner.gain))}>
            {signed(winner.gain)} won · {pct(winner.returnPct)}
          </div>
        </div>
      ) : null}

      <Card className="mt-6">
        <div className="scroll-x">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-muted">
                <th className="pb-2">Rank</th>
                <th className="pb-2">Participant</th>
                <th className="pb-2 text-right">Starting</th>
                <th className="pb-2 text-right">Final cash</th>
                <th className="pb-2 text-right">Holdings value</th>
                <th className="pb-2 text-right">Final net worth</th>
                <th className="pb-2 text-right">Gain / loss</th>
                <th className="pb-2 text-right">Return</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {results.standings.map((row) => (
                <tr key={row.participantId}>
                  <td className="tabular py-2">
                    <span className={clsx('font-bold', row.rank === 1 ? 'text-lavender' : 'text-muted')}>
                      {row.rank}
                    </span>
                  </td>
                  <td className="py-2 pr-2 text-ink">{row.displayName}</td>
                  <td className="tabular py-2 text-right text-muted">{won(row.startingCash)}</td>
                  <td className="tabular py-2 text-right text-muted">{won(row.finalCash)}</td>
                  <td className="tabular py-2 text-right text-muted">{won(row.holdingsValue)}</td>
                  <td className="tabular py-2 text-right font-semibold text-ink">{won(row.netWorth)}</td>
                  <td className={clsx('tabular py-2 text-right', moveClass(row.gain))}>
                    {signed(row.gain)}
                  </td>
                  <td className={clsx('tabular py-2 text-right', moveClass(row.gain))}>
                    {pct(row.returnPct)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-muted">
          Final total assets = cash + market value of remaining holdings. Transaction and intelligence
          costs are already out of the cash figure.
        </p>
      </Card>

      <div className="mt-6 flex flex-wrap gap-2">
        <Link href="/play" className="btn-secondary">
          Back to the game
        </Link>
        <Chip tone="neutral">{results.standings.length} participants</Chip>
      </div>
    </main>
  );
}
