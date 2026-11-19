'use client';

import { useState } from 'react';
import clsx from 'clsx';
import { Card, Chip, SectionTitle, Spinner, Stat } from '@/components/ui';
import { LeaderboardTable } from '@/components/play/Sheets';
import { arrow, clock, moveClass, pct, won } from '@/lib/format';
import type { AdminState, ConfigResponse } from '@/lib/admin-types';

/** The live control room (§14.1). */
export function Overview({
  state,
  config,
  seconds,
  busy,
  onAction,
  onAnnounce,
}: {
  state: AdminState;
  config: ConfigResponse | null;
  seconds: number;
  busy: boolean;
  onAction: (action: string, extra?: Record<string, unknown>) => void;
  onAnnounce: (body: string) => void;
}) {
  const [announcement, setAnnouncement] = useState('');
  const status = state.game.status;

  return (
    <div className="space-y-4">
      <Card>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Round" value={`${state.game.round} / ${state.game.totalRounds}`} />
          <Stat
            label={status === 'running' ? 'Time remaining' : 'Status'}
            value={status === 'running' ? clock(seconds) : status}
            tone={status === 'running' && seconds <= 30 ? 'text-down' : undefined}
          />
          <Stat
            label="Connected"
            value={`${state.admin.connectedParticipants} / ${state.admin.totalParticipants}`}
          />
          <Stat label="Join code" value={config?.game.joinCode ?? '—'} tone="text-lavender" />
        </div>

        <div className="mt-4 flex flex-wrap gap-2 border-t border-white/8 pt-4">
          {status === 'draft' ? (
            <button className="btn-primary" disabled={busy} onClick={() => onAction('open-registration')}>
              Open registration
            </button>
          ) : null}
          {status === 'registration' ? (
            <button className="btn-primary" disabled={busy} onClick={() => onAction('start')}>
              Start the game
            </button>
          ) : null}
          {status === 'running' ? (
            <>
              <button className="btn-secondary" disabled={busy} onClick={() => onAction('pause')}>
                Pause
              </button>
              <button className="btn-secondary" disabled={busy} onClick={() => onAction('force-advance')}>
                End this round now
              </button>
            </>
          ) : null}
          {status === 'paused' ? (
            <button
              className="btn-primary"
              disabled={busy}
              onClick={() => onAction('resume', { secondsLeft: Math.max(5, seconds || 60) })}
            >
              Resume
            </button>
          ) : null}
          {status === 'running' || status === 'paused' ? (
            <button className="btn-ghost" disabled={busy} onClick={() => onAction('finish')}>
              Finish the game
            </button>
          ) : null}
          {status === 'finished' ? (
            <button className="btn-ghost" disabled={busy} onClick={() => onAction('archive')}>
              Archive
            </button>
          ) : null}
          {busy ? <Spinner className="self-center text-muted" /> : null}
        </div>
      </Card>

      <Card>
        <SectionTitle hint="Full information — nothing is hidden from you">Market</SectionTitle>
        <div className="scroll-x">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-muted">
                <th className="pb-2">Stock</th>
                <th className="pb-2 text-right">Price</th>
                <th className="pb-2 text-right">Change</th>
                <th className="pb-2 text-right">Holdings</th>
                <th className="pb-2 text-right">Bought</th>
                <th className="pb-2 text-right">Sold</th>
                <th className="pb-2 text-center">Secret</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {state.stocks.map((stock) => (
                <tr key={stock.id}>
                  <td className="py-2 pr-2 font-medium text-ink">{stock.name}</td>
                  <td className="tabular py-2 text-right text-ink">{won(stock.price)}</td>
                  <td className={clsx('tabular py-2 text-right', moveClass(stock.changePct))}>
                    {stock.changePct == null ? '—' : `${arrow(stock.changePct)} ${pct(stock.changePct)}`}
                  </td>
                  <td className="tabular py-2 text-right text-muted">{stock.aggregateHoldings ?? '—'}</td>
                  <td className="tabular py-2 text-right text-up">{stock.grossBuys ?? '—'}</td>
                  <td className="tabular py-2 text-right text-down">{stock.grossSells ?? '—'}</td>
                  <td className="py-2 text-center">
                    {stock.secretActive ? <Chip tone="violet">Active</Chip> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-muted">
          Bought and sold are the previous completed round&apos;s gross volumes; holdings are current.
        </p>
      </Card>

      {state.admin.activeSecrets.length > 0 ? (
        <Card>
          <SectionTitle hint="Participants never see who imposed a secret">Active secrets</SectionTitle>
          <ul className="space-y-1.5 text-sm">
            {state.admin.activeSecrets.map((s, i) => (
              <li key={i} className="flex items-center gap-2">
                <Chip tone="violet">R{s.firstRound}–{s.lastRound}</Chip>
                <span className="text-ink">{state.stocks.find((x) => x.id === s.stockId)?.name ?? s.stockId}</span>
                <span className="ml-auto text-muted">imposed by {s.imposedBy}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <SectionTitle>Rankings</SectionTitle>
          <LeaderboardTable state={state} />
        </Card>

        <Card>
          <SectionTitle hint={`${state.admin.recentTrades.length} most recent`}>Recent transactions</SectionTitle>
          {state.admin.recentTrades.length === 0 ? (
            <p className="text-sm text-muted">No trades yet.</p>
          ) : (
            <ul className="max-h-80 space-y-1 overflow-y-auto text-xs">
              {state.admin.recentTrades.map((t, i) => (
                <li key={i} className="flex items-center gap-2 border-b border-white/5 pb-1">
                  <span className="tabular w-8 shrink-0 text-muted">R{t.round}</span>
                  <span className="min-w-0 flex-1 truncate text-ink">{t.participant}</span>
                  <span className={clsx('font-semibold', t.side === 'buy' ? 'text-up' : 'text-down')}>
                    {t.side === 'buy' ? 'BUY' : 'SELL'}
                  </span>
                  <span className="tabular w-6 text-right text-ink">{t.quantity}</span>
                  <span className="min-w-0 max-w-[7rem] truncate text-muted">
                    {state.stocks.find((s) => s.id === t.stockId)?.name ?? t.stockId}
                  </span>
                  <span className="tabular w-16 text-right text-muted">{won(t.price)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card>
        <SectionTitle>Announcement</SectionTitle>
        <div className="flex gap-2">
          <input
            className="field"
            value={announcement}
            onChange={(e) => setAnnouncement(e.target.value)}
            placeholder="Shown to every participant and on the display board"
            maxLength={500}
          />
          <button
            className="btn-primary shrink-0"
            disabled={busy || !announcement.trim()}
            onClick={() => {
              onAnnounce(announcement.trim());
              setAnnouncement('');
            }}
          >
            Send
          </button>
        </div>
      </Card>
    </div>
  );
}
