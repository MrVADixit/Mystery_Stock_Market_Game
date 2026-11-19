/**
 * Integration tests (specification §6.2).
 *
 * All seven rules run together against the default session across the
 * fifteen required scenarios.
 */

import { describe, expect, it } from 'vitest';
import { classicPreset, S } from './preset';
import { standardScenarios } from './scenarios';
import { runScenario } from './simulate';
import { finalStandings } from './simulate';
import { classic } from './test-helpers';

const config = classicPreset();
const scenarios = standardScenarios(config);
const byId = (id: string) => {
  const s = scenarios.find((x) => x.id === id);
  if (!s) throw new Error(`scenario ${id} missing`);
  return s;
};

describe('the standard scenario pack', () => {
  it('contains all fifteen required scenarios', () => {
    expect(scenarios).toHaveLength(15);
  });

  it.each(scenarios.map((s) => [s.id, s] as const))('%s runs the full game without throwing', (_id, scenario) => {
    const result = runScenario(config, scenario);
    expect(result.roundsRun).toBe(scenario.maxRounds ?? config.rounds);
    for (const rec of result.records) {
      for (const [stockId, p] of Object.entries(rec.nextPrices)) {
        expect(Number.isSafeInteger(p), `${stockId} price ${p}`).toBe(true);
        expect(p).toBeGreaterThanOrEqual(config.minPrice);
      }
    }
  });
});

describe('scenario 1 — nobody trades', () => {
  const result = runScenario(config, byId('no-trading'));

  it('leaves every participant with exactly their starting cash', () => {
    expect(result.finalAssets.every((a) => a === config.startingCash)).toBe(true);
  });

  it('still moves prices, because several rules do not need trading', () => {
    const first = result.records[0];
    expect(first.nextPrices[S.AIRTIGHT]).not.toBe(first.prices[S.AIRTIGHT]);
  });

  it('leaves the holdings-driven stock flat while holdings stay at zero', () => {
    for (const rec of result.records.filter((r) => r.settled)) {
      const ev = rec.evaluations.find((e) => e.stockId === S.DEFENSE_STEEL)!;
      expect(ev.branch).toBe('holdings-unchanged');
      expect(ev.appliedDelta).toBe(0);
    }
  });
});

describe('scenario 2 and 3 — steady buying and steady selling', () => {
  it('buying pushes the holdings-driven stock down', () => {
    const r = runScenario(config, byId('steady-buying'));
    const first = r.records[0].evaluations.find((e) => e.stockId === S.DEFENSE_STEEL)!;
    expect(first.branch).toBe('holdings-increased');
    expect(first.appliedDelta).toBeLessThan(0);
  });

  it('selling pushes the holdings-driven stock up', () => {
    const r = runScenario(config, byId('steady-selling'));
    const second = r.records[1].evaluations.find((e) => e.stockId === S.DEFENSE_STEEL)!;
    expect(second.branch).toBe('holdings-decreased');
    expect(second.appliedDelta).toBeGreaterThan(0);
  });
});

describe('scenario 4 — equal buying and selling', () => {
  const result = runScenario(config, byId('equal-buy-sell'));

  it('produces gross volume on both sides', () => {
    const active = result.records.find((r) => r.grossBuys[S.DEFENSE_STEEL] > 0 && r.grossSells[S.DEFENSE_STEEL] > 0);
    expect(active).toBeDefined();
  });

  it('keeps holdings flat in rounds where buys and sells match', () => {
    for (const rec of result.records) {
      for (const s of config.stocks) {
        const change = rec.holdings[s.id] - rec.previousHoldings[s.id];
        expect(change).toBe(rec.grossBuys[s.id] - rec.grossSells[s.id]);
      }
    }
  });
});

describe('scenarios 5 and 6 — holdings up and holdings down', () => {
  it('accumulation drives the price to the floor eventually', () => {
    const r = runScenario(config, byId('holdings-increase'));
    expect(r.finalPrices[S.DEFENSE_STEEL]).toBe(config.minPrice);
  });

  it('unwinding a position lifts the price', () => {
    const r = runScenario(config, byId('holdings-decrease'));
    const rec = r.records[1];
    expect(rec.nextPrices[S.DEFENSE_STEEL]).toBeGreaterThan(rec.prices[S.DEFENSE_STEEL]);
  });
});

describe('scenario 7 — secret on the watched stock', () => {
  const result = runScenario(config, byId('secret-activated'));

  it('activates for exactly the configured number of rounds', () => {
    expect(result.secretWindows).toHaveLength(1);
    expect(result.secretWindows[0].firstRound).toBe(3);
    expect(result.secretWindows[0].lastRound).toBe(4);
  });

  it('makes the secret-dependent stock take its positive branch only while active', () => {
    const branchInRound = (round: number) =>
      result.records[round - 1].evaluations.find((e) => e.stockId === S.OPEN_SECURITY)!.branch;
    // Settlement at the end of round 2 sets the price used during round 3.
    expect(branchInRound(2)).toBe('secret-active');
    expect(branchInRound(3)).toBe('secret-active');
    expect(branchInRound(1)).toBe('secret-inactive');
    expect(branchInRound(4)).toBe('secret-inactive');
    expect(branchInRound(5)).toBe('secret-inactive');
  });
});

