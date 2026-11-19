-- Mystery Stock Market — initial schema.
--
-- Money is stored as BIGINT whole won throughout. There is no floating
-- point anywhere in the schema, so arithmetic is exact by construction.
-- Where a figure is genuinely template-specific (rule parameters, frozen
-- market snapshots, audit payloads) it is stored as JSONB alongside a real
-- foreign key to the template it belongs to.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

/* ---------------------------------------------------------------- */
/* Identity and roles                                                */
/* ---------------------------------------------------------------- */

CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  -- 'owner' is the developer account that owns the deployment.
  role          TEXT NOT NULL CHECK (role IN ('owner', 'admin')),
  display_name  TEXT NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX users_email_key ON users (lower(email));

/* ---------------------------------------------------------------- */
/* The closed rule-template library                                  */
/* ---------------------------------------------------------------- */

CREATE TABLE rule_templates (
  id      TEXT PRIMARY KEY,
  title   TEXT NOT NULL,
  summary TEXT NOT NULL,
  ord     INT  NOT NULL
);

INSERT INTO rule_templates (id, title, summary, ord) VALUES
  ('HOLDINGS_DELTA',        'Holdings-based price movement', 'Price moves against the change in total market-wide holdings.', 1),
  ('CROSS_STOCK_DIRECTION', 'Cross-stock price direction',   'Follows whether another stock rose in the previous completed round.', 2),
  ('HOLDINGS_SWEET_SPOT',   'Holdings sweet spot',           'Rewards total holdings inside a band, punishes them outside it.', 3),
  ('RELATIVE_BUY_VOLUME',   'Relative buying volume',        'Compares gross purchases against another stock.', 4),
  ('SECRET_DEPENDENT',      'Secret-dependent movement',     'Reacts to a secret imposed on another stock.', 5),
  ('MARKET_SENTIMENT',      'Market-wide sentiment',         'Reacts to how many stocks rose or fell market-wide.', 6),
  ('SCRIPTED_PATH',         'Fixed scripted price path',      'Follows a price schedule written in advance.', 7),
  ('UNCHANGED',             'Unchanged price',               'The price never moves.', 8);

/* ---------------------------------------------------------------- */
/* Game sessions                                                     */
/* ---------------------------------------------------------------- */

CREATE TABLE games (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             TEXT NOT NULL,
  admin_user_id    UUID NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  status           TEXT NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft', 'registration', 'running', 'paused', 'finished', 'archived')),
  -- Short human-typed code participants use to join.
  join_code        TEXT NOT NULL,
  -- Unguessable token for the read-only classroom display board.
  display_token    TEXT,
  current_round    INT  NOT NULL DEFAULT 0,
  round_started_at TIMESTAMPTZ,
  round_ends_at    TIMESTAMPTZ,
  -- Set when the administrator has acknowledged the volatility warnings.
  warnings_acknowledged BOOLEAN NOT NULL DEFAULT FALSE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at       TIMESTAMPTZ,
  finished_at      TIMESTAMPTZ,
  archived_at      TIMESTAMPTZ
);
CREATE UNIQUE INDEX games_join_code_key ON games (upper(join_code));
CREATE INDEX games_admin_idx ON games (admin_user_id, created_at DESC);
CREATE INDEX games_status_idx ON games (status);

