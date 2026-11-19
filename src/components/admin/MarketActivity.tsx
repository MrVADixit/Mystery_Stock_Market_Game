'use client';

import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { Card, Chip, SectionTitle, Spinner } from '@/components/ui';
import { ComparisonChart } from '@/components/charts';
import { api } from '@/lib/client';
import { signed, won } from '@/lib/format';
import type { SettlementView } from '@/lib/admin-types';
import type { GameStateView } from '@/server/state';

/** Settlement transparency (§8.2). */
export function MarketActivity({ gameId, state }: { gameId: string; state: GameStateView }) {
  const settledRounds = Math.max(0, state.game.round - 1);
  const [round, setRound] = useState(Math.max(1, settledRounds));
  const [view, setView] = useState<SettlementView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showSnapshot, setShowSnapshot] = useState(false);

  useEffect(() => {
    setRound((r) => (r > settledRounds && settledRounds >= 1 ? settledRounds : r));
  }, [settledRounds]);

  useEffect(() => {
    let active = true;
    api<SettlementView>(`/api/admin/games/${gameId}/settlement/${round}`)
      .then((r) => {
        if (active) {
          setView(r);
          setError(null);
        }
      })
      .catch((e) => active && setError(e instanceof Error ? e.message : 'Could not load that round.'));
    return () => {
      active = false;
    };
  }, [gameId, round]);

  return (
    <div className="space-y-4">
      <Card>
        <SectionTitle>Price history</SectionTitle>
        <ComparisonChart
          stocks={state.stocks.map((s) => ({ id: s.id, name: s.name, priceHistory: s.priceHistory }))}
          height={320}
        />
      </Card>

      <Card>
        <SectionTitle hint={settledRounds === 0 ? 'No round has settled yet' : `Rounds 1–${settledRounds}`}>
          Round settlement
        </SectionTitle>

        <div className="flex flex-wrap items-center gap-2">
          <label className="label mb-0">Round</label>
          <input
            type="number"
            className="field tabular w-24"
            min={1}
            max={Math.max(1, settledRounds)}
            value={round}
            onChange={(e) => setRound(Math.max(1, Math.round(Number(e.target.value) || 1)))}
          />
          <button
            className="btn-ghost px-2 py-1 text-xs"
            disabled={round <= 1}
            onClick={() => setRound((r) => Math.max(1, r - 1))}
          >
            ← Previous
          </button>
          <button
            className="btn-ghost px-2 py-1 text-xs"
            disabled={round >= settledRounds}
            onClick={() => setRound((r) => Math.min(settledRounds, r + 1))}
          >
            Next →
          </button>
        </div>

        {error ? <p className="mt-3 rounded-lg bg-down/15 px-3 py-2 text-sm text-down">{error}</p> : null}

        {!view ? (
          <p className="mt-3 text-sm text-muted">
            <Spinner className="mr-2" /> Loading…
          </p>
        ) : (
          <>
            <div className="scroll-x mt-3">
              <table className="w-full min-w-[980px] text-xs">
                <thead>
                  <tr className="text-left uppercase tracking-wide text-muted">
                    <th className="pb-2">Stock</th>
                    <th className="pb-2 text-right">Previous close</th>
                    <th className="pb-2 text-right">Opening</th>
                    <th className="pb-2 text-right">Holdings</th>
                    <th className="pb-2 text-right">Change</th>
                    <th className="pb-2 text-right">Bought</th>
                    <th className="pb-2 text-right">Sold</th>
                    <th className="pb-2">Triggered</th>
                    <th className="pb-2 text-right">Movement</th>
                    <th className="pb-2 text-right">Final</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {view.stocks.map((s) => (
                    <tr key={s.stockId}>
                      <td className="py-1.5 pr-2 font-medium text-ink">{s.stockName}</td>
                      <td className="tabular py-1.5 text-right text-muted">{won(s.previousClosePrice)}</td>
                      <td className="tabular py-1.5 text-right text-ink">{won(s.openingPrice)}</td>
                      <td className="tabular py-1.5 text-right text-muted">{s.aggregateHoldings}</td>
                      <td
                        className={clsx(
                          'tabular py-1.5 text-right',
                          s.holdingsChange > 0 ? 'text-up' : s.holdingsChange < 0 ? 'text-down' : 'text-muted',
                        )}
                      >
                        {s.holdingsChange > 0 ? '+' : ''}
                        {s.holdingsChange}
                      </td>
                      <td className="tabular py-1.5 text-right text-up">{s.grossBuys}</td>
                      <td className="tabular py-1.5 text-right text-down">{s.grossSells}</td>
                      <td className="py-1.5 pr-2">
                        {s.branch ? (
                          <span className="text-[10px] uppercase tracking-wide text-lavender">{s.branch}</span>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                      <td
                        className={clsx(
                          'tabular py-1.5 text-right',
                          (s.appliedMovement ?? 0) > 0
                            ? 'text-up'
                            : (s.appliedMovement ?? 0) < 0
                              ? 'text-down'
                              : 'text-muted',
                        )}
                      >
                        {s.appliedMovement == null ? '—' : signed(s.appliedMovement)}
                      </td>
                      <td className="tabular py-1.5 text-right font-semibold text-ink">
                        {won(s.finalPrice)}
                        {s.hitFloor ? <Chip tone="warn">floor</Chip> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-4 space-y-2">
              <div className="label">Calculations</div>
              {view.stocks.map((s) => (
                <div key={s.stockId} className="rounded-lg bg-surface2/50 p-2.5 text-xs">
                  <span className="font-semibold text-ink">{s.stockName}:</span>{' '}
                  <span className="text-ink/85">{s.calculation}</span>
                </div>
              ))}
            </div>

            <button
              className="btn-ghost mt-3 text-xs"
              onClick={() => setShowSnapshot((v) => !v)}
            >
              {showSnapshot ? 'Hide' : 'Show'} the frozen market snapshot
            </button>
            {showSnapshot ? (
              <pre className="mt-2 max-h-72 overflow-auto rounded-lg bg-concrete/80 p-3 text-[11px] text-muted">
                {JSON.stringify(view.frozenSnapshot, null, 2)}
              </pre>
            ) : null}
            <p className="mt-2 text-xs text-muted">
              This snapshot is exactly what the settlement was computed from. Replaying it through the
              engine reproduces these prices.
            </p>
          </>
        )}
      </Card>
    </div>
  );
}
