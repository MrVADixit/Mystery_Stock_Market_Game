/**
 * Translation between the engine's SessionConfig and the database rows.
 *
 * The engine knows nothing about SQL and the database knows nothing about
 * the engine's types; this module is the only place the two meet.
 */

import type { PoolClient } from 'pg';
import { query, queryOne } from './db';
import type { DisclosureSegments, RuleParams, SessionConfig, StockConfig } from '@/engine/types';

type Runner = Pick<PoolClient, 'query'>;

interface ConfigRow {
  starting_cash: number;
  min_price: number;
  max_price: number | null;
  max_move_per_round_bps: number | null;
  rounds: number;
  round_seconds: number;
  secrets_enabled: boolean;
  secret_tokens_per_participant: number;
  secret_duration_rounds: number;
  secret_latest_round: number;
  secret_hide_price: boolean;
  secret_hide_volume: boolean;
  secret_hide_holdings: boolean;
  secret_hide_assets: boolean;
  secret_mask_holder_assets: boolean;
  secret_trading_policy: 'enabled' | 'suspended';
  secret_allow_simultaneous: boolean;
  secret_simultaneous_extends: boolean;
  intel_mode: 'pieces' | 'cash' | 'disabled';
  intel_starting_pieces: number;
  intel_piece_cost_won: number | null;
  intel_piece_to_cash_won: number;
  intel_allow_piece_cash: boolean;
  intel_cash_price_won: number;
  intel_deadline_round: number;
  disclosure_rounds: number[];
  max_shares_per_order: number | null;
  max_shares_per_participant_stock: number | null;
  public_show_holdings: boolean;
  public_show_volumes: boolean;
  public_show_leaderboard: boolean;
  public_show_assets: boolean;
}

interface StockRow {
  stock_id: string;
  ord: number;
  name: string;
  initial_price: number;
  template_id: string;
  params: Record<string, unknown>;
  disclosure_segments: string[];
}

/** Reads one game's complete configuration back into engine form. */
export async function loadConfig(gameId: string, runner?: Runner): Promise<SessionConfig | null> {
  const run = runner
    ? async <T>(sql: string, p: unknown[]) => (await runner.query(sql, p as never[])).rows as T[]
    : async <T>(sql: string, p: unknown[]) => (await query(sql, p)) as T[];

  const game = (await run<{ name: string }>('SELECT name FROM games WHERE id = $1', [gameId]))[0];
  if (!game) return null;
  const cfg = (await run<ConfigRow>('SELECT * FROM game_configs WHERE game_id = $1', [gameId]))[0];
  if (!cfg) return null;

  const rows = await run<StockRow>(
    `SELECT s.stock_id, s.ord, s.name, s.initial_price,
            r.template_id, r.params, r.disclosure_segments
       FROM stocks s
       JOIN stock_rules r ON r.game_id = s.game_id AND r.stock_id = s.stock_id
      WHERE s.game_id = $1
      ORDER BY s.ord`,
    [gameId],
  );

  const stocks: StockConfig[] = rows.map((r) => ({
    id: r.stock_id,
    name: r.name,
    initialPrice: r.initial_price,
    rule: { template: r.template_id, ...r.params } as RuleParams,
    disclosure: { segments: r.disclosure_segments as DisclosureSegments['segments'] },
  }));

  return {
    name: game.name,
    startingCash: cfg.starting_cash,
    minPrice: cfg.min_price,
    maxPrice: cfg.max_price,
    maxMovePerRoundBps: cfg.max_move_per_round_bps,
    rounds: cfg.rounds,
    roundSeconds: cfg.round_seconds,
    stocks,
    secrets: {
      enabled: cfg.secrets_enabled,
      tokensPerParticipant: cfg.secret_tokens_per_participant,
      durationRounds: cfg.secret_duration_rounds,
      latestActivationRound: cfg.secret_latest_round,
      hidePrice: cfg.secret_hide_price,
      hideVolume: cfg.secret_hide_volume,
      hideHoldings: cfg.secret_hide_holdings,
      hideParticipantAssets: cfg.secret_hide_assets,
      maskHolderAssets: cfg.secret_mask_holder_assets,
      tradingDuringSecret: cfg.secret_trading_policy,
      allowSimultaneous: cfg.secret_allow_simultaneous,
      simultaneousExtendsDuration: cfg.secret_simultaneous_extends,
    },
    intel: {
      mode: cfg.intel_mode,
      startingPieces: cfg.intel_starting_pieces,
      piecePurchaseCostWon: cfg.intel_piece_cost_won,
      pieceToCashWon: cfg.intel_piece_to_cash_won,
      allowPieceToCash: cfg.intel_allow_piece_cash,
      cashPricePerIntelWon: cfg.intel_cash_price_won,
      deadlineRound: cfg.intel_deadline_round,
    },
    disclosure: { rounds: cfg.disclosure_rounds as [number, number, number, number] },
    trading: {
      maxSharesPerOrder: cfg.max_shares_per_order,
      maxSharesPerParticipantPerStock: cfg.max_shares_per_participant_stock,
    },
    publicInfo: {
      showAggregateHoldings: cfg.public_show_holdings,
      showVolumes: cfg.public_show_volumes,
      showLeaderboard: cfg.public_show_leaderboard,
      showParticipantAssets: cfg.public_show_assets,
    },
  };
}