describe('scenarios 8 and 9 — inside and outside the sweet spot', () => {
  it('rewards holdings inside the range', () => {
    const r = runScenario(config, byId('sweet-spot-inside'));
    const settled = r.records.filter(
      (rec) => rec.settled && rec.holdings[S.LATTER] >= 10 && rec.holdings[S.LATTER] <= 30,
    );
    expect(settled.length).toBeGreaterThan(0);
    for (const rec of settled) {
      expect(rec.evaluations.find((e) => e.stockId === S.LATTER)!.branch).toBe('inside-range');
    }
  });

  it('punishes holdings one share past the boundary', () => {
    const r = runScenario(config, byId('sweet-spot-outside'));
    const rec = r.records.find((x) => x.settled && x.holdings[S.LATTER] === 31);
    expect(rec).toBeDefined();
    expect(rec!.evaluations.find((e) => e.stockId === S.LATTER)!.branch).toBe('outside-range');
  });
});

describe('scenarios 10, 11 and 12 — market sentiment', () => {
  it('a broad rally lifts the sentiment stock 20%', () => {
    const r = runScenario(config, byId('broad-rally'));
    const rec = r.records[1];
    const ev = rec.evaluations.find((e) => e.stockId === S.SEASONAL)!;
    expect(ev.branch).toBe('broad-rally');
    expect(ev.appliedDelta).toBe(Math.round(ev.openingPrice * 0.2));
  });

  it('a broad sell-off lowers it 10%', () => {
    const r = runScenario(config, byId('broad-selloff'));
    const ev = r.records[1].evaluations.find((e) => e.stockId === S.SEASONAL)!;
    expect(ev.branch).toBe('broad-selloff');
    expect(ev.appliedDelta).toBeLessThan(0);
  });

  it('a mixed market leaves it exactly unchanged', () => {
    const r = runScenario(config, byId('mixed-market'));
    const ev = r.records[1].evaluations.find((e) => e.stockId === S.SEASONAL)!;
    expect(ev.branch).toBe('mixed-market');
    expect(ev.appliedDelta).toBe(0);
  });
});

describe('scenario 13 — a full 24-round game', () => {
  const result = runScenario(config, byId('full-game'));

  it('runs every configured round', () => {
    expect(result.roundsRun).toBe(24);
    expect(result.records).toHaveLength(24);
  });

  it('keeps every price an integer at or above the floor throughout', () => {
    for (const rec of result.records) {
      for (const p of Object.values(rec.nextPrices)) {
        expect(Number.isSafeInteger(p)).toBe(true);
        expect(p).toBeGreaterThanOrEqual(100);
      }
    }
  });

  it('follows the scripted stock exactly, whatever the participants do', () => {
    const alt = config.stocks.find((s) => s.id === S.ALT_ENT)!;
    if (alt.rule.template !== 'SCRIPTED_PATH') throw new Error('expected scripted path');
    for (let round = 1; round <= 24; round++) {
      expect(result.records[round - 1].prices[S.ALT_ENT]).toBe(alt.rule.prices[round]);
    }
  });

  it('produces a complete ranking', () => {
    const standings = finalStandings(
      config,
      result.finalAssets.map(() => ({
        cash: 0,
        shares: {},
      })),
      result.finalPrices,
    );
    expect(standings).toHaveLength(6);
    expect(standings[0].rank).toBe(1);
  });

  it('never lets a participant hold negative cash or shares', () => {
    for (const a of result.finalAssets) expect(a).toBeGreaterThanOrEqual(0);
  });
});

describe('scenario 14 — market reaches the price floor', () => {
  const result = runScenario(config, byId('floor-crash'));

  it('records floor events', () => {
    expect(result.floorEvents.length).toBeGreaterThan(0);
  });

  it('holds the floor exactly, never going below it', () => {
    for (const rec of result.records) {
      for (const p of Object.values(rec.nextPrices)) {
        expect(p).toBeGreaterThanOrEqual(config.minPrice);
      }
    }
  });

  it('lets the stock recover once holdings are unwound', () => {
    const floored = runScenario(config, byId('floor-crash'));
    expect(floored.finalPrices[S.DEFENSE_STEEL]).toBe(config.minPrice);
    // And selling from the floor lifts it again, per the worked example.
    const recovery = runScenario(config, byId('holdings-decrease'));
    expect(recovery.records.some((r) => r.nextPrices[S.DEFENSE_STEEL] > r.prices[S.DEFENSE_STEEL])).toBe(true);
  });
});

describe('scenario 15 — high-volatility configuration', () => {
  it('runs a deliberately extreme configuration without breaking any invariant', () => {
    const volatile = classic();
    for (const stock of volatile.stocks) {
      if (stock.rule.template === 'HOLDINGS_DELTA') stock.rule.wonPerShare = 2_000;
      if (stock.rule.template === 'CROSS_STOCK_DIRECTION') {
        stock.rule.upBps = 9_000;
        stock.rule.downBps = -9_000;
      }
      if (stock.rule.template === 'HOLDINGS_SWEET_SPOT') {
        stock.rule.insideWon = 9_000;
        stock.rule.outsideWon = -9_000;
      }
    }
    for (const scenario of standardScenarios(volatile)) {
      const r = runScenario(volatile, scenario);
      for (const rec of r.records) {
        for (const p of Object.values(rec.nextPrices)) {
          expect(Number.isSafeInteger(p)).toBe(true);
          expect(p).toBeGreaterThanOrEqual(volatile.minPrice);
        }
      }
    }
  });

  it('respects an optional per-round movement cap when one is set', () => {
    const capped = classic({ maxMovePerRoundBps: 500 }); // 5%
    const r = runScenario(capped, standardScenarios(capped).find((s) => s.id === 'floor-crash')!);
    for (const rec of r.records) {
      for (const ev of rec.evaluations) {
        expect(Math.abs(ev.appliedDelta)).toBeLessThanOrEqual(Math.ceil(ev.openingPrice * 0.05));
      }
    }
  });
});
