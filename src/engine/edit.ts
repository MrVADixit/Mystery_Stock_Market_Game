/**
 * Structural edits to a configuration: adding and removing companies.
 *
 * Both operations have to repair the rest of the configuration, because
 * rules refer to each other. Removing a company that another rule watches
 * would otherwise leave a dangling reference, and adding one to a market
 * sentiment universe can make two thresholds overlap. Everything here
 * returns the repairs it made so the administrator can be told.
 */

import { defaultDisclosures } from './disclosure';
import { nameLookup } from './settle';
import type { RuleParams, SessionConfig, StockConfig, StockId } from './types';

export interface EditResult {
  config: SessionConfig;
  /** Plain-English notes about anything that had to be adjusted. */
  repairs: string[];
}

export class EditError extends Error {}

/** The next free `sN` identifier. */
function nextStockId(config: SessionConfig): StockId {
  let highest = 0;
  for (const stock of config.stocks) {
    const match = /^s(\d+)$/.exec(stock.id);
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  return `s${highest + 1}`;
}

function uniqueName(config: SessionConfig, preferred: string): string {
  const taken = new Set(config.stocks.map((s) => s.name.trim().toLowerCase()));
  if (!taken.has(preferred.trim().toLowerCase())) return preferred;
  for (let n = 2; n < 100; n++) {
    const candidate = `${preferred} ${n}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return `${preferred} ${Date.now()}`;
}

/**
 * Makes a market-sentiment rule's thresholds safe for a universe of
 * `size`. The two branches can both fire exactly when the thresholds fit
 * inside the universe together, so the sum has to exceed it.
 */
function repairThresholds(
  rising: number,
  falling: number,
  size: number,
): { rising: number; falling: number; changed: boolean } {
  let r = Math.max(1, Math.min(rising, size));
  let f = Math.max(1, Math.min(falling, size));
  const before = `${r}/${f}`;
  let guard = 0;
  while (r + f <= size && guard++ < 100) {
    if (r <= f && r < size) r++;
    else if (f < size) f++;
    else break;
  }
  return { rising: r, falling: f, changed: `${r}/${f}` !== before };
}

function regenerateDisclosure(config: SessionConfig, stock: StockConfig): StockConfig {
  const nameOf = nameLookup(config);
  return {
    ...stock,
    disclosure: defaultDisclosures(stock.rule, {
      stockName: stock.name,
      nameOf,
      minPrice: config.minPrice,
    }),
  };
}

/* ------------------------------------------------------------------ */
/* Add                                                                 */
/* ------------------------------------------------------------------ */

export interface AddStockOptions {
  name?: string;
  initialPrice?: number;
  rule?: RuleParams;
  /** Include the new company in every rule that counts the whole market. */
  includeInSentimentUniverses?: boolean;
}

/** Appends a company. It starts on the unchanged-price mechanic. */
export function addStock(config: SessionConfig, options: AddStockOptions = {}): EditResult {
  if (config.stocks.length >= 40) {
    throw new EditError('A game can have at most 40 companies.');
  }

  const repairs: string[] = [];
  const id = nextStockId(config);
  const name = uniqueName(config, options.name?.trim() || `Company ${config.stocks.length + 1}`);
  const rule: RuleParams = options.rule ?? { template: 'UNCHANGED' };
  const initialPrice = Math.max(
    config.minPrice,
    options.initialPrice ?? config.stocks[0]?.initialPrice ?? 10_000,
  );

  const newStock: StockConfig = {
    id,
    name,
    initialPrice,
    rule,
    disclosure: { segments: ['', '', '', ''] },
  };

  let next: SessionConfig = { ...config, stocks: [...config.stocks, newStock] };

  // Rules that count the whole market should normally count the new one too.
  if (options.includeInSentimentUniverses !== false) {
    next = {
      ...next,
      stocks: next.stocks.map((stock) => {
        if (stock.rule.template !== 'MARKET_SENTIMENT') return stock;
        // Only extend a universe that already covered everything; a
        // deliberately narrowed one is left alone.
        const coveredEverything = config.stocks.every((s) => stock.rule.template === 'MARKET_SENTIMENT' && stock.rule.universe.includes(s.id));
        if (!coveredEverything) return stock;

        const universe = [...stock.rule.universe, id];
        const fixed = repairThresholds(stock.rule.risingThreshold, stock.rule.fallingThreshold, universe.length);
        if (fixed.changed) {
          repairs.push(
            `${stock.name} now counts ${universe.length} companies, so its thresholds were raised to ${fixed.rising} rising / ${fixed.falling} falling to keep the two branches from overlapping.`,
          );
        } else {
          repairs.push(`${stock.name} now counts ${name} as part of the market.`);
        }
        return {
          ...stock,
          rule: {
            ...stock.rule,
            universe,
            risingThreshold: fixed.rising,
            fallingThreshold: fixed.falling,
          },
        };
      }),
    };
  }

  next = { ...next, stocks: next.stocks.map((s) => regenerateDisclosure(next, s)) };
  return { config: next, repairs };
}

/* ------------------------------------------------------------------ */
/* Remove                                                              */
/* ------------------------------------------------------------------ */

/**
 * Removes a company and repairs everything that pointed at it.
 *
 * Any rule that referenced it is repointed at another company, and any
 * market-sentiment universe that contained it is shrunk, with its
 * thresholds adjusted if they no longer fit.
 */
export function removeStock(config: SessionConfig, stockId: StockId): EditResult {
  const victim = config.stocks.find((s) => s.id === stockId);
  if (!victim) throw new EditError('That company is not in this game.');
  if (config.stocks.length <= 1) {
    throw new EditError('A game needs at least one company.');
  }

  const repairs: string[] = [];
  const remaining = config.stocks.filter((s) => s.id !== stockId);
  const remainingIds = remaining.map((s) => s.id);
  const nameOfRemoved = victim.name;

  /** Some other company, never the rule's own. */
  const substituteFor = (selfId: StockId): StockId | null =>
    remainingIds.find((id) => id !== selfId) ?? null;

  const repaired = remaining.map((stock) => {
    const rule = stock.rule;

    switch (rule.template) {
      case 'CROSS_STOCK_DIRECTION': {
        if (rule.referenceStockId !== stockId) return stock;
        const replacement = substituteFor(stock.id);
        if (!replacement) {
          repairs.push(`${stock.name} had nothing left to follow, so it now keeps a flat price.`);
          return { ...stock, rule: { template: 'UNCHANGED' } as RuleParams };
        }
        const replacementName = remaining.find((s) => s.id === replacement)?.name ?? replacement;
        repairs.push(`${stock.name} followed ${nameOfRemoved}; it now follows ${replacementName}.`);
        return { ...stock, rule: { ...rule, referenceStockId: replacement } };
      }

      case 'RELATIVE_BUY_VOLUME': {
        if (rule.comparisonStockId !== stockId) return stock;
        const replacement = substituteFor(stock.id);
        if (!replacement) {
          repairs.push(`${stock.name} had nothing left to compare against, so it now keeps a flat price.`);
          return { ...stock, rule: { template: 'UNCHANGED' } as RuleParams };
        }
        const replacementName = remaining.find((s) => s.id === replacement)?.name ?? replacement;
        repairs.push(
          `${stock.name} compared its buying volume against ${nameOfRemoved}; it now compares against ${replacementName}.`,
        );
        return { ...stock, rule: { ...rule, comparisonStockId: replacement } };
      }

      case 'SECRET_DEPENDENT': {
        if (rule.referenceStockId !== stockId) return stock;
        const replacement = substituteFor(stock.id) ?? stock.id;
        const replacementName = remaining.find((s) => s.id === replacement)?.name ?? replacement;
        repairs.push(`${stock.name} watched for secrets on ${nameOfRemoved}; it now watches ${replacementName}.`);
        return { ...stock, rule: { ...rule, referenceStockId: replacement } };
      }

      case 'MARKET_SENTIMENT': {
        if (!rule.universe.includes(stockId)) return stock;
        const universe = rule.universe.filter((id) => id !== stockId);
        if (universe.length === 0) {
          repairs.push(`${stock.name} counted only ${nameOfRemoved}, so it now keeps a flat price.`);
          return { ...stock, rule: { template: 'UNCHANGED' } as RuleParams };
        }
        const fixed = repairThresholds(rule.risingThreshold, rule.fallingThreshold, universe.length);
        if (fixed.changed) {
          repairs.push(
            `${stock.name} now counts ${universe.length} companies, so its thresholds were adjusted to ${fixed.rising} rising / ${fixed.falling} falling.`,
          );
        } else {
          repairs.push(`${stock.name} no longer counts ${nameOfRemoved}.`);
        }
        return {
          ...stock,
          rule: {
            ...rule,
            universe,
            risingThreshold: fixed.rising,
            fallingThreshold: fixed.falling,
          },
        };
      }

      default:
        return stock;
    }
  });

  const next: SessionConfig = { ...config, stocks: repaired };
  return {
    config: { ...next, stocks: repaired.map((s) => regenerateDisclosure(next, s)) },
    repairs,
  };
}

/**
 * Re-points every reference so that nothing dangles, used after a bulk
 * edit such as pasting in a configuration. Returns the repairs made.
 */
export function repairReferences(config: SessionConfig): EditResult {
  const ids = new Set(config.stocks.map((s) => s.id));
  const repairs: string[] = [];

  const stocks = config.stocks.map((stock) => {
    const rule = stock.rule;
    const other = config.stocks.find((s) => s.id !== stock.id)?.id;

    const fix = (current: StockId, label: string): StockId => {
      if (ids.has(current) && current !== stock.id) return current;
      if (!other) return current;
      repairs.push(`${stock.name}: ${label} pointed at a company that is not in this game; it now points at another.`);
      return other;
    };

    switch (rule.template) {
      case 'CROSS_STOCK_DIRECTION':
        return { ...stock, rule: { ...rule, referenceStockId: fix(rule.referenceStockId, 'its reference stock') } };
      case 'RELATIVE_BUY_VOLUME':
        return { ...stock, rule: { ...rule, comparisonStockId: fix(rule.comparisonStockId, 'its comparison stock') } };
      case 'SECRET_DEPENDENT':
        return { ...stock, rule: { ...rule, referenceStockId: fix(rule.referenceStockId, 'its watched stock') } };
      case 'MARKET_SENTIMENT': {
        const universe = rule.universe.filter((id) => ids.has(id));
        if (universe.length === rule.universe.length) return stock;
        repairs.push(`${stock.name}: its market universe listed companies that are not in this game.`);
        const fixed = repairThresholds(rule.risingThreshold, rule.fallingThreshold, Math.max(1, universe.length));
        return {
          ...stock,
          rule: {
            ...rule,
            universe: universe.length > 0 ? universe : config.stocks.map((s) => s.id),
            risingThreshold: fixed.rising,
            fallingThreshold: fixed.falling,
          },
        };
      }
      default:
        return stock;
    }
  });

  return { config: { ...config, stocks }, repairs };
}
