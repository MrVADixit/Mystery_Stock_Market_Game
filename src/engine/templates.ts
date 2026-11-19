/**
 * The seven rule templates.
 *
 * Each template is a closed, pre-tested mathematical structure. The
 * administrator may change its numbers and its stock references; the
 * structure itself is fixed. There is no expression language, no nested
 * condition builder and no user-written formula anywhere in V1.
 */

import { BPS, fromBps, pctDelta } from './money';
import type {
  RuleParams,
  RuleTemplateId,
  RoundSnapshot,
  SessionConfig,
  StockConfig,
  StockId,
} from './types';

/** Everything a template is allowed to look at. */
export interface RuleContext {
  stock: StockConfig;
  config: SessionConfig;
  snapshot: RoundSnapshot;
  /** Name lookup for readable explanations. */
  nameOf: (id: StockId) => string;
}

/**
 * A template either asks for a movement relative to the opening price
 * (`delta`) or declares an authoritative price outright (`absolutePrice`,
 * used only by the scripted path).
 */
export interface RuleOutcome {
  branch: string;
  delta?: number;
  absolutePrice?: number;
  explanation: string;
  inputs: Record<string, number | string | boolean>;
}

export interface TemplateDefinition {
  id: RuleTemplateId;
  /** Short title shown on the rule card. */
  title: string;
  /** One-line description of the mechanic. */
  summary: string;
  /** Plain-English formula with the configured numbers filled in. */
  describe: (params: RuleParams, ctx: DescribeContext) => string;
  evaluate: (params: RuleParams, ctx: RuleContext) => RuleOutcome;
}

export interface DescribeContext {
  stockName: string;
  nameOf: (id: StockId) => string;
  minPrice: number;
}

const won = (n: number) => `${n < 0 ? '-' : ''}${Math.abs(n).toLocaleString('en-US')} won`;
const signedWon = (n: number) => `${n >= 0 ? '+' : '-'}${Math.abs(n).toLocaleString('en-US')} won`;
const signedPct = (bps: number) => `${bps >= 0 ? '+' : ''}${fromBps(bps)}%`;

function wrongTemplate(expected: string, got: string): never {
  throw new Error(`Template mismatch: expected ${expected} parameters, received ${got}`);
}

/* ================================================================== */
/* RULE 1 — HOLDINGS-BASED PRICE MOVEMENT      (default: Defense Steel) */
/* ================================================================== */

export const holdingsDelta: TemplateDefinition = {
  id: 'HOLDINGS_DELTA',
  title: 'Holdings-based price movement',
  summary:
    'The price moves against the change in total market-wide holdings: more shares held pushes the price down, fewer pushes it up.',
  describe(params, ctx) {
    if (params.template !== 'HOLDINGS_DELTA') wrongTemplate('HOLDINGS_DELTA', params.template);
    const up = params.inverted ? 'rises' : 'falls';
    const down = params.inverted ? 'falls' : 'rises';
    const cap = params.maxHoldingsChangePerRound
      ? ` At most ${params.maxHoldingsChangePerRound} shares of change are counted in one round.`
      : '';
    return (
      `For every extra share of ${ctx.stockName} held across the whole market compared with the previous round, ` +
      `the price ${up} by ${won(params.wonPerShare)}. For every share less, the price ${down} by the same amount. ` +
      `No change in holdings means no price movement.${cap}`
    );
  },
  evaluate(params, ctx) {
    if (params.template !== 'HOLDINGS_DELTA') wrongTemplate('HOLDINGS_DELTA', params.template);
    const id = ctx.stock.id;
    const now = ctx.snapshot.holdings[id] ?? 0;
    const before = ctx.snapshot.previousHoldings[id] ?? 0;
    const rawChange = now - before;

    // The optional cap limits the magnitude of the change considered,
    // never its direction.
    let change = rawChange;
    const cap = params.maxHoldingsChangePerRound;
    if (cap != null && Math.abs(change) > cap) {
      change = change < 0 ? -cap : cap;
    }

    // Direction: by default holdings up means price down.
    const direction = params.inverted ? 1 : -1;
    const delta = direction * change * params.wonPerShare;

    const branch =
      rawChange > 0 ? 'holdings-increased' : rawChange < 0 ? 'holdings-decreased' : 'holdings-unchanged';

    const capNote =
      cap != null && Math.abs(rawChange) > cap ? ` (change capped at ${cap} shares)` : '';

    const explanation =
      rawChange === 0
        ? `Total holdings were unchanged at ${now} shares, so the price does not move.`
        : `Total holdings went from ${before} to ${now} shares, a change of ${rawChange > 0 ? '+' : ''}${rawChange}${capNote}. ` +
          `${change < 0 ? Math.abs(change) : change} x ${won(params.wonPerShare)} applied ${delta >= 0 ? 'upward' : 'downward'} = ${signedWon(delta)}.`;

    return {
      branch,
      delta,
      explanation,
      inputs: {
        holdingsNow: now,
        holdingsPrevious: before,
        holdingsChange: rawChange,
        holdingsChangeCounted: change,
        wonPerShare: params.wonPerShare,
      },
    };
  },
};

