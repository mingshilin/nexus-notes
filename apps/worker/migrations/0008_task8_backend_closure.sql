PRAGMA foreign_keys = ON;

-- Backfill nullable fields introduced by 0007 without rewriting that applied migration.
UPDATE activity_logs
SET request_id = 'legacy-activity:' || id
WHERE request_id IS NULL OR trim(request_id) = '';
UPDATE activity_logs
SET target_type = CASE
  WHEN target_type IS NULL OR trim(target_type) = '' THEN entity_type
  ELSE target_type
END;
UPDATE activity_logs
SET target_id = CASE
  WHEN target_id IS NOT NULL AND trim(target_id) <> '' THEN target_id
  WHEN entity_id IS NOT NULL AND trim(entity_id) <> '' THEN entity_id
  ELSE 'legacy-target:' || id
END;

-- Operation-local marker rows make the source mutation and its audit conditional on
-- the same transaction's winning predicate, even when timestamps collide.
CREATE TABLE collaboration_operation_results (
  operation_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  operation_type TEXT NOT NULL,
  target_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE collaboration_operation_guard (
  id INTEGER PRIMARY KEY CHECK (id = 1)
);
INSERT INTO collaboration_operation_guard (id) VALUES (1);

ALTER TABLE comments ADD COLUMN idempotency_fingerprint TEXT;
DROP INDEX comments_workspace_idempotency;
CREATE UNIQUE INDEX comments_actor_idempotency
  ON comments(workspace_id, author_user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX comments_idempotency_fingerprint
  ON comments(workspace_id, author_user_id, idempotency_fingerprint)
  WHERE idempotency_fingerprint IS NOT NULL;

CREATE TABLE workspace_membership_epochs (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  membership_epoch INTEGER NOT NULL CHECK (membership_epoch > 0),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  revoked_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, user_id)
);

INSERT INTO workspace_membership_epochs
  (workspace_id, user_id, membership_epoch, is_active, revoked_at, updated_at)
SELECT workspace_id, user_id, 1, 1, NULL, updated_at FROM workspace_members;

CREATE INDEX workspace_membership_epochs_active
  ON workspace_membership_epochs(workspace_id, user_id, is_active, membership_epoch);

CREATE TRIGGER workspace_members_epoch_after_insert
AFTER INSERT ON workspace_members
BEGIN
  INSERT INTO workspace_membership_epochs
    (workspace_id, user_id, membership_epoch, is_active, revoked_at, updated_at)
  VALUES (NEW.workspace_id, NEW.user_id, 1, 1, NULL, NEW.updated_at)
  ON CONFLICT(workspace_id, user_id) DO UPDATE SET
    membership_epoch = workspace_membership_epochs.membership_epoch + 1,
    is_active = 1,
    revoked_at = NULL,
    updated_at = excluded.updated_at;
END;

CREATE TRIGGER workspace_members_epoch_after_delete
AFTER DELETE ON workspace_members
BEGIN
  UPDATE workspace_membership_epochs
  SET membership_epoch = membership_epoch + 1,
      is_active = 0,
      revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE workspace_id = OLD.workspace_id AND user_id = OLD.user_id;
END;
