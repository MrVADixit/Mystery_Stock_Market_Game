import { describe, expect, it } from 'vitest';
import { applyOrder, emptyPosition, holdingsValue, maxBuyQuantity, maxSellQuantity, totalAssets } from './orders';
import { classic } from './test-helpers';
import { S } from './preset';

const config = classic();

describe('orders', () => {
  it('starts every participant with the configured cash and no shares', () => {
    const p = emptyPosition(config);
    expect(p.cash).toBe(100_000);
    expect(Object.values(p.shares).every((q) => q === 0)).toBe(true);
  });

  it('buys and deducts exactly price x quantity', () => {
    const p = emptyPosition(config);
    const r = applyOrder(p, 'buy', S.DEFENSE_STEEL, 10_000, 3, config);
    expect(r.ok).toBe(true);
    expect(r.amount).toBe(30_000);
    expect(r.position.cash).toBe(70_000);
    expect(r.position.shares[S.DEFENSE_STEEL]).toBe(3);
    // The original position is untouched.
    expect(p.cash).toBe(100_000);
  });

  it('refuses to spend more cash than is available', () => {
    const p = emptyPosition(config);
    const r = applyOrder(p, 'buy', S.DEFENSE_STEEL, 10_000, 11, config);
    expect(r.ok).toBe(false);
    expect(r.rejection).toBe('INSUFFICIENT_CASH');
    expect(r.position.cash).toBe(100_000);
  });

  it('allows spending the last won exactly', () => {
    const p = emptyPosition(config);
    const r = applyOrder(p, 'buy', S.DEFENSE_STEEL, 10_000, 10, config);
    expect(r.ok).toBe(true);
    expect(r.position.cash).toBe(0);
  });

  it('refuses to oversell', () => {
    let p = emptyPosition(config);
    p = applyOrder(p, 'buy', S.DEFENSE_STEEL, 10_000, 2, config).position;
    const r = applyOrder(p, 'sell', S.DEFENSE_STEEL, 10_000, 3, config);
    expect(r.ok).toBe(false);
    expect(r.rejection).toBe('INSUFFICIENT_SHARES');
  });

  it('never allows a short position', () => {
    const p = emptyPosition(config);
    const r = applyOrder(p, 'sell', S.DEFENSE_STEEL, 10_000, 1, config);
    expect(r.ok).toBe(false);
    expect(r.position.shares[S.DEFENSE_STEEL]).toBe(0);
  });

  it('returns cash raised by a sale for reuse', () => {
    let p = emptyPosition(config);
    p = applyOrder(p, 'buy', S.DEFENSE_STEEL, 10_000, 10, config).position;
    expect(p.cash).toBe(0);
    p = applyOrder(p, 'sell', S.DEFENSE_STEEL, 12_000, 10, config).position;
    expect(p.cash).toBe(120_000);
  });

  it('rejects non-integer and non-positive quantities', () => {
    const p = emptyPosition(config);
    for (const q of [0, -1, 1.5, Number.NaN]) {
      expect(applyOrder(p, 'buy', S.DEFENSE_STEEL, 100, q, config).rejection).toBe('QUANTITY_INVALID');
    }
  });

  it('rejects unknown stocks', () => {
    const p = emptyPosition(config);
    expect(applyOrder(p, 'buy', 'nope', 100, 1, config).rejection).toBe('UNKNOWN_STOCK');
  });

  it('computes MAX BUY as the largest affordable whole quantity', () => {
    const p = { ...emptyPosition(config), cash: 35_500 };
    expect(maxBuyQuantity(p, S.DEFENSE_STEEL, 10_000, config)).toBe(3);
    expect(maxBuyQuantity(p, S.DEFENSE_STEEL, 35_500, config)).toBe(1);
    expect(maxBuyQuantity(p, S.DEFENSE_STEEL, 35_501, config)).toBe(0);
  });

  it('computes ALL as the full holding for selling', () => {
    let p = emptyPosition(config);
    p = applyOrder(p, 'buy', S.LATTER, 1_000, 7, config).position;
    expect(maxSellQuantity(p, S.LATTER, config)).toBe(7);
  });

  it('respects a per-order share cap', () => {
    const capped = classic({ trading: { maxSharesPerOrder: 5, maxSharesPerParticipantPerStock: null } });
    const p = emptyPosition(capped);
    expect(applyOrder(p, 'buy', S.DEFENSE_STEEL, 1_000, 6, capped).rejection).toBe('ORDER_CAP_EXCEEDED');
    expect(applyOrder(p, 'buy', S.DEFENSE_STEEL, 1_000, 5, capped).ok).toBe(true);
    expect(maxBuyQuantity(p, S.DEFENSE_STEEL, 1_000, capped)).toBe(5);
  });

  it('respects a per-participant position cap', () => {
    const capped = classic({ trading: { maxSharesPerOrder: null, maxSharesPerParticipantPerStock: 4 } });
    let p = emptyPosition(capped);
    p = applyOrder(p, 'buy', S.DEFENSE_STEEL, 1_000, 4, capped).position;
    expect(applyOrder(p, 'buy', S.DEFENSE_STEEL, 1_000, 1, capped).rejection).toBe('POSITION_CAP_EXCEEDED');
    expect(maxBuyQuantity(p, S.DEFENSE_STEEL, 1_000, capped)).toBe(0);
  });

  it('values a portfolio as cash plus holdings at current prices', () => {
    let p = emptyPosition(config);
    p = applyOrder(p, 'buy', S.DEFENSE_STEEL, 10_000, 3, config).position;
    p = applyOrder(p, 'buy', S.LATTER, 10_000, 5, config).position;
    const prices = { [S.DEFENSE_STEEL]: 12_000, [S.LATTER]: 8_000 };
    expect(holdingsValue(p, prices)).toBe(3 * 12_000 + 5 * 8_000);
    expect(totalAssets(p, prices)).toBe(20_000 + 36_000 + 40_000);
  });

  it('records the before/after figures the audit trail needs', () => {
    let p = emptyPosition(config);
    p = applyOrder(p, 'buy', S.COYOTECH, 10_000, 2, config).position;
    const r = applyOrder(p, 'sell', S.COYOTECH, 11_000, 1, config);
    expect(r.cashBefore).toBe(80_000);
    expect(r.cashAfter).toBe(91_000);
    expect(r.sharesBefore).toBe(2);
    expect(r.sharesAfter).toBe(1);
    expect(r.amount).toBe(11_000);
  });
});
