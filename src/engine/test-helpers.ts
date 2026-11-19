/** Shared fixtures for the engine test suite. */

import { classicPreset } from './preset';
import type { SessionConfig, StockConfig } from './types';
import { defaultDisclosures } from './disclosure';
import { nameLookup } from './settle';

export function classic(overrides: Partial<SessionConfig> = {}): SessionConfig {
  return { ...classicPreset(), ...overrides };
}

/** A tiny configuration holding exactly the stocks supplied. */
export function miniConfig(
  stocks: Omit<StockConfig, 'disclosure'>[],
  overrides: Partial<SessionConfig> = {},
): SessionConfig {
  const base = classicPreset();
  const partial: SessionConfig = {
    ...base,
    rounds: 5,
    stocks: stocks.map((s) => ({ ...s, disclosure: { segments: ['a', 'b', 'c', 'd'] } })),
    ...overrides,
  };
  const nameOf = nameLookup(partial);
  return {
    ...partial,
    stocks: partial.stocks.map((s) => ({
      ...s,
      disclosure: defaultDisclosures(s.rule, {
        stockName: s.name,
        nameOf,
        minPrice: partial.minPrice,
      }),
    })),
  };
}
