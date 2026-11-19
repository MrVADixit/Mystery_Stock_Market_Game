/**
 * Deterministic market simulation.
 *
 * Drives the real settlement engine over a whole game with scripted
 * participant behaviour. The administrator's simulation screen, the
 * readiness check and the integration tests all use this one runner, so
 * what the administrator previews is what the live game will do.
 *
 * A simulation never touches a live session: it operates entirely on an
 * in-memory copy of the configuration.
 */

import { applyOrder, emptyPosition, holdingsValue, maxBuyQuantity, totalAssets } from './orders';
import type { Position, Side } from './orders';
import { secretStateForRound, secretWindows } from './secrets';
import type { SecretActivation, SecretWindow } from './secrets';
import { initialPrices, settleRound } from './settle';
import type { RoundSnapshot, RuleEvaluation, SessionConfig, StockId } from './types';

export interface SimOrder {
  /** Index into the simulated participant list. */
  participant: number;
  stockId: StockId;
  side: Side;
  quantity: number | 'max';
}

export interface SimRoundContext {
  round: number;
  prices: Record<StockId, number>;
  positions: Position[];
  holdings: Record<StockId, number>;
  config: SessionConfig;
}

export interface Scenario {
  id: string;
  name: string;
  description: string;
  participants: number;
  /** Orders placed during the round, in order. */
  orders?: (ctx: SimRoundContext) => SimOrder[];
  /** Secrets imposed during the round. */
  secrets?: (ctx: SimRoundContext) => { stockId: StockId; participant: number }[];
  /**
   * Forces the prices a round opens at. This is how a scenario can set up
   * a market state that ordinary trading cannot reach directly — for
   * example "four stocks rose this round", which Rule 6 reacts to. The
   * previous round's prices are left alone, so the forced prices are what
   * the market-sentiment count compares against.
   */
  overridePrices?: (ctx: Omit<SimRoundContext, 'prices'> & { prices: Record<StockId, number> }) => Record<StockId, number> | undefined;
  /** Stop early instead of running every configured round. */
  maxRounds?: number;
}

export interface RejectedOrder {
  round: number;
  participant: number;
  stockId: StockId;
  side: Side;
  quantity: number;
  reason: string;
}

export interface SimRoundRecord {
  round: number;
  prices: Record<StockId, number>;
  previousPrices: Record<StockId, number>;
  holdings: Record<StockId, number>;
  previousHoldings: Record<StockId, number>;
  grossBuys: Record<StockId, number>;
  grossSells: Record<StockId, number>;
  secretActiveNextRound: Record<StockId, boolean>;
  /**
   * False for the final round. The game ends at the last round's prices,
   * so there is no settlement after it and no round for it to produce
   * prices for. See §21: the final step is valuation, not another
   * price movement.
   */
  settled: boolean;
  evaluations: RuleEvaluation[];
  nextPrices: Record<StockId, number>;
  rejected: RejectedOrder[];
  assets: number[];
}

export interface SimResult {
  scenarioId: string;
  scenarioName: string;
  roundsRun: number;
  records: SimRoundRecord[];
  /** Price of each stock at the start of each round, 1-indexed. */
  priceHistory: Record<StockId, number[]>;
  finalPrices: Record<StockId, number>;
  finalAssets: number[];
  secretWindows: SecretWindow[];
  /** Rounds where a stock hit the configured floor. */
  floorEvents: { round: number; stockId: StockId; stockName: string }[];
  /** Movements of 50% or more of the opening price. */
  extremeMoves: { round: number; stockId: StockId; stockName: string; pct: number }[];
  rejected: RejectedOrder[];
}

function zeroMap(config: SessionConfig): Record<StockId, number> {
  const out: Record<StockId, number> = {};
  for (const s of config.stocks) out[s.id] = 0;
  return out;
}

function aggregateHoldings(config: SessionConfig, positions: Position[]): Record<StockId, number> {
  const out = zeroMap(config);
  for (const p of positions) {
    for (const s of config.stocks) out[s.id] += p.shares[s.id] ?? 0;
  }
  return out;
}

