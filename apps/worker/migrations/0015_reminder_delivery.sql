PRAGMA foreign_keys = ON;

ALTER TABLE reminders ADD COLUMN title TEXT NOT NULL DEFAULT '';
ALTER TABLE reminders ADD COLUMN timezone TEXT NOT NULL DEFAULT 'UTC';
ALTER TABLE reminders ADD COLUMN channels_json TEXT NOT NULL DEFAULT '["in_app"]';
ALTER TABLE reminders ADD COLUMN recurrence_json TEXT;
ALTER TABLE reminders ADD COLUMN recurrence_anchor_local TEXT;
ALTER TABLE reminders ADD COLUMN occurrence_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE reminders ADD COLUMN delivery_enabled_at TEXT;
ALTER TABLE reminders ADD COLUMN snoozed_until TEXT;
ALTER TABLE reminders ADD COLUMN last_delivered_at TEXT;
ALTER TABLE reminders ADD COLUMN deleted_at TEXT;
ALTER TABLE reminders ADD COLUMN dispatch_claim_token TEXT;
ALTER TABLE reminders ADD COLUMN dispatch_claim_expires_at TEXT;

CREATE TABLE reminder_deliveries (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  reminder_id TEXT NOT NULL REFERENCES reminders(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  occurrence_at TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('in_app','email','push')),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','failed','cancelled')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (reminder_id, occurrence_at, channel)
);

CREATE TABLE reminder_delivery_outbox (
  id TEXT PRIMARY KEY,
  delivery_id TEXT NOT NULL UNIQUE REFERENCES reminder_deliveries(id) ON DELETE CASCADE,
  payload_json TEXT NOT NULL,
  available_at TEXT NOT NULL,
  dispatched_at TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX reminders_delivery_due_idx ON reminders(status, delivery_enabled_at, remind_at) WHERE deleted_at IS NULL;
CREATE INDEX reminder_delivery_outbox_pending_idx ON reminder_delivery_outbox(dispatched_at, available_at);
