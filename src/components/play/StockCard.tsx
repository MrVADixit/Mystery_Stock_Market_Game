'use client';

import { useState } from 'react';
import clsx from 'clsx';
import { QuantityStepper, Spinner, Tick, Chip } from '@/components/ui';
import { arrow, moveClass, pct, won } from '@/lib/format';

export interface StockRow {
  id: string;
  name: string;
  price: number | null;
  previousPrice: number | null;
  changePct: number | null;
  myHoldings?: number;
  secretActive: boolean;
  tradingSuspended: boolean;
  aggregateHoldings: number | null;
}

export type TradeState = 'idle' | 'working' | 'done';

/**
 * One tradeable stock.
 *
 * The whole interaction is: pick a quantity, press BUY or SELL. There is no
 * confirmation step for an ordinary trade, and the buttons stay disabled
 * while a request is in flight so a double tap cannot submit twice.
 */
export function StockCard({
  stock,
  cash,
  tradingOpen,
  state,
  onTrade,
  onChart,
}: {
  stock: StockRow;
  cash: number;
  tradingOpen: boolean;
  state: TradeState;
  onTrade: (side: 'buy' | 'sell', quantity: number | 'max') => void;
  onChart: () => void;
}) {
  const [quantity, setQuantity] = useState(1);
  const held = stock.myHoldings ?? 0;
  const busy = state === 'working';
  const concealed = stock.price == null;

  const affordable = stock.price && stock.price > 0 ? Math.floor(cash / stock.price) : 0;
  const canBuy = tradingOpen && !busy && !concealed && !stock.tradingSuspended && affordable >= quantity;
  const canSell = tradingOpen && !busy && !stock.tradingSuspended && held >= quantity;

  return (
    <li className="card p-3.5">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-[15px] font-semibold text-ink">{stock.name}</h3>
            {stock.secretActive ? <Chip tone="violet">Secret</Chip> : null}
          </div>

          <div className="mt-0.5 flex items-baseline gap-2">
            <span className="tabular text-xl font-bold text-ink">
              {concealed ? '•••••' : won(stock.price)}
            </span>
            <span className="text-[11px] font-medium text-muted">WON</span>
            {!concealed && stock.changePct != null ? (
              <span className={clsx('tabular text-sm font-semibold', moveClass(stock.changePct))}>
                {arrow(stock.changePct)} {pct(stock.changePct)}
              </span>
            ) : null}
          </div>

          <div className="mt-1 text-xs text-muted">
            My holdings:{' '}
            <span className="tabular font-semibold text-ink">
              {held} share{held === 1 ? '' : 's'}
            </span>
            {stock.aggregateHoldings != null ? (
              <>
                {' · '}Market: <span className="tabular">{stock.aggregateHoldings}</span>
              </>
            ) : null}
          </div>
        </div>

        <button
          onClick={onChart}
          className="btn-ghost shrink-0 px-2"
          aria-label={`Open the ${stock.name} chart`}
          title="Chart"
        >
          <svg viewBox="0 0 20 20" className="h-5 w-5" aria-hidden>
            <path
              d="M3 15l4.5-5 3.5 3L17 5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>

      {concealed ? (
        <p className="mt-3 rounded-lg bg-violet/15 px-3 py-2 text-xs text-lavender">
          A secret is hiding this stock&apos;s price, volume and holdings. You can still see it once the
          secret expires.
        </p>
      ) : null}

      {stock.tradingSuspended ? (
        <p className="mt-3 rounded-lg bg-amber-400/10 px-3 py-2 text-xs text-amber-300">
          Trading in this stock is suspended while the secret is in force.
        </p>
      ) : null}

      <div className="mt-3 flex items-center gap-2">
        <QuantityStepper
          value={quantity}
          onChange={setQuantity}
          disabled={busy || !tradingOpen}
          label={stock.name}
        />
        <div className="ml-auto flex gap-1.5">
          <button
            className="btn-ghost px-2 text-[11px] font-bold uppercase"
            onClick={() => onTrade('buy', 'max')}
            disabled={!tradingOpen || busy || concealed || stock.tradingSuspended || affordable < 1}
            title="Buy as many as you can afford"
          >
            Max buy
          </button>
          <button
            className="btn-ghost px-2 text-[11px] font-bold uppercase"
            onClick={() => onTrade('sell', 'max')}
            disabled={!tradingOpen || busy || stock.tradingSuspended || held < 1}
            title="Sell your whole holding"
          >
            All
          </button>
        </div>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2">
        <button className="btn-buy" onClick={() => onTrade('buy', quantity)} disabled={!canBuy}>
          {busy ? <Spinner /> : state === 'done' ? <Tick /> : null}
          BUY
        </button>
        <button className="btn-sell" onClick={() => onTrade('sell', quantity)} disabled={!canSell}>
          {busy ? <Spinner /> : state === 'done' ? <Tick /> : null}
          SELL
        </button>
      </div>

      {!concealed && tradingOpen && affordable < quantity && held < quantity ? (
        <p className="mt-2 text-[11px] text-muted">
          You can afford {affordable} at this price and hold {held}.
        </p>
      ) : null}
    </li>
  );
}
