CREATE TRIGGER account_audit_logs_event_insert
BEFORE INSERT ON account_audit_logs
FOR EACH ROW WHEN NEW.event NOT IN (
  'profile.updated', 'avatar.updated', 'avatar.deleted', 'email.change_requested',
  'email.changed', 'password.changed', 'session.revoked', 'account.deleted'
)
BEGIN
  SELECT RAISE(ABORT, 'ACCOUNT_AUDIT_EVENT_INVALID');
END;

CREATE TRIGGER account_audit_logs_event_update
BEFORE UPDATE OF event ON account_audit_logs
FOR EACH ROW WHEN NEW.event NOT IN (
  'profile.updated', 'avatar.updated', 'avatar.deleted', 'email.change_requested',
  'email.changed', 'password.changed', 'session.revoked', 'account.deleted'
)
BEGIN
  SELECT RAISE(ABORT, 'ACCOUNT_AUDIT_EVENT_INVALID');
END;
