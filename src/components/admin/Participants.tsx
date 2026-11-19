'use client';

import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { Card, Chip, SectionTitle, Sheet, Spinner } from '@/components/ui';
import { api } from '@/lib/client';
import { moveClass, pct, signed, won } from '@/lib/format';
import type { ParticipantAudit } from '@/server/results';
import type { ParticipantSummary } from '@/lib/admin-types';
import type { GameStateView } from '@/server/state';

/** Participants list with a private per-participant audit (§14.2). */
export function Participants({
  gameId,
  state,
  joinUrl,
}: {
  gameId: string;
  state: GameStateView;
  joinUrl: string;
}) {
  const [rows, setRows] = useState<ParticipantSummary[] | null>(null);
  const [auditing, setAuditing] = useState<ParticipantSummary | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const result = await api<{ participants: ParticipantSummary[] }>(
          `/api/admin/games/${gameId}/participants`,
        );
        if (active) setRows(result.participants);
      } catch {
        /* the overview already surfaces connection problems */
      }
    };
    void load();
    const id = setInterval(load, 10_000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [gameId]);

  return (
    <div className="space-y-4">
      <Card>
        <SectionTitle>Invite participants</SectionTitle>
        <p className="text-sm text-muted">Everyone joins through the same link and code.</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto]">
          <code className="tabular block overflow-x-auto rounded-lg bg-concrete/70 px-3 py-2.5 text-sm text-lavender">
            {joinUrl}
          </code>
          <button
            className="btn-secondary"
            onClick={() => void navigator.clipboard?.writeText(joinUrl)}
          >
            Copy link
          </button>
        </div>
        <div className="tabular mt-3 text-center text-3xl font-bold tracking-[0.2em] text-ink">
          {state.game.joinCode ?? '—'}
        </div>
      </Card>

      <Card>
        <SectionTitle hint={rows ? `${rows.length} registered` : undefined}>Participants</SectionTitle>
        {!rows ? (
          <p className="text-sm text-muted">
            <Spinner className="mr-2" /> Loading…
          </p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted">Nobody has registered yet.</p>
        ) : (
          <div className="scroll-x">
            <table className="w-full min-w-[680px] text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-muted">
                  <th className="pb-2">Name</th>
                  <th className="pb-2 text-right">Cash</th>
                  <th className="pb-2 text-right">Holdings</th>
                  <th className="pb-2 text-right">Total</th>
                  <th className="pb-2 text-right">Return</th>
                  <th className="pb-2 text-right">Trades</th>
                  <th className="pb-2 text-center">Pieces</th>
                  <th className="pb-2 text-center">Tokens</th>
                  <th className="pb-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {rows.map((p) => {
                  const gain = p.totalAssets - p.startingCash;
                  return (
                    <tr key={p.id}>
                      <td className="py-2 pr-2">
                        <span className="flex items-center gap-2">
                          <span
                            className={clsx(
                              'h-1.5 w-1.5 rounded-full',
                              p.connected ? 'bg-up' : 'bg-white/20',
                            )}
                            title={p.connected ? 'Connected' : 'Not currently connected'}
                          />
                          <span className="text-ink">{p.displayName}</span>
                        </span>
                      </td>
                      <td className="tabular py-2 text-right text-muted">{won(p.cash)}</td>
                      <td className="tabular py-2 text-right text-muted">{won(p.holdingsValue)}</td>
                      <td className="tabular py-2 text-right font-semibold text-ink">{won(p.totalAssets)}</td>
                      <td className={clsx('tabular py-2 text-right', moveClass(gain))}>
                        {pct(p.startingCash > 0 ? (gain / p.startingCash) * 100 : 0)}
                      </td>
                      <td className="tabular py-2 text-right text-muted">{p.trades}</td>
                      <td className="tabular py-2 text-center text-muted">{p.pieces}</td>
                      <td className="tabular py-2 text-center text-muted">{p.secretTokens}</td>
                      <td className="py-2 pl-2 text-right">
                        <button
                          className="btn-ghost px-2 py-1 text-[11px]"
                          onClick={() => setAuditing(p)}
                        >
                          Audit
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-muted">
          These figures and the audit trail are private to you. Participants have no route to each
          other&apos;s trading history.
        </p>
      </Card>

      {auditing ? (
        <AuditSheet
          gameId={gameId}
          participant={auditing}
          state={state}
          onClose={() => setAuditing(null)}
        />
      ) : null}
    </div>
  );
}

function AuditSheet({
  gameId,
  participant,
  state,
  onClose,
}: {
  gameId: string;
  participant: ParticipantSummary;
  state: GameStateView;
  onClose: () => void;
}) {
  const [audit, setAudit] = useState<ParticipantAudit | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [round, setRound] = useState<string>('');
  const [stockId, setStockId] = useState<string>('');
  const [side, setSide] = useState<string>('');
  const [from, setFrom] = useState<string>('');
  const [to, setTo] = useState<string>('');
  const [tab, setTab] = useState<'timeline' | 'transactions' | 'values'>('timeline');

  useEffect(() => {
    let active = true;
    const params = new URLSearchParams();
    if (round) params.set('round', round);
    if (stockId) params.set('stockId', stockId);
    if (side) params.set('side', side);
    if (from) params.set('from', new Date(from).toISOString());
    if (to) params.set('to', new Date(to).toISOString());
    api<ParticipantAudit>(
      `/api/admin/games/${gameId}/participants/${participant.id}/audit?${params.toString()}`,
    )
      .then((result) => {
        if (active) {
          setAudit(result);
          setError(null);
        }
      })
      .catch((e) => active && setError(e instanceof Error ? e.message : 'Could not load the audit.'));
    return () => {
      active = false;
    };
  }, [gameId, participant.id, round, stockId, side, from, to]);

  return (
    <Sheet open onClose={onClose} title={`Audit — ${participant.displayName}`} wide>
      {error ? <p className="rounded-lg bg-down/15 px-3 py-2 text-sm text-down">{error}</p> : null}

      {audit ? (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <div className="label">Starting capital</div>
              <div className="tabular font-semibold text-ink">{won(audit.participant.startingCash)}</div>
            </div>
            <div>
              <div className="label">Cash now</div>
              <div className="tabular font-semibold text-ink">{won(audit.participant.cash)}</div>
            </div>
            <div>
              <div className="label">Spent on intel</div>
              <div className="tabular font-semibold text-ink">{won(audit.participant.intelSpendWon)}</div>
            </div>
            <div>
              <div className="label">Joined</div>
              <div className="text-xs text-ink">{new Date(audit.participant.joinedAt).toLocaleString()}</div>
            </div>
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-5">
            <label className="block">
              <span className="label">Round</span>
              <input
                type="number"
                className="field tabular"
                value={round}
                min={1}
                placeholder="any"
                onChange={(e) => setRound(e.target.value)}
              />
            </label>
            <label className="block">
              <span className="label">Stock</span>
              <select className="field" value={stockId} onChange={(e) => setStockId(e.target.value)}>
                <option value="">All</option>
                {state.stocks.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="label">Action</span>
              <select className="field" value={side} onChange={(e) => setSide(e.target.value)}>
                <option value="">Both</option>
                <option value="buy">Buy</option>
                <option value="sell">Sell</option>
              </select>
            </label>
            <label className="block">
              <span className="label">From</span>
              <input
                type="datetime-local"
                className="field"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </label>
            <label className="block">
              <span className="label">To</span>
              <input
                type="datetime-local"
                className="field"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </label>
          </div>

          <div className="mt-4 flex gap-1.5">
            {(['timeline', 'transactions', 'values'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={clsx(
                  'rounded-lg px-3 py-1.5 text-xs font-semibold capitalize',
                  tab === t ? 'bg-violet text-ink' : 'bg-surface2 text-muted',
                )}
              >
                {t === 'values' ? 'Value by round' : t}
              </button>
            ))}
          </div>

          {tab === 'timeline' ? (
            <ol className="mt-3 space-y-1.5">
              {audit.timeline.length === 0 ? (
                <li className="text-sm text-muted">Nothing recorded.</li>
              ) : (
                audit.timeline.map((entry, i) => (
                  <li key={i} className="flex gap-2 border-b border-white/5 pb-1.5 text-xs">
                    <span className="tabular w-32 shrink-0 text-muted">
                      {new Date(entry.at).toLocaleTimeString()}
                    </span>
                    <span className="tabular w-8 shrink-0 text-muted">
                      {entry.round ? `R${entry.round}` : '—'}
                    </span>
                    <Chip
                      tone={
                        entry.kind === 'trade'
                          ? 'neutral'
                          : entry.kind === 'secret'
                            ? 'violet'
                            : entry.kind === 'intel'
                              ? 'up'
                              : 'neutral'
                      }
                    >
                      {entry.kind}
                    </Chip>
                    <span className="min-w-0 flex-1 text-ink">{entry.summary}</span>
                  </li>
                ))
              )}
            </ol>
          ) : null}

          {tab === 'transactions' ? (
            <div className="scroll-x mt-3">
              <table className="w-full min-w-[840px] text-xs">
                <thead>
                  <tr className="text-left uppercase tracking-wide text-muted">
                    <th className="pb-2">Timestamp</th>
                    <th className="pb-2">Round</th>
                    <th className="pb-2">Stock</th>
                    <th className="pb-2">Action</th>
                    <th className="pb-2 text-right">Qty</th>
                    <th className="pb-2 text-right">Price</th>
                    <th className="pb-2 text-right">Amount</th>
                    <th className="pb-2 text-right">Cash before</th>
                    <th className="pb-2 text-right">Cash after</th>
                    <th className="pb-2 text-right">Held before</th>
                    <th className="pb-2 text-right">Held after</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {audit.transactions.map((t) => (
                    <tr key={t.id}>
                      <td className="tabular py-1.5 pr-2 text-muted">{new Date(t.at).toLocaleString()}</td>
                      <td className="tabular py-1.5 text-muted">{t.round}</td>
                      <td className="py-1.5 pr-2 text-ink">{t.stockName}</td>
                      <td className={clsx('py-1.5 font-semibold', t.side === 'buy' ? 'text-up' : 'text-down')}>
                        {t.side.toUpperCase()}
                      </td>
                      <td className="tabular py-1.5 text-right text-ink">{t.quantity}</td>
                      <td className="tabular py-1.5 text-right text-muted">{won(t.price)}</td>
                      <td className="tabular py-1.5 text-right text-ink">{won(t.amount)}</td>
                      <td className="tabular py-1.5 text-right text-muted">{won(t.cashBefore)}</td>
                      <td className="tabular py-1.5 text-right text-muted">{won(t.cashAfter)}</td>
                      <td className="tabular py-1.5 text-right text-muted">{t.sharesBefore}</td>
                      <td className="tabular py-1.5 text-right text-muted">{t.sharesAfter}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {audit.transactions.length === 0 ? (
                <p className="mt-2 text-sm text-muted">No transactions match those filters.</p>
              ) : null}
            </div>
          ) : null}

          {tab === 'values' ? (
            <table className="mt-3 w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-muted">
                  <th className="pb-2">Round</th>
                  <th className="pb-2 text-right">Cash</th>
                  <th className="pb-2 text-right">Holdings value</th>
                  <th className="pb-2 text-right">Total assets</th>
                  <th className="pb-2 text-right">Rank</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {audit.roundValues.map((r) => (
                  <tr key={r.round}>
                    <td className="tabular py-1.5 text-muted">{r.round}</td>
                    <td className="tabular py-1.5 text-right text-muted">{won(r.cash)}</td>
                    <td className="tabular py-1.5 text-right text-muted">{won(r.holdingsValue)}</td>
                    <td className="tabular py-1.5 text-right font-semibold text-ink">{won(r.totalAssets)}</td>
                    <td className="tabular py-1.5 text-right text-lavender">{r.rank ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </>
      ) : !error ? (
        <p className="text-sm text-muted">
          <Spinner className="mr-2" /> Loading the audit…
        </p>
      ) : null}
    </Sheet>
  );
}

export { signed };
