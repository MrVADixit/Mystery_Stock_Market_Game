/**
 * Order validation and application.
 *
 * The live trading endpoint and the simulator both go through this module,
 * so a simulated market obeys exactly the same cash and holdings rules a
 * real participant does. Nothing here touches the database; the caller
 * supplies the position and persists the result.
 */

import type { SessionConfig, StockId } from './types';

export type Side = 'buy' | 'sell';

export interface Position {
  cash: number;
  shares: Record<StockId, number>;
}

export type OrderRejection =
  | 'QUANTITY_INVALID'
  | 'INSUFFICIENT_CASH'
  | 'INSUFFICIENT_SHARES'
  | 'ORDER_CAP_EXCEEDED'
  | 'POSITION_CAP_EXCEEDED'
  | 'UNKNOWN_STOCK';

export interface OrderResult {
  ok: boolean;
  rejection?: OrderRejection;
  message?: string;
  /** The resulting position. Unchanged when the order is rejected. */
  position: Position;
  /** Total won moved. Positive cash out for a buy, cash in for a sell. */
  amount: number;
  cashBefore: number;
  cashAfter: number;
  sharesBefore: number;
  sharesAfter: number;
}

/** Largest whole quantity this position can afford at `price`. */
export function maxBuyQuantity(
  position: Position,
  stockId: StockId,
  price: number,
  config: SessionConfig,
): number {
  if (price <= 0) return 0;
  let qty = Math.floor(position.cash / price);
  const orderCap = config.trading.maxSharesPerOrder;
  if (orderCap != null) qty = Math.min(qty, orderCap);
  const positionCap = config.trading.maxSharesPerParticipantPerStock;
  if (positionCap != null) {
    qty = Math.min(qty, Math.max(0, positionCap - (position.shares[stockId] ?? 0)));
  }
  return Math.max(0, qty);
}

/** Everything this position currently holds of `stockId`. */
export function maxSellQuantity(position: Position, stockId: StockId, config: SessionConfig): number {
  let qty = position.shares[stockId] ?? 0;
  const orderCap = config.trading.maxSharesPerOrder;
  if (orderCap != null) qty = Math.min(qty, orderCap);
  return Math.max(0, qty);
}

/**
 * Validates and applies one order. Returns a new position; the input is
 * never mutated. Short selling and buying on credit are impossible by
 * construction — there is no code path that produces a negative balance.
 */
export function applyOrder(
  position: Position,
  side: Side,
  stockId: StockId,
  price: number,
  quantity: number,
  config: SessionConfig,
): OrderResult {
  const sharesBefore = position.shares[stockId] ?? 0;
  const base: Omit<OrderResult, 'ok'> = {
    position,
    amount: 0,
    cashBefore: position.cash,
    cashAfter: position.cash,
    sharesBefore,
    sharesAfter: sharesBefore,
  };

  if (!config.stocks.some((s) => s.id === stockId)) {
    return { ...base, ok: false, rejection: 'UNKNOWN_STOCK', message: 'That stock is not in this game.' };
  }
  if (!Number.isSafeInteger(quantity) || quantity < 1) {
    return { ...base, ok: false, rejection: 'QUANTITY_INVALID', message: 'Quantity must be a whole number of at least 1.' };
  }
  const orderCap = config.trading.maxSharesPerOrder;
  if (orderCap != null && quantity > orderCap) {
    return {
      ...base,
      ok: false,
      rejection: 'ORDER_CAP_EXCEEDED',
      message: `This game allows at most ${orderCap} shares in one order.`,
    };
  }

  const amount = price * quantity;

  if (side === 'buy') {
    if (amount > position.cash) {
      return {
        ...base,
        ok: false,
        rejection: 'INSUFFICIENT_CASH',
        message: `That costs ${amount.toLocaleString('en-US')} won but you only have ${position.cash.toLocaleString('en-US')} won.`,
      };
    }
    const positionCap = config.trading.maxSharesPerParticipantPerStock;
    if (positionCap != null && sharesBefore + quantity > positionCap) {
      return {
        ...base,
        ok: false,
        rejection: 'POSITION_CAP_EXCEEDED',
        message: `This game allows at most ${positionCap} shares of one stock per participant.`,
      };
    }
    const next: Position = {
      cash: position.cash - amount,
      shares: { ...position.shares, [stockId]: sharesBefore + quantity },
    };
    return {
      ok: true,
      position: next,
      amount,
      cashBefore: position.cash,
      cashAfter: next.cash,
      sharesBefore,
      sharesAfter: sharesBefore + quantity,
    };
  }

  // Sell
  if (quantity > sharesBefore) {
    return {
      ...base,
      ok: false,
      rejection: 'INSUFFICIENT_SHARES',
      message: `You hold ${sharesBefore} share${sharesBefore === 1 ? '' : 's'}, so you cannot sell ${quantity}.`,
    };
  }
  const next: Position = {
    cash: position.cash + amount,
    shares: { ...position.shares, [stockId]: sharesBefore - quantity },
  };
  return {
    ok: true,
    position: next,
    amount,
    cashBefore: position.cash,
    cashAfter: next.cash,
    sharesBefore,
    sharesAfter: sharesBefore - quantity,
  };
}

/** Market value of the holdings plus cash. */
export function totalAssets(position: Position, prices: Record<StockId, number>): number {
  let total = position.cash;
  for (const [id, qty] of Object.entries(position.shares)) {
    total += (prices[id] ?? 0) * qty;
  }
  return total;
}

export function holdingsValue(position: Position, prices: Record<StockId, number>): number {
  let total = 0;
  for (const [id, qty] of Object.entries(position.shares)) {
    total += (prices[id] ?? 0) * qty;
  }
  return total;
}

export function emptyPosition(config: SessionConfig): Position {
  const shares: Record<StockId, number> = {};
  for (const s of config.stocks) shares[s.id] = 0;
  return { cash: config.startingCash, shares };
}