/** Runs a scenario against a configuration and returns the whole history. */
export function runScenario(config: SessionConfig, scenario: Scenario): SimResult {
  const totalRounds = Math.min(scenario.maxRounds ?? config.rounds, config.rounds);
  const positions: Position[] = Array.from({ length: scenario.participants }, () => emptyPosition(config));

  let prices = initialPrices(config);
  // Before round 1 there is no previous round, so the previous prices are
  // the opening prices: nothing has moved yet.
  let previousPrices = { ...prices };
  let previousHoldings = zeroMap(config);

  const activations: SecretActivation[] = [];
  const records: SimRoundRecord[] = [];
  const rejected: RejectedOrder[] = [];
  const priceHistory: Record<StockId, number[]> = {};
  for (const s of config.stocks) priceHistory[s.id] = [];

  for (let round = 1; round <= totalRounds; round++) {
    const forced = scenario.overridePrices?.({
      round,
      prices: { ...prices },
      positions: positions.map((p) => ({ cash: p.cash, shares: { ...p.shares } })),
      holdings: aggregateHoldings(config, positions),
      config,
    });
    if (forced) prices = { ...prices, ...forced };

    for (const s of config.stocks) priceHistory[s.id].push(prices[s.id]);

    const grossBuys = zeroMap(config);
    const grossSells = zeroMap(config);
    const roundRejected: RejectedOrder[] = [];

    const ctx: SimRoundContext = {
      round,
      prices: { ...prices },
      positions: positions.map((p) => ({ cash: p.cash, shares: { ...p.shares } })),
      holdings: aggregateHoldings(config, positions),
      config,
    };

    // --- trading -----------------------------------------------------
    const orders = scenario.orders?.(ctx) ?? [];
    for (const order of orders) {
      const idx = order.participant;
      const pos = positions[idx];
      if (!pos) continue;
      const price = prices[order.stockId];
      if (price == null) continue;

      const qty =
        order.quantity === 'max'
          ? order.side === 'buy'
            ? maxBuyQuantity(pos, order.stockId, price, config)
            : pos.shares[order.stockId] ?? 0
          : order.quantity;
      if (qty < 1) continue;

      const result = applyOrder(pos, order.side, order.stockId, price, qty, config);
      if (!result.ok) {
        const r: RejectedOrder = {
          round,
          participant: idx,
          stockId: order.stockId,
          side: order.side,
          quantity: qty,
          reason: result.message ?? result.rejection ?? 'rejected',
        };
        roundRejected.push(r);
        rejected.push(r);
        continue;
      }
      positions[idx] = result.position;
      if (order.side === 'buy') grossBuys[order.stockId] += qty;
      else grossSells[order.stockId] += qty;
    }

    // --- secrets -----------------------------------------------------
    const imposed = scenario.secrets?.(ctx) ?? [];
    for (const s of imposed) {
      activations.push({ round, stockId: s.stockId, participantId: String(s.participant) });
    }
    const windows = secretWindows(config.secrets, activations);
    const secretActiveNextRound = secretStateForRound(
      config.stocks.map((s) => s.id),
      windows,
      round + 1,
    );

    // --- settlement --------------------------------------------------
    const holdings = aggregateHoldings(config, positions);
    const snapshot: RoundSnapshot = {
      round,
      prices: { ...prices },
      previousPrices: { ...previousPrices },
      holdings,
      previousHoldings,
      grossBuys,
      grossSells,
      secretActiveNextRound,
    };

    // The last round of the game is never settled: there is no round for
    // it to produce prices for, and the final standings are valued at the
    // last round's own prices.
    const isFinalRound = round === totalRounds;
    const settlement = isFinalRound ? null : settleRound(config, snapshot);

    records.push({
      round,
      prices: { ...prices },
      previousPrices: { ...previousPrices },
      holdings: { ...holdings },
      previousHoldings: { ...previousHoldings },
      grossBuys: { ...grossBuys },
      grossSells: { ...grossSells },
      secretActiveNextRound,
      settled: settlement != null,
      evaluations: settlement?.evaluations ?? [],
      nextPrices: settlement ? { ...settlement.prices } : { ...prices },
      rejected: roundRejected,
      assets: positions.map((p) => totalAssets(p, prices)),
    });

    previousPrices = prices;
    previousHoldings = holdings;
    if (settlement) prices = settlement.prices;
  }

  const windows = secretWindows(config.secrets, activations);
  const floorEvents: SimResult['floorEvents'] = [];
  const extremeMoves: SimResult['extremeMoves'] = [];
  for (const rec of records) {
    for (const e of rec.evaluations) {
      if (e.flooredAtMin) floorEvents.push({ round: rec.round, stockId: e.stockId, stockName: e.stockName });
      if (e.openingPrice > 0) {
        const pct = (Math.abs(e.appliedDelta) / e.openingPrice) * 100;
        if (pct >= 50)
          extremeMoves.push({
            round: rec.round,
            stockId: e.stockId,
            stockName: e.stockName,
            pct: Math.round(pct * 10) / 10,
          });
      }
    }
  }

  return {
    scenarioId: scenario.id,
    scenarioName: scenario.name,
    roundsRun: records.length,
    records,
    priceHistory,
    finalPrices: prices,
    finalAssets: positions.map((p) => totalAssets(p, prices)),
    secretWindows: windows,
    floorEvents,
    extremeMoves,
    rejected,
  };
}

/** Final-standing helper shared by the simulator and the results screen. */
export function finalStandings(
  config: SessionConfig,
  positions: Position[],
  prices: Record<StockId, number>,
): {
  rank: number;
  participant: number;
  startingCash: number;
  cash: number;
  holdingsValue: number;
  netWorth: number;
  gain: number;
  returnPct: number;
}[] {
  return positions
    .map((p, i) => {
      const hv = holdingsValue(p, prices);
      const net = p.cash + hv;
      const gain = net - config.startingCash;
      return {
        rank: 0,
        participant: i,
        startingCash: config.startingCash,
        cash: p.cash,
        holdingsValue: hv,
        netWorth: net,
        gain,
        returnPct: config.startingCash > 0 ? (gain / config.startingCash) * 100 : 0,
      };
    })
    .sort((a, b) => b.netWorth - a.netWorth)
    .map((r, i) => ({ ...r, rank: i + 1 }));
}
