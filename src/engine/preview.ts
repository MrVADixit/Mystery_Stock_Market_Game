/**
 * Single-round what-if preview.
 *
 * Powers the "set holdings to 20", "activate a secret", "choose four
 * rising stocks" controls on the administrator's simulation screen, and
 * the per-rule Preview button in the rule editor. It never touches a live
 * session — the caller passes a configuration and a hypothetical market
 * state and gets back the settlement that state would produce.
 */

import { initialPrices, settleRound } from './settle';
import type { RoundSnapshot, SessionConfig, SettlementResult, StockId } from './types';

export interface PreviewInput {
  /** Which round is closing. Affects the scripted path. Default 1. */
  round?: number;
  /** Prices during the closing round. Defaults to the initial prices. */
  prices?: Partial<Record<StockId, number>>;
  /** Prices during the round before. Defaults to the same as `prices`. */
  previousPrices?: Partial<Record<StockId, number>>;
  /** Aggregate holdings at the close. Default 0 for every stock. */
  holdings?: Partial<Record<StockId, number>>;
  /** Aggregate holdings one round earlier. Default 0. */
  previousHoldings?: Partial<Record<StockId, number>>;
  grossBuys?: Partial<Record<StockId, number>>;
  grossSells?: Partial<Record<StockId, number>>;
  /** Which stocks a secret covers during the coming round. */
  secretActive?: Partial<Record<StockId, boolean>>;
  /**
   * Convenience for the sentiment rule: force exactly this many stocks to
   * count as having risen, and this many as having fallen, by adjusting
   * the previous prices. Applied after `previousPrices`.
   */
  forceRisingCount?: number;
  forceFallingCount?: number;
}

export interface PreviewResult extends SettlementResult {
  snapshot: RoundSnapshot;
}

/** Builds a complete snapshot from a partial description and settles it. */
export function previewSettlement(config: SessionConfig, input: PreviewInput = {}): PreviewResult {
  const ids = config.stocks.map((s) => s.id);
  const defaults = initialPrices(config);

  const prices: Record<StockId, number> = {};
  const previousPrices: Record<StockId, number> = {};
  const holdings: Record<StockId, number> = {};
  const previousHoldings: Record<StockId, number> = {};
  const grossBuys: Record<StockId, number> = {};
  const grossSells: Record<StockId, number> = {};
  const secretActiveNextRound: Record<StockId, boolean> = {};

  for (const id of ids) {
    prices[id] = input.prices?.[id] ?? defaults[id];
    previousPrices[id] = input.previousPrices?.[id] ?? prices[id];
    holdings[id] = input.holdings?.[id] ?? 0;
    previousHoldings[id] = input.previousHoldings?.[id] ?? 0;
    grossBuys[id] = input.grossBuys?.[id] ?? 0;
    grossSells[id] = input.grossSells?.[id] ?? 0;
    secretActiveNextRound[id] = input.secretActive?.[id] ?? false;
  }

  // Force a given number of risers / fallers by moving the PREVIOUS price,
  // which leaves the current prices (the base for every percentage) intact.
  const rising = input.forceRisingCount ?? 0;
  const falling = input.forceFallingCount ?? 0;
  if (rising > 0 || falling > 0) {
    let i = 0;
    for (; i < Math.min(rising, ids.length); i++) {
      previousPrices[ids[i]] = Math.max(1, prices[ids[i]] - 500);
    }
    for (let j = 0; j < falling && i + j < ids.length; j++) {
      previousPrices[ids[i + j]] = prices[ids[i + j]] + 500;
    }
  }

  const snapshot: RoundSnapshot = {
    round: input.round ?? 1,
    prices,
    previousPrices,
    holdings,
    previousHoldings,
    grossBuys,
    grossSells,
    secretActiveNextRound,
  };

  return { ...settleRound(config, snapshot), snapshot };
}
