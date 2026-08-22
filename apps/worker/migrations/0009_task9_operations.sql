PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS beta_jobs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('index', 'import', 'export', 'email')),
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'complete', 'failed', 'cancelled')),
  payload_json TEXT NOT NULL DEFAULT '{}',
  error_code TEXT,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (workspace_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS beta_jobs_workspace_status_idx
  ON beta_jobs(workspace_id, status, updated_at DESC, id DESC);
