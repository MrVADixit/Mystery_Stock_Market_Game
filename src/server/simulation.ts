/**
 * The administrator's simulation and testing surface.
 *
 * Everything here reads the stored configuration and runs it through the
 * engine in memory. No function in this module writes to a live session,
 * so a simulation can never alter a running game.
 */

import { loadConfig } from './config-store';
import { runReadinessCheck } from '@/engine/readiness';
import type { ReadinessReport } from '@/engine/readiness';
import { previewSettlement } from '@/engine/preview';
import type { PreviewInput, PreviewResult } from '@/engine/preview';
import { runScenario } from '@/engine/simulate';
import type { Scenario, SimOrder, SimResult } from '@/engine/simulate';
import { standardScenarios, stockWithTemplate } from '@/engine/scenarios';
import type { SessionConfig, StockId } from '@/engine/types';

export async function readinessFor(gameId: string): Promise<ReadinessReport | null> {
  const config = await loadConfig(gameId);
  return config ? runReadinessCheck(config) : null;
}

export async function previewFor(gameId: string, input: PreviewInput): Promise<PreviewResult | null> {
  const config = await loadConfig(gameId);
  return config ? previewSettlement(config, input) : null;
}

export interface ScenarioSummary {
  id: string;
  name: string;
  description: string;
  roundsRun: number;
  /** Per-round price table, for the chart. */
  priceHistory: Record<StockId, number[]>;
  rounds: {
    round: number;
    prices: Record<StockId, number>;
    holdings: Record<StockId, number>;
    grossBuys: Record<StockId, number>;
    grossSells: Record<StockId, number>;
    secretActive: StockId[];
    evaluations: {
      stockId: StockId;
      stockName: string;
      template: string;
      branch: string;
      openingPrice: number;
      appliedDelta: number;
      finalPrice: number;
      floored: boolean;
      explanation: string;
    }[];
  }[];
  finalPrices: Record<StockId, number>;
  finalAssets: number[];
  floorEvents: SimResult['floorEvents'];
  extremeMoves: SimResult['extremeMoves'];
  rejected: SimResult['rejected'];
}

function summarise(result: SimResult, scenario: Scenario): ScenarioSummary {
  return {
    id: scenario.id,
    name: scenario.name,
    description: scenario.description,
    roundsRun: result.roundsRun,
    priceHistory: result.priceHistory,
    rounds: result.records.map((r) => ({
      round: r.round,
      prices: r.prices,
      holdings: r.holdings,
      grossBuys: r.grossBuys,
      grossSells: r.grossSells,
      secretActive: Object.entries(r.secretActiveNextRound)
        .filter(([, active]) => active)
        .map(([id]) => id),
      evaluations: r.evaluations.map((e) => ({
        stockId: e.stockId,
        stockName: e.stockName,
        template: e.template,
        branch: e.branch,
        openingPrice: e.openingPrice,
        appliedDelta: e.appliedDelta,
        finalPrice: e.finalPrice,
        floored: e.flooredAtMin,
        explanation: e.explanation,
      })),
    })),
    finalPrices: result.finalPrices,
    finalAssets: result.finalAssets,
    floorEvents: result.floorEvents,
    extremeMoves: result.extremeMoves,
    rejected: result.rejected,
  };
}

export async function listScenarios(gameId: string) {
  const config = await loadConfig(gameId);
  if (!config) return [];
  return [...standardScenarios(config), ...strategyDemos(config)].map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    participants: s.participants,
  }));
}

export async function runScenarioFor(
  gameId: string,
  scenarioId: string,
  options: { maxRounds?: number } = {},
): Promise<ScenarioSummary | null> {
  const config = await loadConfig(gameId);
  if (!config) return null;
  const scenario = [...standardScenarios(config), ...strategyDemos(config)].find((s) => s.id === scenarioId);
  if (!scenario) return null;
  const withLimit: Scenario = options.maxRounds
    ? { ...scenario, maxRounds: Math.min(options.maxRounds, config.rounds) }
    : scenario;
  return summarise(runScenario(config, withLimit), withLimit);
}

/**
 * A one-off scenario built from the quantities on the simulation screen:
 * "buy 50 shares", "set holdings to 20", "activate a secret".
 */
