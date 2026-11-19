/**
 * Configuration validation and soft risk warnings.
 *
 * Errors block a game from starting. Warnings never do — high volatility is
 * part of Mystery Stock Market, so the engine explains what a setting will
 * do and lets the administrator decide, rather than quietly rejecting an
 * interesting rule.
 */

import { fromBps } from './money';
import type { SessionConfig, StockConfig, StockId } from './types';

export type IssueLevel = 'error' | 'warning';

export interface ConfigIssue {
  level: IssueLevel;
  /** Stable code, used by the readiness report and the tests. */
  code: string;
  message: string;
  /** Stock the issue belongs to, so the report can deep-link to its card. */
  stockId?: StockId;
  /** Which part of the wizard to send the administrator to. */
  section: 'general' | 'stocks' | 'rules' | 'secrets' | 'intel' | 'disclosure' | 'trading';
  /** True when the administrator must acknowledge before starting. */
  requiresAcknowledgement?: boolean;
}

const won = (n: number) => `${Math.abs(n).toLocaleString('en-US')} won`;

/** Validates a whole session configuration. */
export function validateConfig(config: SessionConfig): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  const err = (code: string, message: string, section: ConfigIssue['section'], stockId?: StockId) =>
    issues.push({ level: 'error', code, message, section, stockId });
  const warn = (
    code: string,
    message: string,
    section: ConfigIssue['section'],
    stockId?: StockId,
    requiresAcknowledgement = false,
  ) => issues.push({ level: 'warning', code, message, section, stockId, requiresAcknowledgement });

  /* ---------------- general ---------------- */

  if (!config.name.trim()) err('NAME_EMPTY', 'The game needs a name.', 'general');
  if (!Number.isSafeInteger(config.rounds) || config.rounds < 1)
    err('ROUNDS_INVALID', 'The game must have at least one round.', 'general');
  if (config.rounds > 200)
    warn('ROUNDS_LARGE', `${config.rounds} rounds is a very long game.`, 'general');
  if (!Number.isSafeInteger(config.roundSeconds) || config.roundSeconds < 5)
    err('ROUND_SECONDS_INVALID', 'Each round must last at least 5 seconds.', 'general');
  if (!Number.isSafeInteger(config.startingCash) || config.startingCash < 0)
    err('CASH_INVALID', 'Starting cash must be a whole number of won, zero or more.', 'general');
  if (!Number.isSafeInteger(config.minPrice) || config.minPrice < 1)
    err('FLOOR_INVALID', 'The minimum price must be at least 1 won.', 'general');
  if (config.maxPrice != null && config.maxPrice <= config.minPrice)
    err('CEILING_INVALID', 'The maximum price must be above the minimum price.', 'general');
  if (config.stocks.length === 0) err('NO_STOCKS', 'The game needs at least one stock.', 'stocks');

  const ids = new Set<StockId>();
  for (const s of config.stocks) {
    if (ids.has(s.id)) err('STOCK_ID_DUPLICATE', `Two stocks share the id "${s.id}".`, 'stocks', s.id);
    ids.add(s.id);
    if (!s.name.trim()) err('STOCK_NAME_EMPTY', `Stock "${s.id}" needs a name.`, 'stocks', s.id);
    if (!Number.isSafeInteger(s.initialPrice) || s.initialPrice < config.minPrice)
      err(
        'INITIAL_PRICE_INVALID',
        `${s.name || s.id} starts at ${s.initialPrice} won, below the ${won(config.minPrice)} floor.`,
        'stocks',
        s.id,
      );
    if (s.disclosure.segments.some((t) => !t || !t.trim()))
      err('DISCLOSURE_EMPTY', `${s.name} has an empty rule reveal.`, 'disclosure', s.id);
  }

  const known = (id: StockId) => ids.has(id);
  const nameOf = (id: StockId) => config.stocks.find((s) => s.id === id)?.name ?? id;

  /* ---------------- per-rule ---------------- */

  for (const stock of config.stocks) {
    validateRule(stock, config, known, nameOf, err, warn);
  }

  /* ---------------- disclosure ---------------- */

  const dr = config.disclosure.rounds;
  if (dr.length !== 4) err('DISCLOSURE_COUNT', 'There must be exactly four disclosure rounds.', 'disclosure');
  for (let i = 0; i < dr.length; i++) {
    if (!Number.isSafeInteger(dr[i]) || dr[i] < 1 || dr[i] > config.rounds)
      err(
        'DISCLOSURE_RANGE',
        `Disclosure ${i + 1} is set to round ${dr[i]}, outside rounds 1–${config.rounds}.`,
        'disclosure',
      );
    if (i > 0 && dr[i] <= dr[i - 1])
      err(
        'DISCLOSURE_ORDER',
        `Disclosure ${i + 1} (round ${dr[i]}) must come after disclosure ${i} (round ${dr[i - 1]}).`,
        'disclosure',
      );
  }

  /* ---------------- secrets ---------------- */

  const sec = config.secrets;
  if (sec.enabled) {
    if (!Number.isSafeInteger(sec.tokensPerParticipant) || sec.tokensPerParticipant < 0)
      err('SECRET_TOKENS_INVALID', 'Secret tokens per participant must be zero or more.', 'secrets');
    if (!Number.isSafeInteger(sec.durationRounds) || sec.durationRounds < 1)
      err('SECRET_DURATION_INVALID', 'A secret must last at least one round.', 'secrets');
    if (sec.latestActivationRound < 1 || sec.latestActivationRound > config.rounds)
      err(
        'SECRET_DEADLINE_RANGE',
        `The secret deadline (round ${sec.latestActivationRound}) is outside rounds 1–${config.rounds}.`,
        'secrets',
      );
    if (sec.tokensPerParticipant === 0)
      warn('SECRET_NO_TOKENS', 'Secrets are enabled but nobody has a token to use.', 'secrets');
  } else {
    const dependents = config.stocks.filter((s) => s.rule.template === 'SECRET_DEPENDENT');
    for (const s of dependents)
      warn(
        'SECRET_RULE_WITHOUT_SECRETS',
        `${s.name} depends on secrets, but secrets are disabled — it will always take its negative branch.`,
        'rules',
        s.id,
      );
  }

  /* ---------------- intelligence ---------------- */

  const intel = config.intel;
  if (intel.mode !== 'disabled') {
    if (intel.deadlineRound < 1 || intel.deadlineRound > config.rounds)
      err(
        'INTEL_DEADLINE_RANGE',
        `The intelligence deadline (round ${intel.deadlineRound}) is outside rounds 1–${config.rounds}.`,
        'intel',
      );
    if (intel.mode === 'pieces') {
      if (!Number.isSafeInteger(intel.startingPieces) || intel.startingPieces < 0)
        err('PIECES_INVALID', 'Starting Pieces must be zero or more.', 'intel');
      if (intel.allowPieceToCash && intel.pieceToCashWon < 0)
        err('PIECE_RATE_INVALID', 'The Piece-to-cash rate cannot be negative.', 'intel');
      if (intel.startingPieces === 0 && intel.piecePurchaseCostWon == null)
        warn(
          'INTEL_UNREACHABLE',
          'Intelligence uses Pieces, but participants start with none and cannot buy any.',
          'intel',
        );
    }
    if (intel.mode === 'cash' && intel.cashPricePerIntelWon <= 0)
      err('INTEL_PRICE_INVALID', 'Cash-priced intelligence needs a price above zero.', 'intel');
    if (intel.mode === 'cash' && intel.cashPricePerIntelWon > config.startingCash)
      warn(
        'INTEL_UNAFFORDABLE',
        `Intelligence costs ${won(intel.cashPricePerIntelWon)} but participants only start with ${won(config.startingCash)}.`,
        'intel',
      );
  }

  /* ---------------- trading ---------------- */

  const t = config.trading;
  if (t.maxSharesPerOrder != null && t.maxSharesPerOrder < 1)
    err('ORDER_CAP_INVALID', 'The per-order share cap must be at least 1.', 'trading');
  if (t.maxSharesPerParticipantPerStock != null && t.maxSharesPerParticipantPerStock < 1)
    err('POSITION_CAP_INVALID', 'The per-participant position cap must be at least 1.', 'trading');

  return issues;
}

