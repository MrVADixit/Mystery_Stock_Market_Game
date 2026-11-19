/**
 * Round settlement.
 *
 * Every stock is evaluated against ONE frozen snapshot of the completed
 * round. Because no rule can see another rule's output, the seven prices
 * are computed simultaneously and the result cannot depend on the order
 * the stocks happen to be stored in. That is what makes a settlement
 * replayable: the same snapshot always yields the same prices.
 */

import { clampPrice, pctDelta } from './money';
import { templateOf } from './templates';
import type { RoundSnapshot, RuleEvaluation, SessionConfig, SettlementResult, StockId } from './types';

export class SettlementError extends Error {}

/** Builds the id -> display name lookup used in explanations. */
export function nameLookup(config: SessionConfig): (id: StockId) => string {
  const map = new Map(config.stocks.map((s) => [s.id, s.name]));
  return (id) => map.get(id) ?? `(unknown stock ${id})`;
}

/**
 * Settles one completed round and returns the prices for the next round.
 * Pure: it mutates nothing and performs no IO.
 */
export function settleRound(config: SessionConfig, snapshot: RoundSnapshot): SettlementResult {
  const nameOf = nameLookup(config);
  const evaluations: RuleEvaluation[] = [];
  const prices: Record<StockId, number> = {};

  for (const stock of config.stocks) {
    const openingPrice = snapshot.prices[stock.id];
    if (openingPrice == null) {
      throw new SettlementError(`Snapshot is missing a price for ${stock.name}`);
    }

    const def = templateOf(stock.rule);
    const outcome = def.evaluate(stock.rule, { stock, config, snapshot, nameOf });

    // Resolve the rule's request into a raw target price.
    let rawDelta: number;
    let rawPrice: number;
    if (outcome.absolutePrice != null) {
      rawPrice = outcome.absolutePrice;
      rawDelta = rawPrice - openingPrice;
    } else {
      rawDelta = outcome.delta ?? 0;
      rawPrice = openingPrice + rawDelta;
    }

    // Optional per-round movement cap. Disabled by default so the classic
    // preset behaves exactly as described.
    let movementCapped = false;
    let cappedDelta = rawDelta;
    if (config.maxMovePerRoundBps != null) {
      const limit = Math.abs(pctDelta(openingPrice, config.maxMovePerRoundBps));
      if (Math.abs(cappedDelta) > limit) {
        cappedDelta = cappedDelta < 0 ? -limit : limit;
        movementCapped = true;
      }
    }

    // The price floor is always enforced, in every configuration.
    const beforeClamp = openingPrice + cappedDelta;
    const finalPrice = clampPrice(beforeClamp, config.minPrice, config.maxPrice);
    const flooredAtMin = beforeClamp < config.minPrice;
    const cappedAtMax = config.maxPrice != null && beforeClamp > config.maxPrice;

    let explanation = outcome.explanation;
    if (movementCapped) {
      explanation += ` The per-round movement cap trimmed the move to ${cappedDelta >= 0 ? '+' : ''}${cappedDelta.toLocaleString('en-US')} won.`;
    }
    if (flooredAtMin) {
      explanation += ` That would have taken the price to ${beforeClamp.toLocaleString('en-US')} won, so the ${config.minPrice.toLocaleString('en-US')} won floor applies.`;
    }
    if (cappedAtMax) {
      explanation += ` That would have taken the price above the ${config.maxPrice!.toLocaleString('en-US')} won ceiling, so the ceiling applies.`;
    }

    evaluations.push({
      stockId: stock.id,
      stockName: stock.name,
      template: stock.rule.template,
      openingPrice,
      branch: outcome.branch,
      rawDelta,
      rawPrice,
      appliedDelta: finalPrice - openingPrice,
      finalPrice,
      flooredAtMin,
      cappedAtMax,
      movementCapped,
      explanation,
      inputs: outcome.inputs,
    });
    prices[stock.id] = finalPrice;
  }

  return {
    round: snapshot.round,
    nextRound: snapshot.round + 1,
    evaluations,
    prices,
  };
}

/** Convenience: an all-zero activity snapshot for a round where nobody traded. */
export function emptySnapshot(
  config: SessionConfig,
  round: number,
  prices: Record<StockId, number>,
  previousPrices: Record<StockId, number>,
  holdings: Record<StockId, number> = {},
  previousHoldings: Record<StockId, number> = {},
): RoundSnapshot {
  const zero: Record<StockId, number> = {};
  const noSecret: Record<StockId, boolean> = {};
  for (const s of config.stocks) {
    zero[s.id] = 0;
    noSecret[s.id] = false;
  }
  return {
    round,
    prices,
    previousPrices,
    holdings: { ...zero, ...holdings },
    previousHoldings: { ...zero, ...previousHoldings },
    grossBuys: { ...zero },
    grossSells: { ...zero },
    secretActiveNextRound: { ...noSecret },
  };
}

/** Starting prices for round 1, taken from each stock's configured initial price. */
export function initialPrices(config: SessionConfig): Record<StockId, number> {
  const out: Record<StockId, number> = {};
  for (const s of config.stocks) {
    out[s.id] = clampPrice(s.initialPrice, config.minPrice, config.maxPrice);
  }
  return out;
}
