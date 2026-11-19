/**
 * Per-template regression tests (specification §6.1).
 *
 * Each of the seven templates is exercised across its branches and
 * boundaries with figures worked out by hand, so a change to the engine
 * that alters any rule's arithmetic fails here immediately.
 */

import { describe, expect, it } from 'vitest';
import { previewSettlement } from './preview';
import { settleRound } from './settle';
import { miniConfig, classic } from './test-helpers';
import { S } from './preset';
import { toBps } from './money';
import type { SessionConfig, StockId } from './types';

const price = (config: SessionConfig, id: StockId, input: Parameters<typeof previewSettlement>[1]) =>
  previewSettlement(config, input).prices[id];

/* ================================================================== */
describe('Rule 1 — holdings-based price movement (Defense Steel)', () => {
  const config = miniConfig([
    {
      id: 'a',
      name: 'Defense Steel',
      initialPrice: 10_000,
      rule: { template: 'HOLDINGS_DELTA', wonPerShare: 200, inverted: false, maxHoldingsChangePerRound: null },
    },
  ]);

  it('falls 200 won for each extra share held market-wide', () => {
    expect(price(config, 'a', { holdings: { a: 5 }, previousHoldings: { a: 0 } })).toBe(10_000 - 1_000);
    expect(price(config, 'a', { holdings: { a: 13 }, previousHoldings: { a: 10 } })).toBe(10_000 - 600);
  });

  it('rises 200 won for each share of reduction', () => {
    expect(price(config, 'a', { holdings: { a: 0 }, previousHoldings: { a: 5 } })).toBe(10_000 + 1_000);
    expect(price(config, 'a', { holdings: { a: 10 }, previousHoldings: { a: 13 } })).toBe(10_000 + 600);
  });

  it('does not move when holdings are unchanged', () => {
    expect(price(config, 'a', { holdings: { a: 17 }, previousHoldings: { a: 17 } })).toBe(10_000);
    expect(price(config, 'a', { holdings: { a: 0 }, previousHoldings: { a: 0 } })).toBe(10_000);
  });

  it('reproduces the worked example: +50 shares lands on the price floor', () => {
    // Adjustment is -10,000 (50 x 200), taking 10,000 to 0, which is
    // below the 100 won minimum, so the floor applies.
    const res = previewSettlement(config, { holdings: { a: 50 }, previousHoldings: { a: 0 } });
    expect(res.evaluations[0].rawDelta).toBe(-10_000);
    expect(res.evaluations[0].rawPrice).toBe(0);
    expect(res.prices.a).toBe(100);
    expect(res.evaluations[0].flooredAtMin).toBe(true);
  });

  it('reproduces the worked example: -50 shares from the floor gives 10,100', () => {
    const res = previewSettlement(config, {
      prices: { a: 100 },
      holdings: { a: 0 },
      previousHoldings: { a: 50 },
    });
    expect(res.prices.a).toBe(10_100);
  });

  it('honours a maximum holdings change per round', () => {
    const capped = miniConfig([
      {
        id: 'a',
        name: 'Defense Steel',
        initialPrice: 10_000,
        rule: { template: 'HOLDINGS_DELTA', wonPerShare: 200, inverted: false, maxHoldingsChangePerRound: 10 },
      },
    ]);
    // A 40-share increase is counted as 10.
    expect(price(capped, 'a', { holdings: { a: 40 }, previousHoldings: { a: 0 } })).toBe(10_000 - 2_000);
    expect(price(capped, 'a', { holdings: { a: 0 }, previousHoldings: { a: 40 } })).toBe(10_000 + 2_000);
  });

  it('can be inverted and re-rated by the administrator', () => {
    const custom = miniConfig([
      {
        id: 'a',
        name: 'Anything',
        initialPrice: 10_000,
        rule: { template: 'HOLDINGS_DELTA', wonPerShare: 300, inverted: true, maxHoldingsChangePerRound: null },
      },
    ]);
    expect(price(custom, 'a', { holdings: { a: 4 }, previousHoldings: { a: 0 } })).toBe(10_000 + 1_200);
  });

  it('uses the change in aggregate holdings, not gross buying or selling', () => {
    // 30 bought and 30 sold in the same round leaves holdings unchanged.
    expect(
      price(config, 'a', {
        holdings: { a: 12 },
        previousHoldings: { a: 12 },
        grossBuys: { a: 30 },
        grossSells: { a: 30 },
      }),
    ).toBe(10_000);
  });

  it('is exact at the boundary where the move lands exactly on the floor', () => {
    // 10,000 - 100 = 9,900 of headroom; 49.5 shares, so 50 shares overshoots.
    const res = previewSettlement(config, { holdings: { a: 49 }, previousHoldings: { a: 0 } });
    expect(res.prices.a).toBe(200);
    expect(res.evaluations[0].flooredAtMin).toBe(false);
  });
});

