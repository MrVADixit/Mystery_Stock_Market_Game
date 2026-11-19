import { describe, expect, it } from 'vitest';
import { canActivateSecret, isSecretActive, secretStateForRound, secretWindows } from './secrets';
import { classicPreset } from './preset';
import type { SecretConfig } from './types';

const base: SecretConfig = classicPreset().secrets;

describe('secret timing', () => {
  it('a secret imposed in round 2 covers rounds 3 and 4 and expires before round 5', () => {
    const w = secretWindows(base, [{ round: 2, stockId: 'x' }]);
    expect(w).toHaveLength(1);
    expect(w[0].firstRound).toBe(3);
    expect(w[0].lastRound).toBe(4);
    expect(isSecretActive(w, 'x', 2)).toBe(false);
    expect(isSecretActive(w, 'x', 3)).toBe(true);
    expect(isSecretActive(w, 'x', 4)).toBe(true);
    expect(isSecretActive(w, 'x', 5)).toBe(false);
  });

  it('is not active in the round it was imposed', () => {
    const w = secretWindows(base, [{ round: 7, stockId: 'x' }]);
    expect(isSecretActive(w, 'x', 7)).toBe(false);
    expect(isSecretActive(w, 'x', 8)).toBe(true);
  });

  it('only covers the stock it was imposed on', () => {
    const w = secretWindows(base, [{ round: 1, stockId: 'x' }]);
    expect(isSecretActive(w, 'y', 2)).toBe(false);
  });

  it('does not add durations together for simultaneous activations', () => {
    const w = secretWindows(base, [
      { round: 2, stockId: 'x', participantId: 'p1' },
      { round: 2, stockId: 'x', participantId: 'p2' },
      { round: 2, stockId: 'x', participantId: 'p3' },
    ]);
    expect(w).toHaveLength(1);
    expect(w[0].tokensSpent).toBe(3);
    expect(w[0].lastRound).toBe(4); // still only two rounds
    expect(isSecretActive(w, 'x', 5)).toBe(false);
  });

  it('can be configured so simultaneous activations do extend the duration', () => {
    const extending: SecretConfig = { ...base, simultaneousExtendsDuration: true };
    const w = secretWindows(extending, [
      { round: 2, stockId: 'x' },
      { round: 2, stockId: 'x' },
    ]);
    expect(w[0].lastRound).toBe(6); // 2 + (2 x 2)
  });

  it('unions windows from activations in different rounds', () => {
    const w = secretWindows(base, [
      { round: 2, stockId: 'x' },
      { round: 4, stockId: 'x' },
    ]);
    expect(isSecretActive(w, 'x', 3)).toBe(true);
    expect(isSecretActive(w, 'x', 4)).toBe(true);
    expect(isSecretActive(w, 'x', 5)).toBe(true);
    expect(isSecretActive(w, 'x', 6)).toBe(true);
    expect(isSecretActive(w, 'x', 7)).toBe(false);
  });

  it('returns no windows at all when secrets are disabled', () => {
    expect(secretWindows({ ...base, enabled: false }, [{ round: 1, stockId: 'x' }])).toEqual([]);
  });

  it('builds the per-round state map the settlement needs', () => {
    const w = secretWindows(base, [{ round: 2, stockId: 'b' }]);
    expect(secretStateForRound(['a', 'b', 'c'], w, 3)).toEqual({ a: false, b: true, c: false });
    expect(secretStateForRound(['a', 'b', 'c'], w, 5)).toEqual({ a: false, b: false, c: false });
  });

  it('honours a custom duration', () => {
    const w = secretWindows({ ...base, durationRounds: 4 }, [{ round: 1, stockId: 'x' }]);
    expect(w[0].firstRound).toBe(2);
    expect(w[0].lastRound).toBe(5);
  });
});

describe('secret activation permission', () => {
  it('refuses without a token', () => {
    expect(canActivateSecret(base, [], 'x', 3, 0).allowed).toBe(false);
  });

  it('allows with a token before the deadline', () => {
    expect(canActivateSecret(base, [], 'x', 3, 1).allowed).toBe(true);
  });

  it('refuses after the configured deadline round', () => {
    const r = canActivateSecret(base, [], 'x', base.latestActivationRound + 1, 1);
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain('round 20');
  });

  it('allows exactly on the deadline round', () => {
    expect(canActivateSecret(base, [], 'x', base.latestActivationRound, 1).allowed).toBe(true);
  });

  it('refuses when secrets are disabled', () => {
    expect(canActivateSecret({ ...base, enabled: false }, [], 'x', 1, 1).allowed).toBe(false);
  });

  it('can forbid a second simultaneous secret on the same stock', () => {
    const cfg = { ...base, allowSimultaneous: false };
    const w = secretWindows(cfg, [{ round: 2, stockId: 'x' }]);
    expect(canActivateSecret(cfg, w, 'x', 3, 1).allowed).toBe(false);
    expect(canActivateSecret(cfg, w, 'y', 3, 1).allowed).toBe(true);
    // Once it has expired the stock is available again.
    expect(canActivateSecret(cfg, w, 'x', 5, 1).allowed).toBe(true);
  });

  it('allows simultaneous secrets by default', () => {
    const w = secretWindows(base, [{ round: 2, stockId: 'x' }]);
    expect(canActivateSecret(base, w, 'x', 3, 1).allowed).toBe(true);
  });
});
