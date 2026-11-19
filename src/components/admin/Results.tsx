'use client';

import { Fragment, useEffect, useState } from 'react';
import clsx from 'clsx';
import { Card, Chip, SectionTitle, Spinner } from '@/components/ui';
import { api } from '@/lib/client';
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
    intelSpendWon: number;
    holdings: { stockName: string; quantity: number; price: number; value: number }[];
  }[];
}

const EXPORTS: { kind: string; label: string }[] = [
  { kind: 'ranking', label: 'Overall ranking' },
  { kind: 'portfolios', label: 'Participant portfolios' },
  { kind: 'transactions', label: 'Full transaction history' },
  { kind: 'prices', label: 'Round-by-round stock prices' },
  { kind: 'statistics', label: 'Trading statistics' },
  { kind: 'rule-triggers', label: 'Rule-trigger history' },
  { kind: 'secrets', label: 'Secret activity' },
  { kind: 'intel', label: 'Intelligence purchases' },
];

export function Results({ gameId }: { gameId: string }) {
  const [results, setResults] = useState<ResultsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    api<ResultsResponse>(`/api/results/${gameId}`)
      .then(setResults)
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load the results.'));
  }, [gameId]);

  return (
    <div className="space-y-4">
      <Card>
        <SectionTitle>Export</SectionTitle>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {EXPORTS.map((e) => (
            <a
              key={e.kind}
              href={`/api/admin/games/${gameId}/export?kind=${e.kind}`}
              className="btn-secondary justify-start text-xs"
              download
            >
              {e.label}
            </a>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted">Each download is a CSV, ready for a spreadsheet.</p>
      </Card>

      {error ? <p className="rounded-lg bg-down/15 px-3 py-2 text-sm text-down">{error}</p> : null}

      {!results && !error ? (
        <p className="text-sm text-muted">
          <Spinner className="mr-2" /> Loading…
        </p>
      ) : null}

      {results ? (
        <Card>
          <SectionTitle
            hint={
              results.status === 'finished' || results.status === 'archived'
                ? `Final — round ${results.finalRound}`
                : `Standing after round ${results.finalRound} of ${results.totalRounds}`
            }
          >
            {results.status === 'finished' || results.status === 'archived'
              ? 'Final results'
              : 'Results so far'}
          </SectionTitle>

          {results.standings.length === 0 ? (
            <p className="text-sm text-muted">Nobody took part.</p>
          ) : (
            <div className="scroll-x">
              <table className="w-full min-w-[780px] text-sm">
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
                    <th className="pb-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {results.standings.map((row) => (
                    <Fragment key={row.participantId}>
                      <tr>
                        <td className="tabular py-2">
                          <span
                            className={clsx(
                              'font-bold',
                              row.rank === 1 ? 'text-lavender' : 'text-muted',
                            )}
                          >
                            {row.rank}
                          </span>
                          {row.rank === 1 ? <Chip tone="violet">Winner</Chip> : null}
                        </td>
                        <td className="py-2 pr-2 text-ink">{row.displayName}</td>
                        <td className="tabular py-2 text-right text-muted">{won(row.startingCash)}</td>
                        <td className="tabular py-2 text-right text-muted">{won(row.finalCash)}</td>
                        <td className="tabular py-2 text-right text-muted">{won(row.holdingsValue)}</td>
                        <td className="tabular py-2 text-right font-semibold text-ink">
                          {won(row.netWorth)}
                        </td>
                        <td className={clsx('tabular py-2 text-right', moveClass(row.gain))}>
                          {signed(row.gain)}
                        </td>
                        <td className={clsx('tabular py-2 text-right', moveClass(row.gain))}>
                          {pct(row.returnPct)}
                        </td>
                        <td className="py-2 pl-2 text-right">
                          <button
                            className="btn-ghost px-2 py-1 text-[11px]"
                            onClick={() =>
                              setExpanded(expanded === row.participantId ? null : row.participantId)
                            }
                          >
                            {expanded === row.participantId ? 'Hide' : 'Holdings'}
                          </button>
                        </td>
                      </tr>
                      {expanded === row.participantId ? (
                        <tr>
                          <td colSpan={9} className="bg-concrete/40 px-3 py-2">
                            {row.holdings.length === 0 ? (
                              <span className="text-xs text-muted">Held only cash at the end.</span>
                            ) : (
                              <ul className="grid gap-1 text-xs sm:grid-cols-2 lg:grid-cols-3">
                                {row.holdings.map((h) => (
                                  <li key={h.stockName} className="tabular text-muted">
                                    <span className="text-ink">{h.stockName}</span> — {h.quantity} ×{' '}
                                    {won(h.price)} = {won(h.value)} won
                                  </li>
                                ))}
                              </ul>
                            )}
                            <p className="tabular mt-1 text-xs text-muted">
                              Intelligence expenditure already deducted from cash: {won(row.intelSpendWon)} won
                            </p>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-3 text-xs text-muted">
            Final total assets = cash + market value of remaining holdings. Transaction and
            intelligence costs are already out of the cash figure.
          </p>
        </Card>
      ) : null}
    </div>
  );
}