-- One row per game. Split out so the live game state above stays narrow.
CREATE TABLE game_configs (
  game_id                 UUID PRIMARY KEY REFERENCES games (id) ON DELETE CASCADE,
  starting_cash           BIGINT NOT NULL CHECK (starting_cash >= 0),
  min_price               BIGINT NOT NULL CHECK (min_price >= 1),
  max_price               BIGINT CHECK (max_price IS NULL OR max_price > min_price),
  max_move_per_round_bps  INT,
  rounds                  INT NOT NULL CHECK (rounds >= 1),
  round_seconds           INT NOT NULL CHECK (round_seconds >= 5),

  secrets_enabled               BOOLEAN NOT NULL,
  secret_tokens_per_participant INT NOT NULL CHECK (secret_tokens_per_participant >= 0),
  secret_duration_rounds        INT NOT NULL CHECK (secret_duration_rounds >= 1),
  secret_latest_round           INT NOT NULL,
  secret_hide_price             BOOLEAN NOT NULL,
  secret_hide_volume            BOOLEAN NOT NULL,
  secret_hide_holdings          BOOLEAN NOT NULL,
  secret_hide_assets            BOOLEAN NOT NULL,
  secret_mask_holder_assets     BOOLEAN NOT NULL,
  secret_trading_policy         TEXT NOT NULL CHECK (secret_trading_policy IN ('enabled', 'suspended')),
  secret_allow_simultaneous     BOOLEAN NOT NULL,
  secret_simultaneous_extends   BOOLEAN NOT NULL,

  intel_mode              TEXT NOT NULL CHECK (intel_mode IN ('pieces', 'cash', 'disabled')),
  intel_starting_pieces   INT NOT NULL CHECK (intel_starting_pieces >= 0),
  intel_piece_cost_won    BIGINT,
  intel_piece_to_cash_won BIGINT NOT NULL CHECK (intel_piece_to_cash_won >= 0),
  intel_allow_piece_cash  BOOLEAN NOT NULL,
  intel_cash_price_won    BIGINT NOT NULL CHECK (intel_cash_price_won >= 0),
  intel_deadline_round    INT NOT NULL,

  disclosure_rounds       INT[] NOT NULL,

  max_shares_per_order              INT,
  max_shares_per_participant_stock  INT,

  public_show_holdings    BOOLEAN NOT NULL,
  public_show_volumes     BOOLEAN NOT NULL,
  public_show_leaderboard BOOLEAN NOT NULL,
  public_show_assets      BOOLEAN NOT NULL,

  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

/* ---------------------------------------------------------------- */
/* Stocks and their rule assignments                                 */
/* ---------------------------------------------------------------- */

CREATE TABLE stocks (
  game_id       UUID NOT NULL REFERENCES games (id) ON DELETE CASCADE,
  -- Stable within the game, e.g. 's1'. Rule references use this.
  stock_id      TEXT NOT NULL,
  ord           INT  NOT NULL,
  name          TEXT NOT NULL,
  initial_price BIGINT NOT NULL CHECK (initial_price >= 0),
  PRIMARY KEY (game_id, stock_id)
);
CREATE INDEX stocks_game_ord_idx ON stocks (game_id, ord);

CREATE TABLE stock_rules (
  game_id     UUID NOT NULL,
  stock_id    TEXT NOT NULL,
  template_id TEXT NOT NULL REFERENCES rule_templates (id) ON DELETE RESTRICT,
  -- Template-specific numbers and stock references.
  params      JSONB NOT NULL,
  -- Exactly four progressive reveals.
  disclosure_segments TEXT[] NOT NULL CHECK (array_length(disclosure_segments, 1) = 4),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (game_id, stock_id),
  FOREIGN KEY (game_id, stock_id) REFERENCES stocks (game_id, stock_id) ON DELETE CASCADE
);
CREATE INDEX stock_rules_template_idx ON stock_rules (template_id);

/* ---------------------------------------------------------------- */
/* Participants                                                      */
/* ---------------------------------------------------------------- */

CREATE TABLE participants (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id        UUID NOT NULL REFERENCES games (id) ON DELETE CASCADE,
  display_name   TEXT NOT NULL,
  -- Participants log in with their name and a passphrase they choose, so
  -- they can reconnect to the same account after losing connection.
  password_hash  TEXT NOT NULL,
  cash           BIGINT NOT NULL CHECK (cash >= 0),
  starting_cash  BIGINT NOT NULL,
  pieces         INT NOT NULL DEFAULT 0 CHECK (pieces >= 0),
  secret_tokens  INT NOT NULL DEFAULT 0 CHECK (secret_tokens >= 0),
  intel_spend_won BIGINT NOT NULL DEFAULT 0,
  joined_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at   TIMESTAMPTZ,
  is_blocked     BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE UNIQUE INDEX participants_game_name_key ON participants (game_id, lower(display_name));
CREATE INDEX participants_game_idx ON participants (game_id);

CREATE TABLE holdings (
  participant_id UUID NOT NULL REFERENCES participants (id) ON DELETE CASCADE,
  game_id        UUID NOT NULL REFERENCES games (id) ON DELETE CASCADE,
  stock_id       TEXT NOT NULL,
  quantity       BIGINT NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  PRIMARY KEY (participant_id, stock_id),
  FOREIGN KEY (game_id, stock_id) REFERENCES stocks (game_id, stock_id) ON DELETE CASCADE
);
CREATE INDEX holdings_game_stock_idx ON holdings (game_id, stock_id);

/* ---------------------------------------------------------------- */
/* Rounds, prices and the frozen market record                       */
/* ---------------------------------------------------------------- */

CREATE TABLE rounds (
  game_id    UUID NOT NULL REFERENCES games (id) ON DELETE CASCADE,
  round      INT  NOT NULL CHECK (round >= 1),
  status     TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'settled')),
  opened_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  ends_at    TIMESTAMPTZ NOT NULL,
  closed_at  TIMESTAMPTZ,
  settled_at TIMESTAMPTZ,
  PRIMARY KEY (game_id, round)
);

