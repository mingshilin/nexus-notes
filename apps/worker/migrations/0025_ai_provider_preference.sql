PRAGMA foreign_keys = ON;

CREATE TABLE ai_provider_preferences (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT 'system' CHECK (source IN ('system', 'personal')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_at TEXT NOT NULL
);

CREATE INDEX ai_provider_preferences_source_idx
  ON ai_provider_preferences(source, updated_at DESC);