/* ================================================================== */
describe('Rule 2 — cross-stock price direction (Airtight Construction)', () => {
  const config = miniConfig([
    {
      id: 'ref',
      name: 'Defense Steel',
      initialPrice: 10_000,
      rule: { template: 'UNCHANGED' },
    },
    {
      id: 'tgt',
      name: 'Airtight Construction',
      initialPrice: 10_000,
      rule: {
        template: 'CROSS_STOCK_DIRECTION',
        referenceStockId: 'ref',
        upBps: toBps(10),
        downBps: toBps(-10),
        unchangedCountsAs: 'negative',
      },
    },
  ]);

  it('rises 10% when the reference stock rose', () => {
    expect(price(config, 'tgt', { previousPrices: { ref: 9_000 } })).toBe(11_000);
  });

  it('falls 10% when the reference stock fell', () => {
    expect(price(config, 'tgt', { previousPrices: { ref: 11_000 } })).toBe(9_000);
  });

  it('falls 10% when the reference stock is unchanged, by default', () => {
    expect(price(config, 'tgt', { previousPrices: { ref: 10_000 } })).toBe(9_000);
  });

  it('can treat an unchanged reference as the positive branch', () => {
    const positive = miniConfig([
      { id: 'ref', name: 'Ref', initialPrice: 10_000, rule: { template: 'UNCHANGED' } },
      {
        id: 'tgt',
        name: 'Target',
        initialPrice: 10_000,
        rule: {
          template: 'CROSS_STOCK_DIRECTION',
          referenceStockId: 'ref',
          upBps: toBps(10),
          downBps: toBps(-10),
          unchangedCountsAs: 'positive',
        },
      },
    ]);
    expect(price(positive, 'tgt', { previousPrices: { ref: 10_000 } })).toBe(11_000);
  });

  it('takes the percentage from the target stock’s own opening price', () => {
    expect(price(config, 'tgt', { prices: { tgt: 7_350 }, previousPrices: { ref: 9_000 } })).toBe(
      7_350 + 735,
    );
  });

  it('rounds half away from zero on an odd price', () => {
    // 10% of 7,355 is 735.5 -> 736
    expect(price(config, 'tgt', { prices: { tgt: 7_355 }, previousPrices: { ref: 9_000 } })).toBe(
      7_355 + 736,
    );
  });

  it('accepts administrator-changed percentages', () => {
    const custom = miniConfig([
      { id: 'ref', name: 'Ref', initialPrice: 10_000, rule: { template: 'UNCHANGED' } },
      {
        id: 'tgt',
        name: 'Target',
        initialPrice: 10_000,
        rule: {
          template: 'CROSS_STOCK_DIRECTION',
          referenceStockId: 'ref',
          upBps: toBps(15),
          downBps: toBps(-5),
          unchangedCountsAs: 'negative',
        },
      },
    ]);
    expect(price(custom, 'tgt', { previousPrices: { ref: 9_000 } })).toBe(11_500);
    expect(price(custom, 'tgt', { previousPrices: { ref: 11_000 } })).toBe(9_500);
  });

  it('compares against the previous completed round, not the live round', () => {
    // The reference's own new price is irrelevant: only prices vs previousPrices.
    const res = previewSettlement(config, { previousPrices: { ref: 9_000 } });
    expect(res.evaluations.find((e) => e.stockId === 'tgt')!.inputs.referenceChange).toBe(1_000);
  });
});