/* ================================================================== */
/* RULE 2 — CROSS-STOCK PRICE DIRECTION  (default: Airtight Construction) */
/* ================================================================== */

export const crossStockDirection: TemplateDefinition = {
  id: 'CROSS_STOCK_DIRECTION',
  title: 'Cross-stock price direction',
  summary:
    "Follows whether another stock's price rose during the previous completed round.",
  describe(params, ctx) {
    if (params.template !== 'CROSS_STOCK_DIRECTION')
      wrongTemplate('CROSS_STOCK_DIRECTION', params.template);
    const ref = ctx.nameOf(params.referenceStockId);
    const tie = params.unchangedCountsAs === 'negative' ? 'unchanged' : '';
    return (
      `If ${ref}'s price rose during the previous completed round, ${ctx.stockName} moves ${signedPct(params.upBps)}. ` +
      `Otherwise${tie ? ' (including when it is unchanged)' : ''} it moves ${signedPct(params.downBps)}. ` +
      `The percentage is taken from ${ctx.stockName}'s opening price for the round.`
    );
  },
  evaluate(params, ctx) {
    if (params.template !== 'CROSS_STOCK_DIRECTION')
      wrongTemplate('CROSS_STOCK_DIRECTION', params.template);
    const ref = params.referenceStockId;
    const refNow = ctx.snapshot.prices[ref];
    const refBefore = ctx.snapshot.previousPrices[ref];
    if (refNow == null || refBefore == null) {
      throw new Error(`Cross-stock rule on ${ctx.stock.name} references unknown stock "${ref}"`);
    }
    const refChange = refNow - refBefore;
    const rose = refChange > 0;
    const unchanged = refChange === 0;
    const takesPositive = rose || (unchanged && params.unchangedCountsAs === 'positive');

    const bps = takesPositive ? params.upBps : params.downBps;
    const base = ctx.snapshot.prices[ctx.stock.id];
    const delta = pctDelta(base, bps);

    const refName = ctx.nameOf(ref);
    const moved = unchanged ? 'was unchanged at' : rose ? 'rose to' : 'fell to';
    const explanation =
      `${refName} ${moved} ${refNow.toLocaleString('en-US')} won (from ${refBefore.toLocaleString('en-US')}), ` +
      `so the ${takesPositive ? 'positive' : 'negative'} branch applies: ` +
      `${signedPct(bps)} of the ${base.toLocaleString('en-US')} won opening price = ${signedWon(delta)}.`;

    return {
      branch: takesPositive ? 'reference-rose' : unchanged ? 'reference-unchanged' : 'reference-fell',
      delta,
      explanation,
      inputs: {
        referenceStock: refName,
        referencePriceNow: refNow,
        referencePricePrevious: refBefore,
        referenceChange: refChange,
        appliedBps: bps,
        basePrice: base,
      },
    };
  },
};

/* ================================================================== */
/* RULE 3 — HOLDINGS SWEET SPOT            (default: Latter Electronics) */
/* ================================================================== */

