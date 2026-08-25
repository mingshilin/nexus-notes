-- Existing daily-date duplicates remain untouched; only future active duplicates are rejected.
CREATE TRIGGER notes_daily_active_unique_insert
BEFORE INSERT ON notes
FOR EACH ROW WHEN NEW.daily_date IS NOT NULL
  AND NEW.status = 'active'
  AND NEW.deleted_at IS NULL
  AND EXISTS (
    SELECT 1 FROM notes
    WHERE workspace_id = NEW.workspace_id
      AND daily_date = NEW.daily_date
      AND status = 'active'
      AND deleted_at IS NULL
  )
BEGIN
  SELECT RAISE(ABORT, 'DAILY_NOTE_EXISTS');
END;

CREATE TRIGGER notes_daily_active_unique_update
BEFORE UPDATE OF workspace_id, daily_date, status, deleted_at ON notes
FOR EACH ROW WHEN NEW.daily_date IS NOT NULL
  AND NEW.status = 'active'
  AND NEW.deleted_at IS NULL
  AND EXISTS (
    SELECT 1 FROM notes
    WHERE workspace_id = NEW.workspace_id
      AND daily_date = NEW.daily_date
      AND status = 'active'
      AND deleted_at IS NULL
      AND id <> NEW.id
  )
BEGIN
  SELECT RAISE(ABORT, 'DAILY_NOTE_EXISTS');
END;
