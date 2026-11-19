/**
 * Exact integer money arithmetic for the market engine.
 *
 * Every monetary amount in Mystery Stock Market is a whole number of won,
 * held as a JavaScript safe integer. No floating point value is ever
 * persisted or used as an authoritative figure. Percentages are expressed
 * in basis points (1 bp = 0.01%), also as integers, so that "10%" is the
 * exact integer 1000 rather than the inexact binary double 0.1.
 */

/** One hundred percent, in basis points. */
export const BPS = 10_000;

/** Largest magnitude we allow any monetary figure to take. */
export const MAX_WON = Number.MAX_SAFE_INTEGER;

export class MoneyError extends Error {}

/** Throws unless `n` is a safe integer. */
export function assertInt(n: number, label: string): number {
  if (!Number.isSafeInteger(n)) {
    throw new MoneyError(`${label} must be a safe integer, received ${n}`);
  }
  return n;
}

/**
 * Converts a human percentage to basis points.
 * `toBps(10)` -> 1000, `toBps(13)` -> 1300, `toBps(-10)` -> -1000.
 * Accepts up to two decimal places; anything finer is rejected rather
 * than silently rounded, so a configuration can never mean something
 * other than what the administrator typed.
 */
export function toBps(percent: number): number {
  const scaled = Math.round(percent * 100);
  if (Math.abs(scaled - percent * 100) > 1e-9) {
    throw new MoneyError(`Percentage ${percent} has more precision than 0.01%`);
  }
  return scaled;
}

/** Converts basis points back to a human percentage (may be fractional). */
export function fromBps(bps: number): number {
  return bps / 100;
}

/**
 * The exact won movement produced by applying `bps` basis points to `base`.
 *
 * Rounding is half away from zero, applied once, to the final figure:
 *   pctDelta(10_000, 1300)  ->  1300
 *   pctDelta(10_001, 1300)  ->  1300   (1300.13 -> 1300)
 *   pctDelta(10_050, -1000) -> -1005
 *   pctDelta(5, 1000)       ->  1      (0.5 rounds away from zero)
 *
 * Deterministic for all inputs, which is what the settlement replay
 * guarantee in docs/MARKET_ENGINE.md depends on.
 */
export function pctDelta(base: number, bps: number): number {
  assertInt(base, 'base price');
  assertInt(bps, 'basis points');
  const numerator = base * bps;
  if (!Number.isSafeInteger(numerator)) {
    throw new MoneyError(`Percentage calculation overflows: ${base} x ${bps}bp`);
  }
  const quotient = Math.trunc(numerator / BPS);
  const remainder = numerator - quotient * BPS;
  if (Math.abs(remainder) * 2 >= BPS) {
    return quotient + (numerator < 0 ? -1 : 1);
  }
  return quotient;
}

/** Clamps a price to the configured floor (and to the ceiling when set). */
export function clampPrice(price: number, minPrice: number, maxPrice?: number | null): number {
  let p = price;
  if (p < minPrice) p = minPrice;
  if (maxPrice != null && p > maxPrice) p = maxPrice;
  return p;
}

/** Formats won for display: 112450 -> "112,450". */
export function formatWon(n: number): string {
  const sign = n < 0 ? '-' : '';
  return sign + Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
}

/** Formats a signed percentage from a ratio of integers, e.g. +5.2%. */
export function formatPctChange(from: number, to: number): string {
  if (from === 0) return '—';
  const pct = ((to - from) / from) * 100;
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(1)}%`;
}
