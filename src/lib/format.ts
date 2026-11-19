/** Display formatting shared by every screen. */

export function won(n: number | null | undefined): string {
  if (n == null) return '—';
  const sign = n < 0 ? '-' : '';
  return `${sign}${Math.abs(Math.round(n)).toLocaleString('en-US')}`;
}

export function wonUnit(n: number | null | undefined): string {
  return n == null ? '—' : `${won(n)} WON`;
}

export function pct(n: number | null | undefined, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(digits)}%`;
}

export function signed(n: number | null | undefined): string {
  if (n == null) return '—';
  return `${n > 0 ? '+' : ''}${won(n)}`;
}

/** mm:ss, never negative. */
export function clock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export function roundLabel(round: number, total: number): string {
  return `ROUND ${String(round).padStart(2, '0')} / ${total}`;
}

/** Up/down/flat colour class for a change. */
export function moveClass(n: number | null | undefined): string {
  if (n == null || n === 0) return 'text-muted';
  return n > 0 ? 'text-up' : 'text-down';
}

export function arrow(n: number | null | undefined): string {
  if (n == null || n === 0) return '–';
  return n > 0 ? '▲' : '▼';
}

/** A stable colour per stock index, for charts. */
export const STOCK_COLOURS = [
  '#A77BE0',
  '#5EC8D8',
  '#F2B45E',
  '#7FD88F',
  '#F0799B',
  '#8E9BF0',
  '#D8CE5E',
  '#C98FD8',
  '#6FD8C0',
  '#F09E79',
];

export function stockColour(index: number): string {
  return STOCK_COLOURS[index % STOCK_COLOURS.length];
}
