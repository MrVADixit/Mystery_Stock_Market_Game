/**
 * Game state projection and secret redaction.
 *
 * This is the only place that decides what each audience may see. Hidden
 * market data is removed here, server-side, before it reaches a response
 * body or a realtime event — it is never sent and then hidden in the UI.
 *
 * Concealment policy for an active secret: a round's price, volume and
 * holdings for the affected stock stay hidden for as long as the secret
 * covering that round is still in force. Once it expires the history
 * becomes visible again, so players can work out after the fact what they
 * were not allowed to see at the time.
 */

import { query } from './db';
import { loadConfig, getGame } from './config-store';
import type { GameRow } from './config-store';
import { advanceIfDue, serverRoundTiming, loadSecretActivations } from './rounds';
import { getPool } from './db';
import { intelOffers } from './intel';
import type { IntelOffer } from './intel';
import { canActivateSecret, secretWindows } from '@/engine/secrets';
import type { SecretWindow } from '@/engine/secrets';
import { revealedSegmentCount, disclosureLabel } from '@/engine/disclosure';
import { templateOf } from '@/engine/templates';
import type { SessionConfig, StockId } from '@/engine/types';

export type Audience = 'participant' | 'display' | 'admin';

export interface StockView {
  id: StockId;
  name: string;
  /** null when a secret is concealing it from this audience. */
  price: number | null;
  previousPrice: number | null;
  changePct: number | null;
  secretActive: boolean;
  tradingSuspended: boolean;
  aggregateHoldings: number | null;
  grossBuys: number | null;
  grossSells: number | null;
  /** The viewer's own holding. Always visible to its owner. */
  myHoldings?: number;
  /** priceHistory[i] is round i+1. null where concealed. */
  priceHistory: (number | null)[];
}

export interface LeaderboardRow {
  rank: number;
  name: string;
  totalAssets: number | null;
  rankChange: number | null;
  isMe: boolean;
}

export interface RuleKnowledgeView {
  stockId: StockId;
  stockName: string;
  templateTitle: string | null;
  /** Segments that are public to everyone. */
  publicSegments: { index: number; label: string; text: string }[];
  /** Segments this participant bought privately. */
  privateSegments: { index: number; label: string; text: string }[];
  /** How many of the four remain unknown to this viewer. */
  lockedCount: number;
}

export interface GameStateView {
  game: {
    id: string;
    name: string;
    status: GameRow['status'];
    round: number;
    totalRounds: number;
    roundSeconds: number;
    secondsRemaining: number;
    endsAt: string | null;
    serverTime: string;
    joinCode?: string;
  };
  stocks: StockView[];
  me?: {
    participantId: string;
    displayName: string;
    cash: number;
    startingCash: number;
    holdingsValue: number;
    totalAssets: number;
    returnPct: number;
    pieces: number;
    secretTokens: number;
    intelSpendWon: number;
    realisedPl: number;
    unrealisedPl: number;
  };
  leaderboard: LeaderboardRow[];
  rules: RuleKnowledgeView[];
  disclosureSchedule: { index: number; label: string; round: number; done: boolean }[];
  announcements: { id: string; body: string; round: number | null; createdAt: string }[];
  secrets: {
    enabled: boolean;
    /** Which stocks are visibly under a secret. Never who imposed it. */
    activeStockIds: StockId[];
    myTokens: number;
    deadlineRound: number;
    durationRounds: number;
    canImpose: boolean;
    reason?: string;
    tradingPolicy: 'enabled' | 'suspended';
  };
  intel: {
    mode: 'pieces' | 'cash' | 'disabled';
    deadlineRound: number;
    offers: IntelOffer[];
    pieceToCashWon: number;
    allowPieceToCash: boolean;
  };
  publicInfo: SessionConfig['publicInfo'];
}

interface Concealment {
  windows: SecretWindow[];
  activeNow: Set<StockId>;
  /** True when round `r` of stock `s` is still being concealed. */
  isRoundHidden: (stockId: StockId, round: number) => boolean;
}

function buildConcealment(windows: SecretWindow[], currentRound: number): Concealment {
  const activeNow = new Set<StockId>();
  for (const w of windows) {
    if (currentRound >= w.firstRound && currentRound <= w.lastRound) activeNow.add(w.stockId);
  }
  return {
    windows,
    activeNow,
    isRoundHidden: (stockId, round) =>
      windows.some(
        (w) =>
          w.stockId === stockId &&
          round >= w.firstRound &&
          round <= w.lastRound &&
          // Only still-running secrets conceal anything.
          w.lastRound >= currentRound,
      ),
  };
}