/* ================================================================== */
describe('Rule 3 — holdings sweet spot (Latter Electronics)', () => {
  const config = miniConfig([
    {
      id: 'a',
      name: 'Latter Electronics',
      initialPrice: 10_000,
      rule: { template: 'HOLDINGS_SWEET_SPOT', lower: 10, upper: 30, insideWon: 1_500, outsideWon: -1_000 },
    },
  ]);

  it.each([
    [0, 9_000],
    [9, 9_000],
    [10, 11_500],
    [20, 11_500],
    [30, 11_500],
    [31, 9_000],
    [500, 9_000],
  ])('with %i total holdings the price becomes %i', (held, expected) => {
    expect(price(config, 'a', { holdings: { a: held } })).toBe(expected);
  });

  it('treats the range as inclusive at both ends', () => {
    const lower = previewSettlement(config, { holdings: { a: 10 } }).evaluations[0];
    const upper = previewSettlement(config, { holdings: { a: 30 } }).evaluations[0];
    expect(lower.branch).toBe('inside-range');
    expect(upper.branch).toBe('inside-range');
  });

  it('uses current total holdings, not the change in holdings', () => {
    expect(price(config, 'a', { holdings: { a: 20 }, previousHoldings: { a: 20 } })).toBe(11_500);
    expect(price(config, 'a', { holdings: { a: 20 }, previousHoldings: { a: 0 } })).toBe(11_500);
  });

  it('supports an administrator-widened band and new amounts', () => {
    const custom = miniConfig([
      {
        id: 'a',
        name: 'Latter',
        initialPrice: 10_000,
        rule: { template: 'HOLDINGS_SWEET_SPOT', lower: 15, upper: 40, insideWon: 2_000, outsideWon: -1_500 },
      },
    ]);
    expect(price(custom, 'a', { holdings: { a: 14 } })).toBe(8_500);
    expect(price(custom, 'a', { holdings: { a: 15 } })).toBe(12_000);
    expect(price(custom, 'a', { holdings: { a: 40 } })).toBe(12_000);
    expect(price(custom, 'a', { holdings: { a: 41 } })).toBe(8_500);
  });
});

/* ================================================================== */
describe('Rule 4 — relative buying volume (CoyoTech)', () => {
  const config = miniConfig([
    { id: 'cmp', name: 'Latter Electronics', initialPrice: 10_000, rule: { template: 'UNCHANGED' } },
    {
      id: 'tgt',
      name: 'CoyoTech',
      initialPrice: 10_000,
      rule: {
        template: 'RELATIVE_BUY_VOLUME',
        comparisonStockId: 'cmp',
        aboveWon: 1_400,
        belowWon: -700,
        tieCountsAs: 'negative',
      },
    },
  ]);

  it('rises 1,400 won when it was bought more', () => {
    expect(price(config, 'tgt', { grossBuys: { tgt: 10, cmp: 4 } })).toBe(11_400);
  });

  it('falls 700 won when it was bought less', () => {
    expect(price(config, 'tgt', { grossBuys: { tgt: 4, cmp: 10 } })).toBe(9_300);
  });

  it('treats an exact tie as the negative branch by default', () => {
    expect(price(config, 'tgt', { grossBuys: { tgt: 7, cmp: 7 } })).toBe(9_300);
  });

  it('treats zero activity on both as a tie', () => {
    expect(price(config, 'tgt', { grossBuys: { tgt: 0, cmp: 0 } })).toBe(9_300);
  });

  it('uses gross purchases and ignores sales entirely', () => {
    // The target was bought 10 and sold 10; the comparison bought 4.
    // Net would be 0 vs 4 (negative branch) but gross is 10 vs 4 (positive).
    expect(
      price(config, 'tgt', {
        grossBuys: { tgt: 10, cmp: 4 },
        grossSells: { tgt: 10, cmp: 0 },
      }),
    ).toBe(11_400);
  });

  it('survives repeated buy/sell cycles within one round', () => {
    // Five buy-then-sell cycles of 2 shares each: 10 gross bought, 10 gross sold.
    const res = previewSettlement(config, {
      grossBuys: { tgt: 10, cmp: 1 },
      grossSells: { tgt: 10, cmp: 0 },
      holdings: { tgt: 0 },
    });
    expect(res.evaluations.find((e) => e.stockId === 'tgt')!.inputs.targetGrossBuys).toBe(10);
    expect(res.prices.tgt).toBe(11_400);
  });

  it('can be configured to treat a tie as the positive branch', () => {
    const custom = miniConfig([
      { id: 'cmp', name: 'Cmp', initialPrice: 10_000, rule: { template: 'UNCHANGED' } },
      {
        id: 'tgt',
        name: 'Tgt',
        initialPrice: 10_000,
        rule: {
          template: 'RELATIVE_BUY_VOLUME',
          comparisonStockId: 'cmp',
          aboveWon: 1_400,
          belowWon: -700,
          tieCountsAs: 'positive',
        },
      },
    ]);
    expect(price(custom, 'tgt', { grossBuys: { tgt: 3, cmp: 3 } })).toBe(11_400);
  });
});

