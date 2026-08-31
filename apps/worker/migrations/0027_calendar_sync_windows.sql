PRAGMA foreign_keys = ON;

ALTER TABLE calendar_connections ADD COLUMN sync_from TEXT;
ALTER TABLE calendar_connections ADD COLUMN sync_to TEXT;

CREATE INDEX calendar_connections_sync_window_idx
  ON calendar_connections(user_id, provider, sync_from, sync_to);
