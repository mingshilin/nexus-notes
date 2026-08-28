PRAGMA foreign_keys = ON;

-- This migration is intentionally atomic. The test/deployment runners submit the
-- complete statement list as one D1 batch so a failed rebuild leaves the old
-- proposal and outbox tables untouched, and any preserved execution result state
-- stays attached to the legacy proposal rows until the rebuild copies it forward.
CREATE TABLE IF NOT EXISTS ai_note_actions_migration_guard (
  applied INTEGER NOT NULL CHECK (applied = 0)
);
INSERT INTO ai_note_actions_migration_guard (applied)
SELECT CASE WHEN EXISTS (
  SELECT 1 FROM pragma_table_info('ai_action_proposals') WHERE name = 'result_json'
) THEN 1 ELSE 0 END;
DROP TABLE ai_note_actions_migration_guard;

ALTER TABLE notes ADD COLUMN ai_last_mutation_token TEXT;

ALTER TABLE ai_email_outbox RENAME TO ai_email_outbox_legacy;
ALTER TABLE ai_action_proposals RENAME TO ai_action_proposals_legacy;
ALTER TABLE ai_action_proposals_legacy ADD COLUMN result_json TEXT;
ALTER TABLE ai_action_proposals_legacy ADD COLUMN error_code TEXT;
ALTER TABLE ai_action_proposals_legacy ADD COLUMN error_message TEXT;
ALTER TABLE ai_action_proposals_legacy ADD COLUMN error_status INTEGER;

CREATE TABLE ai_action_proposals (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  tool TEXT NOT NULL CHECK (tool IN ('create_note','create_reminder','create_notification','send_email','update_note','move_note','archive_note','restore_note','delete_note')),
  input_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','confirmed','executing','rejected','expired','executed','failed','conflict')),
  idempotency_key TEXT NOT NULL CHECK (idempotency_key = 'ai-action:' || user_id || ':' || id),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  requires_confirmation INTEGER NOT NULL DEFAULT 1 CHECK (requires_confirmation IN (0, 1)),
  result_json TEXT,
  error_code TEXT,
  error_message TEXT,
  error_status INTEGER CHECK (error_status IS NULL OR (error_status >= 400 AND error_status <= 599)),
  execution_claim_token TEXT,
  execution_lease_until TEXT
);

INSERT INTO ai_action_proposals (
  id, user_id, workspace_id, tool, input_json, status, idempotency_key,
  revision, expires_at, created_at, updated_at, requires_confirmation,
  result_json, error_code, error_message, error_status
)
SELECT id, user_id, workspace_id, tool, input_json, status, idempotency_key,
  revision, expires_at, created_at, updated_at, 1, result_json, error_code, error_message, error_status
FROM ai_action_proposals_legacy;

CREATE TABLE ai_email_outbox (
  id TEXT PRIMARY KEY,
  action_id TEXT NOT NULL REFERENCES ai_action_proposals(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  body_text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sending','sent','failed','cancelled')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  available_at TEXT NOT NULL,
  sent_at TEXT,
  last_error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  dispatch_lease_until TEXT,
  dispatch_claim_token TEXT,
  delivery_lease_until TEXT,
  delivery_claim_token TEXT
);

INSERT INTO ai_email_outbox (
  id, action_id, user_id, workspace_id, to_email, subject, body_text,
  status, attempt_count, available_at, sent_at, last_error_code, created_at, updated_at,
  dispatch_lease_until, dispatch_claim_token, delivery_lease_until, delivery_claim_token
)
SELECT id, action_id, user_id, workspace_id, to_email, subject, body_text,
  status, attempt_count, available_at, sent_at, last_error_code, created_at, updated_at,
  dispatch_lease_until, dispatch_claim_token, delivery_lease_until, delivery_claim_token
FROM ai_email_outbox_legacy;

DROP TABLE ai_email_outbox_legacy;
DROP TABLE ai_action_proposals_legacy;

CREATE INDEX ai_action_proposals_user_status_expires_idx
  ON ai_action_proposals(user_id, status, expires_at);
CREATE INDEX ai_action_proposals_execution_lease_idx
  ON ai_action_proposals(status, execution_lease_until);
CREATE UNIQUE INDEX ai_action_proposals_workspace_idempotency_idx
  ON ai_action_proposals(workspace_id, idempotency_key);
CREATE INDEX ai_email_outbox_pending_idx
  ON ai_email_outbox(status, available_at, created_at);
CREATE INDEX ai_email_outbox_dispatch_lease_idx
  ON ai_email_outbox(status, dispatch_lease_until, available_at);
CREATE INDEX ai_email_outbox_delivery_lease_idx
  ON ai_email_outbox(status, delivery_lease_until, dispatch_lease_until);

CREATE TABLE ai_note_action_idempotency (
  idempotency_key TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  note_id TEXT NOT NULL,
  base_revision INTEGER NOT NULL CHECK (base_revision > 0),
  result_revision INTEGER NOT NULL CHECK (result_revision > 0),
  patch_json TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX ai_note_action_idempotency_note_idx
  ON ai_note_action_idempotency(workspace_id, note_id, result_revision);
