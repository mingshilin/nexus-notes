-- Expand the action allowlist without editing the already-published 0022 migration.
PRAGMA foreign_keys = ON;

DROP INDEX IF EXISTS ai_action_proposals_user_status_expires_idx;
DROP INDEX IF EXISTS ai_action_proposals_execution_lease_idx;
DROP INDEX IF EXISTS ai_action_proposals_workspace_idempotency_idx;
DROP INDEX IF EXISTS ai_email_outbox_pending_idx;
DROP INDEX IF EXISTS ai_email_outbox_dispatch_lease_idx;
DROP INDEX IF EXISTS ai_email_outbox_delivery_lease_idx;

ALTER TABLE ai_email_outbox RENAME TO ai_email_outbox_0022;
ALTER TABLE ai_action_proposals RENAME TO ai_action_proposals_0022;

CREATE TABLE ai_action_proposals (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  tool TEXT NOT NULL CHECK (tool IN ('create_note','create_reminder','create_notification','send_email','update_note','move_note','archive_note','restore_note','delete_note','create_folder','apply_tag','create_database_record','update_database_record','apply_template')),
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
  result_json, error_code, error_message, error_status,
  execution_claim_token, execution_lease_until
)
SELECT id, user_id, workspace_id, tool, input_json, status, idempotency_key,
  revision, expires_at, created_at, updated_at, requires_confirmation,
  result_json, error_code, error_message, error_status,
  execution_claim_token, execution_lease_until
FROM ai_action_proposals_0022;

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
FROM ai_email_outbox_0022;

DROP TABLE ai_email_outbox_0022;
DROP TABLE ai_action_proposals_0022;

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
