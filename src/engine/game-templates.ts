/**
 * The game template library.
 *
 * A *rule template* (templates.ts) is one of the seven pricing mechanics.
 * A *game template* — this file — is a whole ready-to-play session: a set of
 * companies, a mapping of mechanics onto them, the numbers, the scripted
 * price path and the session settings.
 *
 * Twelve are built in. Every one of them uses a different set of company
 * names, a different permutation of mechanics across those companies, and
 * different numbers, so a participant who played one of them learns nothing
 * transferable about the next. The scrambler (scramble.ts) goes further and
 * re-randomises both within a single template, so even the same template run
 * twice is a different puzzle.
 */

import { toBps } from './money';
import { defaultDisclosures } from './disclosure';
import { classicPreset, rescaleScriptedPath } from './preset';
import type { PresetOptions } from './preset';
import type { RuleParams, SessionConfig, StockConfig, StockId, TieBranch } from './types';

/* ------------------------------------------------------------------ */
/* A compact way to describe a template                                */
/* ------------------------------------------------------------------ */

/**
 * Mechanics referencing other companies do so by **index** into the stock
 * list, which keeps a template readable and makes it obvious at a glance
 * how the references are wired.
 */
type MechanicSpec =
  | { kind: 'holdings'; wonPerShare: number; inverted?: boolean; cap?: number | null }
  | { kind: 'cross'; ref: number; upPct: number; downPct: number; unchanged?: TieBranch }
  | { kind: 'sweet'; lower: number; upper: number; inside: number; outside: number }
  | { kind: 'volume'; cmp: number; above: number; below: number; tie?: TieBranch }
  | { kind: 'secret'; ref: number; activePct: number; inactiveWon: number }
  | { kind: 'sentiment'; rising: number; falling: number; risePct: number; fallPct: number }
  /** Control points, interpolated across however many rounds are configured. */
  | { kind: 'scripted'; control: number[] }
  | { kind: 'flat' };

interface StockSpec {
  name: string;
  initialPrice: number;
  mechanic: MechanicSpec;
}

interface TemplateSpec {
  id: string;
  name: string;
  theme: string;
  description: string;
  /** What makes this one play differently. Shown to the administrator. */
  designerNote: string;
  rounds: number;
  roundSeconds: number;
  startingCash: number;
  minPrice?: number;
  stocks: StockSpec[];
}

export interface GameTemplateMeta {
  id: string;
  name: string;
  theme: string;
  description: string;
  designerNote: string;
  stockCount: number;
  defaultRounds: number;
  defaultRoundSeconds: number;
  startingCash: number;
  source: 'built-in' | 'custom';
  /** The company names, so the administrator can see what they are choosing. */
  stockNames: string[];
}

export interface GameTemplate extends GameTemplateMeta {
  build: (options?: PresetOptions) => SessionConfig;
}

/* ------------------------------------------------------------------ */
/* Builder                                                             */
/* ------------------------------------------------------------------ */

function mechanicToRule(
  mechanic: MechanicSpec,
  ids: StockId[],
  rounds: number,
  minPrice: number,
): RuleParams {
  const at = (index: number) => ids[((index % ids.length) + ids.length) % ids.length];

  switch (mechanic.kind) {
    case 'holdings':
      return {
        template: 'HOLDINGS_DELTA',
        wonPerShare: mechanic.wonPerShare,
        inverted: mechanic.inverted ?? false,
        maxHoldingsChangePerRound: mechanic.cap ?? null,
      };
    case 'cross':
      return {
        template: 'CROSS_STOCK_DIRECTION',
        referenceStockId: at(mechanic.ref),
        upBps: toBps(mechanic.upPct),
        downBps: toBps(mechanic.downPct),
        unchangedCountsAs: mechanic.unchanged ?? 'negative',
      };
    case 'sweet':
      return {
        template: 'HOLDINGS_SWEET_SPOT',
        lower: mechanic.lower,
        upper: mechanic.upper,
        insideWon: mechanic.inside,
        outsideWon: mechanic.outside,
      };
    case 'volume':
      return {
        template: 'RELATIVE_BUY_VOLUME',
        comparisonStockId: at(mechanic.cmp),
        aboveWon: mechanic.above,
        belowWon: mechanic.below,
        tieCountsAs: mechanic.tie ?? 'negative',
      };
    case 'secret':
      return {
        template: 'SECRET_DEPENDENT',
        referenceStockId: at(mechanic.ref),
        activeBps: toBps(mechanic.activePct),
        inactiveWon: mechanic.inactiveWon,
      };
    case 'sentiment':
      return {
        template: 'MARKET_SENTIMENT',
        universe: [...ids],
        risingThreshold: mechanic.rising,
        fallingThreshold: mechanic.falling,
        risingBps: toBps(mechanic.risePct),
        fallingBps: toBps(mechanic.fallPct),
      };
    case 'scripted':
      return {
        template: 'SCRIPTED_PATH',
        prices: rescaleScriptedPath([0, ...mechanic.control], rounds, minPrice),
      };
    case 'flat':
      return { template: 'UNCHANGED' };
  }
}

