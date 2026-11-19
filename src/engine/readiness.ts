/**
 * TEST MY GAME — the session readiness report.
 *
 * Three layers run every time:
 *   1. Configuration validation (errors and soft warnings).
 *   2. A deterministic probe of every assigned rule, where the expected
 *      figure is computed independently of the template code rather than
 *      by calling the same function and comparing it with itself.
 *   3. A real simulation of the session's own rules, stocks and settings
 *      across the whole game.
 *
 * A game is never reported ready merely because its configuration parses.
 */

import { pctDelta } from './money';
import { previewSettlement } from './preview';
import { standardScenarios } from './scenarios';
import { runScenario } from './simulate';
import type { SimResult } from './simulate';
import { validateConfig } from './validate';
import type { ConfigIssue } from './validate';
import type { SessionConfig, StockId } from './types';

export type ReadinessVerdict = 'READY' | 'READY_WITH_WARNINGS' | 'NEEDS_CORRECTION';

export interface RuleProbe {
  stockId: StockId;
  stockName: string;
  template: string;
  /** What was being checked, e.g. "holdings increase by 50". */
  check: string;
  expected: number;
  actual: number;
  passed: boolean;
  detail: string;
}

export interface ScenarioOutcome {
  id: string;
  name: string;
  description: string;
  passed: boolean;
  roundsRun: number;
  floorEvents: number;
  extremeMoves: number;
  rejectedOrders: number;
  error?: string;
  finalPrices: Record<StockId, number>;
}

export interface ReadinessReport {
  verdict: ReadinessVerdict;
  generatedAt: string;
  testsPassed: number;
  testsFailed: number;
  warningCount: number;
  errorCount: number;
  issues: ConfigIssue[];
  probes: RuleProbe[];
  scenarios: ScenarioOutcome[];
  /** Rounds in the full-game simulation where a stock sat on the floor. */
  expectedFloorEvents: { round: number; stockId: StockId; stockName: string }[];
  extremeMoves: { round: number; stockId: StockId; stockName: string; pct: number }[];
  summary: string;
}

/* ------------------------------------------------------------------ */
/* Layer 2: independent per-rule probes                                */
/* ------------------------------------------------------------------ */

