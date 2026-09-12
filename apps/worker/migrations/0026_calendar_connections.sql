PRAGMA foreign_keys = ON;

CREATE TABLE calendar_oauth_states (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('google', 'outlook')),
  state_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE calendar_connections (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('google', 'outlook')),
  provider_account_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'error', 'revoked')),
  refresh_token_ciphertext TEXT NOT NULL,
  refresh_token_iv TEXT NOT NULL,
  refresh_token_key_version INTEGER NOT NULL CHECK (refresh_token_key_version > 0),
  sync_cursor TEXT,
  last_synced_at TEXT,
  last_error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (user_id, provider, provider_account_id)
);

CREATE TABLE calendar_events (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL REFERENCES calendar_connections(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('google', 'outlook')),
  provider_event_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  all_day INTEGER NOT NULL DEFAULT 0 CHECK (all_day IN (0, 1)),
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'tentative', 'cancelled')),
  updated_at TEXT NOT NULL,
  UNIQUE (connection_id, provider_event_id)
);

CREATE INDEX calendar_oauth_states_expiry_idx ON calendar_oauth_states(expires_at, consumed_at);
CREATE INDEX calendar_connections_user_idx ON calendar_connections(user_id, provider, status);
CREATE INDEX calendar_events_user_time_idx ON calendar_events(user_id, starts_at, ends_at);
