/**
 * CLASSIC MYSTERY STOCK MARKET — the shipped preset.
 *
 * Nothing here is hardcoded into the mechanics. Every value below is
 * written into the session's own configuration row when a session is
 * created, and every one of them can then be edited by the administrator.
 */

import { toBps } from './money';
import { defaultDisclosures } from './disclosure';
import { nameLookup } from './settle';
import type { SessionConfig, StockConfig, StockId } from './types';

export const CLASSIC_STOCK_NAMES = [
  'Defense Steel',
  'Airtight Construction',
  'Latter Electronics',
  'CoyoTech',
  'Open Security',
  'Seasonal Financial',
  'Alt Entertainment',
] as const;

export const S = {
  DEFENSE_STEEL: 's1',
  AIRTIGHT: 's2',
  LATTER: 's3',
  COYOTECH: 's4',
  OPEN_SECURITY: 's5',
  SEASONAL: 's6',
  ALT_ENT: 's7',
} as const;

/**
 * The scripted path for the seventh stock. It climbs, gives it all back,
 * then climbs harder — the characteristic rise-and-fall silhouette of the
 * Mystery Stock Market logo. Fully editable in the price-path editor.
 */
export const CLASSIC_SCRIPTED_PATH_24: number[] = [
  0, // index 0 unused; prices are 1-indexed by round
  10_000, 11_200, 12_600, 11_800, 13_500, 15_200,
  14_100, 12_400, 10_900, 9_300, 8_100, 9_600,
  11_500, 13_800, 16_400, 15_100, 13_200, 11_000,
  9_200, 10_700, 12_900, 15_600, 18_200, 21_000,
];

export interface PresetOptions {
  name?: string;
  rounds?: number;
  startingCash?: number;
  initialPrice?: number;
  minPrice?: number;
  roundSeconds?: number;
}

/**
 * Proportionally rescales a scripted price path to a new round count,
 * preserving its shape. Used when the administrator changes the number of
 * rounds and chooses to keep the existing trajectory.
 */
export function rescaleScriptedPath(prices: number[], newRounds: number, minPrice: number): number[] {
  const oldRounds = prices.length - 1;
  if (oldRounds < 1) throw new Error('Cannot rescale an empty price path');
  if (newRounds < 1) throw new Error('A price path needs at least one round');
  const out: number[] = [0];
  for (let r = 1; r <= newRounds; r++) {
    // Map round r of the new path onto a position in the old path.
    const position = newRounds === 1 ? 1 : 1 + ((r - 1) * (oldRounds - 1)) / (newRounds - 1);
    const lo = Math.floor(position);
    const hi = Math.min(oldRounds, lo + 1);
    const frac = position - lo;
    const a = prices[lo] ?? prices[oldRounds];
    const b = prices[hi] ?? prices[oldRounds];
    const value = Math.round(a + (b - a) * frac);
    out.push(Math.max(minPrice, value));
  }
  return out;
}

