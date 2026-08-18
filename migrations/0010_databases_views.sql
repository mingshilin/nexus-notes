PRAGMA foreign_keys = OFF;

ALTER TABLE notes ADD COLUMN database_id TEXT;

CREATE TABLE IF NOT EXISTS databases (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  icon TEXT,
  created_by_user_id TEXT NOT NULL,
  board_property_id TEXT,
  calendar_property_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE (workspace_id, name)
);

CREATE TABLE IF NOT EXISTS database_properties (
  id TEXT PRIMARY KEY,
  database_id TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  config_json TEXT NOT NULL DEFAULT '{}',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (database_id) REFERENCES databases(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS note_property_values (
  note_id TEXT NOT NULL,
  property_id TEXT NOT NULL,
  value_text TEXT,
  value_number REAL,
  value_boolean INTEGER,
  value_date TEXT,
  value_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (note_id, property_id),
  FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE,
  FOREIGN KEY (property_id) REFERENCES database_properties(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_notes_workspace_database_updated ON notes(workspace_id, database_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_database_properties_database_sort ON database_properties(database_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_note_property_values_note_property ON note_property_values(note_id, property_id);
CREATE INDEX IF NOT EXISTS idx_note_property_values_date ON note_property_values(property_id, value_date);
CREATE INDEX IF NOT EXISTS idx_note_property_values_number ON note_property_values(property_id, value_number);
CREATE INDEX IF NOT EXISTS idx_note_property_values_boolean ON note_property_values(property_id, value_boolean);

CREATE TRIGGER IF NOT EXISTS trg_databases_updated_at
AFTER UPDATE ON databases
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE databases SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_database_properties_updated_at
AFTER UPDATE ON database_properties
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE database_properties SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_note_property_values_updated_at
AFTER UPDATE ON note_property_values
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE note_property_values
  SET updated_at = datetime('now')
  WHERE note_id = NEW.note_id AND property_id = NEW.property_id;
END;

PRAGMA foreign_keys = ON;