export const holdingsSweetSpot: TemplateDefinition = {
  id: 'HOLDINGS_SWEET_SPOT',
  title: 'Holdings sweet spot',
  summary:
    'Rewards the market for keeping total holdings inside a band and punishes it for straying outside.',
  describe(params, ctx) {
    if (params.template !== 'HOLDINGS_SWEET_SPOT')
      wrongTemplate('HOLDINGS_SWEET_SPOT', params.template);
    return (
      `If total holdings of ${ctx.stockName} across all participants are between ${params.lower} and ${params.upper} shares inclusive, ` +
      `the price moves ${signedWon(params.insideWon)}. Otherwise it moves ${signedWon(params.outsideWon)}.`
    );
  },
  evaluate(params, ctx) {
    if (params.template !== 'HOLDINGS_SWEET_SPOT')
      wrongTemplate('HOLDINGS_SWEET_SPOT', params.template);
    const held = ctx.snapshot.holdings[ctx.stock.id] ?? 0;
    const inside = held >= params.lower && held <= params.upper;
    const delta = inside ? params.insideWon : params.outsideWon;
    const explanation =
      `Total holdings were ${held} shares, which is ${inside ? 'inside' : 'outside'} the inclusive range ` +
      `${params.lower}–${params.upper}, so ${signedWon(delta)} is applied.`;
    return {
      branch: inside ? 'inside-range' : 'outside-range',
      delta,
      explanation,
      inputs: { totalHoldings: held, lower: params.lower, upper: params.upper, inside },
    };
  },
};

/* ================================================================== */
/* RULE 4 — RELATIVE BUYING VOLUME                 (default: CoyoTech) */
/* ================================================================== */

export const relativeBuyVolume: TemplateDefinition = {
  id: 'RELATIVE_BUY_VOLUME',
  title: 'Relative buying volume',
  summary:
    'Compares this stock’s gross purchases against another stock’s gross purchases during the completed round.',
  describe(params, ctx) {
    if (params.template !== 'RELATIVE_BUY_VOLUME')
      wrongTemplate('RELATIVE_BUY_VOLUME', params.template);
    const cmp = ctx.nameOf(params.comparisonStockId);
    const tie = params.tieCountsAs === 'negative' ? 'A tie counts as the lower case.' : 'A tie counts as the higher case.';
    return (
      `If more ${ctx.stockName} shares were bought during the completed round than ${cmp} shares, ` +
      `${ctx.stockName} moves ${signedWon(params.aboveWon)}. Otherwise it moves ${signedWon(params.belowWon)}. ` +
      `Only gross purchases count — sales are not subtracted. ${tie}`
    );
  },
  evaluate(params, ctx) {
    if (params.template !== 'RELATIVE_BUY_VOLUME')
      wrongTemplate('RELATIVE_BUY_VOLUME', params.template);
    const cmpId = params.comparisonStockId;
    if (!(cmpId in ctx.snapshot.grossBuys)) {
      throw new Error(`Relative volume rule on ${ctx.stock.name} references unknown stock "${cmpId}"`);
    }
    const mine = ctx.snapshot.grossBuys[ctx.stock.id] ?? 0;
    const theirs = ctx.snapshot.grossBuys[cmpId] ?? 0;
    const tie = mine === theirs;
    const above = mine > theirs || (tie && params.tieCountsAs === 'positive');
    const delta = above ? params.aboveWon : params.belowWon;
    const cmpName = ctx.nameOf(cmpId);
    const explanation =
      `${ctx.stock.name} gross purchases ${mine} vs ${cmpName} gross purchases ${theirs}` +
      `${tie ? ' (a tie)' : ''}, so ${signedWon(delta)} is applied.`;
    return {
      branch: tie ? 'tie' : above ? 'bought-more' : 'bought-less',
      delta,
      explanation,
      inputs: {
        targetGrossBuys: mine,
        comparisonStock: cmpName,
        comparisonGrossBuys: theirs,
        tie,
      },
    };
  },
};

/* ================================================================== */
/* RULE 5 — SECRET-DEPENDENT MOVEMENT         (default: Open Security) */
/* ================================================================== */