/** Writes a whole configuration, replacing whatever was stored before. */
export async function saveConfig(
  client: PoolClient,
  gameId: string,
  config: SessionConfig,
): Promise<void> {
  await client.query('UPDATE games SET name = $2 WHERE id = $1', [gameId, config.name]);

  await client.query(
    `INSERT INTO game_configs (
       game_id, starting_cash, min_price, max_price, max_move_per_round_bps, rounds, round_seconds,
       secrets_enabled, secret_tokens_per_participant, secret_duration_rounds, secret_latest_round,
       secret_hide_price, secret_hide_volume, secret_hide_holdings, secret_hide_assets,
       secret_mask_holder_assets, secret_trading_policy, secret_allow_simultaneous, secret_simultaneous_extends,
       intel_mode, intel_starting_pieces, intel_piece_cost_won, intel_piece_to_cash_won,
       intel_allow_piece_cash, intel_cash_price_won, intel_deadline_round,
       disclosure_rounds, max_shares_per_order, max_shares_per_participant_stock,
       public_show_holdings, public_show_volumes, public_show_leaderboard, public_show_assets, updated_at
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,
       $8,$9,$10,$11,
       $12,$13,$14,$15,
       $16,$17,$18,$19,
       $20,$21,$22,$23,
       $24,$25,$26,
       $27,$28,$29,
       $30,$31,$32,$33, now()
     )
     ON CONFLICT (game_id) DO UPDATE SET
       starting_cash = EXCLUDED.starting_cash,
       min_price = EXCLUDED.min_price,
       max_price = EXCLUDED.max_price,
       max_move_per_round_bps = EXCLUDED.max_move_per_round_bps,
       rounds = EXCLUDED.rounds,
       round_seconds = EXCLUDED.round_seconds,
       secrets_enabled = EXCLUDED.secrets_enabled,
       secret_tokens_per_participant = EXCLUDED.secret_tokens_per_participant,
       secret_duration_rounds = EXCLUDED.secret_duration_rounds,
       secret_latest_round = EXCLUDED.secret_latest_round,
       secret_hide_price = EXCLUDED.secret_hide_price,
       secret_hide_volume = EXCLUDED.secret_hide_volume,
       secret_hide_holdings = EXCLUDED.secret_hide_holdings,
       secret_hide_assets = EXCLUDED.secret_hide_assets,
       secret_mask_holder_assets = EXCLUDED.secret_mask_holder_assets,
       secret_trading_policy = EXCLUDED.secret_trading_policy,
       secret_allow_simultaneous = EXCLUDED.secret_allow_simultaneous,
       secret_simultaneous_extends = EXCLUDED.secret_simultaneous_extends,
       intel_mode = EXCLUDED.intel_mode,
       intel_starting_pieces = EXCLUDED.intel_starting_pieces,
       intel_piece_cost_won = EXCLUDED.intel_piece_cost_won,
       intel_piece_to_cash_won = EXCLUDED.intel_piece_to_cash_won,
       intel_allow_piece_cash = EXCLUDED.intel_allow_piece_cash,
       intel_cash_price_won = EXCLUDED.intel_cash_price_won,
       intel_deadline_round = EXCLUDED.intel_deadline_round,
       disclosure_rounds = EXCLUDED.disclosure_rounds,
       max_shares_per_order = EXCLUDED.max_shares_per_order,
       max_shares_per_participant_stock = EXCLUDED.max_shares_per_participant_stock,
       public_show_holdings = EXCLUDED.public_show_holdings,
       public_show_volumes = EXCLUDED.public_show_volumes,
       public_show_leaderboard = EXCLUDED.public_show_leaderboard,
       public_show_assets = EXCLUDED.public_show_assets,
       updated_at = now()`,
    [
      gameId,
      config.startingCash,
      config.minPrice,
      config.maxPrice,
      config.maxMovePerRoundBps,
      config.rounds,
      config.roundSeconds,
      config.secrets.enabled,
      config.secrets.tokensPerParticipant,
      config.secrets.durationRounds,
      config.secrets.latestActivationRound,
      config.secrets.hidePrice,
      config.secrets.hideVolume,
      config.secrets.hideHoldings,
      config.secrets.hideParticipantAssets,
      config.secrets.maskHolderAssets,
      config.secrets.tradingDuringSecret,
      config.secrets.allowSimultaneous,
      config.secrets.simultaneousExtendsDuration,
      config.intel.mode,
      config.intel.startingPieces,
      config.intel.piecePurchaseCostWon,
      config.intel.pieceToCashWon,
      config.intel.allowPieceToCash,
      config.intel.cashPricePerIntelWon,
      config.intel.deadlineRound,
      config.disclosure.rounds,
      config.trading.maxSharesPerOrder,
      config.trading.maxSharesPerParticipantPerStock,
      config.publicInfo.showAggregateHoldings,
      config.publicInfo.showVolumes,
      config.publicInfo.showLeaderboard,
      config.publicInfo.showParticipantAssets,
    ],
  );

  // Replace the stock set. Safe before the game starts; once a game is
  // running the caller must not change the stock list, only its numbers.
  const keep = config.stocks.map((s) => s.id);
  await client.query(
    `DELETE FROM stocks WHERE game_id = $1 AND stock_id <> ALL($2::text[])`,
    [gameId, keep],
  );

  for (const [index, stock] of config.stocks.entries()) {
    await client.query(
      `INSERT INTO stocks (game_id, stock_id, ord, name, initial_price)
         VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (game_id, stock_id) DO UPDATE SET
         ord = EXCLUDED.ord, name = EXCLUDED.name, initial_price = EXCLUDED.initial_price`,
      [gameId, stock.id, index, stock.name, stock.initialPrice],
    );
    const { template, ...params } = stock.rule as RuleParams & { template: string };
    await client.query(
      `INSERT INTO stock_rules (game_id, stock_id, template_id, params, disclosure_segments)
         VALUES ($1, $2, $3, $4::jsonb, $5::text[])
       ON CONFLICT (game_id, stock_id) DO UPDATE SET
         template_id = EXCLUDED.template_id,
         params = EXCLUDED.params,
         disclosure_segments = EXCLUDED.disclosure_segments,
         updated_at = now()`,
      [gameId, stock.id, template, JSON.stringify(params), stock.disclosure.segments],
    );
  }
}

export interface GameRow {
  id: string;
  name: string;
  admin_user_id: string;
  status: 'draft' | 'registration' | 'running' | 'paused' | 'finished' | 'archived';
  join_code: string;
  display_token: string | null;
  current_round: number;
  round_started_at: Date | null;
  round_ends_at: Date | null;
  warnings_acknowledged: boolean;
  created_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
  archived_at: Date | null;
}

export async function getGame(gameId: string): Promise<GameRow | null> {
  return queryOne<GameRow>('SELECT * FROM games WHERE id = $1', [gameId]);
}

export async function getGameByJoinCode(code: string): Promise<GameRow | null> {
  return queryOne<GameRow>('SELECT * FROM games WHERE upper(join_code) = upper($1)', [code]);
}
