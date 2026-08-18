CREATE TABLE IF NOT EXISTS database_views (
  id TEXT PRIMARY KEY,
  database_id TEXT NOT NULL,
  name TEXT NOT NULL,
  view_kind TEXT NOT NULL,
  config_json TEXT NOT NULL DEFAULT '{}',
  created_by_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (database_id) REFERENCES databases(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_database_views_database_updated
ON database_views(database_id, updated_at DESC);

CREATE TRIGGER IF NOT EXISTS trg_database_views_updated_at
AFTER UPDATE ON database_views
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE database_views
  SET updated_at = datetime('now')
  WHERE id = NEW.id;
END;
