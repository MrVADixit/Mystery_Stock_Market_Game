'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ApiError, api, newIdempotencyKey, useCountdown, useLiveState } from '@/lib/client';
import { Spinner, Stat, Toasts, useToasts } from '@/components/ui';
import { RoundHeader } from '@/components/play/RoundHeader';
import { StockCard } from '@/components/play/StockCard';
import type { TradeState } from '@/components/play/StockCard';
import { GraphCentre } from '@/components/play/GraphCentre';
import { LeaderboardSheet, LeaderboardTable, PortfolioSheet, RulesSheet, SecretSheet } from '@/components/play/Sheets';
import { moveClass, pct, won } from '@/lib/format';
import type { GameStateView } from '@/server/state';

type Panel = 'none' | 'portfolio' | 'graphs' | 'rules' | 'leaderboard' | 'secret';

export default function PlayPage() {
  const router = useRouter();
  const toasts = useToasts();
  // The event stream is addressed by game id, which only arrives with the
  // first state payload, so the stream attaches itself once we know it.
  const [gameId, setGameId] = useState<string | null>(null);
  const { state, error, loading, connected, refresh, setState } = useLiveState<GameStateView>(
    '/api/play/state',
    gameId ? `/api/events/${gameId}` : null,
    { pollMs: 8000 },
  );

  const [panel, setPanel] = useState<Panel>('none');
  const [chartStockId, setChartStockId] = useState<string | null>(null);
  const [tradeStates, setTradeStates] = useState<Record<string, TradeState>>({});
  const [actionBusy, setActionBusy] = useState(false);
  // Guards against a double tap submitting the same order twice.
  const pending = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (state && state.game.id !== gameId) setGameId(state.game.id);
  }, [state, gameId]);

  const seconds = useCountdown(state?.game.secondsRemaining, state?.game.serverTime);
  const tradingOpen = state?.game.status === 'running' && seconds > 0;

  const setTradeState = useCallback((stockId: string, next: TradeState) => {
    setTradeStates((all) => ({ ...all, [stockId]: next }));
    if (next === 'done') {
      setTimeout(() => setTradeStates((all) => ({ ...all, [stockId]: 'idle' })), 1200);
    }
  }, []);

  const trade = useCallback(
    async (stockId: string, side: 'buy' | 'sell', quantity: number | 'max') => {
      if (pending.current.has(stockId)) return;
      pending.current.add(stockId);
      setTradeState(stockId, 'working');
      try {
        const result = await api<{ receipt: { quantity: number; price: number }; state: GameStateView }>(
          '/api/play/trade',
          {
            method: 'POST',
            body: JSON.stringify({
              stockId,
              side,
              quantity,
              // The key makes a retry idempotent on the server.
              idempotencyKey: newIdempotencyKey(),
            }),
          },
        );
        setState(result.state);
        setTradeState(stockId, 'done');
        const name = result.state.stocks.find((s) => s.id === stockId)?.name ?? 'stock';
        toasts.success(
          `${side === 'buy' ? 'Bought' : 'Sold'} ${result.receipt.quantity} ${name} at ${won(result.receipt.price)} won`,
        );
      } catch (e) {
        setTradeState(stockId, 'idle');
        if (e instanceof ApiError && e.status === 401) {
          router.push('/join');
          return;
        }
        toasts.error(e instanceof Error ? e.message : 'That order did not go through.');
        void refresh();
      } finally {
        pending.current.delete(stockId);
      }
    },
    [refresh, router, setState, setTradeState, toasts],
  );

  const runAction = useCallback(
    async <T,>(url: string, body: unknown, onDone: (result: T & { state: GameStateView }) => void) => {
      if (actionBusy) return;
      setActionBusy(true);
      try {
        const result = await api<T & { state: GameStateView }>(url, {
          method: 'POST',
          body: JSON.stringify(body),
        });
        setState(result.state);
        onDone(result);
      } catch (e) {
        toasts.error(e instanceof Error ? e.message : 'That did not work.');
      } finally {
        setActionBusy(false);
      }
    },
    [actionBusy, setState, toasts],
  );

  const graphStocks = useMemo(
    () =>
      (state?.stocks ?? []).map((s) => ({
        id: s.id,
        name: s.name,
        priceHistory: s.priceHistory,
        price: s.price,
        changePct: s.changePct,
        secretActive: s.secretActive,
      })),
    [state?.stocks],
  );

  if (loading) {
    return (
      <main className="flex min-h-dvh items-center justify-center text-muted">
        <Spinner className="mr-2" /> Loading the market…
      </main>
    );
  }

  if (!state) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-4 text-center">
        <p className="text-ink">{error ?? 'You are not signed in to a game.'}</p>
        <Link href="/join" className="btn-primary">
          Go to the join screen
        </Link>
      </main>
    );
  }

  const me = state.me;

  return (
    <div className="min-h-dvh pb-8">
      <RoundHeader
        round={state.game.round}
        totalRounds={state.game.totalRounds}
        seconds={seconds}
        status={state.game.status}
        connected={connected}
        gameName={state.game.name}
      />

      <main className="mx-auto max-w-3xl px-4">
        {/* Portfolio summary — visible without scrolling or tapping. */}
        {me ? (
          <section className="card mt-3 p-4" aria-label="Your portfolio">
            <div className="flex items-end justify-between gap-3">
              <Stat label="Total assets" value={`${won(me.totalAssets)} WON`} />
              <span className={`tabular text-sm font-semibold ${moveClass(me.totalAssets - me.startingCash)}`}>
                {pct(me.returnPct)}
              </span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 border-t border-white/8 pt-3">
              <Stat label="Available cash" value={`${won(me.cash)} WON`} small />
              <Stat label="Stock holdings value" value={`${won(me.holdingsValue)} WON`} small />
            </div>
            <button className="btn-secondary mt-3 w-full" onClick={() => setPanel('portfolio')}>
              View portfolio
            </button>
          </section>
        ) : null}

        {/* The four places to go. */}
        <nav className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <button className="btn-secondary" onClick={() => setPanel('graphs')}>
            Market graphs
          </button>
          <button className="btn-secondary" onClick={() => setPanel('rules')}>
            Rules &amp; intel
          </button>
          <button className="btn-secondary" onClick={() => setPanel('leaderboard')}>
            Leaderboard
          </button>
          <button
            className="btn-secondary"
            onClick={() => setPanel('secret')}
            disabled={!state.secrets.enabled}
          >
            Impose a secret
            {state.secrets.myTokens > 0 ? (
              <span className="ml-1 rounded-full bg-violet px-1.5 text-[11px] font-bold text-ink">
                {state.secrets.myTokens}
              </span>
            ) : null}
          </button>
        </nav>

        {state.announcements.length > 0 ? (
          <div className="mt-3 rounded-lg border border-lavender/25 bg-violet/10 p-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-lavender">
              Announcement
            </div>
            <p className="mt-0.5 text-sm text-ink">{state.announcements[0].body}</p>
          </div>
        ) : null}

        {state.game.status === 'registration' ? (
          <p className="mt-3 rounded-lg bg-surface2/60 p-3 text-sm text-muted">
            You are registered. The market opens when the administrator starts the game — this screen
            will update by itself.
          </p>
        ) : null}

        {state.game.status === 'finished' ? (
          <div className="mt-3 rounded-lg bg-violet/15 p-3">
            <p className="text-sm text-ink">The game is over. Final standings are in.</p>
            <Link href={`/results/${state.game.id}`} className="btn-primary mt-2 w-full">
              See the final results
            </Link>
          </div>
        ) : null}

        {/* The market. */}
        <section className="mt-4" aria-label="Stocks">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-lavender">
            The market
          </h2>
          <ul className="space-y-2.5">
            {state.stocks.map((stock) => (
              <StockCard
                key={stock.id}
                stock={stock}
                cash={me?.cash ?? 0}
                tradingOpen={Boolean(tradingOpen)}
                state={tradeStates[stock.id] ?? 'idle'}
                onTrade={(side, quantity) => void trade(stock.id, side, quantity)}
                onChart={() => {
                  setChartStockId(stock.id);
                  setPanel('graphs');
                }}
              />
            ))}
          </ul>
        </section>

        {/* On a wide screen the leaderboard is always in view. */}
        <section className="mt-6 hidden lg:block">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-lavender">
            Standings
          </h2>
          <div className="card p-4">
            <LeaderboardTable state={state} />
          </div>
        </section>

        <footer className="mt-8 flex items-center justify-between text-xs text-muted">
          <span>Signed in as {me?.displayName ?? 'participant'}</span>
          <button
            className="btn-ghost px-2 text-xs"
            onClick={async () => {
              await api('/api/play/logout', { method: 'POST' });
              router.push('/join');
            }}
          >
            Sign out
          </button>
        </footer>
      </main>

      <PortfolioSheet
        open={panel === 'portfolio'}
        onClose={() => setPanel('none')}
        state={state}
        busy={actionBusy}
        onSellAll={(stockId) => void trade(stockId, 'sell', 'max')}
        onSellEverything={async () => {
          // Sequential, so each sale's cash is settled before the next.
          for (const stock of state.stocks) {
            if ((stock.myHoldings ?? 0) > 0) await trade(stock.id, 'sell', 'max');
          }
        }}
      />

      <GraphCentre
        open={panel === 'graphs'}
        onClose={() => {
          setPanel('none');
          setChartStockId(null);
        }}
        stocks={graphStocks}
        initialStockId={chartStockId}
      />

      <RulesSheet
        open={panel === 'rules'}
        onClose={() => setPanel('none')}
        state={state}
        busy={actionBusy}
        onBuyIntel={(stockId) =>
          void runAction<{ receipt: { text: string } }>('/api/play/intel', { stockId }, (r) =>
            toasts.success(`Intel received: ${r.receipt.text.slice(0, 90)}…`),
          )
        }
        onExchangePieces={(pieces) =>
          void runAction<{ receipt: { received: number } }>('/api/play/pieces', { pieces }, (r) =>
            toasts.success(`Exchanged for ${won(r.receipt.received)} won`),
          )
        }
      />

      <LeaderboardSheet open={panel === 'leaderboard'} onClose={() => setPanel('none')} state={state} />

      <SecretSheet
        open={panel === 'secret'}
        onClose={() => setPanel('none')}
        state={state}
        busy={actionBusy}
        onImpose={(stockId) =>
          void runAction<{ receipt: { firstRound: number; lastRound: number } }>(
            '/api/play/secret',
            { stockId },
            (r) => {
              toasts.success(`Secret active for rounds ${r.receipt.firstRound}–${r.receipt.lastRound}`);
              setPanel('none');
            },
          )
        }
      />

      <Toasts toasts={toasts.toasts} onDismiss={toasts.dismiss} />
    </div>
  );
}
