'use client';

import clsx from 'clsx';
import { useCountdown, useLiveState } from '@/lib/client';
import { ComparisonChart } from '@/components/charts';
import { Spinner } from '@/components/ui';
import { arrow, clock, moveClass, pct, stockColour, won } from '@/lib/format';
import type { GameStateView } from '@/server/state';

export function DisplayBoard({ gameId, token }: { gameId: string; token: string }) {
  const { state, error, loading } = useLiveState<GameStateView>(
    `/api/display/${gameId}/state?token=${encodeURIComponent(token)}`,
    `/api/events/${gameId}?token=${encodeURIComponent(token)}`,
    { pollMs: 5000 },
  );
  const seconds = useCountdown(state?.game.secondsRemaining, state?.game.serverTime);

  if (loading) {
    return (
      <main className="flex min-h-dvh items-center justify-center text-muted">
        <Spinner className="mr-3" /> Connecting to the market…
      </main>
    );
  }

  if (!state) {
    return (
      <main className="flex min-h-dvh items-center justify-center p-8 text-center">
        <div>
          <h1 className="text-2xl font-bold text-ink">This display link is not valid</h1>
          <p className="mt-2 text-muted">{error ?? 'Ask the administrator for a new one.'}</p>
        </div>
      </main>
    );
  }

  const live = state.game.status === 'running';
  const urgent = live && seconds <= 30;

  return (
    <main className="min-h-dvh p-4 lg:p-8">
      {/* Header: round, countdown, name. Legible from the back of a room. */}
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-white/10 pb-4">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.35em] text-lavender lg:text-sm">
            Mystery Stock Market
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-ink lg:text-5xl">{state.game.name}</h1>
        </div>
        <div className="text-right">
          <div className="tabular text-xl font-semibold text-muted lg:text-3xl">
            ROUND {String(state.game.round).padStart(2, '0')} / {state.game.totalRounds}
          </div>
          <div
            className={clsx(
              'tabular text-5xl font-bold leading-none tracking-tight lg:text-7xl',
              urgent ? 'text-down' : 'text-ink',
            )}
          >
            {live ? clock(seconds) : state.game.status === 'finished' ? 'FINISHED' : state.game.status.toUpperCase()}
          </div>
        </div>
      </header>

      {state.announcements.length > 0 ? (
        <div className="mt-4 rounded-xl border border-lavender/30 bg-violet/15 px-5 py-3">
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-lavender">Announcement</div>
          <p className="mt-0.5 text-lg text-ink lg:text-2xl">{state.announcements[0].body}</p>
        </div>
      ) : null}

      <div className="mt-5 grid gap-5 xl:grid-cols-[1.6fr_1fr]">
        <section>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.25em] text-lavender lg:text-sm">
            The market
          </h2>
          <div className="scroll-x card p-0">
            <table className="w-full min-w-[620px]">
              <thead>
                <tr className="border-b border-white/8 text-left text-[11px] uppercase tracking-wide text-muted lg:text-xs">
                  <th className="px-4 py-3">Stock</th>
                  <th className="px-4 py-3 text-right">Price</th>
                  <th className="px-4 py-3 text-right">Change</th>
                  {state.publicInfo.showAggregateHoldings ? (
                    <th className="px-4 py-3 text-right">Holdings</th>
                  ) : null}
                  {state.publicInfo.showVolumes ? (
                    <>
                      <th className="px-4 py-3 text-right">Bought</th>
                      <th className="px-4 py-3 text-right">Sold</th>
                    </>
                  ) : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {state.stocks.map((stock, i) => (
                  <tr key={stock.id}>
                    <td className="px-4 py-3">
                      <span className="flex items-center gap-2.5">
                        <span
                          className="h-6 w-1.5 shrink-0 rounded-full"
                          style={{ background: stockColour(i) }}
                          aria-hidden
                        />
                        <span className="text-base font-semibold text-ink lg:text-xl">{stock.name}</span>
                        {stock.secretActive ? (
                          <span className="chip bg-violet/30 text-lavender">Secret</span>
                        ) : null}
                      </span>
                    </td>
                    <td className="tabular px-4 py-3 text-right text-base font-bold text-ink lg:text-2xl">
                      {stock.price == null ? '•••••' : won(stock.price)}
                    </td>
                    <td
                      className={clsx(
                        'tabular px-4 py-3 text-right text-base font-semibold lg:text-xl',
                        moveClass(stock.changePct),
                      )}
                    >
                      {stock.changePct == null ? '—' : `${arrow(stock.changePct)} ${pct(stock.changePct)}`}
                    </td>
                    {state.publicInfo.showAggregateHoldings ? (
                      <td className="tabular px-4 py-3 text-right text-muted lg:text-lg">
                        {stock.aggregateHoldings ?? '•••'}
                      </td>
                    ) : null}
                    {state.publicInfo.showVolumes ? (
                      <>
                        <td className="tabular px-4 py-3 text-right text-up lg:text-lg">
                          {stock.grossBuys ?? '•••'}
                        </td>
                        <td className="tabular px-4 py-3 text-right text-down lg:text-lg">
                          {stock.grossSells ?? '•••'}
                        </td>
                      </>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card mt-4 p-3">
            <ComparisonChart
              stocks={state.stocks.map((s) => ({
                id: s.id,
                name: s.name,
                priceHistory: s.priceHistory,
              }))}
              height={320}
            />
          </div>
          {state.publicInfo.showVolumes ? (
            <p className="mt-2 text-xs text-muted">
              Bought and sold are the previous completed round&apos;s volumes.
            </p>
          ) : null}
        </section>

        <aside className="space-y-5">
          {state.leaderboard.length > 0 ? (
            <section>
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.25em] text-lavender lg:text-sm">
                Standings
              </h2>
              <ol className="card divide-y divide-white/5 p-0">
                {state.leaderboard.slice(0, 20).map((row) => (
                  <li key={`${row.rank}-${row.name}`} className="flex items-center gap-3 px-4 py-2.5">
                    <span className="tabular w-8 shrink-0 text-lg font-bold text-lavender">{row.rank}</span>
                    <span className="min-w-0 flex-1 truncate text-base text-ink lg:text-lg">{row.name}</span>
                    {row.rankChange != null && row.rankChange !== 0 ? (
                      <span
                        className={clsx(
                          'text-xs font-semibold',
                          row.rankChange > 0 ? 'text-up' : 'text-down',
                        )}
                      >
                        {row.rankChange > 0 ? '▲' : '▼'} {Math.abs(row.rankChange)}
                      </span>
                    ) : null}
                    <span className="tabular shrink-0 text-base font-semibold text-ink lg:text-lg">
                      {row.totalAssets == null ? '•••••' : won(row.totalAssets)}
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}

          <section>
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.25em] text-lavender lg:text-sm">
              Rule reveals
            </h2>
            <ul className="card space-y-2 p-4">
              {state.disclosureSchedule.map((d) => (
                <li key={d.index} className="flex items-center gap-3 text-sm lg:text-base">
                  <span
                    className={clsx(
                      'tabular w-16 shrink-0 font-semibold',
                      d.done ? 'text-up' : 'text-muted',
                    )}
                  >
                    R{d.round}
                  </span>
                  <span className={d.done ? 'text-ink' : 'text-muted'}>{d.label}</span>
                  <span className="ml-auto text-xs">
                    {d.done ? <span className="text-up">released</span> : <span className="text-muted">upcoming</span>}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          {/* What is public right now — never an unrevealed fragment. */}
          <section>
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.25em] text-lavender lg:text-sm">
              What the market knows
            </h2>
            <ul className="card space-y-2.5 p-4">
              {state.rules.map((rule) => (
                <li key={rule.stockId}>
                  <div className="text-sm font-semibold text-ink">{rule.stockName}</div>
                  {rule.publicSegments.length === 0 ? (
                    <p className="text-xs text-muted">Nothing revealed yet.</p>
                  ) : (
                    <p className="text-xs text-ink/80">
                      {rule.publicSegments[rule.publicSegments.length - 1].text}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>

      <footer className="mt-6 text-center text-[11px] text-muted">
        Read-only display board · this page cannot trade and shows only what the game rules make public
      </footer>
    </main>
  );
}
