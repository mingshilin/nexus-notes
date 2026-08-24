PRAGMA foreign_keys = ON;

CREATE TABLE user_preferences (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  default_domain TEXT NOT NULL DEFAULT 'notes' CHECK (default_domain IN ('notes','databases','knowledge','reminders','ai')),
  density TEXT NOT NULL DEFAULT 'comfortable' CHECK (density IN ('comfortable','compact')),
  reduced_motion INTEGER NOT NULL DEFAULT 0 CHECK (reduced_motion IN (0,1)),
  week_starts_on INTEGER NOT NULL DEFAULT 1 CHECK (week_starts_on IN (0,1)),
  date_format TEXT NOT NULL DEFAULT 'yyyy-MM-dd',
  default_snooze_minutes INTEGER NOT NULL DEFAULT 10 CHECK (default_snooze_minutes BETWEEN 5 AND 1440),
  email_reminders INTEGER NOT NULL DEFAULT 0 CHECK (email_reminders IN (0,1)),
  push_reminders INTEGER NOT NULL DEFAULT 0 CHECK (push_reminders IN (0,1)),
  in_app_reminders INTEGER NOT NULL DEFAULT 1 CHECK (in_app_reminders IN (0,1)),
  quiet_hours_start TEXT,
  quiet_hours_end TEXT,
  show_push_title INTEGER NOT NULL DEFAULT 0 CHECK (show_push_title IN (0,1)),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_at TEXT NOT NULL
);

CREATE TABLE push_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint_hash TEXT NOT NULL,
  subscription_ciphertext TEXT NOT NULL,
  encryption_iv TEXT NOT NULL,
  key_version INTEGER NOT NULL DEFAULT 1,
  device_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  last_success_at TEXT,
  last_failure_at TEXT,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (user_id, endpoint_hash)
);

CREATE INDEX push_subscriptions_user_status_idx ON push_subscriptions(user_id, status, updated_at DESC);

DROP TRIGGER account_audit_logs_event_insert;
DROP TRIGGER account_audit_logs_event_update;

CREATE TRIGGER account_audit_logs_event_insert
BEFORE INSERT ON account_audit_logs
WHEN NEW.event NOT IN (
  'profile.updated','avatar.updated','avatar.deleted','email.change_requested','email.changed',
  'password.changed','session.revoked','account.deleted','preferences.updated','sessions.revoked_all',
  'push.subscription_added','push.subscription_deleted','ai.config_updated','ai.config_deleted','ai.config_tested'
)
BEGIN
  SELECT RAISE(ABORT, 'ACCOUNT_AUDIT_EVENT_INVALID');
END;

CREATE TRIGGER account_audit_logs_event_update
BEFORE UPDATE OF event ON account_audit_logs
WHEN NEW.event NOT IN (
  'profile.updated','avatar.updated','avatar.deleted','email.change_requested','email.changed',
  'password.changed','session.revoked','account.deleted','preferences.updated','sessions.revoked_all',
  'push.subscription_added','push.subscription_deleted','ai.config_updated','ai.config_deleted','ai.config_tested'
)
BEGIN
  SELECT RAISE(ABORT, 'ACCOUNT_AUDIT_EVENT_INVALID');
END;