export const secretDependent: TemplateDefinition = {
  id: 'SECRET_DEPENDENT',
  title: 'Secret-dependent movement',
  summary: 'Reacts to whether a secret covers another stock during the coming round.',
  describe(params, ctx) {
    if (params.template !== 'SECRET_DEPENDENT') wrongTemplate('SECRET_DEPENDENT', params.template);
    const ref = ctx.nameOf(params.referenceStockId);
    return (
      `If a secret is active on ${ref} during the upcoming round, ${ctx.stockName} moves ${signedPct(params.activeBps)}. ` +
      `Otherwise it moves ${signedWon(params.inactiveWon)}.`
    );
  },
  evaluate(params, ctx) {
    if (params.template !== 'SECRET_DEPENDENT') wrongTemplate('SECRET_DEPENDENT', params.template);
    const ref = params.referenceStockId;
    if (!(ref in ctx.snapshot.secretActiveNextRound)) {
      throw new Error(`Secret rule on ${ctx.stock.name} references unknown stock "${ref}"`);
    }
    const active = ctx.snapshot.secretActiveNextRound[ref] === true;
    const base = ctx.snapshot.prices[ctx.stock.id];
    const delta = active ? pctDelta(base, params.activeBps) : params.inactiveWon;
    const refName = ctx.nameOf(ref);
    const explanation = active
      ? `A secret covers ${refName} during round ${ctx.snapshot.round + 1}, so ${signedPct(params.activeBps)} of the ` +
        `${base.toLocaleString('en-US')} won opening price = ${signedWon(delta)} is applied.`
      : `No secret covers ${refName} during round ${ctx.snapshot.round + 1}, so ${signedWon(params.inactiveWon)} is applied.`;
    return {
      branch: active ? 'secret-active' : 'secret-inactive',
      delta,
      explanation,
      inputs: {
        referenceStock: refName,
        secretActiveNextRound: active,
        basePrice: base,
      },
    };
  },
};

/* ================================================================== */
/* RULE 6 — MARKET-WIDE SENTIMENT          (default: Seasonal Financial) */
/* ================================================================== */

export const marketSentiment: TemplateDefinition = {
  id: 'MARKET_SENTIMENT',
  title: 'Market-wide sentiment',
  summary: 'Reacts to how many stocks across the market rose or fell in the previous completed round.',
  describe(params, ctx) {
    if (params.template !== 'MARKET_SENTIMENT') wrongTemplate('MARKET_SENTIMENT', params.template);
    return (
      `If ${params.risingThreshold} or more of the ${params.universe.length} counted stocks rose during the previous completed round, ` +
      `${ctx.stockName} moves ${signedPct(params.risingBps)}. If ${params.fallingThreshold} or more fell, it moves ${signedPct(params.fallingBps)}. ` +
      `Otherwise its price is unchanged.`
    );
  },
  evaluate(params, ctx) {
    if (params.template !== 'MARKET_SENTIMENT') wrongTemplate('MARKET_SENTIMENT', params.template);
    let rising = 0;
    let falling = 0;
    for (const id of params.universe) {
      const now = ctx.snapshot.prices[id];
      const before = ctx.snapshot.previousPrices[id];
      if (now == null || before == null) {
        throw new Error(`Market sentiment rule on ${ctx.stock.name} references unknown stock "${id}"`);
      }
      if (now > before) rising++;
      else if (now < before) falling++;
    }
    const risingHit = rising >= params.risingThreshold;
    const fallingHit = falling >= params.fallingThreshold;

    // The validator rejects configurations where both branches can fire at
    // once, so this is defence in depth rather than a silent tie-break.
    if (risingHit && fallingHit) {
      throw new Error(
        `Market sentiment rule on ${ctx.stock.name} matched both branches (${rising} rising, ${falling} falling). ` +
          `Thresholds ${params.risingThreshold}/${params.fallingThreshold} overlap for a ${params.universe.length}-stock universe.`,
      );
    }

    const base = ctx.snapshot.prices[ctx.stock.id];
    let delta = 0;
    let branch = 'mixed-market';
    if (risingHit) {
      delta = pctDelta(base, params.risingBps);
      branch = 'broad-rally';
    } else if (fallingHit) {
      delta = pctDelta(base, params.fallingBps);
      branch = 'broad-selloff';
    }

    const explanation =
      `${rising} of ${params.universe.length} counted stocks rose and ${falling} fell. ` +
      (risingHit
        ? `That reaches the rising threshold of ${params.risingThreshold}, so ${signedPct(params.risingBps)} of ${base.toLocaleString('en-US')} won = ${signedWon(delta)}.`
        : fallingHit
          ? `That reaches the falling threshold of ${params.fallingThreshold}, so ${signedPct(params.fallingBps)} of ${base.toLocaleString('en-US')} won = ${signedWon(delta)}.`
          : `Neither threshold (${params.risingThreshold} rising / ${params.fallingThreshold} falling) was reached, so the price is unchanged.`);

    return {
      branch,
      delta,
      explanation,
      inputs: {
        risingCount: rising,
        fallingCount: falling,
        universeSize: params.universe.length,
        risingThreshold: params.risingThreshold,
        fallingThreshold: params.fallingThreshold,
      },
    };
  },
};