function probeRules(config: SessionConfig): RuleProbe[] {
  const probes: RuleProbe[] = [];
  const add = (p: RuleProbe) => probes.push(p);

  for (const stock of config.stocks) {
    const id = stock.id;
    const base = stock.initialPrice;
    const floor = config.minPrice;
    const clamp = (n: number) => Math.max(floor, config.maxPrice != null ? Math.min(n, config.maxPrice) : n);
    const priceFrom = (res: ReturnType<typeof previewSettlement>) => res.prices[id];

    switch (stock.rule.template) {
      case 'HOLDINGS_DELTA': {
        const p = stock.rule;
        const dir = p.inverted ? 1 : -1;
        for (const change of [+10, -10, 0]) {
          const counted =
            p.maxHoldingsChangePerRound != null
              ? Math.sign(change) * Math.min(Math.abs(change), p.maxHoldingsChangePerRound)
              : change;
          const expected = clamp(base + dir * counted * p.wonPerShare);
          const actual = priceFrom(
            previewSettlement(config, {
              holdings: { [id]: Math.max(0, change) },
              previousHoldings: { [id]: Math.max(0, -change) },
            }),
          );
          add({
            stockId: id,
            stockName: stock.name,
            template: 'HOLDINGS_DELTA',
            check: `total holdings change of ${change > 0 ? '+' : ''}${change} shares`,
            expected,
            actual,
            passed: expected === actual,
            detail: `${base.toLocaleString('en-US')} won ${dir * counted * p.wonPerShare >= 0 ? '+' : '-'} ${Math.abs(dir * counted * p.wonPerShare).toLocaleString('en-US')} won`,
          });
        }
        break;
      }

      case 'CROSS_STOCK_DIRECTION': {
        const p = stock.rule;
        const ref = p.referenceStockId;
        const refBase = config.stocks.find((s) => s.id === ref)?.initialPrice ?? base;
        const cases: [string, number, number][] = [
          ['reference stock rose', refBase - 500, p.upBps],
          ['reference stock fell', refBase + 500, p.downBps],
          [
            'reference stock unchanged',
            refBase,
            p.unchangedCountsAs === 'positive' ? p.upBps : p.downBps,
          ],
        ];
        for (const [label, prevRefPrice, bps] of cases) {
          const expected = clamp(base + pctDelta(base, bps));
          const actual = priceFrom(
            previewSettlement(config, { previousPrices: { [ref]: prevRefPrice } }),
          );
          add({
            stockId: id,
            stockName: stock.name,
            template: 'CROSS_STOCK_DIRECTION',
            check: label,
            expected,
            actual,
            passed: expected === actual,
            detail: `${bps / 100}% of ${base.toLocaleString('en-US')} won`,
          });
        }
        break;
      }

      case 'HOLDINGS_SWEET_SPOT': {
        const p = stock.rule;
        const cases: [string, number][] = [
          ['one share below the lower boundary', p.lower - 1],
          ['exactly the lower boundary', p.lower],
          ['inside the range', Math.floor((p.lower + p.upper) / 2)],
          ['exactly the upper boundary', p.upper],
          ['one share above the upper boundary', p.upper + 1],
        ];
        for (const [label, held] of cases) {
          if (held < 0) continue;
          const inside = held >= p.lower && held <= p.upper;
          const expected = clamp(base + (inside ? p.insideWon : p.outsideWon));
          const actual = priceFrom(previewSettlement(config, { holdings: { [id]: held } }));
          add({
            stockId: id,
            stockName: stock.name,
            template: 'HOLDINGS_SWEET_SPOT',
            check: `${label} (${held} shares)`,
            expected,
            actual,
            passed: expected === actual,
            detail: inside ? 'inside -> positive branch' : 'outside -> negative branch',
          });
        }
        break;
      }

      case 'RELATIVE_BUY_VOLUME': {
        const p = stock.rule;
        const cmp = p.comparisonStockId;
        const cases: [string, number, number][] = [
          ['bought more than the comparison stock', 10, 5],
          ['bought less than the comparison stock', 5, 10],
          ['equal buying volume', 7, 7],
          ['no trading at all', 0, 0],
        ];
        for (const [label, mine, theirs] of cases) {
          const tie = mine === theirs;
          const above = mine > theirs || (tie && p.tieCountsAs === 'positive');
          const expected = clamp(base + (above ? p.aboveWon : p.belowWon));
          const actual = priceFrom(
            previewSettlement(config, { grossBuys: { [id]: mine, [cmp]: theirs } }),
          );
          add({
            stockId: id,
            stockName: stock.name,
            template: 'RELATIVE_BUY_VOLUME',
            check: `${label} (${mine} vs ${theirs})`,
            expected,
            actual,
            passed: expected === actual,
            detail: above ? 'positive branch' : 'negative branch',
          });
        }
        break;
      }

      case 'SECRET_DEPENDENT': {
        const p = stock.rule;
        const ref = p.referenceStockId;
        for (const active of [true, false]) {
          const expected = clamp(base + (active ? pctDelta(base, p.activeBps) : p.inactiveWon));
          const actual = priceFrom(previewSettlement(config, { secretActive: { [ref]: active } }));
          add({
            stockId: id,
            stockName: stock.name,
            template: 'SECRET_DEPENDENT',
            check: active ? 'a secret covers the watched stock' : 'no secret on the watched stock',
            expected,
            actual,
            passed: expected === actual,
            detail: active ? `${p.activeBps / 100}% of ${base.toLocaleString('en-US')} won` : `${p.inactiveWon} won`,
          });
        }
        break;
      }

      case 'MARKET_SENTIMENT': {
        const p = stock.rule;
        const n = p.universe.length;
        const cases: [string, number, number][] = [
          ['a broad rally', Math.min(n, p.risingThreshold), 0],
          ['a broad sell-off', 0, Math.min(n, p.fallingThreshold)],
          ['a mixed market', Math.max(0, p.risingThreshold - 1), 0],
        ];
        for (const [label, rising, falling] of cases) {
          const risingHit = rising >= p.risingThreshold;
          const fallingHit = falling >= p.fallingThreshold;
          if (risingHit && fallingHit) continue; // the validator already flags this
          const bps = risingHit ? p.risingBps : fallingHit ? p.fallingBps : 0;
          const expected = clamp(base + pctDelta(base, bps));
          let actual: number;
          try {
            actual = priceFrom(
              previewSettlement(config, { forceRisingCount: rising, forceFallingCount: falling }),
            );
          } catch {
            actual = Number.NaN;
          }
          add({
            stockId: id,
            stockName: stock.name,
            template: 'MARKET_SENTIMENT',
            check: `${label} (${rising} rising, ${falling} falling of ${n})`,
            expected,
            actual,
            passed: expected === actual,
            detail: bps === 0 ? 'neutral branch, no movement' : `${bps / 100}% of ${base.toLocaleString('en-US')} won`,
          });
        }
        break;
      }

      case 'SCRIPTED_PATH': {
        const p = stock.rule;
        // Check every configured round has exactly one authoritative price
        // and that the floor is honoured.
        let mismatches = 0;
        let firstBad = '';
        for (let round = 1; round < config.rounds; round++) {
          const scheduled = p.prices[round + 1];
          if (scheduled == null) {
            mismatches++;
            if (!firstBad) firstBad = `round ${round + 1} has no scheduled price`;
            continue;
          }
          const expected = clamp(scheduled);
          const actual = priceFrom(
            previewSettlement(config, {
              round,
              prices: { [id]: p.prices[round] ?? stock.initialPrice },
              // Trading activity is deliberately non-zero: a scripted
              // stock must ignore it completely.
              holdings: { [id]: 999 },
              previousHoldings: { [id]: 0 },
              grossBuys: { [id]: 999 },
              grossSells: { [id]: 999 },
            }),
          );
          if (expected !== actual) {
            mismatches++;
            if (!firstBad) firstBad = `round ${round + 1}: expected ${expected}, got ${actual}`;
          }
        }
        add({
          stockId: id,
          stockName: stock.name,
          template: 'SCRIPTED_PATH',
          check: `all ${Math.max(0, config.rounds - 1)} scheduled transitions, ignoring heavy trading`,
          expected: 0,
          actual: mismatches,
          passed: mismatches === 0,
          detail: mismatches === 0 ? 'every round has exactly one authoritative price' : firstBad,
        });
        break;
      }

      case 'UNCHANGED': {
        const actual = priceFrom(
          previewSettlement(config, { holdings: { [id]: 100 }, grossBuys: { [id]: 100 } }),
        );
        add({
          stockId: id,
          stockName: stock.name,
          template: 'UNCHANGED',
          check: 'heavy trading leaves the price alone',
          expected: clamp(base),
          actual,
          passed: clamp(base) === actual,
          detail: 'price never moves',
        });
        break;
      }
    }
  }

  return probes;
}

