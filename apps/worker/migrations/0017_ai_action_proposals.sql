PRAGMA foreign_keys = ON;

CREATE TABLE ai_action_proposals (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  tool TEXT NOT NULL CHECK (tool IN ('create_note','create_reminder','create_notification','send_email')),
  input_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','confirmed','rejected','expired','executed','failed')),
  idempotency_key TEXT NOT NULL CHECK (idempotency_key = 'ai-action:' || user_id || ':' || id),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX ai_action_proposals_user_status_expires_idx
  ON ai_action_proposals(user_id, status, expires_at);

CREATE UNIQUE INDEX ai_action_proposals_workspace_idempotency_idx
  ON ai_action_proposals(workspace_id, idempotency_key);