type ErrFn = (code: string, message: string, section: ConfigIssue['section'], stockId?: StockId) => void;
type WarnFn = (
  code: string,
  message: string,
  section: ConfigIssue['section'],
  stockId?: StockId,
  requiresAcknowledgement?: boolean,
) => void;

function validateRule(
  stock: StockConfig,
  config: SessionConfig,
  known: (id: StockId) => boolean,
  nameOf: (id: StockId) => string,
  err: ErrFn,
  warn: WarnFn,
): void {
  const p = stock.rule;
  const id = stock.id;
  const price = stock.initialPrice;
  /** Fraction of the opening price a fixed won movement represents. */
  const share = (amount: number) => (price > 0 ? Math.abs(amount) / price : Infinity);

  switch (p.template) {
    case 'HOLDINGS_DELTA': {
      if (!Number.isSafeInteger(p.wonPerShare) || p.wonPerShare < 0)
        err('RULE1_RATE_INVALID', `${stock.name}: price movement per share must be zero or more.`, 'rules', id);
      if (p.maxHoldingsChangePerRound != null && p.maxHoldingsChangePerRound < 1)
        err('RULE1_CAP_INVALID', `${stock.name}: the holdings-change cap must be at least 1.`, 'rules', id);
      if (p.wonPerShare > 0) {
        const sharesToFloor = Math.ceil((price - config.minPrice) / p.wonPerShare);
        // Judge the risk against what the market can plausibly do in one
        // round. The most a single participant can add is their whole
        // starting cash divided by the price, so if one person acting alone
        // can floor the stock, that is worth pointing out.
        const onePersonCanBuy = Math.max(1, Math.floor(config.startingCash / Math.max(1, price)));
        const capped = p.maxHoldingsChangePerRound;
        const reachableInOneRound = capped != null ? Math.min(capped, onePersonCanBuy) : onePersonCanBuy;
        if (sharesToFloor <= reachableInOneRound)
          warn(
            'RULE1_FLOOR_RISK',
            `${stock.name}: a ${sharesToFloor}-share increase in total holdings takes this stock to its ${won(config.minPrice)} floor in a single round, ` +
              `and one participant alone can buy up to ${onePersonCanBuy} share${onePersonCanBuy === 1 ? '' : 's'}.`,
            'rules',
            id,
            sharesToFloor <= Math.ceil(reachableInOneRound / 2),
          );
        if (p.wonPerShare >= price / 2)
          warn(
            'RULE1_RATE_EXTREME',
            `${stock.name}: ${won(p.wonPerShare)} per share is very large next to the ${won(price)} opening price — two shares of movement swings it by more than its whole value.`,
            'rules',
            id,
            true,
          );
      } else {
        warn('RULE1_RATE_ZERO', `${stock.name}: at 0 won per share this stock can never move.`, 'rules', id);
      }
      break;
    }

    case 'CROSS_STOCK_DIRECTION': {
      if (!known(p.referenceStockId))
        err('RULE2_REF_UNKNOWN', `${stock.name} references a stock that does not exist.`, 'rules', id);
      if (p.referenceStockId === id)
        err('RULE2_SELF_REF', `${stock.name} cannot take its direction from itself.`, 'rules', id);
      for (const [label, bps] of [['rise', p.upBps], ['fall', p.downBps]] as const) {
        if (Math.abs(bps) >= 10_000)
          warn(
            'RULE2_PCT_EXTREME',
            `${stock.name}: a ${fromBps(bps)}% ${label} move is at least the stock's entire value in one round.`,
            'rules',
            id,
            true,
          );
      }
      if (p.upBps > 0 && p.downBps < 0 && Math.abs(p.upBps) >= 3000 && Math.abs(p.downBps) >= 3000)
        warn(
          'RULE2_WHIPSAW',
          `${stock.name}: ±${fromBps(p.upBps)}%/${fromBps(p.downBps)}% each round can create very rapid price reversals.`,
          'rules',
          id,
        );
      break;
    }

    case 'HOLDINGS_SWEET_SPOT': {
      if (!Number.isSafeInteger(p.lower) || !Number.isSafeInteger(p.upper))
        err('RULE3_BOUNDS_INVALID', `${stock.name}: the holdings range must use whole shares.`, 'rules', id);
      if (p.lower > p.upper)
        err(
          'RULE3_BOUNDS_ORDER',
          `${stock.name}: the lower bound (${p.lower}) is above the upper bound (${p.upper}).`,
          'rules',
          id,
        );
      if (p.lower < 0) err('RULE3_BOUNDS_NEGATIVE', `${stock.name}: holdings cannot be negative.`, 'rules', id);
      for (const [label, amount] of [['inside', p.insideWon], ['outside', p.outsideWon]] as const) {
        if (share(amount) >= 0.5)
          warn(
            'RULE3_AMOUNT_LARGE',
            `${stock.name}: the ${label}-range adjustment of ${won(amount)} is ${Math.round(share(amount) * 100)}% of the ${won(price)} opening price.`,
            'rules',
            id,
            share(amount) >= 1,
          );
      }
      if (p.insideWon <= 0 && p.outsideWon <= 0)
        warn(
          'RULE3_NO_UPSIDE',
          `${stock.name}: neither branch can raise the price, so it only ever falls.`,
          'rules',
          id,
        );
      break;
    }

    case 'RELATIVE_BUY_VOLUME': {
      if (!known(p.comparisonStockId))
        err('RULE4_CMP_UNKNOWN', `${stock.name} compares against a stock that does not exist.`, 'rules', id);
      if (p.comparisonStockId === id)
        err('RULE4_SELF_CMP', `${stock.name} cannot compare its buying volume against itself.`, 'rules', id);
      for (const [label, amount] of [['winning', p.aboveWon], ['losing', p.belowWon]] as const) {
        if (share(amount) >= 0.5)
          warn(
            'RULE4_AMOUNT_LARGE',
            `${stock.name}: the ${label} adjustment of ${won(amount)} is ${Math.round(share(amount) * 100)}% of the ${won(price)} opening price.`,
            'rules',
            id,
            share(amount) >= 1,
          );
      }
      break;
    }

    case 'SECRET_DEPENDENT': {
      if (!known(p.referenceStockId))
        err('RULE5_REF_UNKNOWN', `${stock.name} watches a stock that does not exist.`, 'rules', id);
      if (Math.abs(p.activeBps) >= 10_000)
        warn(
          'RULE5_PCT_EXTREME',
          `${stock.name}: ${fromBps(p.activeBps)}% while a secret is active is at least the stock's whole value.`,
          'rules',
          id,
          true,
        );
      if (share(p.inactiveWon) >= 0.5)
        warn(
          'RULE5_AMOUNT_LARGE',
          `${stock.name}: the no-secret adjustment of ${won(p.inactiveWon)} is ${Math.round(share(p.inactiveWon) * 100)}% of the opening price, so this stock will collapse if nobody uses a secret.`,
          'rules',
          id,
          share(p.inactiveWon) >= 1,
        );
      break;
    }

    case 'MARKET_SENTIMENT': {
      const n = p.universe.length;
      if (n === 0) err('RULE6_UNIVERSE_EMPTY', `${stock.name} counts no stocks at all.`, 'rules', id);
      for (const u of p.universe)
        if (!known(u))
          err('RULE6_UNIVERSE_UNKNOWN', `${stock.name} counts a stock that does not exist.`, 'rules', id);
      if (new Set(p.universe).size !== n)
        err('RULE6_UNIVERSE_DUPLICATE', `${stock.name} counts the same stock more than once.`, 'rules', id);
      if (p.risingThreshold < 1 || p.fallingThreshold < 1)
        err('RULE6_THRESHOLD_INVALID', `${stock.name}: both thresholds must be at least 1.`, 'rules', id);
      // Both branches can fire at once exactly when the thresholds fit
      // inside the universe together. For 7 stocks, 4 and 4 cannot.
      if (p.risingThreshold + p.fallingThreshold <= n)
        err(
          'RULE6_THRESHOLDS_OVERLAP',
          `${stock.name}: ${p.risingThreshold} rising and ${p.fallingThreshold} falling can both happen at once in a ${n}-stock market. ` +
            `Raise a threshold so they add up to more than ${n}.`,
          'rules',
          id,
        );
      if (p.risingThreshold > n)
        warn(
          'RULE6_RISE_UNREACHABLE',
          `${stock.name}: the positive branch needs ${p.risingThreshold} rising stocks but only ${n} are counted, so it can never fire.`,
          'rules',
          id,
        );
      if (p.fallingThreshold > n)
        warn(
          'RULE6_FALL_UNREACHABLE',
          `${stock.name}: the negative branch needs ${p.fallingThreshold} falling stocks but only ${n} are counted, so it can never fire.`,
          'rules',
          id,
        );
      for (const [label, bps] of [['rally', p.risingBps], ['sell-off', p.fallingBps]] as const)
        if (Math.abs(bps) >= 10_000)
          warn(
            'RULE6_PCT_EXTREME',
            `${stock.name}: a ${fromBps(bps)}% move on a broad ${label} is at least the stock's whole value.`,
            'rules',
            id,
            true,
          );
      break;
    }

    case 'SCRIPTED_PATH': {
      const needed = config.rounds;
      if (p.prices.length - 1 < needed) {
        err(
          'RULE7_MISSING_PRICES',
          `${stock.name} has a scripted price for ${Math.max(0, p.prices.length - 1)} rounds but the game runs ${needed}. ` +
            `Every round needs exactly one price.`,
          'rules',
          id,
        );
      } else if (p.prices.length - 1 > needed) {
        warn(
          'RULE7_EXTRA_PRICES',
          `${stock.name} has scripted prices for ${p.prices.length - 1} rounds; only the first ${needed} will be used.`,
          'rules',
          id,
        );
      }
      for (let r = 1; r < p.prices.length; r++) {
        const v = p.prices[r];
        if (!Number.isSafeInteger(v))
          err('RULE7_PRICE_INVALID', `${stock.name}: round ${r} has no whole-won price.`, 'rules', id);
        else if (v < config.minPrice)
          warn(
            'RULE7_BELOW_FLOOR',
            `${stock.name}: the scripted round ${r} price of ${won(v)} is below the ${won(config.minPrice)} floor and will be raised to the floor.`,
            'rules',
            id,
          );
      }
      if (p.prices[1] != null && p.prices[1] !== stock.initialPrice)
        warn(
          'RULE7_START_MISMATCH',
          `${stock.name} is listed as starting at ${won(stock.initialPrice)} but its schedule sets round 1 to ${won(p.prices[1])}. The schedule wins.`,
          'rules',
          id,
        );
      break;
    }

    case 'UNCHANGED':
      break;
  }
}

/** True when nothing blocks the game from starting. */
export function hasBlockingErrors(issues: ConfigIssue[]): boolean {
  return issues.some((i) => i.level === 'error');
}

export function issuesRequiringAcknowledgement(issues: ConfigIssue[]): ConfigIssue[] {
  return issues.filter((i) => i.level === 'warning' && i.requiresAcknowledgement);
}