/* ------------------------------------------------------------------ */
/* Layer 3: simulation                                                 */
/* ------------------------------------------------------------------ */

function runScenarios(config: SessionConfig): { outcomes: ScenarioOutcome[]; fullGame?: SimResult } {
  const outcomes: ScenarioOutcome[] = [];
  let fullGame: SimResult | undefined;

  for (const scenario of standardScenarios(config)) {
    try {
      const result = runScenario(config, scenario);
      if (scenario.id === 'full-game') fullGame = result;

      // A scenario passes when it completed and every invariant held.
      let failure: string | undefined;
      for (const rec of result.records) {
        for (const [stockId, price] of Object.entries(rec.nextPrices)) {
          if (price < config.minPrice) {
            failure = `${stockId} settled at ${price} won, below the ${config.minPrice} won floor`;
            break;
          }
          if (!Number.isSafeInteger(price)) {
            failure = `${stockId} settled at a non-integer price (${price})`;
            break;
          }
        }
        if (failure) break;
      }

      outcomes.push({
        id: scenario.id,
        name: scenario.name,
        description: scenario.description,
        passed: !failure,
        roundsRun: result.roundsRun,
        floorEvents: result.floorEvents.length,
        extremeMoves: result.extremeMoves.length,
        rejectedOrders: result.rejected.length,
        error: failure,
        finalPrices: result.finalPrices,
      });
    } catch (e) {
      outcomes.push({
        id: scenario.id,
        name: scenario.name,
        description: scenario.description,
        passed: false,
        roundsRun: 0,
        floorEvents: 0,
        extremeMoves: 0,
        rejectedOrders: 0,
        error: e instanceof Error ? e.message : String(e),
        finalPrices: {},
      });
    }
  }

  return { outcomes, fullGame };
}

/* ------------------------------------------------------------------ */

/** Runs the whole readiness check. Pure and deterministic. */
export function runReadinessCheck(config: SessionConfig): ReadinessReport {
  const issues = validateConfig(config);
  const errorCount = issues.filter((i) => i.level === 'error').length;
  const warningCount = issues.filter((i) => i.level === 'warning').length;

  // Probes and simulations are only meaningful once the configuration is
  // structurally sound; running them on a broken config would just produce
  // noise on top of the real problem.
  let probes: RuleProbe[] = [];
  let scenarios: ScenarioOutcome[] = [];
  let fullGame: SimResult | undefined;

  if (errorCount === 0) {
    probes = probeRules(config);
    const run = runScenarios(config);
    scenarios = run.outcomes;
    fullGame = run.fullGame;
  }

  const probesPassed = probes.filter((p) => p.passed).length;
  const probesFailed = probes.length - probesPassed;
  const scenariosPassed = scenarios.filter((s) => s.passed).length;
  const scenariosFailed = scenarios.length - scenariosPassed;

  const testsPassed = probesPassed + scenariosPassed;
  const testsFailed = probesFailed + scenariosFailed;

  const verdict: ReadinessVerdict =
    errorCount > 0 || testsFailed > 0
      ? 'NEEDS_CORRECTION'
      : warningCount > 0
        ? 'READY_WITH_WARNINGS'
        : 'READY';

  const summary =
    verdict === 'NEEDS_CORRECTION'
      ? errorCount > 0
        ? `${errorCount} configuration ${errorCount === 1 ? 'problem needs' : 'problems need'} fixing before this game can start.`
        : `${testsFailed} ${testsFailed === 1 ? 'check' : 'checks'} failed when the rules were actually run.`
      : verdict === 'READY_WITH_WARNINGS'
        ? `All ${testsPassed} checks passed. ${warningCount} ${warningCount === 1 ? 'warning is' : 'warnings are'} worth reading first — high volatility is allowed, but have a look at what it will do.`
        : `All ${testsPassed} checks passed with no warnings. This game is ready to run.`;

  return {
    verdict,
    generatedAt: new Date().toISOString(),
    testsPassed,
    testsFailed,
    warningCount,
    errorCount,
    issues,
    probes,
    scenarios,
    expectedFloorEvents: fullGame?.floorEvents ?? [],
    extremeMoves: fullGame?.extremeMoves ?? [],
    summary,
  };
}
