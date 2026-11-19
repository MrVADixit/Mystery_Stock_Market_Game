'use client';

import { useState } from 'react';
import clsx from 'clsx';
import { Chip, Lock, Sheet, Spinner, Stat, Tick } from '@/components/ui';
import { moveClass, pct, signed, won } from '@/lib/format';
import type { GameStateView } from '@/server/state';

/* ---------------------------------------------------------------- */
/* Portfolio                                                         */
/* ---------------------------------------------------------------- */

export function PortfolioSheet({
  open,
  onClose,
  state,
  busy,
  onSellAll,
  onSellEverything,
}: {
  open: boolean;
  onClose: () => void;
  state: GameStateView;
  busy: boolean;
  onSellAll: (stockId: string) => void;
  onSellEverything: () => void;
}) {
  const [confirmAll, setConfirmAll] = useState(false);
  const me = state.me;
  if (!me) return null;

  const held = state.stocks.filter((s) => (s.myHoldings ?? 0) > 0);
  const tradingOpen = state.game.status === 'running';

  return (
    <Sheet open={open} onClose={onClose} title="Portfolio">
      <div className="grid grid-cols-2 gap-4">
        <Stat label="Total assets" value={`${won(me.totalAssets)}`} />
        <Stat
          label="Return"
          value={pct(me.returnPct)}
          tone={moveClass(me.totalAssets - me.startingCash)}
        />
        <Stat label="Available cash" value={won(me.cash)} small />
        <Stat label="Stock holdings value" value={won(me.holdingsValue)} small />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4 border-t border-white/8 pt-4">
        <Stat label="Starting capital" value={won(me.startingCash)} small />
        <Stat
          label="Gain / loss"
          value={signed(me.totalAssets - me.startingCash)}
          tone={moveClass(me.totalAssets - me.startingCash)}
          small
        />
        <Stat
          label="Realised P/L"
          value={signed(me.realisedPl)}
          tone={moveClass(me.realisedPl)}
          small
        />
        <Stat
          label="Unrealised P/L"
          value={signed(me.unrealisedPl)}
          tone={moveClass(me.unrealisedPl)}
          small
        />
        <Stat label="Spent on intelligence" value={won(me.intelSpendWon)} small />
        <Stat label="Pieces held" value={me.pieces} small />
      </div>

      <h4 className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wide text-lavender">Holdings</h4>
      {held.length === 0 ? (
        <p className="text-sm text-muted">You do not hold any stock yet.</p>
      ) : (
        <ul className="divide-y divide-white/5">
          {held.map((stock) => {
            const quantity = stock.myHoldings ?? 0;
            const value = stock.price != null ? stock.price * quantity : null;
            return (
              <li key={stock.id} className="flex items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-ink">{stock.name}</div>
                  <div className="tabular text-xs text-muted">
                    {quantity} × {stock.price == null ? '•••' : won(stock.price)} ={' '}
                    {value == null ? 'concealed' : `${won(value)} won`}
                  </div>
                </div>
                <button
                  className="btn-sell px-3 py-1.5 text-xs"
                  onClick={() => onSellAll(stock.id)}
                  disabled={busy || !tradingOpen || stock.tradingSuspended}
                >
                  Sell all
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {held.length > 1 ? (
        <div className="mt-5 border-t border-white/8 pt-4">
          {confirmAll ? (
            <div className="rounded-lg bg-down/10 p-3">
              <p className="text-sm text-ink">
                Sell every holding at this round&apos;s prices? That is{' '}
                <span className="tabular font-semibold">
                  {held.reduce((n, s) => n + (s.myHoldings ?? 0), 0)} shares
                </span>{' '}
                across {held.length} stocks.
              </p>
              <div className="mt-3 flex gap-2">
                <button
                  className="btn-sell flex-1"
                  onClick={() => {
                    setConfirmAll(false);
                    onSellEverything();
                  }}
                  disabled={busy}
                >
                  {busy ? <Spinner /> : null} Yes, sell everything
                </button>
                <button className="btn-secondary flex-1" onClick={() => setConfirmAll(false)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              className="btn-secondary w-full"
              onClick={() => setConfirmAll(true)}
              disabled={busy || !tradingOpen}
            >
              Sell all stocks…
            </button>
          )}
        </div>
      ) : null}
    </Sheet>
  );
}

/* ---------------------------------------------------------------- */
/* Rules & intelligence                                              */
/* ---------------------------------------------------------------- */

export function RulesSheet({
  open,
  onClose,
  state,
  busy,
  onBuyIntel,
  onExchangePieces,
}: {
  open: boolean;
  onClose: () => void;
  state: GameStateView;
  busy: boolean;
  onBuyIntel: (stockId: string) => void;
  onExchangePieces: (pieces: number) => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const intel = state.intel;
  const me = state.me;

  return (
    <Sheet open={open} onClose={onClose} title="Rules & intelligence" wide>
      <div className="mb-4 rounded-lg bg-surface2/60 p-3 text-xs text-muted">
        Each stock moves by a hidden rule. Fragments become public at rounds{' '}
        {state.disclosureSchedule.map((d) => d.round).join(', ')}. You can buy the next fragment early
        for one stock at a time — it stays private to you.
      </div>

      {intel.mode !== 'disabled' && me ? (
        <div className="card mb-4 p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-lavender">
                Buy rule intel
              </div>
              <div className="tabular mt-0.5 text-sm text-ink">
                {intel.mode === 'pieces'
                  ? `${me.pieces} Piece${me.pieces === 1 ? '' : 's'} left · 1 Piece per fragment`
                  : `${won(state.intel.offers[0]?.costWon ?? 0)} won per fragment`}
              </div>
            </div>
            <div className="text-right text-[11px] text-muted">
              Closes end of round {intel.deadlineRound}
            </div>
          </div>

          {intel.mode === 'pieces' && intel.allowPieceToCash && me.pieces > 0 ? (
            <button
              className="btn-ghost mt-2 w-full text-xs"
              onClick={() => onExchangePieces(1)}
              disabled={busy}
            >
              Exchange 1 Piece for {won(intel.pieceToCashWon)} won instead
            </button>
          ) : null}
        </div>
      ) : null}

      <ul className="space-y-2">
        {state.rules.map((rule) => {
          const offer = intel.offers.find((o) => o.stockId === rule.stockId);
          const isOpen = expanded === rule.stockId;
          const knownCount = rule.publicSegments.length + rule.privateSegments.length;
          return (
            <li key={rule.stockId} className="card overflow-hidden p-0">
              <button
                className="flex w-full items-center gap-3 p-3 text-left hover:bg-white/5"
                onClick={() => setExpanded(isOpen ? null : rule.stockId)}
                aria-expanded={isOpen}
                aria-label={`What is known about ${rule.stockName}`}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-ink">{rule.stockName}</div>
                  <div className="mt-0.5 flex items-center gap-1.5">
                    {[0, 1, 2, 3].map((i) => {
                      const isPublic = rule.publicSegments.some((s) => s.index === i);
                      const isPrivate = rule.privateSegments.some((s) => s.index === i);
                      return (
                        <span
                          key={i}
                          title={
                            isPublic ? 'Public' : isPrivate ? 'Bought by you' : 'Not yet revealed'
                          }
                          className={clsx(
                            'h-1.5 w-7 rounded-full',
                            isPublic ? 'bg-lavender' : isPrivate ? 'bg-up' : 'bg-white/12',
                          )}
                        />
                      );
                    })}
                    <span className="ml-1 text-[11px] text-muted">{knownCount}/4</span>
                  </div>
                </div>
                {rule.lockedCount > 0 ? <Lock className="text-muted" /> : <Tick className="text-up" />}
                <span className="text-muted" aria-hidden>
                  {isOpen ? '▾' : '›'}
                </span>
              </button>

              {isOpen ? (
                <div className="space-y-2 border-t border-white/8 px-3 pb-3 pt-3">
                  {rule.templateTitle ? (
                    <div className="text-[11px] uppercase tracking-wide text-muted">
                      Mechanic: {rule.templateTitle}
                    </div>
                  ) : null}

                  {rule.publicSegments.map((s) => (
                    <div key={`p${s.index}`} className="rounded-lg bg-surface2/60 p-2.5">
                      <div className="mb-0.5 flex items-center gap-2">
                        <Chip tone="violet">Public</Chip>
                        <span className="text-[11px] text-muted">{s.label}</span>
                      </div>
                      <p className="whitespace-pre-line text-sm text-ink">{s.text}</p>
                    </div>
                  ))}

                  {rule.privateSegments.map((s) => (
                    <div key={`v${s.index}`} className="rounded-lg bg-up/10 p-2.5">
                      <div className="mb-0.5 flex items-center gap-2">
                        <Chip tone="up">Yours only</Chip>
                        <span className="text-[11px] text-muted">{s.label}</span>
                      </div>
                      <p className="whitespace-pre-line text-sm text-ink">{s.text}</p>
                    </div>
                  ))}

                  {Array.from({ length: rule.lockedCount }).map((_, i) => (
                    <div
                      key={`l${i}`}
                      className="flex items-center gap-2 rounded-lg border border-dashed border-white/12 p-2.5 text-sm text-muted"
                    >
                      <Lock /> Not yet revealed
                    </div>
                  ))}

                  {offer?.available ? (
                    <button
                      className="btn-primary w-full"
                      onClick={() => onBuyIntel(rule.stockId)}
                      disabled={busy}
                    >
                      {busy ? <Spinner /> : null}
                      Buy intel
                      {offer.costPieces > 0
                        ? ` — 1 Piece`
                        : offer.costWon > 0
                          ? ` — ${won(offer.costWon)} won`
                          : ''}
                    </button>
                  ) : offer?.reason ? (
                    <p className="text-xs text-muted">{offer.reason}</p>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </Sheet>
  );
}

/* ---------------------------------------------------------------- */
/* Leaderboard                                                       */
/* ---------------------------------------------------------------- */

export function LeaderboardSheet({
  open,
  onClose,
  state,
}: {
  open: boolean;
  onClose: () => void;
  state: GameStateView;
}) {
  return (
    <Sheet open={open} onClose={onClose} title="Leaderboard">
      <LeaderboardTable state={state} />
    </Sheet>
  );
}

export function LeaderboardTable({ state }: { state: GameStateView }) {
  if (state.leaderboard.length === 0) {
    return <p className="text-sm text-muted">The leaderboard is not shown in this game.</p>;
  }
  const anyHidden = state.leaderboard.some((r) => r.totalAssets == null);

  return (
    <>
      <ol className="divide-y divide-white/5">
        {state.leaderboard.map((row) => (
          <li
            key={`${row.rank}-${row.name}`}
            className={clsx(
              'flex items-center gap-3 py-2.5',
              row.isMe && 'rounded-lg bg-violet/12 px-2',
            )}
          >
            <span className="tabular w-7 shrink-0 text-sm font-bold text-lavender">{row.rank}</span>
            <span className="min-w-0 flex-1 truncate text-sm text-ink">
              {row.name}
              {row.isMe ? <span className="ml-1.5 text-[11px] text-lavender">(you)</span> : null}
            </span>
            {row.rankChange != null && row.rankChange !== 0 ? (
              <span className={clsx('text-xs font-semibold', row.rankChange > 0 ? 'text-up' : 'text-down')}>
                {row.rankChange > 0 ? '▲' : '▼'} {Math.abs(row.rankChange)}
              </span>
            ) : null}
            <span className="tabular w-28 shrink-0 text-right text-sm font-semibold text-ink">
              {row.totalAssets == null ? '•••••' : won(row.totalAssets)}
            </span>
          </li>
        ))}
      </ol>
      {anyHidden ? (
        <p className="mt-3 text-xs text-muted">
          Hidden figures are concealed by an active secret. The rankings themselves stay visible.
        </p>
      ) : null}
    </>
  );
}

/* ---------------------------------------------------------------- */
/* Secret                                                            */
/* ---------------------------------------------------------------- */

export function SecretSheet({
  open,
  onClose,
  state,
  busy,
  onImpose,
}: {
  open: boolean;
  onClose: () => void;
  state: GameStateView;
  busy: boolean;
  onImpose: (stockId: string) => void;
}) {
  const [chosen, setChosen] = useState<string | null>(null);
  const secrets = state.secrets;

  return (
    <Sheet open={open} onClose={onClose} title="Impose a secret">
      <p className="text-sm text-muted">
        A secret hides a stock&apos;s price, trading activity and total holdings from everybody else for{' '}
        {secrets.durationRounds} round{secrets.durationRounds === 1 ? '' : 's'}, starting with the next
        round. Nobody is told who imposed it.
      </p>
      <p className="mt-2 text-xs text-muted">
        You have{' '}
        <span className="font-semibold text-ink">
          {secrets.myTokens} token{secrets.myTokens === 1 ? '' : 's'}
        </span>
        . Secrets can be imposed until the end of round {secrets.deadlineRound}.
        {secrets.tradingPolicy === 'suspended'
          ? ' Trading in the affected stock is suspended while the secret is in force.'
          : ' Trading in the affected stock continues as normal.'}
      </p>

      {!secrets.enabled ? (
        <p className="mt-4 rounded-lg bg-surface2/60 p-3 text-sm text-muted">
          Secrets are not available in this game.
        </p>
      ) : secrets.myTokens < 1 ? (
        <p className="mt-4 rounded-lg bg-surface2/60 p-3 text-sm text-muted">
          You have no secret tokens left.
        </p>
      ) : (
        <>
          <ul className="mt-4 space-y-1.5">
            {state.stocks.map((stock) => (
              <li key={stock.id}>
                <button
                  onClick={() => setChosen(stock.id)}
                  aria-label={`Target ${stock.name} with your secret`}
                  aria-pressed={chosen === stock.id}
                  className={clsx(
                    'flex w-full items-center gap-2 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors',
                    chosen === stock.id
                      ? 'border-lavender bg-violet/20 text-ink'
                      : 'border-white/10 text-ink hover:border-lavender/40',
                  )}
                >
                  <span className="flex-1 truncate">{stock.name}</span>
                  {stock.secretActive ? <Chip tone="violet">Already secret</Chip> : null}
                </button>
              </li>
            ))}
          </ul>

          <button
            className="btn-primary mt-4 w-full"
            disabled={!chosen || busy || !secrets.canImpose}
            onClick={() => chosen && onImpose(chosen)}
          >
            {busy ? <Spinner /> : null}
            Impose the secret
          </button>
          {!secrets.canImpose && secrets.reason ? (
            <p className="mt-2 text-xs text-muted">{secrets.reason}</p>
          ) : null}
          <p className="mt-2 text-[11px] text-muted">
            This uses your token immediately and cannot be undone.
          </p>
        </>
      )}
    </Sheet>
  );
}
