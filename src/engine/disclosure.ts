/**
 * Progressive rule revelations.
 *
 * The administrator never has to write a technical description. For every
 * template the system drafts four plain-English segments that get
 * progressively more specific, ending in the complete formula. The wording
 * is editable and segments can be reordered in the rule editor; this module
 * only supplies the starting text.
 */

import { templateOf } from './templates';
import type { DisclosureSegments, RuleParams, SessionConfig, StockId } from './types';

export interface DisclosureContext {
  stockName: string;
  nameOf: (id: StockId) => string;
  minPrice: number;
}

/** Drafts the four reveals for one rule. The fourth is always the full formula. */
export function defaultDisclosures(params: RuleParams, ctx: DisclosureContext): DisclosureSegments {
  const full = templateOf(params).describe(params, ctx);
  const name = ctx.stockName;

  switch (params.template) {
    case 'HOLDINGS_DELTA':
      return {
        segments: [
          `${name} responds to the total number of shares held across the whole market, not to any one player's trades.`,
          `The direction depends on whether those total holdings went up or down compared with the previous round.`,
          `The price moves by a fixed number of won for every single share of change — the more the holdings move, the bigger the swing.`,
          full,
        ],
      };

    case 'CROSS_STOCK_DIRECTION': {
      const ref = ctx.nameOf(params.referenceStockId);
      return {
        segments: [
          `${name} is driven by another stock on this market rather than by its own trading.`,
          `It follows whether ${ref}'s price rose during the previous completed round.`,
          `Both outcomes are fixed percentage moves of ${name}'s own opening price — one up, one down.`,
          full,
        ],
      };
    }

    case 'HOLDINGS_SWEET_SPOT':
      return {
        segments: [
          `${name} responds to the total shares held across all participants.`,
          `There is a specific range of total holdings that this stock favours.`,
          `Inside that range the price rises by a fixed amount; outside it the price falls by a fixed amount.`,
          full,
        ],
      };

    case 'RELATIVE_BUY_VOLUME': {
      const cmp = ctx.nameOf(params.comparisonStockId);
      return {
        segments: [
          `${name} measures itself against one other stock every round.`,
          `What is compared is how many shares were bought during the round — purchases only. Sales are not subtracted.`,
          `Buying more than ${cmp} gives a fixed gain; anything else gives a fixed loss.`,
          full,
        ],
      };
    }

    case 'SECRET_DEPENDENT': {
      const ref = ctx.nameOf(params.referenceStockId);
      return {
        segments: [
          `${name} reacts to the secret mechanic rather than to ordinary trading.`,
          `It watches whether a secret has been imposed on ${ref}.`,
          `While that secret is in force ${name} gains a percentage; the rest of the time it loses a fixed amount.`,
          full,
        ],
      };
    }

    case 'MARKET_SENTIMENT':
      return {
        segments: [
          `${name} reacts to the market as a whole rather than to its own trading.`,
          `It counts how many stocks rose and how many fell during the previous completed round.`,
          `A broad rally lifts it by a percentage, a broad sell-off pushes it down by a percentage, and a mixed market leaves it exactly where it was.`,
          full,
        ],
      };

    case 'SCRIPTED_PATH': {
      const schedule = params.prices
        .map((p, r) => (r === 0 ? null : `R${r}: ${p.toLocaleString('en-US')}`))
        .filter(Boolean)
        .join('  ·  ');
      return {
        segments: [
          `Nothing any participant does affects ${name}. Buying it, selling it and imposing secrets on it change nothing.`,
          `Its price for every round of this game was decided before the game began.`,
          `The path both rises and falls across the game — it is not a steady trend in one direction.`,
          `${full}\n\nFull schedule — ${schedule}`,
        ],
      };
    }

    case 'UNCHANGED':
      return {
        segments: [
          `${name} behaves differently from the other stocks on this market.`,
          `No amount of trading moves it.`,
          `Its price is the same in the last round as it was in the first.`,
          full,
        ],
      };
  }
}

/** Which disclosure segments are public at the start of `round`. */
export function revealedSegmentCount(config: SessionConfig, round: number): number {
  let count = 0;
  for (const r of config.disclosure.rounds) {
    if (round >= r) count++;
  }
  return Math.min(count, 4);
}

/**
 * The next segment a participant would receive if they bought intelligence
 * on this stock now, given what is already public and what they already own.
 * Returns null when there is nothing left to sell them.
 */
export function nextIntelSegmentIndex(
  publiclyRevealed: number,
  privatelyOwned: number[],
): number | null {
  const owned = new Set(privatelyOwned);
  for (let i = 0; i < 4; i++) {
    if (i < publiclyRevealed) continue; // already public, not worth selling
    if (owned.has(i)) continue;
    return i;
  }
  return null;
}

/** Human label for a disclosure stage. */
export function disclosureLabel(index: number): string {
  return ['First reveal', 'Second reveal', 'Third reveal', 'Full disclosure'][index] ?? `Reveal ${index + 1}`;
}
