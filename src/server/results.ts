/**
 * Final results, the participant audit trail and CSV exports.
 */

import { query } from './db';
import { loadConfig, getGame } from './config-store';
import type { SessionConfig, StockId } from '@/engine/types';

export interface FinalStanding {
  rank: number;
  participantId: string;
  displayName: string;
  startingCash: number;
  finalCash: number;
  holdingsValue: number;
  netWorth: number;
  gain: number;
  returnPct: number;
  intelSpendWon: number;
  pieces: number;
  holdings: { stockId: StockId; stockName: string; quantity: number; price: number; value: number }[];
}

/**
 * Final assets = cash + market value of remaining holdings. Intelligence
 * and transaction costs are already out of the cash figure, so they are
 * not subtracted again here.
 */
export async function finalResults(gameId: string): Promise<{
  config: SessionConfig;
  finalRound: number;
  prices: Record<StockId, number>;
  standings: FinalStanding[];
} | null> {
  const game = await getGame(gameId);
  const config = await loadConfig(gameId);
  if (!game || !config) return null;

  const finalRound = Math.min(Math.max(1, game.current_round), config.rounds);
  const prices: Record<StockId, number> = {};
  for (const row of await query<{ stock_id: string; price: number }>(
    'SELECT stock_id, price FROM stock_prices WHERE game_id = $1 AND round = $2',
    [gameId, finalRound],
  )) {
    prices[row.stock_id] = row.price;
  }
  for (const stock of config.stocks) if (prices[stock.id] == null) prices[stock.id] = stock.initialPrice;

  const participants = await query<{
    id: string;
    display_name: string;
    cash: number;
    starting_cash: number;
    pieces: number;
    intel_spend_won: number;
  }>(
    `SELECT id, display_name, cash, starting_cash, pieces, intel_spend_won
       FROM participants WHERE game_id = $1`,
    [gameId],
  );

  const holdingRows = await query<{ participant_id: string; stock_id: string; quantity: number }>(
    'SELECT participant_id, stock_id, quantity FROM holdings WHERE game_id = $1',
    [gameId],
  );
  const byParticipant = new Map<string, { stock_id: string; quantity: number }[]>();
  for (const h of holdingRows) {
    const list = byParticipant.get(h.participant_id) ?? [];
    list.push(h);
    byParticipant.set(h.participant_id, list);
  }
  const nameOf = new Map(config.stocks.map((s) => [s.id, s.name]));

  const standings = participants
    .map((p) => {
      const holdings = (byParticipant.get(p.id) ?? [])
        .filter((h) => h.quantity > 0)
        .map((h) => ({
          stockId: h.stock_id,
          stockName: nameOf.get(h.stock_id) ?? h.stock_id,
          quantity: h.quantity,
          price: prices[h.stock_id] ?? 0,
          value: (prices[h.stock_id] ?? 0) * h.quantity,
        }));
      const holdingsValue = holdings.reduce((sum, h) => sum + h.value, 0);
      const netWorth = p.cash + holdingsValue;
      const gain = netWorth - p.starting_cash;
      return {
        rank: 0,
        participantId: p.id,
        displayName: p.display_name,
        startingCash: p.starting_cash,
        finalCash: p.cash,
        holdingsValue,
        netWorth,
        gain,
        returnPct: p.starting_cash > 0 ? (gain / p.starting_cash) * 100 : 0,
        intelSpendWon: p.intel_spend_won,
        pieces: p.pieces,
        holdings,
      };
    })
    .sort((a, b) => b.netWorth - a.netWorth || a.displayName.localeCompare(b.displayName))
    .map((s, i) => ({ ...s, rank: i + 1 }));

  return { config, finalRound, prices, standings };
}

/* ------------------------------------------------------------------ */
/* Individual participant audit (§14.2)                                */
/* ------------------------------------------------------------------ */

export interface AuditTimelineEntry {
  kind: 'trade' | 'intel' | 'secret' | 'piece' | 'session';
  at: string;
  round: number | null;
  summary: string;
  detail: Record<string, unknown>;
}

export interface ParticipantAudit {
  participant: {
    id: string;
    displayName: string;
    startingCash: number;
    cash: number;
    pieces: number;
    secretTokens: number;
    intelSpendWon: number;
    joinedAt: string;
    lastSeenAt: string | null;
  };
  timeline: AuditTimelineEntry[];
  roundValues: { round: number; cash: number; holdingsValue: number; totalAssets: number; rank: number | null }[];
  transactions: {
    id: number;
    at: string;
    round: number;
    stockId: string;
    stockName: string;
    side: 'buy' | 'sell';
    quantity: number;
    price: number;
    amount: number;
    cashBefore: number;
    cashAfter: number;
    sharesBefore: number;
    sharesAfter: number;
  }[];
}

