/**
 * The standard scenario pack.
 *
 * These are the fifteen integration scenarios from the specification plus
 * the seven quick checks the administrator can press in the simulation
 * screen. They are built from the session's own configuration — stocks are
 * located by the template assigned to them, not by name — so they keep
 * working after the administrator moves a rule to a different stock.
 */

import { CLASSIC_SCRIPTED_PATH_24 } from './preset';
import type { Scenario, SimOrder, SimRoundContext } from './simulate';
import type { RuleTemplateId, SessionConfig, StockId } from './types';

/** First stock using a given template, or undefined. */
export function stockWithTemplate(config: SessionConfig, template: RuleTemplateId): StockId | undefined {
  return config.stocks.find((s) => s.rule.template === template)?.id;
}

function firstStock(config: SessionConfig): StockId {
  const id = config.stocks[0]?.id;
  if (!id) throw new Error('A scenario needs at least one stock');
  return id;
}

/** Buys `qty` of `stockId` spread across every participant. */
function spreadBuy(participants: number, stockId: StockId, qty: number): SimOrder[] {
  const orders: SimOrder[] = [];
  let remaining = qty;
  for (let i = 0; i < participants && remaining > 0; i++) {
    const take = Math.ceil(remaining / (participants - i));
    orders.push({ participant: i, stockId, side: 'buy', quantity: take });
    remaining -= take;
  }
  return orders;
}

function spreadSell(ctx: SimRoundContext, stockId: StockId, qty: number): SimOrder[] {
  const orders: SimOrder[] = [];
  let remaining = qty;
  for (let i = 0; i < ctx.positions.length && remaining > 0; i++) {
    const have = ctx.positions[i].shares[stockId] ?? 0;
    const take = Math.min(have, remaining);
    if (take > 0) {
      orders.push({ participant: i, stockId, side: 'sell', quantity: take });
      remaining -= take;
    }
  }
  return orders;
}

/** Drives total holdings of one stock toward `target` shares. */
function driveHoldingsTo(ctx: SimRoundContext, stockId: StockId, target: number): SimOrder[] {
  const current = ctx.holdings[stockId] ?? 0;
  if (current === target) return [];
  if (current < target) return spreadBuy(ctx.positions.length, stockId, target - current);
  return spreadSell(ctx, stockId, current - target);
}