CREATE TABLE stock_prices (
  game_id  UUID NOT NULL REFERENCES games (id) ON DELETE CASCADE,
  stock_id TEXT NOT NULL,
  round    INT  NOT NULL CHECK (round >= 1),
  price    BIGINT NOT NULL CHECK (price >= 0),
  PRIMARY KEY (game_id, stock_id, round),
  FOREIGN KEY (game_id, stock_id) REFERENCES stocks (game_id, stock_id) ON DELETE CASCADE
);
CREATE INDEX stock_prices_game_round_idx ON stock_prices (game_id, round);

-- The exact snapshot a settlement was computed from. Replaying this row
-- through the engine must reproduce the same prices.
CREATE TABLE market_snapshots (
  game_id    UUID NOT NULL REFERENCES games (id) ON DELETE CASCADE,
  round      INT  NOT NULL,
  snapshot   JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (game_id, round)
);

CREATE TABLE rule_evaluations (
  game_id       UUID NOT NULL REFERENCES games (id) ON DELETE CASCADE,
  round         INT  NOT NULL,
  stock_id      TEXT NOT NULL,
  template_id   TEXT NOT NULL REFERENCES rule_templates (id),
  branch        TEXT NOT NULL,
  opening_price BIGINT NOT NULL,
  raw_delta     BIGINT NOT NULL,
  applied_delta BIGINT NOT NULL,
  final_price   BIGINT NOT NULL,
  floored       BOOLEAN NOT NULL,
  movement_capped BOOLEAN NOT NULL DEFAULT FALSE,
  explanation   TEXT NOT NULL,
  inputs        JSONB NOT NULL,
  PRIMARY KEY (game_id, round, stock_id)
);
CREATE INDEX rule_evaluations_game_round_idx ON rule_evaluations (game_id, round);

-- Per-round aggregate market activity, kept so the audit never has to be
-- reconstructed from current balances.
CREATE TABLE round_stock_activity (
  game_id      UUID NOT NULL REFERENCES games (id) ON DELETE CASCADE,
  round        INT NOT NULL,
  stock_id     TEXT NOT NULL,
  gross_buys   BIGINT NOT NULL DEFAULT 0,
  gross_sells  BIGINT NOT NULL DEFAULT 0,
  holdings_end BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (game_id, round, stock_id)
);

CREATE TABLE participant_round_values (
  game_id        UUID NOT NULL REFERENCES games (id) ON DELETE CASCADE,
  participant_id UUID NOT NULL REFERENCES participants (id) ON DELETE CASCADE,
  round          INT NOT NULL,
  cash           BIGINT NOT NULL,
  holdings_value BIGINT NOT NULL,
  total_assets   BIGINT NOT NULL,
  rank           INT,
  PRIMARY KEY (participant_id, round)
);
CREATE INDEX prv_game_round_idx ON participant_round_values (game_id, round, total_assets DESC);

/* ---------------------------------------------------------------- */
/* Immutable transaction ledger                                      */
/* ---------------------------------------------------------------- */

