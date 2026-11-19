'use client';

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Legend,
} from 'recharts';
import { stockColour, won } from '@/lib/format';

export interface SeriesStock {
  id: string;
  name: string;
  /** priceHistory[i] is round i+1; null means concealed by a secret. */
  priceHistory: (number | null)[];
}

interface Row {
  round: number;
  [stockId: string]: number | null;
}

function toRows(stocks: SeriesStock[]): Row[] {
  const length = Math.max(0, ...stocks.map((s) => s.priceHistory.length));
  const rows: Row[] = [];
  for (let i = 0; i < length; i++) {
    const row: Row = { round: i + 1 };
    for (const stock of stocks) row[stock.id] = stock.priceHistory[i] ?? null;
    rows.push(row);
  }
  return rows;
}

const axisStyle = { fill: '#AAA5B2', fontSize: 11 };

function ChartTooltip({
  active,
  payload,
  label,
  names,
}: {
  active?: boolean;
  payload?: { dataKey?: string | number; value?: number | string; color?: string }[];
  label?: string | number;
  names: Map<string, string>;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-white/10 bg-concrete/95 px-3 py-2 text-xs shadow-lg">
      <div className="mb-1 font-semibold text-lavender">Round {label}</div>
      {payload.map((entry) => (
        <div key={String(entry.dataKey)} className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full" style={{ background: entry.color }} />
          <span className="text-muted">{names.get(String(entry.dataKey)) ?? String(entry.dataKey)}</span>
          <span className="tabular ml-auto font-semibold text-ink">
            {typeof entry.value === 'number' ? won(entry.value) : '—'}
          </span>
        </div>
      ))}
    </div>
  );
}

/** One stock's price path. */
export function StockChart({
  stock,
  index,
  height = 260,
  showAxes = true,
  decorative = false,
}: {
  stock: SeriesStock;
  index: number;
  /** A pixel height, or a percentage to fill a sized parent. */
  height?: number | `${number}%`;
  showAxes?: boolean;
  /**
   * A decorative chart sits inside something else that is interactive —
   * a list row, say. It takes no focus and swallows no clicks.
   */
  decorative?: boolean;
}) {
  const rows = toRows([stock]);
  const names = new Map([[stock.id, stock.name]]);
  const colour = stockColour(index);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart
        data={rows}
        margin={{ top: 8, right: 12, bottom: 0, left: showAxes ? 4 : 0 }}
        accessibilityLayer={!decorative}
      >
        <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
        {showAxes ? (
          <>
            <XAxis dataKey="round" tick={axisStyle} stroke="rgba(255,255,255,0.1)" />
            <YAxis
              tick={axisStyle}
              stroke="rgba(255,255,255,0.1)"
              width={62}
              tickFormatter={(v: number) => won(v)}
              domain={['auto', 'auto']}
            />
            <Tooltip content={<ChartTooltip names={names} />} />
          </>
        ) : null}
        <Line
          type="monotone"
          dataKey={stock.id}
          stroke={colour}
          strokeWidth={2}
          dot={false}
          // A gap is a round a secret concealed, not a missing data point.
          connectNulls={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

/** Several stocks on one set of axes. */
export function ComparisonChart({
  stocks,
  height = 320,
  visible,
}: {
  stocks: SeriesStock[];
  height?: number;
  visible?: Set<string>;
}) {
  const shown = visible ? stocks.filter((s) => visible.has(s.id)) : stocks;
  const rows = toRows(shown);
  const names = new Map(stocks.map((s) => [s.id, s.name]));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: 4 }}>
        <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
        <XAxis dataKey="round" tick={axisStyle} stroke="rgba(255,255,255,0.1)" />
        <YAxis
          tick={axisStyle}
          stroke="rgba(255,255,255,0.1)"
          width={62}
          tickFormatter={(v: number) => won(v)}
          domain={['auto', 'auto']}
        />
        <Tooltip content={<ChartTooltip names={names} />} />
        <Legend
          wrapperStyle={{ fontSize: 11, color: '#AAA5B2' }}
          formatter={(value: string) => names.get(value) ?? value}
        />
        {shown.map((stock) => (
          <Line
            key={stock.id}
            type="monotone"
            dataKey={stock.id}
            stroke={stockColour(stocks.findIndex((s) => s.id === stock.id))}
            strokeWidth={2}
            dot={false}
            connectNulls={false}
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

/** A tiny preview line for a list row. */
export function Sparkline({ stock, index }: { stock: SeriesStock; index: number }) {
  return (
    <div className="pointer-events-none h-10 w-24" aria-hidden>
      <StockChart stock={stock} index={index} height={40} showAxes={false} decorative />
    </div>
  );
}
