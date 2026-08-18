PRAGMA foreign_keys = OFF;

CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS workspace_members (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'owner',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE (workspace_id, user_id)
);

INSERT INTO workspaces (id, name, owner_user_id, created_at, updated_at)
SELECT
  'ws_' || lower(hex(randomblob(16))),
  'Personal',
  u.id,
  datetime('now'),
  datetime('now')
FROM users u
WHERE NOT EXISTS (
  SELECT 1 FROM workspaces w WHERE w.owner_user_id = u.id
);

INSERT INTO workspace_members (id, workspace_id, user_id, role, created_at, updated_at)
SELECT
  'wsm_' || lower(hex(randomblob(16))),
  w.id,
  w.owner_user_id,
  'owner',
  datetime('now'),
  datetime('now')
FROM workspaces w
WHERE NOT EXISTS (
  SELECT 1 FROM workspace_members wm
  WHERE wm.workspace_id = w.id AND wm.user_id = w.owner_user_id
);

ALTER TABLE notes ADD COLUMN workspace_id TEXT;
UPDATE notes
SET workspace_id = (
  SELECT w.id
  FROM workspaces w
  WHERE w.owner_user_id = notes.user_id
  ORDER BY w.created_at ASC
  LIMIT 1
)
WHERE workspace_id IS NULL;

ALTER TABLE folders ADD COLUMN workspace_id TEXT;
UPDATE folders
SET workspace_id = (
  SELECT w.id
  FROM workspaces w
  WHERE w.owner_user_id = folders.user_id
  ORDER BY w.created_at ASC
  LIMIT 1
)
WHERE workspace_id IS NULL;

ALTER TABLE tags ADD COLUMN workspace_id TEXT;
UPDATE tags
SET workspace_id = (
  SELECT w.id
  FROM workspaces w
  WHERE w.owner_user_id = tags.user_id
  ORDER BY w.created_at ASC
  LIMIT 1
)
WHERE workspace_id IS NULL;

ALTER TABLE note_versions ADD COLUMN workspace_id TEXT;
UPDATE note_versions
SET workspace_id = (
  SELECT w.id
  FROM workspaces w
  WHERE w.owner_user_id = note_versions.user_id
  ORDER BY w.created_at ASC
  LIMIT 1
)
WHERE workspace_id IS NULL;

ALTER TABLE note_links ADD COLUMN workspace_id TEXT;
UPDATE note_links
SET workspace_id = (
  SELECT w.id
  FROM workspaces w
  WHERE w.owner_user_id = note_links.user_id
  ORDER BY w.created_at ASC
  LIMIT 1
)
WHERE workspace_id IS NULL;

ALTER TABLE settings ADD COLUMN workspace_id TEXT;
UPDATE settings
SET workspace_id = (
  SELECT w.id
  FROM workspaces w
  WHERE w.owner_user_id = settings.user_id
  ORDER BY w.created_at ASC
  LIMIT 1
)
WHERE workspace_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_workspace_members_user ON workspace_members(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notes_workspace_updated ON notes(workspace_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_notes_workspace_deleted ON notes(workspace_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_notes_workspace_favorite ON notes(workspace_id, is_favorite);
CREATE INDEX IF NOT EXISTS idx_notes_workspace_folder ON notes(workspace_id, folder_id);
CREATE INDEX IF NOT EXISTS idx_notes_workspace_pinned ON notes(workspace_id, is_pinned, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_notes_workspace_archived ON notes(workspace_id, archived_at);
CREATE INDEX IF NOT EXISTS idx_notes_workspace_last_opened ON notes(workspace_id, last_opened_at DESC);
CREATE INDEX IF NOT EXISTS idx_notes_workspace_daily ON notes(workspace_id, is_daily, daily_date);
CREATE UNIQUE INDEX IF NOT EXISTS idx_notes_user_daily_unique
  ON notes(workspace_id, daily_date)
  WHERE is_daily = 1 AND daily_date IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_notes_workspace_title ON notes(workspace_id, title);
CREATE INDEX IF NOT EXISTS idx_folders_workspace_name ON folders(workspace_id, name);
CREATE INDEX IF NOT EXISTS idx_tags_workspace_name ON tags(workspace_id, name);
CREATE INDEX IF NOT EXISTS idx_note_versions_note_created ON note_versions(workspace_id, note_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_note_links_workspace_source ON note_links(workspace_id, source_note_id);
CREATE INDEX IF NOT EXISTS idx_note_links_workspace_target ON note_links(workspace_id, target_note_id);
CREATE INDEX IF NOT EXISTS idx_note_links_workspace_title ON note_links(workspace_id, target_title);

CREATE TRIGGER IF NOT EXISTS trg_workspaces_updated_at
AFTER UPDATE ON workspaces
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE workspaces SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_workspace_members_updated_at
AFTER UPDATE ON workspace_members
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE workspace_members SET updated_at = datetime('now') WHERE id = NEW.id;
END;

DROP TRIGGER IF EXISTS trg_settings_updated_at;
CREATE TRIGGER trg_settings_updated_at
AFTER UPDATE ON settings
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE settings SET updated_at = datetime('now') WHERE key = NEW.key AND workspace_id = NEW.workspace_id;
END;

PRAGMA foreign_keys = ON;
