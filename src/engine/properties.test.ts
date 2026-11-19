/**
 * Property-based invariants (specification §6.3).
 *
 * Bounded, seeded and reproducible. The point is not to enumerate every
 * numerical value but to assert the handful of things that must hold for
 * any market state the game can reach.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { applyOrder, emptyPosition } from './orders';
import type { Position } from './orders';
import { classicPreset, S } from './preset';
import { previewSettlement } from './preview';
import { secretWindows, isSecretActive } from './secrets';
import { initialPrices, settleRound } from './settle';
import { standardScenarios } from './scenarios';
import { runScenario } from './simulate';
import type { RoundSnapshot, SessionConfig } from './types';

const SEED = 20260419;
const RUNS = 200;
const params = { seed: SEED, numRuns: RUNS, verbose: 0 } as const;

const config = classicPreset();
const ids = config.stocks.map((s) => s.id);

/** An arbitrary but legal market snapshot. */
const arbSnapshot = (cfg: SessionConfig = config): fc.Arbitrary<RoundSnapshot> => {
  const stockIds = cfg.stocks.map((s) => s.id);
  const priceMap = fc.dictionary(fc.constantFrom(...stockIds), fc.integer({ min: cfg.minPrice, max: 500_000 }), {
    minKeys: stockIds.length,
    maxKeys: stockIds.length,
  });
  const countMap = fc.dictionary(fc.constantFrom(...stockIds), fc.integer({ min: 0, max: 5_000 }), {
    minKeys: stockIds.length,
    maxKeys: stockIds.length,
  });
  const boolMap = fc.dictionary(fc.constantFrom(...stockIds), fc.boolean(), {
    minKeys: stockIds.length,
    maxKeys: stockIds.length,
  });
  return fc.record({
    round: fc.integer({ min: 1, max: cfg.rounds - 1 }),
    prices: priceMap,
    previousPrices: priceMap,
    holdings: countMap,
    previousHoldings: countMap,
    grossBuys: countMap,
    grossSells: countMap,
    secretActiveNextRound: boolMap,
  }) as fc.Arbitrary<RoundSnapshot>;
};

describe('invariant: stock prices never fall below the configured floor', () => {
  it('holds for any reachable market state', () => {
    fc.assert(
      fc.property(arbSnapshot(), (snapshot) => {
        const result = settleRound(config, snapshot);
        for (const price of Object.values(result.prices)) {
          expect(price).toBeGreaterThanOrEqual(config.minPrice);
        }
      }),
      params,
    );
  });

  it('holds for a custom floor too', () => {
    const custom: SessionConfig = { ...config, minPrice: 2_500 };
    fc.assert(
      fc.property(arbSnapshot(custom), (snapshot) => {
        for (const price of Object.values(settleRound(custom, snapshot).prices)) {
          expect(price).toBeGreaterThanOrEqual(2_500);
        }
      }),
      params,
    );
  });
});

describe('invariant: price calculations are deterministic', () => {
  it('the same frozen snapshot always produces the same settlement', () => {
    fc.assert(
      fc.property(arbSnapshot(), (snapshot) => {
        const a = settleRound(config, snapshot);
        const b = settleRound(config, structuredClone(snapshot));
        expect(b.prices).toEqual(a.prices);
        expect(b.evaluations.map((e) => [e.branch, e.appliedDelta])).toEqual(
          a.evaluations.map((e) => [e.branch, e.appliedDelta]),
        );
      }),
      params,
    );
  });

  it('every settled price is a whole number of won', () => {
    fc.assert(
      fc.property(arbSnapshot(), (snapshot) => {
        for (const price of Object.values(settleRound(config, snapshot).prices)) {
          expect(Number.isSafeInteger(price)).toBe(true);
        }
      }),
      params,
    );
  });

  it('settlement does not mutate the snapshot it was given', () => {
    fc.assert(
      fc.property(arbSnapshot(), (snapshot) => {
        const copy = structuredClone(snapshot);
        settleRound(config, snapshot);
        expect(snapshot).toEqual(copy);
      }),
      params,
    );
  });
});