/** Builds the seven classic stocks with their seven default rules. */
function classicStocks(rounds: number, initialPrice: number, minPrice: number): StockConfig[] {
  const path =
    rounds === 24
      ? [...CLASSIC_SCRIPTED_PATH_24]
      : rescaleScriptedPath(CLASSIC_SCRIPTED_PATH_24, rounds, minPrice);

  const universe: StockId[] = [S.DEFENSE_STEEL, S.AIRTIGHT, S.LATTER, S.COYOTECH, S.OPEN_SECURITY, S.SEASONAL, S.ALT_ENT];

  const base: Omit<StockConfig, 'disclosure'>[] = [
    {
      id: S.DEFENSE_STEEL,
      name: 'Defense Steel',
      initialPrice,
      rule: {
        template: 'HOLDINGS_DELTA',
        wonPerShare: 200,
        inverted: false,
        maxHoldingsChangePerRound: null,
      },
    },
    {
      id: S.AIRTIGHT,
      name: 'Airtight Construction',
      initialPrice,
      rule: {
        template: 'CROSS_STOCK_DIRECTION',
        referenceStockId: S.DEFENSE_STEEL,
        upBps: toBps(10),
        downBps: toBps(-10),
        unchangedCountsAs: 'negative',
      },
    },
    {
      id: S.LATTER,
      name: 'Latter Electronics',
      initialPrice,
      rule: {
        template: 'HOLDINGS_SWEET_SPOT',
        lower: 10,
        upper: 30,
        insideWon: 1_500,
        outsideWon: -1_000,
      },
    },
    {
      id: S.COYOTECH,
      name: 'CoyoTech',
      initialPrice,
      rule: {
        template: 'RELATIVE_BUY_VOLUME',
        comparisonStockId: S.LATTER,
        aboveWon: 1_400,
        belowWon: -700,
        tieCountsAs: 'negative',
      },
    },
    {
      id: S.OPEN_SECURITY,
      name: 'Open Security',
      initialPrice,
      rule: {
        template: 'SECRET_DEPENDENT',
        referenceStockId: S.LATTER,
        activeBps: toBps(13),
        inactiveWon: -1_000,
      },
    },
    {
      id: S.SEASONAL,
      name: 'Seasonal Financial',
      initialPrice,
      rule: {
        template: 'MARKET_SENTIMENT',
        universe,
        risingThreshold: 4,
        fallingThreshold: 4,
        risingBps: toBps(20),
        fallingBps: toBps(-10),
      },
    },
    {
      id: S.ALT_ENT,
      name: 'Alt Entertainment',
      initialPrice,
      rule: { template: 'SCRIPTED_PATH', prices: path },
    },
  ];

  // The scripted stock starts wherever its own schedule starts.
  const scripted = base[6];
  if (scripted.rule.template === 'SCRIPTED_PATH') {
    scripted.initialPrice = scripted.rule.prices[1] ?? initialPrice;
  }

  const nameOf = (id: StockId) => base.find((s) => s.id === id)?.name ?? id;

  return base.map((s) => ({
    ...s,
    disclosure: defaultDisclosures(s.rule, { stockName: s.name, nameOf, minPrice }),
  }));
}

/** The CLASSIC MYSTERY STOCK MARKET configuration. */
export function classicPreset(options: PresetOptions = {}): SessionConfig {
  const rounds = options.rounds ?? 24;
  const minPrice = options.minPrice ?? 100;
  const initialPrice = options.initialPrice ?? 10_000;

  // Four reveals spaced across the game, at a fifth, two fifths, three
  // fifths and four fifths of its length. For the classic 24 rounds that
  // is exactly rounds 5, 10, 15 and 20; a shorter game gets the same
  // shape, and the first reveal never lands on round 1 unless the game is
  // too short to avoid it. A game with fewer than four rounds cannot hold
  // four distinct reveals, and the validator says so rather than silently
  // doubling one up.
  const spaced = [1, 2, 3, 4].map((i) => Math.ceil((rounds * i) / 5));
  for (let i = 1; i < spaced.length; i++) {
    if (spaced[i] <= spaced[i - 1]) spaced[i] = spaced[i - 1] + 1;
  }
  const disclosureRounds: [number, number, number, number] = [spaced[0], spaced[1], spaced[2], spaced[3]];

  return {
    name: options.name ?? 'Classic Mystery Stock Market',
    startingCash: options.startingCash ?? 100_000,
    minPrice,
    maxPrice: null,
    maxMovePerRoundBps: null,
    rounds,
    roundSeconds: options.roundSeconds ?? 300,
    stocks: classicStocks(rounds, initialPrice, minPrice),
    secrets: {
      enabled: true,
      tokensPerParticipant: 1,
      durationRounds: 2,
      latestActivationRound: disclosureRounds[3],
      hidePrice: true,
      hideVolume: true,
      hideHoldings: true,
      hideParticipantAssets: false,
      maskHolderAssets: false,
      tradingDuringSecret: 'enabled',
      allowSimultaneous: true,
      simultaneousExtendsDuration: false,
    },
    intel: {
      mode: 'pieces',
      startingPieces: 1,
      piecePurchaseCostWon: null,
      pieceToCashWon: 10_000,
      allowPieceToCash: true,
      cashPricePerIntelWon: 50_000,
      deadlineRound: disclosureRounds[3],
    },
    disclosure: { rounds: disclosureRounds },
    trading: { maxSharesPerOrder: null, maxSharesPerParticipantPerStock: null },
    publicInfo: {
      showAggregateHoldings: true,
      showVolumes: true,
      showLeaderboard: true,
      showParticipantAssets: true,
    },
  };
}

/** Regenerates every stock's default disclosure wording after an edit. */
export function regenerateDisclosures(config: SessionConfig): SessionConfig {
  const nameOf = nameLookup(config);
  return {
    ...config,
    stocks: config.stocks.map((s) => ({
      ...s,
      disclosure: defaultDisclosures(s.rule, {
        stockName: s.name,
        nameOf,
        minPrice: config.minPrice,
      }),
    })),
  };
}
