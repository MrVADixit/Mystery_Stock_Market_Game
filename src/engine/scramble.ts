/**
 * Seeded scrambling.
 *
 * A participant who has played before should face the same deduction
 * problem as somebody who has not. Different company names across the
 * template library is a start, but a determined returning player could
 * still remember that "the steel company is the holdings one". Scrambling
 * removes that entirely: it re-assigns which company runs which mechanic,
 * rewires the cross-references, and varies every number within bands that
 * keep the game sound.
 *
 * It is deterministic from a seed, so a session can be reproduced exactly —
 * the seed is stored on the game and shown to the administrator.
 *
 * Every band here is chosen to stay inside the configuration validator's
 * safe range, so a scrambled template is still READY with no warnings.
 */

import { defaultDisclosures } from './disclosure';
import { nameLookup } from './settle';
import type { RuleParams, SessionConfig, StockConfig, StockId } from './types';

export interface ScrambleOptions {
  seed: number;
  /** Move mechanics between companies. */
  permuteMechanics?: boolean;
  /** Repoint every cross-stock, comparison and watched-stock reference. */
  rewireReferences?: boolean;
  /** Vary the rates, bands, percentages and thresholds. */
  jitterParameters?: boolean;
  /** Vary the opening prices. */
  jitterPrices?: boolean;
  /** Shuffle the order the companies are listed in. */
  shuffleOrder?: boolean;
}

/** A seed suitable for a new session. */
export function randomSeed(): number {
  return Math.floor(Math.random() * 2_147_483_647) + 1;
}

/* ------------------------------------------------------------------ */
/* A small deterministic generator                                     */
/* ------------------------------------------------------------------ */

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rng = () => number;

/** Inclusive at both ends. */
function intBetween(rng: Rng, lo: number, hi: number): number {
  if (hi <= lo) return lo;
  return lo + Math.floor(rng() * (hi - lo + 1));
}

function roundTo(value: number, step: number): number {
  return Math.max(step, Math.round(value / step) * step);
}

function pick<T>(rng: Rng, options: readonly T[]): T {
  return options[Math.floor(rng() * options.length)] ?? options[0];
}