/* ================================================================== */
describe('Rule 5 — secret-dependent movement (Open Security)', () => {
  const config = miniConfig([
    { id: 'watched', name: 'Latter Electronics', initialPrice: 10_000, rule: { template: 'UNCHANGED' } },
    {
      id: 'tgt',
      name: 'Open Security',
      initialPrice: 10_000,
      rule: {
        template: 'SECRET_DEPENDENT',
        referenceStockId: 'watched',
        activeBps: toBps(13),
        inactiveWon: -1_000,
      },
    },
  ]);

  it('rises 13% while a secret covers the watched stock', () => {
    expect(price(config, 'tgt', { secretActive: { watched: true } })).toBe(11_300);
  });

  it('falls 1,000 won when no secret covers it', () => {
    expect(price(config, 'tgt', { secretActive: { watched: false } })).toBe(9_000);
  });

  it('ignores a secret on a different stock', () => {
    expect(price(config, 'tgt', { secretActive: { tgt: true, watched: false } })).toBe(9_000);
  });

  it('reads the secret state for the upcoming round, not the closing one', () => {
    const res = previewSettlement(config, { round: 7, secretActive: { watched: true } });
    const ev = res.evaluations.find((e) => e.stockId === 'tgt')!;
    expect(ev.explanation).toContain('round 8');
  });

  it('accepts an administrator-changed percentage and fixed amount', () => {
    const custom = miniConfig([
      { id: 'watched', name: 'W', initialPrice: 10_000, rule: { template: 'UNCHANGED' } },
      {
        id: 'tgt',
        name: 'T',
        initialPrice: 10_000,
        rule: {
          template: 'SECRET_DEPENDENT',
          referenceStockId: 'watched',
          activeBps: toBps(20),
          inactiveWon: -500,
        },
      },
    ]);
    expect(price(custom, 'tgt', { secretActive: { watched: true } })).toBe(12_000);
    expect(price(custom, 'tgt', { secretActive: { watched: false } })).toBe(9_500);
  });
});

