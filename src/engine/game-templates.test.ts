/**
 * Tests for the game template library, the scrambler and structural edits.
 *
 * The headline property is the anti-memory one: a participant who has
 * played before should face the same deduction problem as a newcomer.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  GAME_TEMPLATES,
  blankTemplate,
  buildGameTemplate,
  gameTemplateById,
  listGameTemplates,
} from './game-templates';
import { scrambleConfig } from './scramble';
import { addStock, removeStock, repairReferences, EditError } from './edit';
import { runReadinessCheck } from './readiness';
import { hasBlockingErrors, validateConfig } from './validate';
import { templateOf } from './templates';
import type { RuleTemplateId, SessionConfig } from './types';

const SEED = 20260419;
const params = { seed: SEED, numRuns: 150, verbose: 0 } as const;

const mechanicsOf = (config: SessionConfig) => config.stocks.map((s) => s.rule.template);
const assignmentOf = (config: SessionConfig) =>
  new Map(config.stocks.map((s) => [s.name, s.rule.template as RuleTemplateId]));

/* ================================================================== */
describe('the built-in template library', () => {
  it('ships at least ten complete games', () => {
    expect(GAME_TEMPLATES.length).toBeGreaterThanOrEqual(10);
  });

  it.each(GAME_TEMPLATES.map((t) => [t.id, t] as const))(
    '%s is READY out of the box',
    (_id, template) => {
      const report = runReadinessCheck(template.build());
      expect(report.errorCount, report.issues.map((i) => i.message).join('; ')).toBe(0);
      expect(report.testsFailed).toBe(0);
      expect(report.verdict).toBe('READY');
    },
  );

  it('never reuses a company name across templates', () => {
    const seen = new Map<string, string>();
    for (const template of GAME_TEMPLATES) {
      for (const name of template.stockNames) {
        const key = name.toLowerCase();
        expect(seen.has(key), `"${name}" appears in both ${seen.get(key)} and ${template.id}`).toBe(false);
        seen.set(key, template.id);
      }
    }
    // Twelve templates of six to eight companies each.
    expect(seen.size).toBeGreaterThanOrEqual(80);
  });

  it('gives every template a different arrangement of mechanics', () => {
    const arrangements = new Set<string>();
    for (const template of GAME_TEMPLATES) {
      arrangements.add(mechanicsOf(template.build()).join('|'));
    }
    expect(arrangements.size).toBe(GAME_TEMPLATES.length);
  });

  it('does not always put a given mechanic in the same position', () => {
    // If the holdings rule were always stock 1, a returning player would
    // know where to look before the game even started.
    const positions = new Set<number>();
    for (const template of GAME_TEMPLATES) {
      const index = mechanicsOf(template.build()).indexOf('HOLDINGS_DELTA');
      if (index >= 0) positions.add(index);
    }
    expect(positions.size).toBeGreaterThanOrEqual(5);
  });

  it('varies the shape of the game, not only the names', () => {
    const configs = GAME_TEMPLATES.map((t) => t.build());
    expect(new Set(configs.map((c) => c.stocks.length)).size).toBeGreaterThanOrEqual(3);
    expect(new Set(configs.map((c) => c.rounds)).size).toBeGreaterThanOrEqual(3);
    expect(new Set(configs.map((c) => c.startingCash)).size).toBeGreaterThanOrEqual(3);
  });

  it('includes a template where buying pushes the price up', () => {
    // The single most effective way to break a remembered instinct.
    const inverted = GAME_TEMPLATES.some((t) =>
      t.build().stocks.some((s) => s.rule.template === 'HOLDINGS_DELTA' && s.rule.inverted),
    );
    expect(inverted).toBe(true);
  });

  it('includes a template that leaves a mechanic out entirely', () => {
    const incomplete = GAME_TEMPLATES.some((t) => {
      const used = new Set(mechanicsOf(t.build()));
      return used.size < 7;
    });
    expect(incomplete).toBe(true);
  });

  it('includes a template that uses one mechanic twice', () => {
    const reused = GAME_TEMPLATES.some((t) => {
      const used = mechanicsOf(t.build());
      return new Set(used).size < used.length;
    });
    expect(reused).toBe(true);
  });

  it('exposes metadata without exposing the builder', () => {
    const meta = listGameTemplates();
    expect(meta).toHaveLength(GAME_TEMPLATES.length);
    expect(meta[0]).not.toHaveProperty('build');
    expect(meta.every((m) => m.description.length > 20 && m.designerNote.length > 20)).toBe(true);
  });

  it('keeps the classic preset exactly as it was', () => {
    const classic = buildGameTemplate('classic');
    expect(classic.stocks.map((s) => s.name)).toEqual([
      'Defense Steel',
      'Airtight Construction',
      'Latter Electronics',
      'CoyoTech',
      'Open Security',
      'Seasonal Financial',
      'Alt Entertainment',
    ]);
    expect(classic.disclosure.rounds).toEqual([5, 10, 15, 20]);
    expect(classic.startingCash).toBe(100_000);
  });

  it('accepts overrides for rounds and timing', () => {
    const short = buildGameTemplate('cascade', { rounds: 8, roundSeconds: 60 });
    expect(short.rounds).toBe(8);
    expect(short.roundSeconds).toBe(60);
    expect(runReadinessCheck(short).errorCount).toBe(0);
  });

  it('rejects an unknown template id', () => {
    expect(() => buildGameTemplate('does-not-exist')).toThrow(/No game template/);
    expect(gameTemplateById('does-not-exist')).toBeUndefined();
  });

  it('can start from a blank game', () => {
    const blank = blankTemplate({ stocks: 5 });
    expect(blank.stocks).toHaveLength(5);
    expect(blank.stocks.every((s) => s.rule.template === 'UNCHANGED')).toBe(true);
    expect(hasBlockingErrors(validateConfig(blank))).toBe(false);
  });
});

