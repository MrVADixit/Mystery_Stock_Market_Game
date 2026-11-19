-- Sign in with Google or GitHub, for administrators.
--
-- Password sign-in is unchanged and remains the bootstrap route: the owner
-- account is still created from OWNER_EMAIL / OWNER_PASSWORD, and an
-- administrator can always get in that way. OAuth is an additional door to
-- an existing account, never a way to create an unexpected one.

-- An administrator who only ever signs in with Google has no password.
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

-- A user may link more than one provider, and the same person's Google and
-- GitHub identities both point at one account.
CREATE TABLE user_identities (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  provider         TEXT NOT NULL CHECK (provider IN ('google', 'github')),
  -- The provider's own stable identifier for the person. Not the email:
  -- an email address can be reassigned, this cannot.
  provider_user_id TEXT NOT NULL,
  email            TEXT,
  display_name     TEXT,
  avatar_url       TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at    TIMESTAMPTZ
);

CREATE UNIQUE INDEX user_identities_provider_key
  ON user_identities (provider, provider_user_id);
CREATE INDEX user_identities_user_idx ON user_identities (user_id);
