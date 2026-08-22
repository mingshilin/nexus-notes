CREATE TABLE record_values_0006_backup AS
SELECT id, workspace_id, database_id, record_id, property_id, value_json, revision, updated_at
FROM record_values;

CREATE TABLE field_permissions_0006_backup AS
SELECT id, workspace_id, database_id, property_id, subject_type, subject_id,
  can_read, can_write, revision, updated_at
FROM field_permissions;

CREATE TABLE database_properties_0006 (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  database_id TEXT NOT NULL REFERENCES databases(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('text', 'number', 'checkbox', 'select', 'multi_select', 'date', 'url', 'email', 'member', 'relation')),
  config_json TEXT NOT NULL DEFAULT '{}',
  position INTEGER NOT NULL DEFAULT 0,
  is_hidden INTEGER NOT NULL DEFAULT 0 CHECK (is_hidden IN (0, 1)),
  is_read_only INTEGER NOT NULL DEFAULT 0 CHECK (is_read_only IN (0, 1)),
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (database_id, name)
);

INSERT INTO database_properties_0006 (
  id, workspace_id, database_id, name, type, config_json, position,
  is_hidden, is_read_only, revision, created_at, updated_at
)
SELECT id, workspace_id, database_id, name,
  CASE WHEN type IN ('title', 'file') THEN 'text' ELSE type END,
  config_json, position, 0, 0, revision, created_at, updated_at
FROM database_properties;

DROP TABLE database_properties;

ALTER TABLE database_properties_0006 RENAME TO database_properties;

INSERT INTO record_values (
  id, workspace_id, database_id, record_id, property_id, value_json, revision, updated_at
)
SELECT id, workspace_id, database_id, record_id, property_id, value_json, revision, updated_at
FROM record_values_0006_backup;

INSERT INTO field_permissions (
  id, workspace_id, database_id, property_id, subject_type, subject_id,
  can_read, can_write, revision, updated_at
)
SELECT id, workspace_id, database_id, property_id, subject_type, subject_id,
  can_read, can_write, revision, updated_at
FROM field_permissions_0006_backup;

DROP TABLE record_values_0006_backup;

DROP TABLE field_permissions_0006_backup;

ALTER TABLE database_permissions
ADD COLUMN access_level TEXT NOT NULL DEFAULT 'viewer'
CHECK (access_level IN ('owner', 'editor', 'viewer'));

UPDATE database_permissions
SET access_level = CASE WHEN can_write = 1 THEN 'editor' ELSE 'viewer' END;

CREATE INDEX database_properties_order_idx
ON database_properties(workspace_id, database_id, position, id);

CREATE INDEX database_records_stable_page_idx
ON database_records(workspace_id, database_id, updated_at DESC, id DESC);

CREATE INDEX record_values_board_idx
ON record_values(workspace_id, database_id, property_id, record_id);

CREATE INDEX database_views_order_idx
ON database_views(workspace_id, database_id, position, id);

CREATE INDEX database_templates_lookup_idx
ON database_templates(workspace_id, database_id, updated_at DESC, id DESC);

CREATE INDEX database_permissions_subject_idx
ON database_permissions(workspace_id, database_id, subject_type, subject_id);

CREATE INDEX field_permissions_subject_idx
ON field_permissions(workspace_id, database_id, property_id, subject_type, subject_id);
