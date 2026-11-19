'use client';

import clsx from 'clsx';
import { clock, roundLabel } from '@/lib/format';

/**
 * The round and countdown, pinned to the top of the screen.
 *
 * The countdown is the server's figure, interpolated locally between
 * refreshes. The server alone decides when trading actually closes.
 */
export function RoundHeader({
  round,
  totalRounds,
  seconds,
  status,
  connected,
  gameName,
}: {
  round: number;
  totalRounds: number;
  seconds: number;
  status: string;
  connected: boolean;
  gameName: string;
}) {
  const urgent = seconds <= 30 && status === 'running';
  const notLive = status !== 'running';

  return (
    <header className="sticky top-0 z-20 border-b border-white/8 bg-concrete/95 backdrop-blur">
      <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-2.5">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
            {gameName}
          </div>
          <div className="tabular text-base font-bold tracking-wide text-ink">
            {roundLabel(round, totalRounds)}
          </div>
        </div>

        <div className="text-right">
          <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
            {notLive ? 'Status' : 'Time remaining'}
          </div>
          {notLive ? (
            <div className="text-base font-bold uppercase tracking-wide text-lavender">
              {status === 'finished' ? 'Finished' : status === 'paused' ? 'Paused' : status}
            </div>
          ) : (
            <div
              className={clsx(
                'tabular text-2xl font-bold leading-6 tracking-tight',
                urgent ? 'text-down' : 'text-ink',
              )}
              aria-live="off"
            >
              {clock(seconds)}
            </div>
          )}
        </div>

        <span
          className={clsx('h-2 w-2 shrink-0 rounded-full', connected ? 'bg-up' : 'bg-amber-400')}
          title={connected ? 'Live' : 'Reconnecting — your account and holdings are safe'}
          aria-label={connected ? 'Connected' : 'Reconnecting'}
        />
      </div>

      {urgent ? (
        <div className="bg-down/15 px-4 py-1 text-center text-[11px] font-semibold uppercase tracking-wide text-down">
          Trading closes in {seconds}s
        </div>
      ) : null}
    </header>
  );
}