CREATE TABLE transactions (
  id              BIGSERIAL PRIMARY KEY,
  game_id         UUID NOT NULL REFERENCES games (id) ON DELETE CASCADE,
  participant_id  UUID NOT NULL REFERENCES participants (id) ON DELETE CASCADE,
  round           INT NOT NULL,
  stock_id        TEXT NOT NULL,
  side            TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
  quantity        BIGINT NOT NULL CHECK (quantity > 0),
  price           BIGINT NOT NULL CHECK (price >= 0),
  amount          BIGINT NOT NULL CHECK (amount >= 0),
  cash_before     BIGINT NOT NULL,
  cash_after      BIGINT NOT NULL,
  shares_before   BIGINT NOT NULL,
  shares_after    BIGINT NOT NULL,
  -- Client-supplied key making a retried submission a no-op.
  idempotency_key TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX transactions_idempotency_key ON transactions (participant_id, idempotency_key);
CREATE INDEX transactions_game_round_idx ON transactions (game_id, round, created_at);
CREATE INDEX transactions_participant_idx ON transactions (participant_id, created_at);
CREATE INDEX transactions_stock_idx ON transactions (game_id, stock_id, round);

-- The ledger is append-only: rows may never be changed or removed.
CREATE OR REPLACE FUNCTION forbid_write() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% on % is not allowed: this table is an immutable ledger',
    TG_OP, TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER transactions_immutable
  BEFORE UPDATE OR DELETE ON transactions
  FOR EACH ROW EXECUTE FUNCTION forbid_write();

/* ---------------------------------------------------------------- */
/* Secrets                                                           */
/* ---------------------------------------------------------------- */

CREATE TABLE secret_activations (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id        UUID NOT NULL REFERENCES games (id) ON DELETE CASCADE,
  -- Never exposed to other participants.
  participant_id UUID NOT NULL REFERENCES participants (id) ON DELETE CASCADE,
  stock_id       TEXT NOT NULL,
  activated_round INT NOT NULL,
  first_round    INT NOT NULL,
  last_round     INT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX secret_activations_game_idx ON secret_activations (game_id, stock_id, first_round);
CREATE TRIGGER secret_activations_immutable
  BEFORE UPDATE OR DELETE ON secret_activations
  FOR EACH ROW EXECUTE FUNCTION forbid_write();

/* ---------------------------------------------------------------- */
/* Intelligence and Pieces                                           */
/* ---------------------------------------------------------------- */

CREATE TABLE intel_purchases (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id        UUID NOT NULL REFERENCES games (id) ON DELETE CASCADE,
  participant_id UUID NOT NULL REFERENCES participants (id) ON DELETE CASCADE,
  stock_id       TEXT NOT NULL,
  segment_index  INT NOT NULL CHECK (segment_index BETWEEN 0 AND 3),
  round          INT NOT NULL,
  cost_pieces    INT NOT NULL DEFAULT 0,
  cost_won       BIGINT NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX intel_purchases_unique ON intel_purchases (participant_id, stock_id, segment_index);
CREATE INDEX intel_purchases_game_idx ON intel_purchases (game_id, created_at);

CREATE TABLE piece_ledger (
  id             BIGSERIAL PRIMARY KEY,
  game_id        UUID NOT NULL REFERENCES games (id) ON DELETE CASCADE,
  participant_id UUID NOT NULL REFERENCES participants (id) ON DELETE CASCADE,
  delta          INT NOT NULL,
  reason         TEXT NOT NULL,
  round          INT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX piece_ledger_participant_idx ON piece_ledger (participant_id, created_at);

/* ---------------------------------------------------------------- */
/* Disclosures and announcements                                     */
/* ---------------------------------------------------------------- */

CREATE TABLE disclosure_events (
  game_id       UUID NOT NULL REFERENCES games (id) ON DELETE CASCADE,
  stock_id      TEXT NOT NULL,
  segment_index INT NOT NULL CHECK (segment_index BETWEEN 0 AND 3),
  round         INT NOT NULL,
  revealed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (game_id, stock_id, segment_index)
);
CREATE INDEX disclosure_events_round_idx ON disclosure_events (game_id, round);

CREATE TABLE announcements (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id    UUID NOT NULL REFERENCES games (id) ON DELETE CASCADE,
  body       TEXT NOT NULL,
  round      INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX announcements_game_idx ON announcements (game_id, created_at DESC);

/* ---------------------------------------------------------------- */
/* Audit trail                                                       */
/* ---------------------------------------------------------------- */

CREATE TABLE audit_events (
  id             BIGSERIAL PRIMARY KEY,
  game_id        UUID REFERENCES games (id) ON DELETE CASCADE,
  participant_id UUID REFERENCES participants (id) ON DELETE CASCADE,
  user_id        UUID REFERENCES users (id) ON DELETE SET NULL,
  actor_type     TEXT NOT NULL CHECK (actor_type IN ('participant', 'admin', 'system', 'display')),
  event_type     TEXT NOT NULL,
  round          INT,
  payload        JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip_hash        TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_events_game_idx ON audit_events (game_id, created_at);
CREATE INDEX audit_events_participant_idx ON audit_events (participant_id, created_at);
CREATE INDEX audit_events_type_idx ON audit_events (event_type);
CREATE TRIGGER audit_events_immutable
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION forbid_write();

/* ---------------------------------------------------------------- */
/* Authentication sessions                                           */
/* ---------------------------------------------------------------- */

CREATE TABLE auth_sessions (
  token_hash     TEXT PRIMARY KEY,
  user_id        UUID REFERENCES users (id) ON DELETE CASCADE,
  participant_id UUID REFERENCES participants (id) ON DELETE CASCADE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at     TIMESTAMPTZ NOT NULL,
  CHECK ((user_id IS NOT NULL) <> (participant_id IS NOT NULL))
);
CREATE INDEX auth_sessions_expiry_idx ON auth_sessions (expires_at);
CREATE INDEX auth_sessions_participant_idx ON auth_sessions (participant_id);

/* ---------------------------------------------------------------- */
/* Rate limiting                                                     */
/* ---------------------------------------------------------------- */

CREATE TABLE rate_limits (
  bucket      TEXT PRIMARY KEY,
  tokens      INT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL DEFAULT now()
);