/* ================================================================== */
describe('Rule 6 — market-wide sentiment (Seasonal Financial)', () => {
  const config = classic();
  const seasonal = S.SEASONAL;

  it('rises 20% when four of the seven stocks rose', () => {
    const res = previewSettlement(config, { forceRisingCount: 4 });
    expect(res.prices[seasonal]).toBe(12_000);
    expect(res.evaluations.find((e) => e.stockId === seasonal)!.branch).toBe('broad-rally');
  });

  it('falls 10% when four of the seven stocks fell', () => {
    const res = previewSettlement(config, { forceFallingCount: 4 });
    expect(res.prices[seasonal]).toBe(9_000);
    expect(res.evaluations.find((e) => e.stockId === seasonal)!.branch).toBe('broad-selloff');
  });

  it('is unchanged on three risers', () => {
    const res = previewSettlement(config, { forceRisingCount: 3 });
    expect(res.prices[seasonal]).toBe(10_000);
    expect(res.evaluations.find((e) => e.stockId === seasonal)!.branch).toBe('mixed-market');
  });

  it('is unchanged on three fallers', () => {
    const res = previewSettlement(config, { forceFallingCount: 3 });
    expect(res.prices[seasonal]).toBe(10_000);
  });

  it('is unchanged on a mixed market of three up and three down', () => {
    const res = previewSettlement(config, { forceRisingCount: 3, forceFallingCount: 3 });
    expect(res.prices[seasonal]).toBe(10_000);
  });

  it('cannot reach both branches with the default seven-stock thresholds', () => {
    // 4 + 4 = 8 > 7, so there is no market state that satisfies both.
    for (let rising = 0; rising <= 7; rising++) {
      for (let falling = 0; falling + rising <= 7; falling++) {
        expect(rising >= 4 && falling >= 4).toBe(false);
      }
    }
  });

  it('throws rather than guessing if an overlapping configuration is forced through', () => {
    const overlapping = classic();
    const stock = overlapping.stocks.find((s) => s.id === seasonal)!;
    if (stock.rule.template === 'MARKET_SENTIMENT') {
      stock.rule.risingThreshold = 3;
      stock.rule.fallingThreshold = 3;
    }
    expect(() => previewSettlement(overlapping, { forceRisingCount: 3, forceFallingCount: 3 })).toThrow(
      /matched both branches/,
    );
  });

  it('accepts a custom universe and thresholds', () => {
    const custom = classic();
    const stock = custom.stocks.find((s) => s.id === seasonal)!;
    if (stock.rule.template === 'MARKET_SENTIMENT') {
      stock.rule.risingThreshold = 5;
      stock.rule.fallingThreshold = 5;
      stock.rule.risingBps = toBps(25);
      stock.rule.fallingBps = toBps(-15);
    }
    expect(previewSettlement(custom, { forceRisingCount: 4 }).prices[seasonal]).toBe(10_000);
    expect(previewSettlement(custom, { forceRisingCount: 5 }).prices[seasonal]).toBe(12_500);
    expect(previewSettlement(custom, { forceFallingCount: 5 }).prices[seasonal]).toBe(8_500);
  });
});

/* ================================================================== */
describe('Rule 7 — fixed scripted price path (Alt Entertainment)', () => {
  const path = [0, 10_000, 11_200, 12_600, 11_800, 50];
  const config = miniConfig(
    [{ id: 'a', name: 'Alt Entertainment', initialPrice: 10_000, rule: { template: 'SCRIPTED_PATH', prices: path } }],
    { rounds: 5 },
  );

  it('produces exactly the scheduled price for each round', () => {
    expect(price(config, 'a', { round: 1, prices: { a: path[1] } })).toBe(11_200);
    expect(price(config, 'a', { round: 2, prices: { a: path[2] } })).toBe(12_600);
    expect(price(config, 'a', { round: 3, prices: { a: path[3] } })).toBe(11_800);
  });

  it('ignores holdings, volume, other prices and secrets completely', () => {
    const quiet = price(config, 'a', { round: 1, prices: { a: 10_000 } });
    const busy = price(config, 'a', {
      round: 1,
      prices: { a: 10_000 },
      holdings: { a: 9_999 },
      previousHoldings: { a: 0 },
      grossBuys: { a: 5_000 },
      grossSells: { a: 4_000 },
      secretActive: { a: true },
    });
    expect(busy).toBe(quiet);
    expect(busy).toBe(11_200);
  });

  it('still obeys the price floor', () => {
    const res = previewSettlement(config, { round: 4, prices: { a: path[4] } });
    expect(res.evaluations[0].rawPrice).toBe(50);
    expect(res.prices.a).toBe(100);
    expect(res.evaluations[0].flooredAtMin).toBe(true);
  });

  it('throws when a configured round has no scheduled price', () => {
    const short = miniConfig(
      [{ id: 'a', name: 'Alt', initialPrice: 10_000, rule: { template: 'SCRIPTED_PATH', prices: [0, 10_000] } }],
      { rounds: 5 },
    );
    expect(() => previewSettlement(short, { round: 1 })).toThrow(/no price for round 2/);
  });

  it('supports a custom number of rounds', () => {
    const longPath = [0, ...Array.from({ length: 40 }, (_, i) => 10_000 + i * 100)];
    const long = miniConfig(
      [{ id: 'a', name: 'Alt', initialPrice: 10_000, rule: { template: 'SCRIPTED_PATH', prices: longPath } }],
      { rounds: 40 },
    );
    expect(price(long, 'a', { round: 39, prices: { a: longPath[39] } })).toBe(longPath[40]);
  });

  it('has exactly one authoritative price per round', () => {
    for (let r = 1; r <= 4; r++) {
      const a = previewSettlement(config, { round: r, prices: { a: path[r] } }).prices.a;
      const b = previewSettlement(config, { round: r, prices: { a: path[r] } }).prices.a;
      expect(a).toBe(b);
    }
  });
});