function shuffle<T>(rng: Rng, items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Parameter bands                                                     */
/* ------------------------------------------------------------------ */

/**
 * The steepest holdings rate that will not let one participant, acting
 * alone, drive the stock to the floor in a single round. Staying under this
 * is what keeps a scrambled game free of volatility warnings.
 */
function safeHoldingsRate(price: number, minPrice: number, startingCash: number): number {
  const onePersonCanBuy = Math.max(1, Math.floor(startingCash / Math.max(1, price)));
  const headroom = Math.max(1, price - minPrice);
  return Math.max(60, Math.min(600, Math.floor(headroom / (onePersonCanBuy + 1))));
}

/** Threshold pairs where the two branches cannot both fire. */
function sentimentThresholds(rng: Rng, universeSize: number): { rising: number; falling: number } {
  const valid: { rising: number; falling: number }[] = [];
  for (let rising = 2; rising <= universeSize; rising++) {
    for (let falling = 2; falling <= universeSize; falling++) {
      // Both branches can fire at once exactly when the thresholds fit
      // inside the universe together, so require the sum to exceed it.
      if (rising + falling > universeSize) valid.push({ rising, falling });
    }
  }
  if (valid.length === 0) return { rising: universeSize, falling: universeSize };
  return pick(rng, valid);
}

function jitterRule(
  rule: RuleParams,
  rng: Rng,
  context: { price: number; minPrice: number; startingCash: number; universeSize: number },
): RuleParams {
  switch (rule.template) {
    case 'HOLDINGS_DELTA': {
      const max = safeHoldingsRate(context.price, context.minPrice, context.startingCash);
      return {
        ...rule,
        wonPerShare: roundTo(intBetween(rng, Math.min(120, max), max), 10),
        // Roughly a third of scrambles invert the relationship, so buying
        // pushes the price UP. Nothing breaks a remembered instinct faster.
        inverted: rng() < 0.33,
        maxHoldingsChangePerRound: rng() < 0.2 ? intBetween(rng, 8, 24) : null,
      };
    }

    case 'CROSS_STOCK_DIRECTION':
      return {
        ...rule,
        upBps: roundTo(intBetween(rng, 600, 2000), 50),
        downBps: -roundTo(intBetween(rng, 500, 1800), 50),
        unchangedCountsAs: pick(rng, ['negative', 'negative', 'negative', 'positive'] as const),
      };

    case 'HOLDINGS_SWEET_SPOT': {
      const lower = intBetween(rng, 5, 28);
      return {
        ...rule,
        lower,
        upper: lower + intBetween(rng, 8, 30),
        // The inside branch is always positive, so the rule always has an
        // upside worth chasing.
        insideWon: roundTo(intBetween(rng, 900, 2400), 100),
        outsideWon: -roundTo(intBetween(rng, 500, 1600), 100),
      };
    }

    case 'RELATIVE_BUY_VOLUME':
      return {
        ...rule,
        aboveWon: roundTo(intBetween(rng, 800, 2000), 100),
        belowWon: -roundTo(intBetween(rng, 400, 1300), 100),
        tieCountsAs: pick(rng, ['negative', 'negative', 'negative', 'positive'] as const),
      };

    case 'SECRET_DEPENDENT':
      return {
        ...rule,
        activeBps: roundTo(intBetween(rng, 800, 2200), 100),
        inactiveWon: -roundTo(intBetween(rng, 500, 1600), 100),
      };

    case 'MARKET_SENTIMENT': {
      const { rising, falling } = sentimentThresholds(rng, context.universeSize);
      return {
        ...rule,
        risingThreshold: rising,
        fallingThreshold: falling,
        risingBps: roundTo(intBetween(rng, 1200, 3000), 100),
        fallingBps: -roundTo(intBetween(rng, 700, 2000), 100),
      };
    }

    case 'SCRIPTED_PATH': {
      // One overall scale plus a little per-round noise: the path keeps its
      // character but stops being recognisable round by round.
      const scale = 0.85 + rng() * 0.3;
      return {
        ...rule,
        prices: rule.prices.map((price, index) => {
          if (index === 0) return 0;
          const noise = 0.94 + rng() * 0.12;
          return Math.max(context.minPrice, roundTo(price * scale * noise, 100));
        }),
      };
    }

    case 'UNCHANGED':
      return rule;
  }
}

/** Points every reference at a freshly chosen company. */
function rewire(rule: RuleParams, rng: Rng, selfId: StockId, allIds: StockId[]): RuleParams {
  const others = allIds.filter((id) => id !== selfId);
  if (others.length === 0) return rule;

  switch (rule.template) {
    case 'CROSS_STOCK_DIRECTION':
      return { ...rule, referenceStockId: pick(rng, others) };
    case 'RELATIVE_BUY_VOLUME':
      return { ...rule, comparisonStockId: pick(rng, others) };
    case 'SECRET_DEPENDENT':
      return { ...rule, referenceStockId: pick(rng, others) };
    case 'MARKET_SENTIMENT':
      return { ...rule, universe: [...allIds] };
    default:
      return rule;
  }
}

/* ------------------------------------------------------------------ */
/* The scrambler                                                       */
/* ------------------------------------------------------------------ */

/**
 * Returns a new configuration. The input is never modified.
 *
 * Company names, the number of companies, the round count and every session
 * setting are preserved — only the puzzle changes.
 */
export function scrambleConfig(config: SessionConfig, options: ScrambleOptions): SessionConfig {
  const {
    seed,
    permuteMechanics = true,
    rewireReferences = true,
    jitterParameters = true,
    jitterPrices = true,
    shuffleOrder = true,
  } = options;

  const rng = mulberry32(seed);
  const ids = config.stocks.map((s) => s.id);

  // 1. Opening prices. Done first, because the safe holdings rate depends
  //    on the price the rule will be attached to.
  let stocks: StockConfig[] = config.stocks.map((stock) => {
    if (!jitterPrices) return { ...stock };
    const low = Math.max(config.minPrice, Math.round(stock.initialPrice * 0.8));
    const high = Math.max(low, Math.round(stock.initialPrice * 1.25));
    return { ...stock, initialPrice: roundTo(intBetween(rng, low, high), 100) };
  });

  // 2. Which company runs which mechanic.
  const rules = stocks.map((s) => structuredClone(s.rule));
  const assigned = permuteMechanics ? shuffle(rng, rules) : rules;
  stocks = stocks.map((stock, index) => ({ ...stock, rule: assigned[index] }));

  // 3. The numbers.
  if (jitterParameters) {
    stocks = stocks.map((stock) => ({
      ...stock,
      rule: jitterRule(stock.rule, rng, {
        price: stock.initialPrice,
        minPrice: config.minPrice,
        startingCash: config.startingCash,
        universeSize: ids.length,
      }),
    }));
  }

  // 4. The wiring between companies.
  if (rewireReferences) {
    stocks = stocks.map((stock) => ({ ...stock, rule: rewire(stock.rule, rng, stock.id, ids) }));
  } else {
    // Even without rewiring, a reference may now point at a company that
    // has taken over the same mechanic, or at itself. Repair only that.
    stocks = stocks.map((stock) => {
      const rule = stock.rule;
      const selfReference =
        (rule.template === 'CROSS_STOCK_DIRECTION' && rule.referenceStockId === stock.id) ||
        (rule.template === 'RELATIVE_BUY_VOLUME' && rule.comparisonStockId === stock.id);
      return selfReference ? { ...stock, rule: rewire(rule, rng, stock.id, ids) } : stock;
    });
  }

  // 5. A scripted company opens wherever its own schedule opens.
  stocks = stocks.map((stock) =>
    stock.rule.template === 'SCRIPTED_PATH'
      ? { ...stock, initialPrice: Math.max(config.minPrice, stock.rule.prices[1] ?? stock.initialPrice) }
      : stock,
  );

  // 6. The order they are listed in.
  if (shuffleOrder) stocks = shuffle(rng, stocks);

  // 7. Fresh disclosure wording for the rules as they now stand.
  const scrambled: SessionConfig = { ...config, stocks };
  const nameOf = nameLookup(scrambled);
  scrambled.stocks = stocks.map((stock) => ({
    ...stock,
    disclosure: defaultDisclosures(stock.rule, {
      stockName: stock.name,
      nameOf,
      minPrice: config.minPrice,
    }),
  }));

  return scrambled;
}

/**
 * A short, human-readable description of what a seed produced, for the
 * administrator's records.
 */
export function describeScramble(config: SessionConfig, seed: number): string {
  const pairs = config.stocks.map((s) => `${s.name} → ${s.rule.template}`);
  return `seed ${seed}: ${pairs.join(', ')}`;
}
