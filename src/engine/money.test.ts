import { describe, expect, it } from 'vitest';
import { BPS, clampPrice, formatWon, MoneyError, pctDelta, toBps, fromBps } from './money';

describe('money', () => {
  it('converts percentages to basis points exactly', () => {
    expect(toBps(10)).toBe(1000);
    expect(toBps(13)).toBe(1300);
    expect(toBps(-10)).toBe(-1000);
    expect(toBps(20)).toBe(2000);
    expect(toBps(0.5)).toBe(50);
    expect(fromBps(1300)).toBe(13);
  });

  it('rejects precision finer than 0.01%', () => {
    expect(() => toBps(10.001)).toThrow(MoneyError);
  });

  it('computes percentage movements with half-away-from-zero rounding', () => {
    expect(pctDelta(10_000, 1300)).toBe(1300);
    expect(pctDelta(10_000, -1000)).toBe(-1000);
    expect(pctDelta(10_000, 2000)).toBe(2000);
    // 10001 * 13% = 1300.13 -> 1300
    expect(pctDelta(10_001, 1300)).toBe(1300);
    // 10050 * -10% = -1005 exactly
    expect(pctDelta(10_050, -1000)).toBe(-1005);
    // 5 * 10% = 0.5 -> rounds away from zero
    expect(pctDelta(5, 1000)).toBe(1);
    expect(pctDelta(5, -1000)).toBe(-1);
    expect(pctDelta(1234, 0)).toBe(0);
  });

  it('never produces a fractional won', () => {
    for (let price = 100; price < 3000; price += 7) {
      for (const bps of [1300, -1000, 2000, 333, -1]) {
        expect(Number.isInteger(pctDelta(price, bps))).toBe(true);
      }
    }
  });

  it('is exact where floating point is not', () => {
    // 0.1 + 0.2 !== 0.3 in binary floating point; basis points avoid it.
    expect(pctDelta(10_000, toBps(0.1)) + pctDelta(10_000, toBps(0.2))).toBe(
      pctDelta(10_000, toBps(0.3)),
    );
  });

  it('clamps to the floor and optional ceiling', () => {
    expect(clampPrice(-5_000, 100, null)).toBe(100);
    expect(clampPrice(50, 100, null)).toBe(100);
    expect(clampPrice(100, 100, null)).toBe(100);
    expect(clampPrice(9_999, 100, null)).toBe(9_999);
    expect(clampPrice(50_000, 100, 20_000)).toBe(20_000);
  });

  it('formats won with thousands separators', () => {
    expect(formatWon(112_450)).toBe('112,450');
    expect(formatWon(-10_000)).toBe('-10,000');
    expect(formatWon(0)).toBe('0');
  });

  it('defines one hundred percent as ten thousand basis points', () => {
    expect(BPS).toBe(10_000);
    expect(pctDelta(777, BPS)).toBe(777);
  });
});