function buildFromSpec(spec: TemplateSpec, options: PresetOptions = {}): SessionConfig {
  const rounds = options.rounds ?? spec.rounds;
  const minPrice = options.minPrice ?? spec.minPrice ?? 100;
  const ids: StockId[] = spec.stocks.map((_, i) => `s${i + 1}`);

  const stocks: Omit<StockConfig, 'disclosure'>[] = spec.stocks.map((stock, index) => {
    const rule = mechanicToRule(stock.mechanic, ids, rounds, minPrice);
    // A scripted stock opens wherever its own schedule opens, whatever is
    // written beside it.
    const initialPrice =
      rule.template === 'SCRIPTED_PATH'
        ? (rule.prices[1] ?? stock.initialPrice)
        : (options.initialPrice ?? stock.initialPrice);
    return { id: ids[index], name: stock.name, initialPrice: Math.max(minPrice, initialPrice), rule };
  });

  // Four reveals spaced across the game, exactly as the classic preset does.
  const spaced = [1, 2, 3, 4].map((i) => Math.ceil((rounds * i) / 5));
  for (let i = 1; i < spaced.length; i++) {
    if (spaced[i] <= spaced[i - 1]) spaced[i] = spaced[i - 1] + 1;
  }
  const disclosureRounds: [number, number, number, number] = [spaced[0], spaced[1], spaced[2], spaced[3]];

  const nameOf = (id: StockId) => stocks.find((s) => s.id === id)?.name ?? id;

  return {
    name: options.name ?? spec.name,
    startingCash: options.startingCash ?? spec.startingCash,
    minPrice,
    maxPrice: null,
    maxMovePerRoundBps: null,
    rounds,
    roundSeconds: options.roundSeconds ?? spec.roundSeconds,
    stocks: stocks.map((s) => ({
      ...s,
      disclosure: defaultDisclosures(s.rule, { stockName: s.name, nameOf, minPrice }),
    })),
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
      pieceToCashWon: Math.round(spec.startingCash / 10),
      allowPieceToCash: true,
      cashPricePerIntelWon: Math.round(spec.startingCash / 2),
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

/* ------------------------------------------------------------------ */
/* The twelve built-in templates                                       */
/* ------------------------------------------------------------------ */

const SPECS: TemplateSpec[] = [
  /* --- 2 ----------------------------------------------------------- */
  {
    id: 'orbital-freight',
    name: 'Orbital Freight',
    theme: 'Low-orbit logistics',
    description:
      'Seven companies hauling cargo above the atmosphere. The scripted stock sits in the first slot, where most players will not think to look.',
    designerNote:
      'The sentiment rule is wired to a company that almost nobody trades, so the whole-market signal stays clean. Expect the sweet spot to be found early and the secret rule late.',
    rounds: 24,
    roundSeconds: 300,
    startingCash: 100_000,
    stocks: [
      { name: 'Helio Launch', initialPrice: 10_000, mechanic: { kind: 'scripted', control: [10_000, 12_400, 9_800, 8_200, 11_600, 15_400, 12_800, 17_200, 14_200] } },
      { name: 'Vacuum Dynamics', initialPrice: 9_000, mechanic: { kind: 'sweet', lower: 12, upper: 34, inside: 1_300, outside: -900 } },
      { name: 'Tether & Co', initialPrice: 11_000, mechanic: { kind: 'holdings', wonPerShare: 250, inverted: false, cap: null } },
      { name: 'Kuiper Salvage', initialPrice: 10_500, mechanic: { kind: 'sentiment', rising: 4, falling: 4, risePct: 18, fallPct: -12 } },
      { name: 'Dark Side Mining', initialPrice: 8_500, mechanic: { kind: 'cross', ref: 2, upPct: 12, downPct: -9 } },
      { name: 'Orbit Insurance', initialPrice: 12_000, mechanic: { kind: 'volume', cmp: 1, above: 1_200, below: -800 } },
      { name: 'Stellar Broadcast', initialPrice: 9_500, mechanic: { kind: 'secret', ref: 1, activePct: 15, inactiveWon: -900 } },
    ],
  },

  /* --- 3 ----------------------------------------------------------- */
  {
    id: 'deep-harbour',
    name: 'Deep Harbour',
    theme: 'Ports and shipping',
    description:
      'A working harbour. Two mechanics point at the same company, which makes one stock unusually influential and rewards anyone who notices.',
    designerNote:
      'Tidewater Grain is both a cross-stock reference and a buying-volume comparison, so moving it moves two other stocks at once. The strongest play in this template is indirect.',
    rounds: 24,
    roundSeconds: 300,
    startingCash: 100_000,
    stocks: [
      { name: 'Mariner Hull', initialPrice: 10_000, mechanic: { kind: 'volume', cmp: 4, above: 1_600, below: -600 } },
      { name: 'Saltline Freight', initialPrice: 11_500, mechanic: { kind: 'secret', ref: 3, activePct: 11, inactiveWon: -1_100 } },
      { name: 'Harbourmaster Group', initialPrice: 9_000, mechanic: { kind: 'sentiment', rising: 4, falling: 5, risePct: 22, fallPct: -9 } },
      { name: 'Tidewater Grain', initialPrice: 10_000, mechanic: { kind: 'holdings', wonPerShare: 300, inverted: false, cap: null } },
      { name: 'Kelp Biotech', initialPrice: 8_000, mechanic: { kind: 'cross', ref: 3, upPct: 14, downPct: -14 } },
      { name: 'Lighthouse Mutual', initialPrice: 13_000, mechanic: { kind: 'scripted', control: [11_000, 10_200, 9_400, 8_600, 9_900, 12_300, 14_800, 13_100, 16_000] } },
      { name: 'Anchor Arcade', initialPrice: 9_500, mechanic: { kind: 'sweet', lower: 8, upper: 24, inside: 1_800, outside: -1_200 } },
    ],
  },

  /* --- 4 ----------------------------------------------------------- */
  {
    id: 'greenfield',
    name: 'Greenfield',
    theme: 'Agriculture and food',
    description:
      'A gentler market with a wide sweet spot and a forgiving holdings rate. A good first game for a class that has not played before.',
    designerNote:
      'Every movement here is smaller than the classic preset, so prices drift rather than lurch and nobody is wiped out in round three. The scripted stock has an obvious seasonal shape, which is usually the first rule anyone works out.',
    rounds: 20,
    roundSeconds: 240,
    startingCash: 120_000,
    stocks: [
      { name: 'Rootstock Farms', initialPrice: 10_000, mechanic: { kind: 'sweet', lower: 15, upper: 45, inside: 1_100, outside: -700 } },
      { name: 'Pollinator Labs', initialPrice: 12_500, mechanic: { kind: 'sentiment', rising: 4, falling: 4, risePct: 15, fallPct: -8 } },
      { name: 'Silo Logistics', initialPrice: 9_000, mechanic: { kind: 'cross', ref: 5, upPct: 8, downPct: -6 } },
      { name: 'Terra Nitrate', initialPrice: 10_000, mechanic: { kind: 'scripted', control: [9_500, 11_800, 13_900, 12_100, 10_400, 8_900, 10_800, 13_600, 16_900] } },
      { name: 'Orchard Networks', initialPrice: 11_000, mechanic: { kind: 'holdings', wonPerShare: 180, inverted: false, cap: null } },
      { name: 'Harvest Assurance', initialPrice: 8_500, mechanic: { kind: 'volume', cmp: 0, above: 900, below: -500 } },
      { name: 'Copper Kettle Brewing', initialPrice: 9_500, mechanic: { kind: 'secret', ref: 0, activePct: 9, inactiveWon: -600 } },
    ],
  },

  /* --- 5 ----------------------------------------------------------- */
  {
    id: 'neon-district',
    name: 'Neon District',
    theme: 'Nightlife and retail',
    description:
      'Fast and loud. Large percentage swings, a narrow sweet spot and a holdings rule steep enough to reach the floor if a group commits to it.',
    designerNote:
      'The most volatile of the built-in templates. Run it with short rounds. Expect at least one stock to hit the floor and expect that to be somebody doing it on purpose.',
    rounds: 24,
    roundSeconds: 180,
    startingCash: 100_000,
    stocks: [
      { name: 'Midnight Transit', initialPrice: 12_000, mechanic: { kind: 'cross', ref: 3, upPct: 18, downPct: -16 } },
      { name: 'Lantern Realty', initialPrice: 10_000, mechanic: { kind: 'scripted', control: [12_000, 10_800, 14_500, 11_200, 15_800, 12_400, 17_100, 13_600, 18_800] } },
      { name: 'Pixel Arcade', initialPrice: 8_000, mechanic: { kind: 'volume', cmp: 5, above: 2_000, below: -1_100 } },
      { name: 'Velvet Rope Group', initialPrice: 10_000, mechanic: { kind: 'holdings', wonPerShare: 450, inverted: false, cap: null } },
      { name: 'Static Audio', initialPrice: 9_000, mechanic: { kind: 'secret', ref: 5, activePct: 20, inactiveWon: -1_400 } },
      { name: 'Nocturne Finance', initialPrice: 13_500, mechanic: { kind: 'sweet', lower: 6, upper: 18, inside: 2_400, outside: -1_600 } },
      { name: 'Signal Noodle Bar', initialPrice: 7_500, mechanic: { kind: 'sentiment', rising: 4, falling: 4, risePct: 25, fallPct: -15 } },
    ],
  },

  /* --- 6 ----------------------------------------------------------- */
  {
    id: 'permafrost',
    name: 'Permafrost',
    theme: 'Arctic energy',
    description:
      'A grinding, downward-pressured market. The scripted stock falls for most of the game before recovering, which punishes anyone who assumes a rising path.',
    designerNote:
      'Deliberately bearish. Several rules have a negative default branch, so holding cash is a real strategy here — which is a lesson in itself if your class assumes trading is always correct.',
    rounds: 24,
    roundSeconds: 300,
    startingCash: 100_000,
    stocks: [
      { name: 'Icebreaker Energy', initialPrice: 11_000, mechanic: { kind: 'sentiment', rising: 5, falling: 4, risePct: 20, fallPct: -14 } },
      { name: 'Tundra Drilling', initialPrice: 10_000, mechanic: { kind: 'volume', cmp: 6, above: 1_500, below: -1_000 } },
      { name: 'Aurora Grid', initialPrice: 10_000, mechanic: { kind: 'scripted', control: [10_000, 9_200, 8_400, 7_600, 9_100, 11_400, 10_200, 8_800, 12_600] } },
      { name: 'Methane Hydrates', initialPrice: 8_500, mechanic: { kind: 'secret', ref: 1, activePct: 16, inactiveWon: -1_300 } },
      { name: 'Polar Comms', initialPrice: 12_000, mechanic: { kind: 'sweet', lower: 10, upper: 26, inside: 1_600, outside: -1_300 } },
      { name: 'Glacier Trust', initialPrice: 9_500, mechanic: { kind: 'cross', ref: 4, upPct: 10, downPct: -13 } },
      { name: 'White Night Media', initialPrice: 10_500, mechanic: { kind: 'holdings', wonPerShare: 320, inverted: false, cap: null } },
    ],
  },

  /* --- 7 ----------------------------------------------------------- */
  {
    id: 'clockwork',
    name: 'Clockwork',
    theme: 'Precision manufacturing',
    description:
      'Regular and legible. The holdings rule is capped, so no single round can swing it wildly, and the scripted path oscillates on a fixed period.',
    designerNote:
      'The capped holdings rule is the interesting part: a coordinated group cannot crash the stock in one round however much they buy, so manipulation has to be sustained across several. Good for teaching patience.',
    rounds: 24,
    roundSeconds: 300,
    startingCash: 100_000,
    stocks: [
      { name: 'Escapement Works', initialPrice: 10_000, mechanic: { kind: 'secret', ref: 6, activePct: 13, inactiveWon: -800 } },
      { name: 'Mainspring Metals', initialPrice: 10_000, mechanic: { kind: 'holdings', wonPerShare: 400, inverted: false, cap: 12 } },
      { name: 'Gear & Pawl', initialPrice: 9_500, mechanic: { kind: 'sweet', lower: 14, upper: 28, inside: 1_500, outside: -1_000 } },
      { name: 'Jewel Bearing Co', initialPrice: 11_500, mechanic: { kind: 'cross', ref: 1, upPct: 11, downPct: -11 } },
      { name: 'Regulator Systems', initialPrice: 10_500, mechanic: { kind: 'sentiment', rising: 4, falling: 4, risePct: 17, fallPct: -11 } },
      { name: 'Horology Mutual', initialPrice: 10_000, mechanic: { kind: 'scripted', control: [10_000, 10_800, 11_600, 12_400, 11_200, 10_000, 11_000, 12_200, 13_400] } },
      { name: 'Chime Entertainment', initialPrice: 8_800, mechanic: { kind: 'volume', cmp: 2, above: 1_300, below: -700 } },
    ],
  },

  /* --- 8 ----------------------------------------------------------- */
  {
    id: 'monsoon',
    name: 'Monsoon',
    theme: 'Tropical infrastructure',
    description:
      'An inverted holdings rule: buying pushes this market UP rather than down. Anyone carrying a habit over from another template will get it exactly backwards.',
    designerNote:
      'The single best anti-memory template. Delta Cement rewards accumulation instead of punishing it, which inverts the most commonly learned instinct in the whole game.',
    rounds: 24,
    roundSeconds: 300,
    startingCash: 100_000,
    stocks: [
      { name: 'Delta Cement', initialPrice: 9_000, mechanic: { kind: 'holdings', wonPerShare: 220, inverted: true, cap: null } },
      { name: 'Rainfall Power', initialPrice: 10_000, mechanic: { kind: 'scripted', control: [8_800, 9_600, 13_200, 16_400, 12_800, 9_200, 8_400, 11_600, 15_200] } },
      { name: 'Mangrove Holdings', initialPrice: 11_000, mechanic: { kind: 'secret', ref: 4, activePct: 14, inactiveWon: -1_000 } },
      { name: 'Cyclone Shutters', initialPrice: 12_500, mechanic: { kind: 'sentiment', rising: 4, falling: 4, risePct: 19, fallPct: -13 } },
      { name: 'Paddy Futures', initialPrice: 8_500, mechanic: { kind: 'sweet', lower: 20, upper: 40, inside: 1_400, outside: -1_100 } },
      { name: 'Monsoon Re', initialPrice: 10_000, mechanic: { kind: 'volume', cmp: 4, above: 1_700, below: -900 } },
      { name: 'Festival Lanterns', initialPrice: 9_800, mechanic: { kind: 'cross', ref: 0, upPct: 13, downPct: -10 } },
    ],
  },

  /* --- 9 ----------------------------------------------------------- */
  {
    id: 'red-sand',
    name: 'Red Sand',
    theme: 'Desert extraction',
    description:
      'A long, dry grind. Fixed adjustments dominate percentages here, so cheap stocks fall proportionally harder than expensive ones.',
    designerNote:
      'Starting prices are spread from 7,000 to 14,000, which makes the fixed-won rules behave very differently stock by stock. The lesson is that the same rule is not the same opportunity at every price.',
    rounds: 24,
    roundSeconds: 300,
    startingCash: 100_000,
    stocks: [
      { name: 'Dune Haulage', initialPrice: 7_000, mechanic: { kind: 'volume', cmp: 1, above: 1_100, below: -600 } },
      { name: 'Quartz Extraction', initialPrice: 14_000, mechanic: { kind: 'sweet', lower: 12, upper: 30, inside: 1_900, outside: -1_400 } },
      { name: 'Mirage Water', initialPrice: 9_000, mechanic: { kind: 'cross', ref: 6, upPct: 16, downPct: -12 } },
      { name: 'Solar Furnace', initialPrice: 12_000, mechanic: { kind: 'secret', ref: 0, activePct: 12, inactiveWon: -1_200 } },
      { name: 'Caravan Logistics', initialPrice: 10_000, mechanic: { kind: 'scripted', control: [13_000, 11_400, 9_800, 8_200, 9_400, 11_000, 9_600, 8_000, 12_400] } },
      { name: 'Oasis Assurance', initialPrice: 8_000, mechanic: { kind: 'holdings', wonPerShare: 280, inverted: false, cap: null } },
      { name: 'Scorpion Studios', initialPrice: 11_500, mechanic: { kind: 'sentiment', rising: 5, falling: 5, risePct: 24, fallPct: -16 } },
    ],
  },

  /* --- 10 ---------------------------------------------------------- */
  {
    id: 'paper-trail',
    name: 'Paper Trail',
    theme: 'Finance and bureaucracy',
    description:
      'The deceptive one. The scripted stock barely moves and looks like a safe haven, while the real money is in two rules that interact.',
    designerNote:
      'Ledger & Quill counts five risers rather than four, so the sentiment rule fires rarely and powerfully. Players tend to dismiss it for ten rounds and then discover it all at once.',
    rounds: 24,
    roundSeconds: 300,
    startingCash: 100_000,
    stocks: [
      { name: 'Ledger & Quill', initialPrice: 10_000, mechanic: { kind: 'sentiment', rising: 5, falling: 5, risePct: 28, fallPct: -18 } },
      { name: 'Notary Partners', initialPrice: 9_500, mechanic: { kind: 'cross', ref: 4, upPct: 10, downPct: -10 } },
      { name: 'Carbon Copy Ltd', initialPrice: 10_000, mechanic: { kind: 'scripted', control: [10_000, 10_200, 10_100, 10_400, 9_800, 10_600, 9_400, 11_200, 9_000] } },
      { name: 'Filing Cabinet Co', initialPrice: 11_000, mechanic: { kind: 'sweet', lower: 9, upper: 22, inside: 1_700, outside: -1_000 } },
      { name: 'Rubber Stamp Group', initialPrice: 10_500, mechanic: { kind: 'holdings', wonPerShare: 240, inverted: false, cap: null } },
      { name: 'Indemnity House', initialPrice: 12_000, mechanic: { kind: 'secret', ref: 3, activePct: 17, inactiveWon: -1_100 } },
      { name: 'Paper Crane Press', initialPrice: 8_800, mechanic: { kind: 'volume', cmp: 3, above: 1_400, below: -800 } },
    ],
  },

  /* --- 11 ---------------------------------------------------------- */
  {
    id: 'tidal-reach',
    name: 'Tidal Reach',
    theme: 'Estuary energy — a short game',
    description:
      'Six companies and twelve rounds, for a single lesson. One mechanic is left out entirely, which changes the deduction problem.',
    designerNote:
      'With only six stocks there is no relative-buying-volume rule at all. Players who have learned to look for one waste time hunting for something that is not there, which is exactly the point.',
    rounds: 12,
    roundSeconds: 180,
    startingCash: 80_000,
    stocks: [
      { name: 'Estuary Power', initialPrice: 10_000, mechanic: { kind: 'holdings', wonPerShare: 260, inverted: false, cap: null } },
      { name: 'Breakwater Build', initialPrice: 9_000, mechanic: { kind: 'cross', ref: 0, upPct: 12, downPct: -12 } },
      { name: 'Lunar Pull Energy', initialPrice: 11_000, mechanic: { kind: 'sweet', lower: 8, upper: 20, inside: 1_500, outside: -1_000 } },
      { name: 'Saltmarsh Analytics', initialPrice: 10_000, mechanic: { kind: 'secret', ref: 2, activePct: 15, inactiveWon: -900 } },
      { name: 'Spring Tide Capital', initialPrice: 12_000, mechanic: { kind: 'sentiment', rising: 4, falling: 4, risePct: 20, fallPct: -12 } },
      { name: 'Neap Entertainment', initialPrice: 10_000, mechanic: { kind: 'scripted', control: [10_000, 11_600, 10_000, 8_400, 10_000, 11_600, 10_000, 8_400, 10_000] } },
    ],
  },

  /* --- 12 ---------------------------------------------------------- */
  {
    id: 'cascade',
    name: 'Cascade',
    theme: 'River systems — a long game',
    description:
      'Eight companies over thirty rounds, with the sweet-spot mechanic used twice on different bands. The densest template in the library.',
    designerNote:
      'Two sweet spots with different ranges means the market cannot satisfy both at once, so the class has to choose which stock to farm. That argument is usually the best part of the session.',
    rounds: 30,
    roundSeconds: 240,
    startingCash: 150_000,
    stocks: [
      { name: 'Headwater Hydro', initialPrice: 11_000, mechanic: { kind: 'sweet', lower: 10, upper: 24, inside: 1_800, outside: -1_200 } },
      { name: 'Rapids Transit', initialPrice: 9_500, mechanic: { kind: 'volume', cmp: 0, above: 1_500, below: -800 } },
      { name: 'Gorge Mining', initialPrice: 10_000, mechanic: { kind: 'holdings', wonPerShare: 200, inverted: false, cap: null } },
      { name: 'Plunge Pool Leisure', initialPrice: 8_500, mechanic: { kind: 'cross', ref: 2, upPct: 14, downPct: -11 } },
      { name: 'Riffle Semiconductors', initialPrice: 13_000, mechanic: { kind: 'sentiment', rising: 5, falling: 4, risePct: 21, fallPct: -13 } },
      { name: 'Eddy Logistics', initialPrice: 10_000, mechanic: { kind: 'secret', ref: 0, activePct: 13, inactiveWon: -1_000 } },
      { name: 'Watershed Mutual', initialPrice: 10_000, mechanic: { kind: 'scripted', control: [16_000, 14_200, 12_600, 11_000, 9_400, 7_800, 9_200, 11_800, 14_600] } },
      { name: 'Cataract Media', initialPrice: 12_000, mechanic: { kind: 'sweet', lower: 30, upper: 55, inside: 2_000, outside: -1_300 } },
    ],
  },
];

/* ------------------------------------------------------------------ */
/* Registry                                                            */
/* ------------------------------------------------------------------ */

function toTemplate(spec: TemplateSpec): GameTemplate {
  return {
    id: spec.id,
    name: spec.name,
    theme: spec.theme,
    description: spec.description,
    designerNote: spec.designerNote,
    stockCount: spec.stocks.length,
    defaultRounds: spec.rounds,
    defaultRoundSeconds: spec.roundSeconds,
    startingCash: spec.startingCash,
    source: 'built-in',
    stockNames: spec.stocks.map((s) => s.name),
    build: (options?: PresetOptions) => buildFromSpec(spec, options),
  };
}

/** The original seven. Kept exactly as it was, as template number one. */
const CLASSIC: GameTemplate = {
  id: 'classic',
  name: 'Classic Mystery Stock Market',
  theme: 'The original seven',
  description:
    'The configuration from the original game: Defense Steel, Airtight Construction, Latter Electronics, CoyoTech, Open Security, Seasonal Financial and Alt Entertainment.',
  designerNote:
    'The reference implementation of all seven mechanics. Use it the first time you run a session, and scramble it if any of your players have seen it before.',
  stockCount: 7,
  defaultRounds: 24,
  defaultRoundSeconds: 300,
  startingCash: 100_000,
  source: 'built-in',
  stockNames: [
    'Defense Steel',
    'Airtight Construction',
    'Latter Electronics',
    'CoyoTech',
    'Open Security',
    'Seasonal Financial',
    'Alt Entertainment',
  ],
  build: (options?: PresetOptions) => classicPreset(options),
};

export const GAME_TEMPLATES: GameTemplate[] = [CLASSIC, ...SPECS.map(toTemplate)];

export function listGameTemplates(): GameTemplateMeta[] {
  return GAME_TEMPLATES.map(({ build: _build, ...meta }) => meta);
}

export function gameTemplateById(id: string): GameTemplate | undefined {
  return GAME_TEMPLATES.find((t) => t.id === id);
}

/** Builds a template's configuration, or throws if the id is unknown. */
export function buildGameTemplate(id: string, options: PresetOptions = {}): SessionConfig {
  const template = gameTemplateById(id);
  if (!template) throw new Error(`No game template called "${id}"`);
  return template.build(options);
}

/**
 * An empty game to build from scratch: the requested number of companies,
 * all with the unchanged-price mechanic, for the administrator to assign.
 */
export function blankTemplate(options: { stocks?: number } & PresetOptions = {}): SessionConfig {
  const count = Math.max(1, Math.min(options.stocks ?? 7, 40));
  const base = classicPreset(options);
  const minPrice = options.minPrice ?? base.minPrice;
  const initialPrice = options.initialPrice ?? 10_000;
  const stocks = Array.from({ length: count }, (_, i) => {
    const rule: RuleParams = { template: 'UNCHANGED' };
    const name = `Company ${String.fromCharCode(65 + (i % 26))}`;
    return {
      id: `s${i + 1}`,
      name,
      initialPrice,
      rule,
      disclosure: defaultDisclosures(rule, { stockName: name, nameOf: (x: StockId) => x, minPrice }),
    };
  });
  return { ...base, name: options.name ?? 'New game', stocks };
}
