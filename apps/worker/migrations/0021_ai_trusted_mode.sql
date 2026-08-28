PRAGMA foreign_keys = ON;

CREATE TABLE ai_trusted_modes (
  workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  expires_at TEXT,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  CHECK ((enabled = 0 AND expires_at IS NULL) OR (enabled = 1 AND expires_at IS NOT NULL))
);