export function standardScenarios(config: SessionConfig): Scenario[] {
  const holdingsStock = stockWithTemplate(config, 'HOLDINGS_DELTA') ?? firstStock(config);
  const sweetStock = stockWithTemplate(config, 'HOLDINGS_SWEET_SPOT') ?? firstStock(config);
  const volumeStock = stockWithTemplate(config, 'RELATIVE_BUY_VOLUME') ?? firstStock(config);
  const secretRule = config.stocks.find((s) => s.rule.template === 'SECRET_DEPENDENT');
  const secretTarget =
    secretRule && secretRule.rule.template === 'SECRET_DEPENDENT'
      ? secretRule.rule.referenceStockId
      : sweetStock;

  const sweet = config.stocks.find((s) => s.id === sweetStock);
  const sweetParams = sweet && sweet.rule.template === 'HOLDINGS_SWEET_SPOT' ? sweet.rule : null;
  const insideTarget = sweetParams ? Math.floor((sweetParams.lower + sweetParams.upper) / 2) : 20;
  const outsideTarget = sweetParams ? sweetParams.upper + 1 : 31;

  const allIds = config.stocks.map((s) => s.id);

  // Force exactly as many risers / fallers as the sentiment rule needs, so
  // these scenarios keep working if the administrator retunes it.
  const sentiment = config.stocks.find((s) => s.rule.template === 'MARKET_SENTIMENT');
  const sentimentParams = sentiment && sentiment.rule.template === 'MARKET_SENTIMENT' ? sentiment.rule : null;
  const risingNeeded = Math.min(allIds.length, sentimentParams?.risingThreshold ?? 4);
  const fallingNeeded = Math.min(allIds.length, sentimentParams?.fallingThreshold ?? 4);

  const LADDER_BASE = 10_000;
  const LADDER_STEP = 300;
  /** A price ladder that moves one step per round in the given direction. */
  const ladder = (round: number, ids: StockId[], direction: 1 | -1): Record<StockId, number> => {
    const out: Record<StockId, number> = {};
    for (const id of ids) {
      out[id] = Math.max(config.minPrice, LADDER_BASE + direction * LADDER_STEP * round);
    }
    return out;
  };

  const scenarios: Scenario[] = [
    {
      id: 'no-trading',
      name: '1. Nobody trades',
      description: 'Every round passes with no orders at all. Shows the market’s idle drift.',
      participants: 4,
    },
    {
      id: 'steady-buying',
      name: '2. Steady buying',
      description: 'Four participants buy one share of every stock, every round, while they can afford it.',
      participants: 4,
      orders: (ctx) =>
        ctx.positions.flatMap((pos, i) =>
          config.stocks
            .filter((s) => pos.cash >= ctx.prices[s.id])
            .map<SimOrder>((s) => ({ participant: i, stockId: s.id, side: 'buy', quantity: 1 })),
        ),
    },
    {
      id: 'steady-selling',
      name: '3. Steady selling',
      description: 'Participants load up in round 1 and then sell one share of each holding every round.',
      participants: 4,
      orders: (ctx) => {
        if (ctx.round === 1) {
          return ctx.positions.flatMap((pos, i) =>
            config.stocks
              .filter((s) => pos.cash >= ctx.prices[s.id] * 3)
              .map<SimOrder>((s) => ({ participant: i, stockId: s.id, side: 'buy', quantity: 3 })),
          );
        }
        return ctx.positions.flatMap((pos, i) =>
          config.stocks
            .filter((s) => (pos.shares[s.id] ?? 0) > 0)
            .map<SimOrder>((s) => ({ participant: i, stockId: s.id, side: 'sell', quantity: 1 })),
        );
      },
    },
    {
      id: 'equal-buy-sell',
      name: '4. Equal buying and selling',
      description:
        'Each round the same number of shares is bought and sold, so holdings never change but gross volume is high. Separates volume from holdings.',
      participants: 4,
      orders: (ctx) => {
        const orders: SimOrder[] = [];
        if (ctx.round === 1) {
          // Participant 1 needs an inventory before it can sell any of it.
          for (const s of config.stocks) {
            if (ctx.positions[1].cash >= ctx.prices[s.id] * 2)
              orders.push({ participant: 1, stockId: s.id, side: 'buy', quantity: 2 });
          }
          return orders;
        }
        for (const s of config.stocks) {
          const held = ctx.positions[1].shares[s.id] ?? 0;
          const qty = Math.min(2, held);
          if (qty < 1) continue;
          // Exactly as many shares are bought as are sold, so aggregate
          // holdings do not move while gross volume is non-zero on both sides.
          if (ctx.positions[0].cash >= ctx.prices[s.id] * qty) {
            orders.push({ participant: 0, stockId: s.id, side: 'buy', quantity: qty });
            orders.push({ participant: 1, stockId: s.id, side: 'sell', quantity: qty });
          }
        }
        return orders;
      },
    },
    {
      id: 'holdings-increase',
      name: '5. Holdings-rule stock accumulates',
      description: 'Participants add shares of the holdings-driven stock every round, pushing its price down.',
      participants: 4,
      orders: (ctx) =>
        ctx.positions
          .map((pos, i) => ({ pos, i }))
          .filter(({ pos }) => pos.cash >= ctx.prices[holdingsStock] * 2)
          .map<SimOrder>(({ i }) => ({ participant: i, stockId: holdingsStock, side: 'buy', quantity: 2 })),
    },
    {
      id: 'holdings-decrease',
      name: '6. Holdings-rule stock is unwound',
      description: 'A large position in the holdings-driven stock is sold down, pushing its price up.',
      participants: 4,
      orders: (ctx) => {
        if (ctx.round === 1) return spreadBuy(4, holdingsStock, 40);
        return spreadSell(ctx, holdingsStock, 5);
      },
    },
    {
      id: 'secret-activated',
      name: '7. Secret imposed on the watched stock',
      description:
        'A secret is imposed in round 2 on the stock the secret-dependent rule watches. Checks the activation, duration and expiry boundaries.',
      participants: 4,
      secrets: (ctx) => (ctx.round === 2 ? [{ stockId: secretTarget, participant: 0 }] : []),
    },
    {
      id: 'sweet-spot-inside',
      name: '8. Holdings held inside the sweet spot',
      description: `Total holdings are driven to ${insideTarget} shares and kept there.`,
      participants: 4,
      orders: (ctx) => driveHoldingsTo(ctx, sweetStock, insideTarget),
    },
    {
      id: 'sweet-spot-outside',
      name: '9. Holdings pushed outside the sweet spot',
      description: `Total holdings are driven to ${outsideTarget} shares, one past the upper boundary.`,
      participants: 4,
      orders: (ctx) => driveHoldingsTo(ctx, sweetStock, outsideTarget),
    },
    {
      id: 'broad-rally',
      name: `10. ${risingNeeded} or more stocks rise`,
      description:
        'Prices are walked up a fixed ladder each round so the sentiment rule reliably takes its positive branch.',
      participants: 2,
      // A ladder anchored to the round number, rather than to the previous
      // settled price, guarantees the direction regardless of what the
      // other rules did in between.
      overridePrices: (ctx) => ladder(ctx.round, allIds.slice(0, risingNeeded), +1),
    },
    {
      id: 'broad-selloff',
      name: `11. ${fallingNeeded} or more stocks fall`,
      description:
        'Prices are walked down a fixed ladder each round so the sentiment rule reliably takes its negative branch.',
      participants: 2,
      overridePrices: (ctx) => ladder(ctx.round, allIds.slice(0, fallingNeeded), -1),
    },
    {
      id: 'mixed-market',
      name: '12. Mixed cross-stock movements',
      description:
        'Some stocks are walked up, some down and the rest held flat, so the sentiment rule stays on its neutral branch while the cross-stock rule still fires.',
      participants: 2,
      overridePrices: (ctx) => {
        // Keep both counts strictly below their thresholds.
        const up = Math.max(0, risingNeeded - 1);
        const down = Math.max(0, fallingNeeded - 1);
        const out: Record<StockId, number> = {
          ...ladder(ctx.round, allIds.slice(0, up), +1),
          ...ladder(ctx.round, allIds.slice(up, up + down), -1),
        };
        // Everything else is pinned flat so it counts as neither.
        for (const id of allIds.slice(up + down)) out[id] = LADDER_BASE;
        return out;
      },
    },
    {
      id: 'full-game',
      name: '13. Full game, realistic trading',
      description:
        'Every configured round is played with participants rotating between stocks, one secret and a mix of buying and selling.',
      participants: 6,
      orders: (ctx) => {
        const orders: SimOrder[] = [];
        for (let i = 0; i < ctx.positions.length; i++) {
          const pos = ctx.positions[i];
          const stock = config.stocks[(ctx.round + i) % config.stocks.length];
          const price = ctx.prices[stock.id];
          if (ctx.round % 3 === 0) {
            const held = pos.shares[stock.id] ?? 0;
            if (held > 0) orders.push({ participant: i, stockId: stock.id, side: 'sell', quantity: Math.min(held, 2) });
          } else if (pos.cash >= price * 2) {
            orders.push({ participant: i, stockId: stock.id, side: 'buy', quantity: 2 });
          }
        }
        return orders;
      },
      secrets: (ctx) =>
        ctx.round === 4 && config.secrets.enabled ? [{ stockId: secretTarget, participant: 0 }] : [],
    },
    {
      id: 'floor-crash',
      name: '14. Market driven to the price floor',
      description:
        'Aggressive accumulation of the holdings-driven stock, which collapses it onto the configured floor. Checks the floor holds everywhere.',
      participants: 6,
      orders: (ctx) => {
        const orders: SimOrder[] = [];
        for (let i = 0; i < ctx.positions.length; i++) {
          const pos = ctx.positions[i];
          const price = ctx.prices[holdingsStock];
          const qty = Math.min(20, Math.floor(pos.cash / Math.max(1, price)));
          if (qty > 0) orders.push({ participant: i, stockId: holdingsStock, side: 'buy', quantity: qty });
        }
        return orders;
      },
    },
    {
      id: 'volume-duel',
      name: '15. Buying-volume duel',
      description:
        'The volume-rule stock and its comparison stock are bought and sold in the same round, so only gross purchases decide the outcome.',
      participants: 4,
      orders: (ctx) => {
        const orders: SimOrder[] = [];
        const price = ctx.prices[volumeStock];
        if (ctx.positions[0].cash >= price * 3)
          orders.push({ participant: 0, stockId: volumeStock, side: 'buy', quantity: 3 });
        const held = ctx.positions[0].shares[volumeStock] ?? 0;
        if (held >= 3) orders.push({ participant: 0, stockId: volumeStock, side: 'sell', quantity: 3 });
        const cmp = config.stocks.find((s) => s.id === volumeStock);
        if (cmp && cmp.rule.template === 'RELATIVE_BUY_VOLUME') {
          const other = cmp.rule.comparisonStockId;
          if (ctx.positions[1].cash >= ctx.prices[other])
            orders.push({ participant: 1, stockId: other, side: 'buy', quantity: 1 });
        }
        return orders;
      },
    },
  ];

  return scenarios;
}

/** The seven quick checks offered as buttons on the simulation screen. */
export function quickTestIds(): string[] {
  return [
    'no-trading',
    'steady-buying',
    'steady-selling',
    'secret-activated',
    'broad-rally',
    'sweet-spot-outside',
    'full-game',
  ];
}

export { CLASSIC_SCRIPTED_PATH_24 };
