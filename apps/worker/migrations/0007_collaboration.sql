PRAGMA foreign_keys = ON;

CREATE TABLE workspace_invitations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email TEXT NOT NULL COLLATE NOCASE,
  role TEXT NOT NULL CHECK (role IN ('editor', 'viewer')),
  token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')),
  revision INTEGER NOT NULL DEFAULT 1,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  consumption_id TEXT,
  consumed_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX workspace_invitations_pending_email
  ON workspace_invitations(workspace_id, email)
  WHERE status = 'pending' AND consumed_at IS NULL;
CREATE INDEX workspace_invitations_workspace_status
  ON workspace_invitations(workspace_id, status, created_at DESC);
CREATE UNIQUE INDEX workspace_invitations_consumption
  ON workspace_invitations(consumption_id)
  WHERE consumption_id IS NOT NULL;

ALTER TABLE comments ADD COLUMN idempotency_key TEXT;
CREATE UNIQUE INDEX comments_actor_idempotency
  ON comments(workspace_id, author_user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX comments_workspace_target_cursor
  ON comments(workspace_id, entity_type, entity_id, created_at, id);

ALTER TABLE mentions ADD COLUMN source_revision INTEGER NOT NULL DEFAULT 1;
CREATE UNIQUE INDEX mentions_comment_member
  ON mentions(comment_id, mentioned_user_id)
  WHERE comment_id IS NOT NULL;

ALTER TABLE notifications ADD COLUMN dedupe_key TEXT;
ALTER TABLE notifications ADD COLUMN deep_link TEXT NOT NULL DEFAULT '/';
ALTER TABLE notifications ADD COLUMN updated_at TEXT;
CREATE UNIQUE INDEX notifications_workspace_user_dedupe
  ON notifications(workspace_id, user_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL;
CREATE INDEX notifications_user_inbox
  ON notifications(user_id, created_at DESC, id DESC);
CREATE INDEX notifications_user_unread
  ON notifications(user_id, read_at)
  WHERE read_at IS NULL;

ALTER TABLE public_shares ADD COLUMN status TEXT NOT NULL DEFAULT 'active'
  CHECK (status IN ('active', 'revoked', 'expired'));
CREATE INDEX public_shares_workspace_entity
  ON public_shares(workspace_id, entity_type, entity_id, created_at DESC);

ALTER TABLE activity_logs ADD COLUMN request_id TEXT;
ALTER TABLE activity_logs ADD COLUMN target_type TEXT;
ALTER TABLE activity_logs ADD COLUMN target_id TEXT;
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
CREATE INDEX activity_logs_workspace_cursor
  ON activity_logs(workspace_id, created_at DESC, id DESC);
CREATE INDEX audit_logs_workspace_cursor
  ON audit_logs(workspace_id, created_at DESC, id DESC);

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

CREATE TABLE workspace_membership_epochs (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  membership_epoch INTEGER NOT NULL CHECK (membership_epoch > 0),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, user_id)
);

INSERT INTO workspace_membership_epochs (workspace_id, user_id, membership_epoch, updated_at)
SELECT workspace_id, user_id, 1, updated_at FROM workspace_members;

CREATE TRIGGER workspace_members_epoch_after_insert
AFTER INSERT ON workspace_members
BEGIN
  INSERT INTO workspace_membership_epochs (workspace_id, user_id, membership_epoch, updated_at)
  VALUES (NEW.workspace_id, NEW.user_id, 1, NEW.updated_at)
  ON CONFLICT(workspace_id, user_id) DO UPDATE SET
    membership_epoch = workspace_membership_epochs.membership_epoch + 1,
    updated_at = excluded.updated_at;
END;

CREATE TRIGGER workspace_members_epoch_after_delete
AFTER DELETE ON workspace_members
BEGIN
  UPDATE workspace_membership_epochs
  SET membership_epoch = membership_epoch + 1,
      updated_at = OLD.updated_at
  WHERE workspace_id = OLD.workspace_id AND user_id = OLD.user_id;
END;

CREATE TRIGGER audit_logs_immutable_update
BEFORE UPDATE ON audit_logs
BEGIN
  SELECT RAISE(ABORT, 'AUDIT_IMMUTABLE');
END;

CREATE TRIGGER audit_logs_immutable_delete
BEFORE DELETE ON audit_logs
BEGIN
  SELECT RAISE(ABORT, 'AUDIT_IMMUTABLE');
END;
