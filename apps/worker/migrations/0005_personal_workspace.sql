ALTER TABLE workspaces
ADD COLUMN workspace_type TEXT NOT NULL DEFAULT 'team'
CHECK (workspace_type IN ('personal', 'team'));

CREATE UNIQUE INDEX workspaces_personal_owner_idx
ON workspaces(owner_user_id)
WHERE workspace_type = 'personal';

CREATE TRIGGER workspaces_beta_quota_before_insert
BEFORE INSERT ON workspaces
WHEN NEW.workspace_type = 'team'
  AND (
    SELECT COUNT(*)
    FROM workspaces
    WHERE owner_user_id = NEW.owner_user_id
  ) >= 2
BEGIN
  SELECT RAISE(ABORT, 'workspace quota exceeded');
END;
