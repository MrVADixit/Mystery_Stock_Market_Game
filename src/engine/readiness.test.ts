import { describe, expect, it } from 'vitest';
import { classicPreset, rescaleScriptedPath, S } from './preset';
import { runReadinessCheck } from './readiness';
import { validateConfig, hasBlockingErrors, issuesRequiringAcknowledgement } from './validate';
import { toBps } from './money';
import { classic } from './test-helpers';

describe('TEST MY GAME — the classic preset', () => {
  const report = runReadinessCheck(classicPreset());

  it('reports the shipped preset as ready', () => {
    expect(report.verdict).toBe('READY');
  });

  it('passes every probe and every scenario', () => {
    expect(report.testsFailed).toBe(0);
    expect(report.testsPassed).toBeGreaterThan(30);
    expect(report.scenarios.every((s) => s.passed)).toBe(true);
  });

  it('probes all seven rules', () => {
    const templates = new Set(report.probes.map((p) => p.template));
    expect(templates).toEqual(
      new Set([
        'HOLDINGS_DELTA',
        'CROSS_STOCK_DIRECTION',
        'HOLDINGS_SWEET_SPOT',
        'RELATIVE_BUY_VOLUME',
        'SECRET_DEPENDENT',
        'MARKET_SENTIMENT',
        'SCRIPTED_PATH',
      ]),
    );
  });

  it('actually simulates the game rather than only parsing it', () => {
    expect(report.scenarios.find((s) => s.id === 'full-game')!.roundsRun).toBe(24);
  });

  it('has no configuration errors or warnings', () => {
    expect(report.errorCount).toBe(0);
    expect(report.warningCount).toBe(0);
  });
});

describe('TEST MY GAME — broken configurations', () => {
  it('fails a game whose scripted stock is missing prices', () => {
    const cfg = classic();
    const alt = cfg.stocks.find((s) => s.id === S.ALT_ENT)!;
    if (alt.rule.template === 'SCRIPTED_PATH') alt.rule.prices = [0, 10_000, 11_000];
    const report = runReadinessCheck(cfg);
    expect(report.verdict).toBe('NEEDS_CORRECTION');
    expect(report.issues.some((i) => i.code === 'RULE7_MISSING_PRICES')).toBe(true);
  });

  it('fails a game with overlapping sentiment thresholds and says how to fix it', () => {
    const cfg = classic();
    const seasonal = cfg.stocks.find((s) => s.id === S.SEASONAL)!;
    if (seasonal.rule.template === 'MARKET_SENTIMENT') {
      seasonal.rule.risingThreshold = 3;
      seasonal.rule.fallingThreshold = 3;
    }
    const report = runReadinessCheck(cfg);
    expect(report.verdict).toBe('NEEDS_CORRECTION');
    const issue = report.issues.find((i) => i.code === 'RULE6_THRESHOLDS_OVERLAP')!;
    expect(issue.message).toContain('more than 7');
    expect(issue.stockId).toBe(S.SEASONAL);
  });

  it('fails a game referencing a stock that does not exist', () => {
    const cfg = classic();
    const airtight = cfg.stocks.find((s) => s.id === S.AIRTIGHT)!;
    if (airtight.rule.template === 'CROSS_STOCK_DIRECTION') airtight.rule.referenceStockId = 'ghost';
    const report = runReadinessCheck(cfg);
    expect(report.verdict).toBe('NEEDS_CORRECTION');
    expect(report.issues.some((i) => i.code === 'RULE2_REF_UNKNOWN')).toBe(true);
  });

  it('fails a game whose disclosure rounds are out of order', () => {
    const cfg = classic({ disclosure: { rounds: [5, 4, 15, 20] } });
    expect(runReadinessCheck(cfg).issues.some((i) => i.code === 'DISCLOSURE_ORDER')).toBe(true);
  });

  it('points the administrator at the rule card that needs attention', () => {
    const cfg = classic();
    const latter = cfg.stocks.find((s) => s.id === S.LATTER)!;
    if (latter.rule.template === 'HOLDINGS_SWEET_SPOT') {
      latter.rule.lower = 40;
      latter.rule.upper = 10;
    }
    const issue = runReadinessCheck(cfg).issues.find((i) => i.code === 'RULE3_BOUNDS_ORDER')!;
    expect(issue.stockId).toBe(S.LATTER);
    expect(issue.section).toBe('rules');
  });
});