/* ================================================================== */
describe('scrambling', () => {
  it('is deterministic for a seed', () => {
    const base = buildGameTemplate('deep-harbour');
    expect(scrambleConfig(base, { seed: 99 })).toEqual(scrambleConfig(base, { seed: 99 }));
  });

  it('produces a different game for a different seed', () => {
    const base = buildGameTemplate('deep-harbour');
    const a = JSON.stringify(scrambleConfig(base, { seed: 1 }));
    const b = JSON.stringify(scrambleConfig(base, { seed: 2 }));
    expect(a).not.toBe(b);
  });

  it('never mutates the configuration it was given', () => {
    const base = buildGameTemplate('clockwork');
    const before = structuredClone(base);
    scrambleConfig(base, { seed: 5 });
    expect(base).toEqual(before);
  });

  it('keeps the company names, the count and the session settings', () => {
    for (const template of GAME_TEMPLATES) {
      const base = template.build();
      const scrambled = scrambleConfig(base, { seed: 31 });
      expect([...scrambled.stocks.map((s) => s.name)].sort()).toEqual(
        [...base.stocks.map((s) => s.name)].sort(),
      );
      expect(scrambled.rounds).toBe(base.rounds);
      expect(scrambled.startingCash).toBe(base.startingCash);
      expect(scrambled.minPrice).toBe(base.minPrice);
    }
  });

  it('produces no errors and no warnings, for any seed and any template', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 2_000_000 }), (seed) => {
        for (const template of GAME_TEMPLATES) {
          const issues = validateConfig(scrambleConfig(template.build(), { seed }));
          expect(issues, `${template.id} seed ${seed}`).toEqual([]);
        }
      }),
      { ...params, numRuns: 40 },
    );
  });

  it('settles correctly: a scrambled game is still READY', () => {
    for (const template of GAME_TEMPLATES) {
      for (const seed of [7, 4242]) {
        const report = runReadinessCheck(scrambleConfig(template.build(), { seed }));
        expect(report.verdict, `${template.id} seed ${seed}`).toBe('READY');
        expect(report.testsFailed).toBe(0);
      }
    }
  });

  it('never leaves a dangling or self-referencing rule', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 2_000_000 }), (seed) => {
        for (const template of GAME_TEMPLATES) {
          const config = scrambleConfig(template.build(), { seed });
          const ids = new Set(config.stocks.map((s) => s.id));
          for (const stock of config.stocks) {
            const rule = stock.rule;
            if (rule.template === 'CROSS_STOCK_DIRECTION') {
              expect(ids.has(rule.referenceStockId)).toBe(true);
              expect(rule.referenceStockId).not.toBe(stock.id);
            }
            if (rule.template === 'RELATIVE_BUY_VOLUME') {
              expect(ids.has(rule.comparisonStockId)).toBe(true);
              expect(rule.comparisonStockId).not.toBe(stock.id);
            }
            if (rule.template === 'SECRET_DEPENDENT') {
              expect(ids.has(rule.referenceStockId)).toBe(true);
            }
            if (rule.template === 'MARKET_SENTIMENT') {
              expect(rule.universe.every((id) => ids.has(id))).toBe(true);
              expect(rule.risingThreshold + rule.fallingThreshold).toBeGreaterThan(rule.universe.length);
            }
          }
        }
      }),
      { ...params, numRuns: 40 },
    );
  });

  it('keeps a scripted company opening at its own scheduled price', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 100_000 }), (seed) => {
        const config = scrambleConfig(buildGameTemplate('classic'), { seed });
        for (const stock of config.stocks) {
          if (stock.rule.template === 'SCRIPTED_PATH') {
            expect(stock.initialPrice).toBe(stock.rule.prices[1]);
          }
        }
      }),
      params,
    );
  });

  /* ---------- the property this whole feature exists for ---------- */

  it('carries no memory of which company ran which mechanic', () => {
    // Across many seeds, a company keeps its original mechanic no more
    // often than pure chance would give. A returning player therefore
    // learns nothing transferable from having played before.
    const base = buildGameTemplate('classic');
    const original = assignmentOf(base);
    let kept = 0;
    let total = 0;

    for (let seed = 1; seed <= 500; seed++) {
      for (const stock of scrambleConfig(base, { seed }).stocks) {
        total++;
        if (original.get(stock.name) === stock.rule.template) kept++;
      }
    }

    const observed = kept / total;
    const chance = 1 / base.stocks.length;
    expect(observed).toBeGreaterThan(chance * 0.6);
    expect(observed).toBeLessThan(chance * 1.5);
  });

  it('also varies the numbers, not just the assignment', () => {
    const base = buildGameTemplate('red-sand');
    const rates = new Set<number>();
    const bands = new Set<string>();
    for (let seed = 1; seed <= 100; seed++) {
      for (const stock of scrambleConfig(base, { seed }).stocks) {
        if (stock.rule.template === 'HOLDINGS_DELTA') rates.add(stock.rule.wonPerShare);
        if (stock.rule.template === 'HOLDINGS_SWEET_SPOT') bands.add(`${stock.rule.lower}-${stock.rule.upper}`);
      }
    }
    expect(rates.size).toBeGreaterThan(10);
    expect(bands.size).toBeGreaterThan(10);
  });

  it('can be asked to change only some things', () => {
    const base = buildGameTemplate('greenfield');
    const namesOnly = scrambleConfig(base, {
      seed: 11,
      permuteMechanics: false,
      jitterParameters: false,
      jitterPrices: false,
      rewireReferences: false,
      shuffleOrder: true,
    });
    // Same puzzle, listed in a different order.
    expect(assignmentOf(namesOnly)).toEqual(assignmentOf(base));
    expect(validateConfig(namesOnly)).toEqual([]);
  });
});