/* ================================================================== */
/* RULE 7 — FIXED SCRIPTED PRICE PATH       (default: Alt Entertainment) */
/* ================================================================== */

export const scriptedPath: TemplateDefinition = {
  id: 'SCRIPTED_PATH',
  title: 'Fixed scripted price path',
  summary:
    'Follows a price schedule written in advance. Trading cannot influence it in any way.',
  describe(params, ctx) {
    if (params.template !== 'SCRIPTED_PATH') wrongTemplate('SCRIPTED_PATH', params.template);
    const n = Math.max(0, params.prices.length - 1);
    return (
      `${ctx.stockName} follows a price path fixed in advance for all ${n} rounds. ` +
      `Buying, selling, holdings, other stock prices and secrets have no effect on it. ` +
      `The configured price is still subject to the ${ctx.minPrice.toLocaleString('en-US')} won floor.`
    );
  },
  evaluate(params, ctx) {
    if (params.template !== 'SCRIPTED_PATH') wrongTemplate('SCRIPTED_PATH', params.template);
    const target = ctx.snapshot.round + 1;
    const scheduled = params.prices[target];
    if (scheduled == null) {
      throw new Error(
        `Scripted path for ${ctx.stock.name} has no price for round ${target}. ` +
          `Every configured round needs exactly one authoritative price.`,
      );
    }
    const current = ctx.snapshot.prices[ctx.stock.id];
    const explanation =
      `The schedule sets round ${target} to ${scheduled.toLocaleString('en-US')} won ` +
      `(round ${ctx.snapshot.round} was ${current.toLocaleString('en-US')} won). Trading activity is ignored.`;
    return {
      branch: 'scripted',
      absolutePrice: scheduled,
      explanation,
      inputs: { scheduledRound: target, scheduledPrice: scheduled },
    };
  },
};

/* ================================================================== */
/* Unchanged price                                                     */
/* ================================================================== */

export const unchanged: TemplateDefinition = {
  id: 'UNCHANGED',
  title: 'Unchanged price',
  summary: 'The price never moves. Useful as a control stock or a placeholder.',
  describe(_params, ctx) {
    return `${ctx.stockName} keeps the same price for the whole game.`;
  },
  evaluate(_params, _ctx) {
    return {
      branch: 'unchanged',
      delta: 0,
      explanation: 'This stock is configured never to move.',
      inputs: {},
    };
  },
};

export const TEMPLATES: Record<RuleTemplateId, TemplateDefinition> = {
  HOLDINGS_DELTA: holdingsDelta,
  CROSS_STOCK_DIRECTION: crossStockDirection,
  HOLDINGS_SWEET_SPOT: holdingsSweetSpot,
  RELATIVE_BUY_VOLUME: relativeBuyVolume,
  SECRET_DEPENDENT: secretDependent,
  MARKET_SENTIMENT: marketSentiment,
  SCRIPTED_PATH: scriptedPath,
  UNCHANGED: unchanged,
};

/** The seven headline templates, in specification order, for the rule editor. */
export const TEMPLATE_ORDER: RuleTemplateId[] = [
  'HOLDINGS_DELTA',
  'CROSS_STOCK_DIRECTION',
  'HOLDINGS_SWEET_SPOT',
  'RELATIVE_BUY_VOLUME',
  'SECRET_DEPENDENT',
  'MARKET_SENTIMENT',
  'SCRIPTED_PATH',
  'UNCHANGED',
];

export function templateOf(params: RuleParams): TemplateDefinition {
  const def = TEMPLATES[params.template];
  if (!def) throw new Error(`Unknown rule template "${params.template}"`);
  return def;
}

/** Does this template depend on trading activity at all? */
export function dependsOnTrading(template: RuleTemplateId): boolean {
  return (
    template === 'HOLDINGS_DELTA' ||
    template === 'HOLDINGS_SWEET_SPOT' ||
    template === 'RELATIVE_BUY_VOLUME'
  );
}

export { BPS };
