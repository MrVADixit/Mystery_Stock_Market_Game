/**
 * Request validation for a session configuration.
 *
 * This is a shape check only: it guarantees the JSON is structurally a
 * SessionConfig. The game-design rules (threshold overlaps, missing
 * scripted prices, reference stocks that do not exist, volatility
 * warnings) are the engine validator's job, and run afterwards.
 */

import { z } from 'zod';
import { RULE_TEMPLATE_IDS } from '@/engine/types';
import type { SessionConfig } from '@/engine/types';

const won = z.number().int().min(-1_000_000_000).max(1_000_000_000);
const positiveWon = z.number().int().min(0).max(1_000_000_000);
const bps = z.number().int().min(-1_000_000).max(1_000_000);
const shares = z.number().int().min(0).max(10_000_000);
const stockId = z.string().min(1).max(32);
const tie = z.enum(['positive', 'negative']);

const ruleParams = z.discriminatedUnion('template', [
  z.object({
    template: z.literal('HOLDINGS_DELTA'),
    wonPerShare: positiveWon,
    inverted: z.boolean(),
    maxHoldingsChangePerRound: shares.nullable(),
  }),
  z.object({
    template: z.literal('CROSS_STOCK_DIRECTION'),
    referenceStockId: stockId,
    upBps: bps,
    downBps: bps,
    unchangedCountsAs: tie,
  }),
  z.object({
    template: z.literal('HOLDINGS_SWEET_SPOT'),
    lower: shares,
    upper: shares,
    insideWon: won,
    outsideWon: won,
  }),
  z.object({
    template: z.literal('RELATIVE_BUY_VOLUME'),
    comparisonStockId: stockId,
    aboveWon: won,
    belowWon: won,
    tieCountsAs: tie,
  }),
  z.object({
    template: z.literal('SECRET_DEPENDENT'),
    referenceStockId: stockId,
    activeBps: bps,
    inactiveWon: won,
  }),
  z.object({
    template: z.literal('MARKET_SENTIMENT'),
    universe: z.array(stockId).min(1).max(64),
    risingThreshold: z.number().int().min(1).max(64),
    fallingThreshold: z.number().int().min(1).max(64),
    risingBps: bps,
    fallingBps: bps,
  }),
  z.object({
    template: z.literal('SCRIPTED_PATH'),
    prices: z.array(z.number().int().min(0).max(1_000_000_000)).min(1).max(401),
  }),
  z.object({ template: z.literal('UNCHANGED') }),
]);

const stockSchema = z.object({
  id: stockId,
  name: z.string().min(1).max(60),
  initialPrice: positiveWon,
  rule: ruleParams,
  disclosure: z.object({
    segments: z.tuple([
      z.string().min(1).max(4000),
      z.string().min(1).max(4000),
      z.string().min(1).max(4000),
      z.string().min(1).max(4000),
    ]),
  }),
});

export const sessionConfigSchema = z.object({
  name: z.string().min(1).max(120),
  startingCash: positiveWon,
  minPrice: z.number().int().min(1).max(1_000_000_000),
  maxPrice: z.number().int().min(1).max(1_000_000_000).nullable(),
  maxMovePerRoundBps: z.number().int().min(1).max(1_000_000).nullable(),
  rounds: z.number().int().min(1).max(200),
  roundSeconds: z.number().int().min(5).max(7200),
  stocks: z.array(stockSchema).min(1).max(40),
  secrets: z.object({
    enabled: z.boolean(),
    tokensPerParticipant: z.number().int().min(0).max(100),
    durationRounds: z.number().int().min(1).max(200),
    latestActivationRound: z.number().int().min(1).max(200),
    hidePrice: z.boolean(),
    hideVolume: z.boolean(),
    hideHoldings: z.boolean(),
    hideParticipantAssets: z.boolean(),
    maskHolderAssets: z.boolean(),
    tradingDuringSecret: z.enum(['enabled', 'suspended']),
    allowSimultaneous: z.boolean(),
    simultaneousExtendsDuration: z.boolean(),
  }),
  intel: z.object({
    mode: z.enum(['pieces', 'cash', 'disabled']),
    startingPieces: z.number().int().min(0).max(1000),
    piecePurchaseCostWon: positiveWon.nullable(),
    pieceToCashWon: positiveWon,
    allowPieceToCash: z.boolean(),
    cashPricePerIntelWon: positiveWon,
    deadlineRound: z.number().int().min(1).max(200),
  }),
  disclosure: z.object({
    rounds: z.tuple([
      z.number().int().min(1).max(200),
      z.number().int().min(1).max(200),
      z.number().int().min(1).max(200),
      z.number().int().min(1).max(200),
    ]),
  }),
  trading: z.object({
    maxSharesPerOrder: z.number().int().min(1).max(10_000_000).nullable(),
    maxSharesPerParticipantPerStock: z.number().int().min(1).max(10_000_000).nullable(),
  }),
  publicInfo: z.object({
    showAggregateHoldings: z.boolean(),
    showVolumes: z.boolean(),
    showLeaderboard: z.boolean(),
    showParticipantAssets: z.boolean(),
  }),
});

export function parseSessionConfig(value: unknown): SessionConfig {
  return sessionConfigSchema.parse(value) as SessionConfig;
}

export { RULE_TEMPLATE_IDS };