/* ================================================================== */
describe('adding and removing companies', () => {
  it('adds a company on the unchanged mechanic', () => {
    const { config, repairs } = addStock(buildGameTemplate('classic'), { name: 'Newco' });
    expect(config.stocks).toHaveLength(8);
    expect(config.stocks[7].name).toBe('Newco');
    expect(config.stocks[7].rule.template).toBe('UNCHANGED');
    expect(repairs.length).toBeGreaterThan(0);
    expect(validateConfig(config)).toEqual([]);
  });

  it('keeps the sentiment thresholds from overlapping when the market grows', () => {
    // 4 rising + 4 falling is safe for seven stocks but not for eight.
    let config = buildGameTemplate('classic');
    const before = config.stocks.find((s) => s.rule.template === 'MARKET_SENTIMENT')!;
    if (before.rule.template !== 'MARKET_SENTIMENT') throw new Error('expected sentiment');
    expect(before.rule.risingThreshold + before.rule.fallingThreshold).toBe(8);

    config = addStock(config).config;
    const after = config.stocks.find((s) => s.rule.template === 'MARKET_SENTIMENT')!;
    if (after.rule.template !== 'MARKET_SENTIMENT') throw new Error('expected sentiment');
    expect(after.rule.universe).toHaveLength(8);
    expect(after.rule.risingThreshold + after.rule.fallingThreshold).toBeGreaterThan(8);
    expect(hasBlockingErrors(validateConfig(config))).toBe(false);
  });

  it('gives a duplicate name a distinct one', () => {
    const { config } = addStock(buildGameTemplate('classic'), { name: 'CoyoTech' });
    expect(config.stocks[7].name).toBe('CoyoTech 2');
  });

  it('repoints every rule that referenced a removed company', () => {
    const base = buildGameTemplate('classic');
    // Latter Electronics is both a volume comparison and a watched stock.
    const latter = base.stocks.find((s) => s.name === 'Latter Electronics')!;
    const { config, repairs } = removeStock(base, latter.id);

    expect(config.stocks).toHaveLength(6);
    expect(config.stocks.some((s) => s.name === 'Latter Electronics')).toBe(false);
    expect(repairs.length).toBeGreaterThanOrEqual(2);
    expect(validateConfig(config)).toEqual([]);

    const ids = new Set(config.stocks.map((s) => s.id));
    for (const stock of config.stocks) {
      if (stock.rule.template === 'RELATIVE_BUY_VOLUME') expect(ids.has(stock.rule.comparisonStockId)).toBe(true);
      if (stock.rule.template === 'SECRET_DEPENDENT') expect(ids.has(stock.rule.referenceStockId)).toBe(true);
      if (stock.rule.template === 'CROSS_STOCK_DIRECTION') expect(ids.has(stock.rule.referenceStockId)).toBe(true);
    }
  });

  it('explains in plain English what it repaired', () => {
    const base = buildGameTemplate('classic');
    const steel = base.stocks.find((s) => s.name === 'Defense Steel')!;
    const { repairs } = removeStock(base, steel.id);
    expect(repairs.join(' ')).toMatch(/Airtight Construction followed Defense Steel; it now follows/);
  });

  it('shrinks a sentiment universe and keeps it valid', () => {
    let config = buildGameTemplate('classic');
    for (const name of ['CoyoTech', 'Open Security', 'Alt Entertainment']) {
      const target = config.stocks.find((s) => s.name === name)!;
      config = removeStock(config, target.id).config;
    }
    expect(config.stocks).toHaveLength(4);
    const sentiment = config.stocks.find((s) => s.rule.template === 'MARKET_SENTIMENT');
    if (sentiment && sentiment.rule.template === 'MARKET_SENTIMENT') {
      expect(sentiment.rule.universe).toHaveLength(4);
      expect(sentiment.rule.risingThreshold + sentiment.rule.fallingThreshold).toBeGreaterThan(4);
    }
    expect(hasBlockingErrors(validateConfig(config))).toBe(false);
  });

  it('refuses to remove the last company', () => {
    let config = buildGameTemplate('tidal-reach');
    while (config.stocks.length > 1) config = removeStock(config, config.stocks[0].id).config;
    expect(() => removeStock(config, config.stocks[0].id)).toThrow(EditError);
  });

  it('refuses to remove a company that is not there', () => {
    expect(() => removeStock(buildGameTemplate('classic'), 'ghost')).toThrow(EditError);
  });

  it('survives any sequence of additions and removals', () => {
    fc.assert(
      fc.property(
        fc.array(fc.boolean(), { minLength: 1, maxLength: 25 }),
        fc.integer({ min: 0, max: 1000 }),
        (operations, pickSeed) => {
          let config = buildGameTemplate('classic');
          for (const [index, isAdd] of operations.entries()) {
            if (isAdd) {
              config = addStock(config).config;
            } else if (config.stocks.length > 1) {
              const victim = config.stocks[(pickSeed + index) % config.stocks.length];
              config = removeStock(config, victim.id).config;
            }
            // The configuration stays playable at every step.
            expect(hasBlockingErrors(validateConfig(config))).toBe(false);
          }
        },
      ),
      { ...params, numRuns: 60 },
    );
  });

  it('repairs a configuration whose references were broken by hand', () => {
    const base = buildGameTemplate('classic');
    const broken = structuredClone(base);
    const airtight = broken.stocks.find((s) => s.name === 'Airtight Construction')!;
    if (airtight.rule.template === 'CROSS_STOCK_DIRECTION') airtight.rule.referenceStockId = 'ghost';
    expect(hasBlockingErrors(validateConfig(broken))).toBe(true);

    const { config, repairs } = repairReferences(broken);
    expect(repairs.length).toBeGreaterThan(0);
    expect(hasBlockingErrors(validateConfig(config))).toBe(false);
  });

  it('keeps every rule explainable after an edit', () => {
    const { config } = addStock(buildGameTemplate('monsoon'), { name: 'Late Entry' });
    for (const stock of config.stocks) {
      const text = templateOf(stock.rule).describe(stock.rule, {
        stockName: stock.name,
        nameOf: (id) => config.stocks.find((s) => s.id === id)?.name ?? id,
        minPrice: config.minPrice,
      });
      expect(text.length).toBeGreaterThan(20);
      expect(text).not.toContain('(unknown stock');
      expect(stock.disclosure.segments.every((s) => s.trim().length > 0)).toBe(true);
    }
  });
});