describe('invariant: no participant can spend more cash than they have', () => {
  const arbOrder = fc.record({
    side: fc.constantFrom<'buy' | 'sell'>('buy', 'sell'),
    stockId: fc.constantFrom(...ids),
    price: fc.integer({ min: 1, max: 60_000 }),
    quantity: fc.integer({ min: -3, max: 40 }),
  });

  it('cash and share balances stay non-negative over any order sequence', () => {
    fc.assert(
      fc.property(fc.array(arbOrder, { minLength: 1, maxLength: 60 }), (orders) => {
        let pos: Position = emptyPosition(config);
        for (const o of orders) {
          const r = applyOrder(pos, o.side, o.stockId, o.price, o.quantity, config);
          if (r.ok) pos = r.position;
          expect(pos.cash).toBeGreaterThanOrEqual(0);
          for (const q of Object.values(pos.shares)) expect(q).toBeGreaterThanOrEqual(0);
        }
      }),
      params,
    );
  });

  it('a rejected order leaves the position byte-for-byte unchanged', () => {
    fc.assert(
      fc.property(arbOrder, (o) => {
        const pos = emptyPosition(config);
        const before = structuredClone(pos);
        const r = applyOrder(pos, o.side, o.stockId, o.price, o.quantity, config);
        if (!r.ok) expect(r.position).toEqual(before);
      }),
      params,
    );
  });
});

describe('invariant: total holdings equal the sum of participant holdings', () => {
  it('holds across every scenario in the standard pack', () => {
    for (const scenario of standardScenarios(config)) {
      const result = runScenario(config, scenario);
      for (const rec of result.records) {
        for (const id of ids) {
          // The change in aggregate holdings must equal gross buys minus
          // gross sells for that round, with nothing unaccounted for.
          expect(rec.holdings[id] - rec.previousHoldings[id]).toBe(rec.grossBuys[id] - rec.grossSells[id]);
          expect(rec.holdings[id]).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });
});

describe('invariant: a scripted stock never depends on trading', () => {
  it('produces the same price no matter what the market did', () => {
    fc.assert(
      fc.property(arbSnapshot(), (snapshot) => {
        const quiet: RoundSnapshot = {
          ...snapshot,
          holdings: Object.fromEntries(ids.map((i) => [i, 0])),
          previousHoldings: Object.fromEntries(ids.map((i) => [i, 0])),
          grossBuys: Object.fromEntries(ids.map((i) => [i, 0])),
          grossSells: Object.fromEntries(ids.map((i) => [i, 0])),
          secretActiveNextRound: Object.fromEntries(ids.map((i) => [i, false])),
        };
        expect(settleRound(config, quiet).prices[S.ALT_ENT]).toBe(
          settleRound(config, snapshot).prices[S.ALT_ENT],
        );
      }),
      params,
    );
  });
});

describe('invariant: a secret expires at its defined round boundary', () => {
  it('covers exactly `duration` rounds starting the round after activation', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 40 }),
        fc.integer({ min: 1, max: 6 }),
        (activationRound, duration) => {
          const cfg = { ...config.secrets, durationRounds: duration };
          const w = secretWindows(cfg, [{ round: activationRound, stockId: 'x' }]);
          expect(isSecretActive(w, 'x', activationRound)).toBe(false);
          for (let r = activationRound + 1; r <= activationRound + duration; r++) {
            expect(isSecretActive(w, 'x', r)).toBe(true);
          }
          expect(isSecretActive(w, 'x', activationRound + duration + 1)).toBe(false);
        },
      ),
      params,
    );
  });

  it('never lengthens a window just because more tokens were spent at once', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 8 }), (tokens) => {
        const activations = Array.from({ length: tokens }, () => ({ round: 3, stockId: 'x' }));
        const w = secretWindows(config.secrets, activations);
        expect(w).toHaveLength(1);
        expect(w[0].lastRound).toBe(3 + config.secrets.durationRounds);
        expect(w[0].tokensSpent).toBe(tokens);
      }),
      params,
    );
  });
});

describe('invariant: percentage rules scale with the opening price', () => {
  it('doubling the opening price doubles the movement, to within one won of rounding', () => {
    fc.assert(
      fc.property(fc.integer({ min: 200, max: 100_000 }), (base) => {
        const single = previewSettlement(config, {
          prices: { [S.AIRTIGHT]: base },
          previousPrices: { [S.DEFENSE_STEEL]: 1 },
        });
        const double = previewSettlement(config, {
          prices: { [S.AIRTIGHT]: base * 2 },
          previousPrices: { [S.DEFENSE_STEEL]: 1 },
        });
        const d1 = single.evaluations.find((e) => e.stockId === S.AIRTIGHT)!.appliedDelta;
        const d2 = double.evaluations.find((e) => e.stockId === S.AIRTIGHT)!.appliedDelta;
        expect(Math.abs(d2 - d1 * 2)).toBeLessThanOrEqual(1);
      }),
      params,
    );
  });
});

describe('invariant: the initial prices are always legal', () => {
  it('every stock opens at or above the floor', () => {
    const prices = initialPrices(config);
    for (const id of ids) expect(prices[id]).toBeGreaterThanOrEqual(config.minPrice);
  });
});
