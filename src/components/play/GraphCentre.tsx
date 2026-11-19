'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { ComparisonChart, Sparkline, StockChart } from '@/components/charts';
import type { SeriesStock } from '@/components/charts';
import { Sheet } from '@/components/ui';
import { arrow, moveClass, pct, stockColour, won } from '@/lib/format';

interface GraphStock extends SeriesStock {
  price: number | null;
  changePct: number | null;
  secretActive: boolean;
}

/**
 * MARKET GRAPHS.
 *
 * A list of stocks with preview lines; tapping one opens a large chart.
 * On a phone the chart goes full-screen and asks the browser to rotate to
 * landscape — and simply stays portrait where that is not supported,
 * rather than refusing to open.
 */
export function GraphCentre({
  open,
  onClose,
  stocks,
  initialStockId,
}: {
  open: boolean;
  onClose: () => void;
  stocks: GraphStock[];
  initialStockId?: string | null;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [comparing, setComparing] = useState(false);
  const [visible, setVisible] = useState<Set<string>>(() => new Set(stocks.map((s) => s.id)));

  useEffect(() => {
    if (open) setSelected(initialStockId ?? null);
  }, [open, initialStockId]);

  if (selected) {
    const index = stocks.findIndex((s) => s.id === selected);
    const stock = stocks[index];
    if (stock) {
      return (
        <FullscreenChart
          stock={stock}
          index={index}
          onBack={() => setSelected(null)}
          onClose={() => {
            setSelected(null);
            onClose();
          }}
        />
      );
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Market graphs" wide>
      <div className="mb-3 flex gap-2">
        <button
          className={clsx(comparing ? 'btn-secondary' : 'btn-primary', 'flex-1')}
          onClick={() => setComparing(false)}
        >
          Individual
        </button>
        <button
          className={clsx(comparing ? 'btn-primary' : 'btn-secondary', 'flex-1')}
          onClick={() => setComparing(true)}
        >
          Compare
        </button>
      </div>

      {comparing ? (
        <div>
          <div className="mb-3 flex flex-wrap gap-1.5">
            {stocks.map((stock, i) => {
              const on = visible.has(stock.id);
              return (
                <button
                  key={stock.id}
                  onClick={() =>
                    setVisible((current) => {
                      const next = new Set(current);
                      if (next.has(stock.id)) next.delete(stock.id);
                      else next.add(stock.id);
                      return next;
                    })
                  }
                  className={clsx(
                    'rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors',
                    on ? 'border-transparent text-concrete' : 'border-white/15 text-muted',
                  )}
                  style={on ? { background: stockColour(i) } : undefined}
                  aria-pressed={on}
                >
                  {stock.name}
                </button>
              );
            })}
          </div>
          <ComparisonChart stocks={stocks} visible={visible} height={340} />
          <p className="mt-2 text-xs text-muted">
            A gap in a line is a round that a secret concealed at the time.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-white/5">
          {stocks.map((stock, i) => (
            <li key={stock.id}>
              <button
                onClick={() => setSelected(stock.id)}
                aria-label={`View the ${stock.name} price chart`}
                className="flex w-full items-center gap-3 px-1 py-3 text-left hover:bg-white/5"
              >
                <span
                  className="h-8 w-1 shrink-0 rounded-full"
                  style={{ background: stockColour(i) }}
                  aria-hidden
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-ink">{stock.name}</span>
                  <span className="tabular block text-xs text-muted">
                    {stock.price == null ? 'Concealed' : `${won(stock.price)} won`}
                    {stock.changePct != null ? (
                      <span className={clsx('ml-2 font-semibold', moveClass(stock.changePct))}>
                        {arrow(stock.changePct)} {pct(stock.changePct)}
                      </span>
                    ) : null}
                  </span>
                </span>
                <Sparkline stock={stock} index={i} />
                <span className="text-muted" aria-hidden>
                  ›
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}

function FullscreenChart({
  stock,
  index,
  onBack,
  onClose,
}: {
  stock: GraphStock;
  index: number;
  onBack: () => void;
  onClose: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [rotated, setRotated] = useState(false);

  const enter = useCallback(async () => {
    const element = containerRef.current;
    if (!element) return;
    try {
      if (!document.fullscreenElement && element.requestFullscreen) {
        await element.requestFullscreen({ navigationUI: 'hide' });
      }
      // Orientation locking only exists on some mobile browsers. Where it
      // is missing the chart simply stays portrait; nothing is blocked.
      const orientation = screen.orientation as (ScreenOrientation & { lock?: (o: string) => Promise<void> }) | undefined;
      if (orientation?.lock) {
        await orientation.lock('landscape');
        setRotated(true);
      }
    } catch {
      /* unsupported or refused — carry on in portrait */
    }
  }, []);

  useEffect(() => {
    void enter();
    return () => {
      try {
        (screen.orientation as ScreenOrientation & { unlock?: () => void })?.unlock?.();
        if (document.fullscreenElement) void document.exitFullscreen();
      } catch {
        /* ignore */
      }
    };
  }, [enter]);

  const last = [...stock.priceHistory].reverse().find((p) => p != null) ?? null;

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-50 flex flex-col bg-concrete"
      role="dialog"
      aria-modal
      aria-label={`${stock.name} price chart`}
    >
      <div className="flex items-center gap-3 border-b border-white/8 px-3 py-2">
        <button onClick={onBack} className="btn-ghost px-3" aria-label="Back to the stock list">
          ← Back
        </button>
        <div className="min-w-0 flex-1 text-center">
          <div className="truncate text-sm font-semibold text-ink">{stock.name}</div>
          <div className="tabular text-xs text-muted">{last == null ? 'Concealed' : `${won(last)} won`}</div>
        </div>
        <button onClick={onClose} className="btn-ghost px-3" aria-label="Close the chart">
          ✕
        </button>
      </div>

      <div className="min-h-0 flex-1 p-2">
        <div className="h-full w-full">
          <StockChart stock={stock} index={index} height="100%" />
        </div>
      </div>

      {!rotated ? (
        <p className="px-3 pb-2 text-center text-[11px] text-muted">
          Turn your phone sideways for a larger view.
        </p>
      ) : null}
    </div>
  );
}