export interface AdHocScenarioSpec {
  participants?: number;
  maxRounds?: number;
  /** Buy this many shares of this stock in round 1 and hold. */
  buy?: { stockId: StockId; quantity: number };
  /** Acquire then sell this many shares, to drive holdings down. */
  sell?: { stockId: StockId; quantity: number };
  /** Hold total holdings of this stock at exactly this level. */
  holdingsTarget?: { stockId: StockId; quantity: number };
  /** Impose a secret on this stock in this round. */
  secret?: { stockId: StockId; round: number };
}

export async function runAdHoc(gameId: string, spec: AdHocScenarioSpec): Promise<ScenarioSummary | null> {
  const config = await loadConfig(gameId);
  if (!config) return null;

  const participants = Math.max(1, Math.min(spec.participants ?? 4, 50));
  const scenario: Scenario = {
    id: 'ad-hoc',
    name: 'Custom check',
    description: 'A one-off scenario built from the quantities you entered.',
    participants,
    maxRounds: spec.maxRounds,
    orders: (ctx) => {
      const orders: SimOrder[] = [];
      const spread = (stockId: StockId, qty: number, side: 'buy' | 'sell') => {
        let remaining = qty;
        for (let i = 0; i < ctx.positions.length && remaining > 0; i++) {
          const take =
            side === 'sell'
              ? Math.min(remaining, ctx.positions[i].shares[stockId] ?? 0)
              : Math.ceil(remaining / (ctx.positions.length - i));
          if (take > 0) {
            orders.push({ participant: i, stockId, side, quantity: take });
            remaining -= take;
          }
        }
      };

      if (spec.buy && ctx.round === 1) spread(spec.buy.stockId, spec.buy.quantity, 'buy');
      if (spec.sell) {
        if (ctx.round === 1) spread(spec.sell.stockId, spec.sell.quantity, 'buy');
        else if (ctx.round === 2) spread(spec.sell.stockId, spec.sell.quantity, 'sell');
      }
      if (spec.holdingsTarget) {
        const { stockId, quantity } = spec.holdingsTarget;
        const current = ctx.holdings[stockId] ?? 0;
        if (current < quantity) spread(stockId, quantity - current, 'buy');
        else if (current > quantity) spread(stockId, current - quantity, 'sell');
      }
      return orders;
    },
    secrets: (ctx) =>
      spec.secret && ctx.round === spec.secret.round
        ? [{ stockId: spec.secret.stockId, participant: 0 }]
        : [],
  };

  return summarise(runScenario(config, scenario), scenario);
}

/* ------------------------------------------------------------------ */
/* Strategic demonstrations (§15.1)                                    */
/* ------------------------------------------------------------------ */

/**
 * The three sample strategies, reconstructed as real trade sequences.
 *
 * No profit figure is assumed or asserted: each demonstration replays the
 * trades through the actual rules, cash limits, holdings limits, price
 * floor and secret timing, and reports whatever genuinely comes out. The
 * point is to validate the model, not to guarantee an outcome.
 */