/**
 * Builds the view for one audience. `participantId` is required for the
 * participant audience and ignored otherwise.
 */
export async function buildGameState(
  gameId: string,
  audience: Audience,
  participantId?: string,
): Promise<GameStateView | null> {
  // Reading the state is also what drives the clock forward.
  await advanceIfDue(gameId);

  const game = await getGame(gameId);
  if (!game) return null;
  const config = await loadConfig(gameId);
  if (!config) return null;
  const timing = (await serverRoundTiming(gameId)) ?? {
    round: game.current_round,
    endsAt: null,
    secondsRemaining: 0,
    serverTime: new Date().toISOString(),
  };

  const round = Math.max(1, game.current_round);
  const pool = getPool();
  const windows = secretWindows(config.secrets, await loadSecretActivations(pool, gameId));
  const conceal = buildConcealment(windows, round);
  const isAdmin = audience === 'admin';

  /* ----------------------------- prices ----------------------------- */

  const priceRows = await query<{ stock_id: string; round: number; price: number }>(
    'SELECT stock_id, round, price FROM stock_prices WHERE game_id = $1 ORDER BY round',
    [gameId],
  );
  const historyByStock = new Map<string, Map<number, number>>();
  for (const r of priceRows) {
    const m = historyByStock.get(r.stock_id) ?? new Map<number, number>();
    m.set(r.round, r.price);
    historyByStock.set(r.stock_id, m);
  }

  /* --------------------------- market stats -------------------------- */

  const holdingTotals = new Map<string, number>();
  for (const r of await query<{ stock_id: string; total: number }>(
    'SELECT stock_id, COALESCE(sum(quantity),0)::bigint AS total FROM holdings WHERE game_id = $1 GROUP BY stock_id',
    [gameId],
  )) {
    holdingTotals.set(r.stock_id, Number(r.total));
  }

  // Volumes shown are the previous completed round's, which is what the
  // display board and participants are allowed to know.
  const activity = new Map<string, { buys: number; sells: number }>();
  if (round > 1) {
    for (const r of await query<{ stock_id: string; gross_buys: number; gross_sells: number }>(
      'SELECT stock_id, gross_buys, gross_sells FROM round_stock_activity WHERE game_id = $1 AND round = $2',
      [gameId, round - 1],
    )) {
      activity.set(r.stock_id, { buys: r.gross_buys, sells: r.gross_sells });
    }
  }

  /* --------------------------- the viewer ---------------------------- */

  let me: GameStateView['me'];
  const myHoldings = new Map<string, number>();
  if (audience === 'participant' && participantId) {
    const p = (
      await query<{
        id: string;
        display_name: string;
        cash: number;
        starting_cash: number;
        pieces: number;
        secret_tokens: number;
        intel_spend_won: number;
      }>(
        `SELECT id, display_name, cash, starting_cash, pieces, secret_tokens, intel_spend_won
           FROM participants WHERE id = $1 AND game_id = $2`,
        [participantId, gameId],
      )
    )[0];
    if (p) {
      for (const h of await query<{ stock_id: string; quantity: number }>(
        'SELECT stock_id, quantity FROM holdings WHERE participant_id = $1',
        [participantId],
      )) {
        myHoldings.set(h.stock_id, h.quantity);
      }

      let holdingsValue = 0;
      for (const stock of config.stocks) {
        const price = historyByStock.get(stock.id)?.get(round) ?? stock.initialPrice;
        holdingsValue += price * (myHoldings.get(stock.id) ?? 0);
      }
      const totalAssets = p.cash + holdingsValue;

      // Realised profit comes from the ledger, never from current balances.
      const pl = (
        await query<{ realised: number; cost_basis: number }>(
          `WITH t AS (
             SELECT stock_id, side, quantity, price FROM transactions WHERE participant_id = $1
           )
           SELECT
             COALESCE(sum(CASE WHEN side = 'sell' THEN quantity * price ELSE -quantity * price END), 0)::bigint AS realised,
             0::bigint AS cost_basis
           FROM t`,
          [participantId],
        )
      )[0];

      me = {
        participantId: p.id,
        displayName: p.display_name,
        cash: p.cash,
        startingCash: p.starting_cash,
        holdingsValue,
        totalAssets,
        returnPct: p.starting_cash > 0 ? ((totalAssets - p.starting_cash) / p.starting_cash) * 100 : 0,
        pieces: p.pieces,
        secretTokens: p.secret_tokens,
        intelSpendWon: p.intel_spend_won,
        // Cash movement from trading alone: what selling brought in minus
        // what buying cost. Adding the current holdings value back gives
        // the total gain, so the unrealised part is the remainder.
        realisedPl: Number(pl?.realised ?? 0),
        unrealisedPl: totalAssets - p.starting_cash - Number(pl?.realised ?? 0),
      };
    }
  }

  /* ---------------------------- stock views -------------------------- */

  const stocks: StockView[] = config.stocks.map((stock) => {
    const history = historyByStock.get(stock.id) ?? new Map<number, number>();
    const secretActive = conceal.activeNow.has(stock.id);
    const hidePrice = !isAdmin && secretActive && config.secrets.hidePrice;
    const hideVolume = !isAdmin && secretActive && config.secrets.hideVolume;
    const hideHoldings = !isAdmin && secretActive && config.secrets.hideHoldings;

    const priceHistory: (number | null)[] = [];
    for (let r = 1; r <= Math.min(round, config.rounds); r++) {
      const value = history.get(r) ?? null;
      const hidden = !isAdmin && config.secrets.hidePrice && conceal.isRoundHidden(stock.id, r);
      priceHistory.push(hidden ? null : value);
    }

    const price = history.get(round) ?? stock.initialPrice;
    const previousPrice = round > 1 ? (history.get(round - 1) ?? null) : null;
    const showVolumes = isAdmin || config.publicInfo.showVolumes;
    const showHoldings = isAdmin || config.publicInfo.showAggregateHoldings;
    const vol = activity.get(stock.id);

    return {
      id: stock.id,
      name: stock.name,
      price: hidePrice ? null : price,
      previousPrice: hidePrice ? null : previousPrice,
      changePct:
        hidePrice || previousPrice == null || previousPrice === 0
          ? null
          : ((price - previousPrice) / previousPrice) * 100,
      secretActive,
      tradingSuspended:
        secretActive && config.secrets.enabled && config.secrets.tradingDuringSecret === 'suspended',
      aggregateHoldings: hideHoldings || !showHoldings ? null : (holdingTotals.get(stock.id) ?? 0),
      grossBuys: hideVolume || !showVolumes ? null : (vol?.buys ?? 0),
      grossSells: hideVolume || !showVolumes ? null : (vol?.sells ?? 0),
      myHoldings: audience === 'participant' ? (myHoldings.get(stock.id) ?? 0) : undefined,
      priceHistory,
    };
  });

  /* ---------------------------- leaderboard -------------------------- */

  const leaderboard = await buildLeaderboard(
    gameId,
    config,
    round,
    audience,
    participantId,
    conceal,
    historyByStock,
  );

  /* ------------------------ rules and intel -------------------------- */

  const publicRevealed = revealedSegmentCount(config, round);
  const ownedSegments = new Map<string, number[]>();
  if (participantId) {
    for (const row of await query<{ stock_id: string; segment_index: number }>(
      'SELECT stock_id, segment_index FROM intel_purchases WHERE participant_id = $1',
      [participantId],
    )) {
      const list = ownedSegments.get(row.stock_id) ?? [];
      list.push(row.segment_index);
      ownedSegments.set(row.stock_id, list);
    }
  }

  const rules: RuleKnowledgeView[] = config.stocks.map((stock) => {
    const owned = new Set(ownedSegments.get(stock.id) ?? []);
    const publicSegments: RuleKnowledgeView['publicSegments'] = [];
    const privateSegments: RuleKnowledgeView['privateSegments'] = [];
    for (let i = 0; i < 4; i++) {
      const entry = { index: i, label: disclosureLabel(i), text: stock.disclosure.segments[i] };
      if (i < publicRevealed || isAdmin) publicSegments.push(entry);
      else if (owned.has(i)) privateSegments.push(entry);
    }
    return {
      stockId: stock.id,
      stockName: stock.name,
      // The template name is itself a clue, so only the administrator and
      // anyone who has reached full disclosure sees it.
      templateTitle:
        isAdmin || publicRevealed >= 4
          ? templateOf(stock.rule).title
          : null,
      publicSegments,
      privateSegments,
      lockedCount: Math.max(0, 4 - publicSegments.length - privateSegments.length),
    };
  });

  const offers =
    audience === 'participant' && participantId
      ? await intelOffers(gameId, participantId, config, round)
      : [];

  const announcements = (
    await query<{ id: string; body: string; round: number | null; created_at: Date }>(
      'SELECT id, body, round, created_at FROM announcements WHERE game_id = $1 ORDER BY created_at DESC LIMIT 20',
      [gameId],
    )
  ).map((a) => ({ id: a.id, body: a.body, round: a.round, createdAt: a.created_at.toISOString() }));

  const myTokens = me?.secretTokens ?? 0;
  const permission =
    audience === 'participant'
      ? canActivateSecret(config.secrets, windows, config.stocks[0]?.id ?? '', round, myTokens)
      : { allowed: false as boolean, reason: undefined as string | undefined };

  return {
    game: {
      id: game.id,
      name: config.name,
      status: game.status,
      round,
      totalRounds: config.rounds,
      roundSeconds: config.roundSeconds,
      secondsRemaining: timing.secondsRemaining,
      endsAt: timing.endsAt,
      serverTime: timing.serverTime,
      joinCode: isAdmin ? game.join_code : undefined,
    },
    stocks,
    me,
    leaderboard,
    rules,
    disclosureSchedule: config.disclosure.rounds.map((r, index) => ({
      index,
      label: disclosureLabel(index),
      round: r,
      done: round >= r,
    })),
    announcements,
    secrets: {
      enabled: config.secrets.enabled,
      activeStockIds: [...conceal.activeNow],
      myTokens,
      deadlineRound: config.secrets.latestActivationRound,
      durationRounds: config.secrets.durationRounds,
      canImpose: audience === 'participant' && permission.allowed,
      reason: permission.reason,
      tradingPolicy: config.secrets.tradingDuringSecret,
    },
    intel: {
      mode: config.intel.mode,
      deadlineRound: config.intel.deadlineRound,
      offers,
      pieceToCashWon: config.intel.pieceToCashWon,
      allowPieceToCash: config.intel.allowPieceToCash,
    },
    publicInfo: config.publicInfo,
  };
}