export interface AuditFilters {
  round?: number;
  stockId?: string;
  side?: 'buy' | 'sell';
  from?: string;
  to?: string;
}

export async function participantAudit(
  gameId: string,
  participantId: string,
  filters: AuditFilters = {},
): Promise<ParticipantAudit | null> {
  const config = await loadConfig(gameId);
  if (!config) return null;
  const nameOf = new Map(config.stocks.map((s) => [s.id, s.name]));

  const p = (
    await query<{
      id: string;
      display_name: string;
      starting_cash: number;
      cash: number;
      pieces: number;
      secret_tokens: number;
      intel_spend_won: number;
      joined_at: Date;
      last_seen_at: Date | null;
    }>('SELECT * FROM participants WHERE id = $1 AND game_id = $2', [participantId, gameId])
  )[0];
  if (!p) return null;

  const transactions = await query<{
    id: number;
    created_at: Date;
    round: number;
    stock_id: string;
    side: 'buy' | 'sell';
    quantity: number;
    price: number;
    amount: number;
    cash_before: number;
    cash_after: number;
    shares_before: number;
    shares_after: number;
  }>(
    `SELECT * FROM transactions
      WHERE participant_id = $1
        AND ($2::int  IS NULL OR round = $2)
        AND ($3::text IS NULL OR stock_id = $3)
        AND ($4::text IS NULL OR side = $4)
        AND ($5::timestamptz IS NULL OR created_at >= $5)
        AND ($6::timestamptz IS NULL OR created_at <= $6)
      ORDER BY created_at, id`,
    [
      participantId,
      filters.round ?? null,
      filters.stockId ?? null,
      filters.side ?? null,
      filters.from ?? null,
      filters.to ?? null,
    ],
  );

  const intel = await query<{
    stock_id: string;
    segment_index: number;
    round: number;
    cost_pieces: number;
    cost_won: number;
    created_at: Date;
  }>('SELECT * FROM intel_purchases WHERE participant_id = $1 ORDER BY created_at', [participantId]);

  const secrets = await query<{ stock_id: string; activated_round: number; first_round: number; last_round: number; created_at: Date }>(
    'SELECT stock_id, activated_round, first_round, last_round, created_at FROM secret_activations WHERE participant_id = $1 ORDER BY created_at',
    [participantId],
  );

  const pieces = await query<{ delta: number; reason: string; round: number | null; created_at: Date }>(
    'SELECT delta, reason, round, created_at FROM piece_ledger WHERE participant_id = $1 ORDER BY created_at',
    [participantId],
  );

  const sessionEvents = await query<{ event_type: string; round: number | null; created_at: Date }>(
    `SELECT event_type, round, created_at FROM audit_events
      WHERE participant_id = $1 AND event_type IN ('participant.registered','participant.reconnected')
      ORDER BY created_at`,
    [participantId],
  );

  const roundValues = (
    await query<{ round: number; cash: number; holdings_value: number; total_assets: number; rank: number | null }>(
      'SELECT round, cash, holdings_value, total_assets, rank FROM participant_round_values WHERE participant_id = $1 ORDER BY round',
      [participantId],
    )
  ).map((r) => ({
    round: r.round,
    cash: r.cash,
    holdingsValue: r.holdings_value,
    totalAssets: r.total_assets,
    rank: r.rank,
  }));

  const timeline: AuditTimelineEntry[] = [
    ...sessionEvents.map((e) => ({
      kind: 'session' as const,
      at: e.created_at.toISOString(),
      round: e.round,
      summary: e.event_type === 'participant.registered' ? 'Registered for the game' : 'Reconnected',
      detail: {},
    })),
    ...transactions.map((t) => ({
      kind: 'trade' as const,
      at: t.created_at.toISOString(),
      round: t.round,
      summary: `${t.side === 'buy' ? 'Bought' : 'Sold'} ${t.quantity} ${nameOf.get(t.stock_id) ?? t.stock_id} at ${t.price.toLocaleString('en-US')} won`,
      detail: {
        stock: nameOf.get(t.stock_id) ?? t.stock_id,
        quantity: t.quantity,
        price: t.price,
        amount: t.amount,
        cashBefore: t.cash_before,
        cashAfter: t.cash_after,
        holdingsBefore: t.shares_before,
        holdingsAfter: t.shares_after,
      },
    })),
    ...intel.map((i) => ({
      kind: 'intel' as const,
      at: i.created_at.toISOString(),
      round: i.round,
      summary: `Bought intelligence on ${nameOf.get(i.stock_id) ?? i.stock_id} (reveal ${i.segment_index + 1})`,
      detail: { costPieces: i.cost_pieces, costWon: i.cost_won },
    })),
    ...secrets.map((s) => ({
      kind: 'secret' as const,
      at: s.created_at.toISOString(),
      round: s.activated_round,
      summary: `Imposed a secret on ${nameOf.get(s.stock_id) ?? s.stock_id}, active rounds ${s.first_round}–${s.last_round}`,
      detail: { firstRound: s.first_round, lastRound: s.last_round },
    })),
    ...pieces.map((pl) => ({
      kind: 'piece' as const,
      at: pl.created_at.toISOString(),
      round: pl.round,
      summary: `${pl.delta >= 0 ? '+' : ''}${pl.delta} Piece — ${pl.reason}`,
      detail: {},
    })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  return {
    participant: {
      id: p.id,
      displayName: p.display_name,
      startingCash: p.starting_cash,
      cash: p.cash,
      pieces: p.pieces,
      secretTokens: p.secret_tokens,
      intelSpendWon: p.intel_spend_won,
      joinedAt: p.joined_at.toISOString(),
      lastSeenAt: p.last_seen_at?.toISOString() ?? null,
    },
    timeline,
    roundValues,
    transactions: transactions.map((t) => ({
      id: t.id,
      at: t.created_at.toISOString(),
      round: t.round,
      stockId: t.stock_id,
      stockName: nameOf.get(t.stock_id) ?? t.stock_id,
      side: t.side,
      quantity: t.quantity,
      price: t.price,
      amount: t.amount,
      cashBefore: t.cash_before,
      cashAfter: t.cash_after,
      sharesBefore: t.shares_before,
      sharesAfter: t.shares_after,
    })),
  };
}

/* ------------------------------------------------------------------ */
/* CSV export                                                          */
/* ------------------------------------------------------------------ */

function csv(rows: (string | number | null | boolean)[][]): string {
  const escape = (v: string | number | null | boolean) => {
    if (v == null) return '';
    const s = String(v);
    // Guard against a value being interpreted as a formula by a spreadsheet.
    const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return rows.map((r) => r.map(escape).join(',')).join('\r\n') + '\r\n';
}

export type ExportKind =
  | 'ranking'
  | 'portfolios'
  | 'transactions'
  | 'prices'
  | 'statistics'
  | 'rule-triggers'
  | 'secrets'
  | 'intel';

export async function exportCsv(gameId: string, kind: ExportKind): Promise<{ filename: string; body: string }> {
  const config = await loadConfig(gameId);
  if (!config) throw new Error('That game does not exist.');
  const nameOf = new Map(config.stocks.map((s) => [s.id, s.name]));
  const slug = config.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'game';

  switch (kind) {
    case 'ranking': {
      const results = await finalResults(gameId);
      const rows: (string | number)[][] = [
        ['rank', 'participant', 'starting_cash', 'final_cash', 'holdings_value', 'final_net_worth', 'gain_loss', 'return_pct'],
      ];
      for (const s of results?.standings ?? []) {
        rows.push([
          s.rank,
          s.displayName,
          s.startingCash,
          s.finalCash,
          s.holdingsValue,
          s.netWorth,
          s.gain,
          s.returnPct.toFixed(2),
        ]);
      }
      return { filename: `${slug}-ranking.csv`, body: csv(rows) };
    }

    case 'portfolios': {
      const results = await finalResults(gameId);
      const rows: (string | number)[][] = [['participant', 'stock', 'quantity', 'price', 'value']];
      for (const s of results?.standings ?? []) {
        rows.push([s.displayName, 'CASH', '', '', s.finalCash]);
        for (const h of s.holdings) rows.push([s.displayName, h.stockName, h.quantity, h.price, h.value]);
      }
      return { filename: `${slug}-portfolios.csv`, body: csv(rows) };
    }

    case 'transactions': {
      const rows: (string | number)[][] = [
        ['timestamp', 'round', 'participant', 'stock', 'action', 'quantity', 'price', 'amount', 'cash_before', 'cash_after', 'holdings_before', 'holdings_after'],
      ];
      for (const t of await query<{
        created_at: Date;
        round: number;
        display_name: string;
        stock_id: string;
        side: string;
        quantity: number;
        price: number;
        amount: number;
        cash_before: number;
        cash_after: number;
        shares_before: number;
        shares_after: number;
      }>(
        `SELECT t.created_at, t.round, p.display_name, t.stock_id, t.side, t.quantity, t.price,
                t.amount, t.cash_before, t.cash_after, t.shares_before, t.shares_after
           FROM transactions t JOIN participants p ON p.id = t.participant_id
          WHERE t.game_id = $1 ORDER BY t.created_at, t.id`,
        [gameId],
      )) {
        rows.push([
          t.created_at.toISOString(),
          t.round,
          t.display_name,
          nameOf.get(t.stock_id) ?? t.stock_id,
          t.side.toUpperCase(),
          t.quantity,
          t.price,
          t.amount,
          t.cash_before,
          t.cash_after,
          t.shares_before,
          t.shares_after,
        ]);
      }
      return { filename: `${slug}-transactions.csv`, body: csv(rows) };
    }

    case 'prices': {
      const header = ['round', ...config.stocks.map((s) => s.name)];
      const priceRows = await query<{ stock_id: string; round: number; price: number }>(
        'SELECT stock_id, round, price FROM stock_prices WHERE game_id = $1',
        [gameId],
      );
      const byRound = new Map<number, Record<string, number>>();
      for (const r of priceRows) {
        const entry = byRound.get(r.round) ?? {};
        entry[r.stock_id] = r.price;
        byRound.set(r.round, entry);
      }
      const rows: (string | number)[][] = [header];
      for (const round of [...byRound.keys()].sort((a, b) => a - b)) {
        rows.push([round, ...config.stocks.map((s) => byRound.get(round)?.[s.id] ?? '')]);
      }
      return { filename: `${slug}-prices.csv`, body: csv(rows) };
    }

    case 'statistics': {
      const rows: (string | number)[][] = [['round', 'stock', 'gross_buys', 'gross_sells', 'holdings_end']];
      for (const r of await query<{ round: number; stock_id: string; gross_buys: number; gross_sells: number; holdings_end: number }>(
        'SELECT round, stock_id, gross_buys, gross_sells, holdings_end FROM round_stock_activity WHERE game_id = $1 ORDER BY round, stock_id',
        [gameId],
      )) {
        rows.push([r.round, nameOf.get(r.stock_id) ?? r.stock_id, r.gross_buys, r.gross_sells, r.holdings_end]);
      }
      return { filename: `${slug}-trading-statistics.csv`, body: csv(rows) };
    }

    case 'rule-triggers': {
      const rows: (string | number | boolean)[][] = [
        ['round', 'stock', 'template', 'branch', 'opening_price', 'applied_movement', 'final_price', 'hit_floor', 'explanation'],
      ];
      for (const r of await query<{
        round: number;
        stock_id: string;
        template_id: string;
        branch: string;
        opening_price: number;
        applied_delta: number;
        final_price: number;
        floored: boolean;
        explanation: string;
      }>(
        'SELECT round, stock_id, template_id, branch, opening_price, applied_delta, final_price, floored, explanation FROM rule_evaluations WHERE game_id = $1 ORDER BY round, stock_id',
        [gameId],
      )) {
        rows.push([
          r.round,
          nameOf.get(r.stock_id) ?? r.stock_id,
          r.template_id,
          r.branch,
          r.opening_price,
          r.applied_delta,
          r.final_price,
          r.floored,
          r.explanation,
        ]);
      }
      return { filename: `${slug}-rule-triggers.csv`, body: csv(rows) };
    }

    case 'secrets': {
      const rows: (string | number)[][] = [['imposed_by', 'stock', 'activated_in_round', 'active_from', 'active_until', 'timestamp']];
      for (const r of await query<{
        display_name: string;
        stock_id: string;
        activated_round: number;
        first_round: number;
        last_round: number;
        created_at: Date;
      }>(
        `SELECT p.display_name, s.stock_id, s.activated_round, s.first_round, s.last_round, s.created_at
           FROM secret_activations s JOIN participants p ON p.id = s.participant_id
          WHERE s.game_id = $1 ORDER BY s.created_at`,
        [gameId],
      )) {
        rows.push([
          r.display_name,
          nameOf.get(r.stock_id) ?? r.stock_id,
          r.activated_round,
          r.first_round,
          r.last_round,
          r.created_at.toISOString(),
        ]);
      }
      return { filename: `${slug}-secrets.csv`, body: csv(rows) };
    }

    case 'intel': {
      const rows: (string | number)[][] = [['participant', 'stock', 'reveal_number', 'round', 'cost_pieces', 'cost_won', 'timestamp']];
      for (const r of await query<{
        display_name: string;
        stock_id: string;
        segment_index: number;
        round: number;
        cost_pieces: number;
        cost_won: number;
        created_at: Date;
      }>(
        `SELECT p.display_name, i.stock_id, i.segment_index, i.round, i.cost_pieces, i.cost_won, i.created_at
           FROM intel_purchases i JOIN participants p ON p.id = i.participant_id
          WHERE i.game_id = $1 ORDER BY i.created_at`,
        [gameId],
      )) {
        rows.push([
          r.display_name,
          nameOf.get(r.stock_id) ?? r.stock_id,
          r.segment_index + 1,
          r.round,
          r.cost_pieces,
          r.cost_won,
          r.created_at.toISOString(),
        ]);
      }
      return { filename: `${slug}-intelligence.csv`, body: csv(rows) };
    }
  }
}