export function strategyDemos(config: SessionConfig): Scenario[] {
  const holdingsStock = stockWithTemplate(config, 'HOLDINGS_DELTA') ?? config.stocks[0]?.id ?? 's1';
  const sweetStock = stockWithTemplate(config, 'HOLDINGS_SWEET_SPOT') ?? holdingsStock;
  const sentimentStock = stockWithTemplate(config, 'MARKET_SENTIMENT') ?? holdingsStock;
  const crossStock = stockWithTemplate(config, 'CROSS_STOCK_DIRECTION') ?? holdingsStock;

  const sweet = config.stocks.find((s) => s.id === sweetStock);
  const band = sweet && sweet.rule.template === 'HOLDINGS_SWEET_SPOT' ? sweet.rule : null;

  return [
    {
      id: 'demo-crash-rebound',
      name: 'Demonstration: crash and rebound',
      description:
        'A syndicate accumulates the holdings-driven stock to force its price down, then unwinds the position to ride the rebound. Shows whether the floor makes the round trip profitable.',
      participants: 5,
      orders: (ctx) => {
        const orders: SimOrder[] = [];
        const price = ctx.prices[holdingsStock];
        // Phase 1: pile in for the first third of the game.
        if (ctx.round <= Math.max(2, Math.floor(config.rounds / 3))) {
          for (let i = 0; i < ctx.positions.length; i++) {
            const qty = Math.min(10, Math.floor(ctx.positions[i].cash / Math.max(1, price)));
            if (qty > 0) orders.push({ participant: i, stockId: holdingsStock, side: 'buy', quantity: qty });
          }
          return orders;
        }
        // Phase 2: unwind steadily, which pushes the price back up.
        for (let i = 0; i < ctx.positions.length; i++) {
          const held = ctx.positions[i].shares[holdingsStock] ?? 0;
          if (held > 0) orders.push({ participant: i, stockId: holdingsStock, side: 'sell', quantity: Math.min(held, 5) });
        }
        return orders;
      },
    },
    {
      id: 'demo-sweet-spot',
      name: 'Demonstration: sweet-spot manipulation',
      description: band
        ? `Holdings are parked inside the ${band.lower}–${band.upper} band to farm the bonus, then deliberately pushed one share past the boundary to show the swing.`
        : 'Holdings are parked inside the favoured band, then pushed past the boundary.',
      participants: 4,
      orders: (ctx) => {
        const target =
          band && ctx.round > Math.floor(config.rounds / 2)
            ? band.upper + 1
            : band
              ? Math.floor((band.lower + band.upper) / 2)
              : 20;
        const current = ctx.holdings[sweetStock] ?? 0;
        const orders: SimOrder[] = [];
        let remaining = Math.abs(target - current);
        const side = target > current ? 'buy' : 'sell';
        for (let i = 0; i < ctx.positions.length && remaining > 0; i++) {
          const take =
            side === 'sell'
              ? Math.min(remaining, ctx.positions[i].shares[sweetStock] ?? 0)
              : Math.ceil(remaining / (ctx.positions.length - i));
          if (take > 0) {
            orders.push({ participant: i, stockId: sweetStock, side, quantity: take });
            remaining -= take;
          }
        }
        return orders;
      },
    },
    {
      id: 'demo-compound-sentiment',
      name: 'Demonstration: compound cross-stock movement',
      description:
        'The holdings-driven stock is pushed up by selling, which lifts the stock that follows it, which helps tip the market-wide sentiment rule into its positive branch. Shows how one action compounds across three rules.',
      participants: 5,
      orders: (ctx) => {
        const orders: SimOrder[] = [];
        if (ctx.round === 1) {
          // Build an inventory first so there is something to sell.
          for (let i = 0; i < ctx.positions.length; i++) {
            const qty = Math.min(8, Math.floor(ctx.positions[i].cash / Math.max(1, ctx.prices[holdingsStock])));
            if (qty > 0) orders.push({ participant: i, stockId: holdingsStock, side: 'buy', quantity: qty });
          }
          return orders;
        }
        // Then release shares a few at a time, lifting the price each round.
        for (let i = 0; i < ctx.positions.length; i++) {
          const held = ctx.positions[i].shares[holdingsStock] ?? 0;
          if (held > 0) orders.push({ participant: i, stockId: holdingsStock, side: 'sell', quantity: Math.min(2, held) });
        }
        // And hold positions in the two stocks that benefit.
        for (const stockId of [crossStock, sentimentStock]) {
          const pos = ctx.positions[0];
          if (pos.cash >= ctx.prices[stockId]) {
            orders.push({ participant: 0, stockId, side: 'buy', quantity: 1 });
          }
        }
        return orders;
      },
    },
  ];
}

/** Final standings for a simulated run, for the ranking-impact demos. */
export async function simulatedStandings(gameId: string, scenarioId: string) {
  const config = await loadConfig(gameId);
  if (!config) return null;
  const scenario = [...standardScenarios(config), ...strategyDemos(config)].find((s) => s.id === scenarioId);
  if (!scenario) return null;
  const result = runScenario(config, scenario);

  // The simulator values every participant at the end of each round, so
  // the final figures come straight from the simulated run rather than
  // from any separate running total.
  const standings = result.finalAssets
    .map((netWorth, participant) => {
      const gain = netWorth - config.startingCash;
      return {
        rank: 0,
        participant,
        startingCash: config.startingCash,
        netWorth,
        gain,
        returnPct: config.startingCash > 0 ? (gain / config.startingCash) * 100 : 0,
      };
    })
    .sort((a, b) => b.netWorth - a.netWorth)
    .map((row, index) => ({ ...row, rank: index + 1 }));

  return {
    scenario: { id: scenario.id, name: scenario.name },
    finalPrices: result.finalPrices,
    standings,
    assetsByRound: result.records.map((r) => ({ round: r.round, assets: r.assets })),
  };
}
