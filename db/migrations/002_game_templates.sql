-- Custom game templates, and a record of which template a session came from.
--
-- The built-in templates live in code (src/engine/game-templates.ts) so they
-- are versioned with the application. This table holds only the ones an
-- administrator saved themselves.

CREATE TABLE game_templates (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  designer_note TEXT NOT NULL DEFAULT '',
  -- A complete SessionConfig. Validated by the engine before it is stored.
  config        JSONB NOT NULL,
  -- Shared templates are visible to every administrator, read-only.
  is_shared     BOOLEAN NOT NULL DEFAULT FALSE,
  -- Where it came from, for the administrator's own reference.
  derived_from  TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX game_templates_owner_name_key
  ON game_templates (owner_user_id, lower(name));
CREATE INDEX game_templates_owner_idx ON game_templates (owner_user_id, updated_at DESC);
CREATE INDEX game_templates_shared_idx ON game_templates (is_shared) WHERE is_shared;

-- Which template a session was created from, and the scramble seed used,
-- so a session can be described and reproduced exactly.
ALTER TABLE games ADD COLUMN template_id     TEXT;
ALTER TABLE games ADD COLUMN template_source TEXT
  CHECK (template_source IS NULL OR template_source IN ('built-in', 'custom', 'blank'));
ALTER TABLE games ADD COLUMN template_name   TEXT;
ALTER TABLE games ADD COLUMN scramble_seed   BIGINT;