async function buildLeaderboard(
  gameId: string,
  config: SessionConfig,
  round: number,
  audience: Audience,
  participantId: string | undefined,
  conceal: Concealment,
  historyByStock: Map<string, Map<number, number>>,
): Promise<LeaderboardRow[]> {
  const isAdmin = audience === 'admin';
  if (!isAdmin && !config.publicInfo.showLeaderboard) return [];

  const participants = await query<{ id: string; display_name: string; cash: number }>(
    'SELECT id, display_name, cash FROM participants WHERE game_id = $1',
    [gameId],
  );
  if (participants.length === 0) return [];

  const holdings = await query<{ participant_id: string; stock_id: string; quantity: number }>(
    'SELECT participant_id, stock_id, quantity FROM holdings WHERE game_id = $1 AND quantity > 0',
    [gameId],
  );

  const valueOf = new Map<string, number>();
  const touchesSecretStock = new Set<string>();
  for (const h of holdings) {
    const price = historyByStock.get(h.stock_id)?.get(round) ?? 0;
    valueOf.set(h.participant_id, (valueOf.get(h.participant_id) ?? 0) + price * h.quantity);
    if (conceal.activeNow.has(h.stock_id)) touchesSecretStock.add(h.participant_id);
  }

  // Previous round's ranks, for the rank-change column.
  const previousRanks = new Map<string, number>();
  if (round > 1) {
    for (const r of await query<{ participant_id: string; rank: number }>(
      'SELECT participant_id, rank FROM participant_round_values WHERE game_id = $1 AND round = $2',
      [gameId, round - 1],
    )) {
      if (r.rank != null) previousRanks.set(r.participant_id, r.rank);
    }
  }

  const anySecretActive = conceal.activeNow.size > 0;
  const hideAssets =
    !isAdmin && anySecretActive && config.secrets.enabled && config.secrets.hideParticipantAssets;
  const showAssets = isAdmin || config.publicInfo.showParticipantAssets;

  return participants
    .map((p) => ({
      id: p.id,
      name: p.display_name,
      total: p.cash + (valueOf.get(p.id) ?? 0),
    }))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))
    .map((row, index) => {
      const previous = previousRanks.get(row.id);
      // Rankings always stay visible, even while a secret conceals values.
      const maskedForHolder =
        !isAdmin &&
        config.secrets.enabled &&
        config.secrets.maskHolderAssets &&
        touchesSecretStock.has(row.id);
      return {
        rank: index + 1,
        name: row.name,
        totalAssets: hideAssets || maskedForHolder || !showAssets ? null : row.total,
        rankChange: previous != null ? previous - (index + 1) : null,
        isMe: participantId === row.id,
      };
    });
}
