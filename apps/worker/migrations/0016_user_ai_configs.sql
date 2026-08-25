PRAGMA foreign_keys = ON;

CREATE TABLE user_ai_configs (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  base_url TEXT NOT NULL,
  model TEXT NOT NULL,
  api_key_ciphertext TEXT NOT NULL,
  encryption_iv TEXT NOT NULL,
  key_fingerprint TEXT NOT NULL,
  key_version INTEGER NOT NULL DEFAULT 1,
  verified_at TEXT,
  last_error_code TEXT,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX user_ai_configs_verified_idx ON user_ai_configs(verified_at, updated_at DESC);