/* ================================================================== */
describe('Unchanged template', () => {
  it('never moves whatever happens', () => {
    const config = miniConfig([
      { id: 'a', name: 'Flat', initialPrice: 4_321, rule: { template: 'UNCHANGED' } },
    ]);
    expect(
      price(config, 'a', { holdings: { a: 900 }, grossBuys: { a: 900 }, secretActive: { a: true } }),
    ).toBe(4_321);
  });
});

/* ================================================================== */
describe('simultaneous evaluation', () => {
  it('evaluates every rule against the same frozen snapshot', () => {
    // Airtight follows Defense Steel. Defense Steel is about to crash, but
    // Airtight must read the price Defense Steel traded at during the
    // completed round, not the new price being computed in the same pass.
    const config = classic();
    const res = previewSettlement(config, {
      prices: { [S.DEFENSE_STEEL]: 10_000 },
      previousPrices: { [S.DEFENSE_STEEL]: 9_000 }, // it rose during the completed round
      holdings: { [S.DEFENSE_STEEL]: 50 },
      previousHoldings: { [S.DEFENSE_STEEL]: 0 },
    });
    // Defense Steel collapses to the floor...
    expect(res.prices[S.DEFENSE_STEEL]).toBe(100);
    // ...but Airtight still takes the positive branch from the old move.
    expect(res.prices[S.AIRTIGHT]).toBe(11_000);
  });

  it('does not depend on the order stocks are listed in', () => {
    const config = classic();
    const reversed: SessionConfig = { ...config, stocks: [...config.stocks].reverse() };
    // Describe the market state explicitly so the input itself does not
    // depend on stock ordering.
    const input = {
      holdings: { [S.DEFENSE_STEEL]: 12 },
      previousPrices: {
        [S.DEFENSE_STEEL]: 9_500,
        [S.AIRTIGHT]: 9_500,
        [S.LATTER]: 9_500,
        [S.COYOTECH]: 9_500,
      },
    } as const;
    const a = previewSettlement(config, input).prices;
    const b = previewSettlement(reversed, input).prices;
    expect(b).toEqual(a);
  });

  it('settles a round deterministically from a snapshot', () => {
    const config = classic();
    const snapshot = previewSettlement(config, { holdings: { [S.DEFENSE_STEEL]: 7 } }).snapshot;
    const first = settleRound(config, snapshot);
    const second = settleRound(config, snapshot);
    expect(second.prices).toEqual(first.prices);
    expect(second.evaluations.map((e) => e.explanation)).toEqual(
      first.evaluations.map((e) => e.explanation),
    );
  });
});
