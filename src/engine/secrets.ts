/**
 * Secret timing.
 *
 * A secret imposed during round A covers rounds A+1 .. A+duration. With the
 * classic two-round duration, a secret imposed in round 2 is active during
 * rounds 3 and 4 and has expired before round 5.
 */

import type { SecretConfig, StockId } from './types';

export interface SecretActivation {
  /** The round during which the token was spent. */
  round: number;
  stockId: StockId;
  /** Who spent it. Never exposed to other participants. */
  participantId?: string;
}

export interface SecretWindow {
  stockId: StockId;
  activatedInRound: number;
  /** First round the secret is in force. */
  firstRound: number;
  /** Last round the secret is in force, inclusive. */
  lastRound: number;
  /** How many tokens were spent on this stock in this round. */
  tokensSpent: number;
}

/** Turns raw activations into concrete active windows. */
export function secretWindows(config: SecretConfig, activations: SecretActivation[]): SecretWindow[] {
  if (!config.enabled) return [];
  // Tokens spent on the same stock in the same round form one group.
  const groups = new Map<string, { stockId: StockId; round: number; count: number }>();
  for (const a of activations) {
    const key = `${a.stockId}@${a.round}`;
    const existing = groups.get(key);
    if (existing) existing.count++;
    else groups.set(key, { stockId: a.stockId, round: a.round, count: 1 });
  }

  const windows: SecretWindow[] = [];
  for (const g of groups.values()) {
    // Default: simultaneous activations consume every token but grant only
    // one normal secret period. Durations are never added together unless
    // the administrator explicitly turns that on.
    const duration = config.simultaneousExtendsDuration
      ? config.durationRounds * g.count
      : config.durationRounds;
    windows.push({
      stockId: g.stockId,
      activatedInRound: g.round,
      firstRound: g.round + 1,
      lastRound: g.round + duration,
      tokensSpent: g.count,
    });
  }
  return windows.sort((a, b) => a.firstRound - b.firstRound || a.stockId.localeCompare(b.stockId));
}

/** Is a secret in force on `stockId` during `round`? */
export function isSecretActive(windows: SecretWindow[], stockId: StockId, round: number): boolean {
  return windows.some((w) => w.stockId === stockId && round >= w.firstRound && round <= w.lastRound);
}

/** The map the settlement snapshot needs: which stocks are covered next round. */
export function secretStateForRound(
  stockIds: StockId[],
  windows: SecretWindow[],
  round: number,
): Record<StockId, boolean> {
  const out: Record<StockId, boolean> = {};
  for (const id of stockIds) out[id] = isSecretActive(windows, id, round);
  return out;
}

/** May a participant impose a secret on this stock right now? */
export function canActivateSecret(
  config: SecretConfig,
  windows: SecretWindow[],
  stockId: StockId,
  currentRound: number,
  tokensRemaining: number,
): { allowed: boolean; reason?: string } {
  if (!config.enabled) return { allowed: false, reason: 'Secrets are not available in this game.' };
  if (tokensRemaining < 1) return { allowed: false, reason: 'You have no secret tokens left.' };
  if (currentRound > config.latestActivationRound)
    return {
      allowed: false,
      reason: `Secrets could only be imposed up to the end of round ${config.latestActivationRound}.`,
    };
  if (!config.allowSimultaneous) {
    // Block if the stock is already covered next round or later by an
    // existing window.
    const covered = windows.some((w) => w.stockId === stockId && w.lastRound >= currentRound + 1);
    if (covered)
      return { allowed: false, reason: 'A secret is already in force on that stock.' };
  }
  return { allowed: true };
}