describe('TEST MY GAME — warnings do not block the game', () => {
  it('reports READY WITH WARNINGS for a deliberately volatile rule', () => {
    const cfg = classic();
    const defense = cfg.stocks.find((s) => s.id === S.DEFENSE_STEEL)!;
    if (defense.rule.template === 'HOLDINGS_DELTA') defense.rule.wonPerShare = 2_000;
    const report = runReadinessCheck(cfg);
    expect(report.verdict).toBe('READY_WITH_WARNINGS');
    expect(report.testsFailed).toBe(0);
    expect(report.warningCount).toBeGreaterThan(0);
    expect(report.issues.some((i) => i.code === 'RULE1_FLOOR_RISK')).toBe(true);
  });

  it('explains how quickly a stock can reach the floor', () => {
    const cfg = classic();
    const defense = cfg.stocks.find((s) => s.id === S.DEFENSE_STEEL)!;
    if (defense.rule.template === 'HOLDINGS_DELTA') defense.rule.wonPerShare = 1_000;
    const issue = validateConfig(cfg).find((i) => i.code === 'RULE1_FLOOR_RISK')!;
    expect(issue.message).toMatch(/10-share increase/);
  });

  it('requires acknowledgement only for genuinely extreme settings', () => {
    const mild = classic();
    expect(issuesRequiringAcknowledgement(validateConfig(mild))).toHaveLength(0);

    const extreme = classic();
    const defense = extreme.stocks.find((s) => s.id === S.DEFENSE_STEEL)!;
    if (defense.rule.template === 'HOLDINGS_DELTA') defense.rule.wonPerShare = 9_000;
    expect(issuesRequiringAcknowledgement(validateConfig(extreme)).length).toBeGreaterThan(0);
  });

  it('warns rather than refuses when a percentage exceeds the whole stock value', () => {
    const cfg = classic();
    const airtight = cfg.stocks.find((s) => s.id === S.AIRTIGHT)!;
    if (airtight.rule.template === 'CROSS_STOCK_DIRECTION') airtight.rule.upBps = toBps(150);
    const issues = validateConfig(cfg);
    expect(hasBlockingErrors(issues)).toBe(false);
    expect(issues.some((i) => i.code === 'RULE2_PCT_EXTREME')).toBe(true);
  });

  it('reports the floor events and extreme moves the game will actually produce', () => {
    const cfg = classic();
    const defense = cfg.stocks.find((s) => s.id === S.DEFENSE_STEEL)!;
    if (defense.rule.template === 'HOLDINGS_DELTA') defense.rule.wonPerShare = 3_000;
    const report = runReadinessCheck(cfg);
    expect(report.extremeMoves.length + report.expectedFloorEvents.length).toBeGreaterThan(0);
  });
});

describe('administrator edits the preset', () => {
  it('stays ready after retuning numbers within the templates', () => {
    const cfg = classic();
    for (const s of cfg.stocks) {
      if (s.rule.template === 'HOLDINGS_DELTA') s.rule.wonPerShare = 300;
      if (s.rule.template === 'CROSS_STOCK_DIRECTION') {
        s.rule.upBps = toBps(15);
        s.rule.downBps = toBps(-15);
      }
      if (s.rule.template === 'HOLDINGS_SWEET_SPOT') {
        s.rule.lower = 15;
        s.rule.upper = 40;
        s.rule.insideWon = 2_000;
      }
      if (s.rule.template === 'MARKET_SENTIMENT') {
        s.rule.risingThreshold = 5;
        s.rule.fallingThreshold = 5;
        s.rule.risingBps = toBps(25);
        s.rule.fallingBps = toBps(-15);
      }
    }
    const report = runReadinessCheck(cfg);
    expect(report.testsFailed).toBe(0);
    expect(['READY', 'READY_WITH_WARNINGS']).toContain(report.verdict);
  });

  it('stays ready after moving a rule to a different stock', () => {
    const cfg = classic();
    // Point the cross-stock rule at CoyoTech instead of Defense Steel.
    const airtight = cfg.stocks.find((s) => s.id === S.AIRTIGHT)!;
    if (airtight.rule.template === 'CROSS_STOCK_DIRECTION') airtight.rule.referenceStockId = S.COYOTECH;
    const report = runReadinessCheck(cfg);
    expect(report.verdict).toBe('READY');
  });

  it('stays ready with a different number of rounds', () => {
    for (const rounds of [6, 12, 36]) {
      const report = runReadinessCheck(classicPreset({ rounds }));
      expect(report.testsFailed, `rounds=${rounds}`).toBe(0);
      expect(report.scenarios.find((s) => s.id === 'full-game')!.roundsRun).toBe(rounds);
    }
  });

  it('rescales a scripted path proportionally and keeps its shape', () => {
    const original = [0, 100, 200, 300, 200, 100];
    const rescaled = rescaleScriptedPath(original, 9, 10);
    expect(rescaled).toHaveLength(10);
    expect(rescaled[1]).toBe(100);
    expect(rescaled[9]).toBe(100);
    expect(Math.max(...rescaled.slice(1))).toBe(300);
    expect(rescaled.every((v, i) => i === 0 || v >= 10)).toBe(true);
  });

  it('stays ready with a completely different stock count', () => {
    const cfg = classic();
    cfg.stocks = cfg.stocks.slice(0, 5);
    const seasonal = cfg.stocks.find((s) => s.id === S.SEASONAL);
    expect(seasonal).toBeUndefined();
    // Repoint the remaining sentiment-free market and re-check.
    const report = runReadinessCheck(cfg);
    expect(report.errorCount).toBe(0);
  });
});
