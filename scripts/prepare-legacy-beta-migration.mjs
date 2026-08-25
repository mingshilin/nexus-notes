import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const betaMigrationDir = join(root, "apps", "worker", "migrations");

function parseArgs(argv) {
  const options = { input: undefined, output: undefined, report: undefined };
  for (const arg of argv) {
    if (arg.startsWith("--input=")) options.input = arg.slice("--input=".length);
    else if (arg.startsWith("--output=")) options.output = arg.slice("--output=".length);
    else if (arg.startsWith("--report=")) options.report = arg.slice("--report=".length);
  }
  if (!options.input || !options.output) {
    throw new Error("Usage: node scripts/prepare-legacy-beta-migration.mjs --input=<legacy.sql> --output=<beta-data.sql> [--report=<report.json>]");
  }
  return options;
}

function splitMigration(source) {
  const statements = [];
  let statement = "";
  let trigger = false;
  for (const sourceLine of source.split(/\r?\n/u)) {
    const line = sourceLine.trim();
    if (!line || line.startsWith("--") || /^PRAGMA foreign_keys = ON;$/iu.test(line)) continue;
    if (/^CREATE TRIGGER\b/iu.test(line)) trigger = true;
    statement += `${statement ? " " : ""}${line}`;
    const complete = trigger ? /^END;$/iu.test(line) : line.endsWith(";");
    if (complete) {
      statements.push(statement);
      statement = "";
      trigger = false;
    }
  }
  if (statement) throw new Error(`Incomplete migration statement: ${statement}`);
  return statements;
}

function loadLegacy(input) {
  const db = new DatabaseSync(":memory:");
  db.exec(`PRAGMA foreign_keys = OFF;${readFileSync(resolve(input), "utf8")}`);
  return db;
}

function loadBetaSchema() {
  const db = new DatabaseSync(":memory:");
  const migrations = readdirSync(betaMigrationDir)
    .filter((name) => /^\d+_.+\.sql$/u.test(name))
    .sort();
  for (const name of migrations) {
    for (const statement of splitMigration(readFileSync(join(betaMigrationDir, name), "utf8"))) db.exec(statement);
  }
  return db;
}

function tableExists(db, table) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));
}

function rows(db, table) {
  return tableExists(db, table) ? db.prepare(`SELECT * FROM "${table.replaceAll('"', '""')}"`).all() : [];
}

function normalizeTime(value, fallback = "1970-01-01T00:00:00.000Z") {
  if (!value) return fallback;
  const raw = String(value);
  const date = new Date(/Z$/iu.test(raw) ? raw : `${raw.replace(" ", "T")}Z`);
  return Number.isNaN(date.getTime()) ? raw : date.toISOString();
}

function stringValue(value, fallback = "") {
  return value === null || value === undefined ? fallback : String(value);
}

function boolValue(value) {
  return Number(value) ? 1 : 0;
}

function jsonValue(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value !== "string") return JSON.stringify(value);
  try {
    JSON.parse(value);
    return value;
  } catch {
    return JSON.stringify(value);
  }
}

function safeJsonObject(value) {
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function quote(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "bigint") return String(value);
  return `'${String(value).replaceAll("'", "''")}'`;
}

function insertFactory(db, counts) {
  return (table, columns, values) => {
    try {
      db.prepare(`INSERT INTO "${table}" (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`).run(...values);
      counts[table] = (counts[table] ?? 0) + 1;
    } catch (error) {
      throw new Error(`Could not migrate ${table} row ${values[0]}: ${error instanceof Error ? error.message : error}`);
    }
  };
}

function migrate(legacy, beta) {
  const counts = {};
  const warnings = [];
  const insert = insertFactory(beta, counts);
  const source = Object.fromEntries([
    "users", "workspaces", "workspace_members", "folders", "tags", "notes", "note_versions", "note_tags",
    "note_links", "reminders", "databases", "database_properties", "note_property_values", "database_views",
    "database_templates", "database_permissions", "database_field_permissions", "note_attachments", "saved_searches",
    "comments", "notifications", "note_public_shares", "activity_logs", "audit_logs", "import_jobs",
  ].map((table) => [table, rows(legacy, table)]));

  const users = new Map(source.users.map((user) => [user.id, user]));
  const workspaceByUser = new Map();
  const workspaceIds = new Set();
  const databaseIds = new Set(source.databases.map((database) => database.id));
  const propertyById = new Map(source.database_properties.map((property) => [property.id, property]));
  const noteById = new Map(source.notes.map((note) => [note.id, note]));
  const tagIds = new Set(source.tags.map((tag) => tag.id));
  const orphanNotes = source.notes.filter((note) => !note.user_id || !note.workspace_id || !users.has(note.user_id));
  const recovery = orphanNotes.length > 0 ? {
    userId: "legacy-recovery-user",
    workspaceId: "legacy-recovery-workspace",
    now: new Date(0).toISOString(),
  } : null;

  for (const user of source.users) {
    const passwordHash = stringValue(user.password_hash).replace(/^pbkdf2\$/u, "pbkdf2_sha256$");
    const avatarMatch = stringValue(user.avatar_url).match(/^\/api\/profile\/avatar\/(.+)$/u);
    insert("users", [
      "id", "email", "password_hash", "display_name", "biography", "locale", "timezone", "avatar_key",
      "status", "email_verified_at", "created_at", "updated_at",
    ], [
      user.id, user.email, passwordHash, stringValue(user.display_name), stringValue(user.bio), "zh-CN", "Asia/Shanghai",
      avatarMatch ? `avatars/${avatarMatch[1]}` : null, "active", user.email_verified_at ? normalizeTime(user.email_verified_at) : null,
      normalizeTime(user.created_at), normalizeTime(user.updated_at),
    ]);
  }
  if (recovery) {
    insert("users", [
      "id", "email", "password_hash", "display_name", "biography", "locale", "timezone", "avatar_key",
      "status", "email_verified_at", "created_at", "updated_at",
    ], [
      recovery.userId, "legacy-recovery@example.invalid", "migration-disabled", "Legacy recovery", "Quarantined orphaned legacy records",
      "zh-CN", "Asia/Shanghai", null, "suspended", null, recovery.now, recovery.now,
    ]);
    users.set(recovery.userId, { id: recovery.userId });
  }

  for (const workspace of source.workspaces) {
    const workspaceType = String(workspace.name).toLowerCase() === "personal" ? "personal" : "team";
    const slug = `legacy-${String(workspace.id).replace(/[^a-zA-Z0-9-]/gu, "-")}`.slice(0, 180);
    insert("workspaces", ["id", "owner_user_id", "slug", "name", "workspace_type", "revision", "created_at", "updated_at"], [
      workspace.id, workspace.owner_user_id, slug, stringValue(workspace.name, "Legacy workspace"), workspaceType, 1,
      normalizeTime(workspace.created_at), normalizeTime(workspace.updated_at),
    ]);
    workspaceIds.add(workspace.id);
    if (!workspaceByUser.has(workspace.owner_user_id)) workspaceByUser.set(workspace.owner_user_id, workspace.id);
  }
  if (recovery) {
    insert("workspaces", ["id", "owner_user_id", "slug", "name", "workspace_type", "revision", "created_at", "updated_at"], [
      recovery.workspaceId, recovery.userId, recovery.workspaceId, "Legacy recovery", "personal", 1, recovery.now, recovery.now,
    ]);
    insert("workspace_members", ["workspace_id", "user_id", "role", "revision", "joined_at", "updated_at"], [
      recovery.workspaceId, recovery.userId, "owner", 1, recovery.now, recovery.now,
    ]);
    workspaceIds.add(recovery.workspaceId);
    workspaceByUser.set(recovery.userId, recovery.workspaceId);
    warnings.push(`Quarantined ${orphanNotes.length} orphaned legacy note(s) in ${recovery.workspaceId}`);
  }

  for (const user of source.users) {
    if (workspaceByUser.has(user.id)) continue;
    const id = `legacy-personal-${user.id}`;
    const now = normalizeTime(user.created_at);
    insert("workspaces", ["id", "owner_user_id", "slug", "name", "workspace_type", "revision", "created_at", "updated_at"], [
      id, user.id, id, "Personal", "personal", 1, now, now,
    ]);
    insert("workspace_members", ["workspace_id", "user_id", "role", "revision", "joined_at", "updated_at"], [id, user.id, "owner", 1, now, now]);
    workspaceIds.add(id);
    workspaceByUser.set(user.id, id);
  }

  for (const member of source.workspace_members) {
    if (!workspaceIds.has(member.workspace_id) || !users.has(member.user_id)) continue;
    insert("workspace_members", ["workspace_id", "user_id", "role", "revision", "joined_at", "updated_at"], [
      member.workspace_id, member.user_id, ["owner", "editor", "viewer"].includes(member.role) ? member.role : "viewer", 1,
      normalizeTime(member.created_at), normalizeTime(member.updated_at),
    ]);
  }

  const folderIds = new Set();
  for (const folder of source.folders) {
    const workspaceId = folder.workspace_id || workspaceByUser.get(folder.user_id);
    if (!workspaceId || !workspaceIds.has(workspaceId)) continue;
    insert("folders", ["id", "workspace_id", "parent_id", "name", "position", "revision", "created_at", "updated_at"], [
      folder.id, workspaceId, null, stringValue(folder.name, "Folder"), 0, 1, normalizeTime(folder.created_at), normalizeTime(folder.updated_at),
    ]);
    folderIds.add(folder.id);
  }

  for (const tag of source.tags) {
    const workspaceId = tag.workspace_id || workspaceByUser.get(tag.user_id);
    if (!workspaceId || !workspaceIds.has(workspaceId)) continue;
    insert("tags", ["id", "workspace_id", "name", "color", "revision", "created_at", "updated_at"], [
      tag.id, workspaceId, stringValue(tag.name, "Tag"), stringValue(tag.color), 1, normalizeTime(tag.created_at), normalizeTime(tag.updated_at),
    ]);
  }

  const noteRevisionCounts = new Map();
  for (const version of source.note_versions) noteRevisionCounts.set(version.note_id, (noteRevisionCounts.get(version.note_id) ?? 0) + 1);
  const migratedNotes = new Set();
  for (const note of source.notes) {
    const userId = note.user_id && users.has(note.user_id) ? note.user_id : recovery?.userId;
    const workspaceId = note.workspace_id && workspaceIds.has(note.workspace_id)
      ? note.workspace_id
      : userId ? workspaceByUser.get(userId) : recovery?.workspaceId;
    if (!userId || !workspaceId || !workspaceIds.has(workspaceId)) continue;
    const databaseId = note.database_id && databaseIds.has(note.database_id) ? note.database_id : null;
    const folderId = note.folder_id && folderIds.has(note.folder_id) ? note.folder_id : null;
    const status = note.deleted_at ? "trashed" : note.archived_at ? "archived" : "active";
    insert("notes", [
      "id", "workspace_id", "folder_id", "created_by", "updated_by", "title", "content", "status", "is_favorite", "is_pinned",
      "daily_date", "database_id", "revision", "created_at", "updated_at", "deleted_at",
    ], [
      note.id, workspaceId, folderId, userId, userId, stringValue(note.title), stringValue(note.content), status,
      boolValue(note.is_favorite), boolValue(note.is_pinned), note.is_daily && note.daily_date ? String(note.daily_date).slice(0, 10) : null,
      databaseId, Math.max(1, noteRevisionCounts.get(note.id) ?? 1), normalizeTime(note.created_at), normalizeTime(note.updated_at),
      note.deleted_at ? normalizeTime(note.deleted_at) : null,
    ]);
    migratedNotes.add(note.id);
  }

  const revisionsByNote = new Map();
  for (const version of source.note_versions) {
    if (!migratedNotes.has(version.note_id) || !users.has(version.user_id)) continue;
    const list = revisionsByNote.get(version.note_id) ?? [];
    list.push(version);
    revisionsByNote.set(version.note_id, list);
  }
  for (const [noteId, versions] of revisionsByNote) {
    versions.sort((left, right) => String(left.created_at).localeCompare(String(right.created_at)) || String(left.id).localeCompare(String(right.id)));
    versions.forEach((version, index) => insert("note_revisions", [
      "id", "workspace_id", "note_id", "revision", "title", "content", "source", "created_by", "created_at",
    ], [
      version.id, version.workspace_id || workspaceByUser.get(version.user_id), noteId, index + 1, stringValue(version.title), stringValue(version.content),
      "manual", version.user_id, normalizeTime(version.created_at),
    ]));
  }

  for (const link of source.note_tags) {
    if (!migratedNotes.has(link.note_id) || !tagIds.has(link.tag_id)) continue;
    const linkedNote = noteById.get(link.note_id);
    const workspaceId = linkedNote?.workspace_id || workspaceByUser.get(linkedNote?.user_id);
    if (!workspaceId || !workspaceIds.has(workspaceId)) continue;
    insert("note_tags", ["workspace_id", "note_id", "tag_id", "created_at"], [workspaceId, link.note_id, link.tag_id, new Date().toISOString()]);
  }
  for (const link of source.note_links) {
    if (!migratedNotes.has(link.source_note_id) || !migratedNotes.has(link.target_note_id)) {
      warnings.push(`Skipped unresolved legacy note link ${link.id}`);
      continue;
    }
    const workspaceId = link.workspace_id || workspaceByUser.get(link.user_id);
    if (!workspaceId) continue;
    insert("note_links", ["id", "workspace_id", "source_note_id", "target_note_id", "created_at"], [link.id, workspaceId, link.source_note_id, link.target_note_id, normalizeTime(link.created_at)]);
  }

  for (const database of source.databases) {
    if (!workspaceIds.has(database.workspace_id) || !users.has(database.created_by_user_id)) continue;
    insert("databases", ["id", "workspace_id", "name", "description", "created_by", "revision", "created_at", "updated_at"], [
      database.id, database.workspace_id, stringValue(database.name, "Database"), stringValue(database.description), database.created_by_user_id, 1,
      normalizeTime(database.created_at), normalizeTime(database.updated_at),
    ]);
  }

  const propertyIds = new Set();
  for (const property of source.database_properties) {
    const database = source.databases.find((candidate) => candidate.id === property.database_id);
    if (!database || !workspaceIds.has(database.workspace_id)) continue;
    const type = { title: "text", file: "text", single_select: "select" }[property.type] ?? property.type;
    const allowed = ["text", "number", "checkbox", "select", "multi_select", "date", "url", "email", "member", "relation"];
    if (!allowed.includes(type)) {
      warnings.push(`Skipped unsupported legacy property type ${property.type} (${property.id})`);
      continue;
    }
    insert("database_properties", ["id", "workspace_id", "database_id", "name", "type", "config_json", "position", "is_hidden", "is_read_only", "revision", "created_at", "updated_at"], [
      property.id, database.workspace_id, property.database_id, stringValue(property.name, "Property"), type, stringValue(property.config_json, "{}"),
      Number(property.sort_order) || 0, 0, 0, 1, normalizeTime(property.created_at), normalizeTime(property.updated_at),
    ]);
    propertyIds.add(property.id);
  }

  const recordByNote = new Map();
  for (const note of source.notes) {
    if (!migratedNotes.has(note.id) || !note.database_id || !databaseIds.has(note.database_id)) continue;
    const recordId = `legacy-record-${note.id}`;
    recordByNote.set(note.id, recordId);
    const workspaceId = note.workspace_id || workspaceByUser.get(note.user_id);
    insert("database_records", ["id", "workspace_id", "database_id", "note_id", "created_by", "updated_by", "revision", "created_at", "updated_at"], [
      recordId, workspaceId, note.database_id, note.id, note.user_id, note.user_id, 1, normalizeTime(note.created_at), normalizeTime(note.updated_at),
    ]);
  }
  for (const value of source.note_property_values) {
    const recordId = recordByNote.get(value.note_id);
    if (!recordId || !propertyIds.has(value.property_id)) continue;
    const property = propertyById.get(value.property_id);
    let valueJson = value.value_json;
    if (valueJson === null || valueJson === undefined) {
      const raw = value.value_text ?? value.value_number ?? value.value_boolean ?? value.value_date ?? null;
      valueJson = JSON.stringify(raw);
    } else valueJson = jsonValue(valueJson, "null");
    insert("record_values", ["id", "workspace_id", "database_id", "record_id", "property_id", "value_json", "revision", "updated_at"], [
      `legacy-value-${value.note_id}-${value.property_id}`, source.notes.find((note) => note.id === value.note_id)?.workspace_id, property ? property.database_id : null,
      recordId, value.property_id, valueJson, 1, normalizeTime(value.updated_at),
    ]);
  }

  for (const view of source.database_views) {
    const database = source.databases.find((candidate) => candidate.id === view.database_id);
    const type = ["table", "board", "calendar"].includes(view.view_kind) ? view.view_kind : "table";
    if (!database || !workspaceIds.has(database.workspace_id) || !users.has(view.created_by_user_id)) continue;
    insert("database_views", ["id", "workspace_id", "database_id", "name", "type", "config_json", "position", "revision", "created_at", "updated_at"], [
      view.id, database.workspace_id, view.database_id, stringValue(view.name, "View"), type, stringValue(view.config_json, "{}"), 0, 1,
      normalizeTime(view.created_at), normalizeTime(view.updated_at),
    ]);
  }
  for (const template of source.database_templates) {
    const database = source.databases.find((candidate) => candidate.id === template.database_id);
    if (!database || !workspaceIds.has(database.workspace_id) || !users.has(template.created_by_user_id)) continue;
    const defaults = safeJsonObject(template.default_values_json);
    if (template.title) defaults.__legacy_title = template.title;
    if (template.content) defaults.__legacy_content = template.content;
    insert("database_templates", ["id", "workspace_id", "database_id", "name", "default_values_json", "revision", "created_at", "updated_at"], [
      template.id, database.workspace_id, template.database_id, stringValue(template.name, "Template"), JSON.stringify(defaults), 1,
      normalizeTime(template.created_at), normalizeTime(template.updated_at),
    ]);
  }

  for (const reminder of source.reminders) {
    const workspaceId = reminder.workspace_id || workspaceByUser.get(reminder.user_id);
    if (!workspaceId || !users.has(reminder.user_id)) continue;
    insert("reminders", [
      "id", "workspace_id", "note_id", "user_id", "remind_at", "title", "timezone", "channels_json", "recurrence_json",
      "recurrence_anchor_local", "occurrence_count", "delivery_enabled_at", "snoozed_until", "last_delivered_at", "status", "revision", "created_at", "updated_at",
    ], [
      reminder.id, workspaceId, migratedNotes.has(reminder.note_id) ? reminder.note_id : null, reminder.user_id, normalizeTime(reminder.due_at), stringValue(reminder.title),
      "Asia/Shanghai", '["in_app"]', null, null, 0, null, null, reminder.notified_at ? normalizeTime(reminder.notified_at) : null,
      reminder.completed_at ? "dismissed" : "pending", 1, normalizeTime(reminder.created_at), normalizeTime(reminder.updated_at),
    ]);
  }

  for (const attachment of source.note_attachments) {
    if (!migratedNotes.has(attachment.note_id) || !users.has(attachment.uploader_id)) continue;
    insert("attachments", ["id", "workspace_id", "note_id", "record_id", "r2_key", "filename", "mime_type", "size_bytes", "status", "revision", "created_by", "created_at", "updated_at"], [
      attachment.id, attachment.workspace_id, attachment.note_id, recordByNote.get(attachment.note_id) ?? null, attachment.storage_key,
      stringValue(attachment.file_name, "attachment"), stringValue(attachment.mime_type, "application/octet-stream"), Number(attachment.size) || 1,
      "ready", 1, attachment.uploader_id, normalizeTime(attachment.created_at), normalizeTime(attachment.ocr_updated_at || attachment.created_at),
    ]);
    if (attachment.ocr_text) insert("ocr_jobs", ["id", "workspace_id", "attachment_id", "status", "result_text", "revision", "created_at", "updated_at"], [
      `legacy-ocr-${attachment.id}`, attachment.workspace_id, attachment.id, attachment.ocr_status === "failed" ? "failed" : "complete", attachment.ocr_text, 1,
      normalizeTime(attachment.created_at), normalizeTime(attachment.ocr_updated_at || attachment.created_at),
    ]);
  }

  for (const saved of source.saved_searches) {
    const workspaceId = saved.workspace_id || workspaceByUser.get(saved.created_by_user_id);
    if (!workspaceId || !users.has(saved.created_by_user_id)) continue;
    insert("saved_searches", ["id", "workspace_id", "user_id", "name", "query", "filters_json", "revision", "created_at", "updated_at"], [
      saved.id, workspaceId, saved.created_by_user_id, stringValue(saved.name, "Saved search"), stringValue(saved.query), stringValue(saved.filters_json, "{}"), 1,
      normalizeTime(saved.created_at), normalizeTime(saved.updated_at),
    ]);
  }

  for (const comment of source.comments) {
    const entityType = comment.note_id && migratedNotes.has(comment.note_id) ? "note" : null;
    const entityId = entityType === "note" ? comment.note_id : null;
    if (!entityType || !users.has(comment.created_by_user_id)) continue;
    insert("comments", ["id", "workspace_id", "entity_type", "entity_id", "author_user_id", "parent_id", "body", "revision", "created_at", "updated_at"], [
      comment.id, comment.workspace_id, entityType, entityId, comment.created_by_user_id, null, stringValue(comment.body), 1,
      normalizeTime(comment.created_at), normalizeTime(comment.updated_at),
    ]);
  }

  for (const notification of source.notifications) {
    if (!users.has(notification.user_id) || !workspaceIds.has(notification.workspace_id)) continue;
    insert("notifications", ["id", "workspace_id", "user_id", "type", "payload_json", "read_at", "revision", "created_at"], [
      notification.id, notification.workspace_id, notification.user_id, stringValue(notification.type, "legacy"), JSON.stringify({ title: notification.title, body: notification.body, entity_type: notification.entity_type, entity_id: notification.entity_id }),
      notification.read_at ? normalizeTime(notification.read_at) : null, 1, normalizeTime(notification.created_at),
    ]);
  }

  for (const share of source.note_public_shares) {
    if (!migratedNotes.has(share.note_id) || !users.has(share.creator_user_id)) continue;
    insert("public_shares", ["id", "workspace_id", "entity_type", "entity_id", "token_hash", "password_hash", "password_salt", "expires_at", "revoked_at", "status", "revision", "created_by", "created_at", "updated_at"], [
      share.id, share.workspace_id, "note", share.note_id, share.access_token_hash, null, null, share.expires_at ? normalizeTime(share.expires_at) : null,
      share.revoked_at ? normalizeTime(share.revoked_at) : null, "revoked", 1, share.creator_user_id, normalizeTime(share.created_at), normalizeTime(share.updated_at),
    ]);
    warnings.push(`Legacy public share ${share.id} was imported revoked because its raw token hash algorithm is not portable`);
  }

  for (const activity of source.activity_logs) {
    if (!workspaceIds.has(activity.workspace_id) || !users.has(activity.actor_user_id)) continue;
    insert("activity_logs", ["id", "workspace_id", "actor_user_id", "action", "entity_type", "entity_id", "metadata_json", "created_at"], [
      activity.id, activity.workspace_id, activity.actor_user_id, stringValue(activity.action, "legacy"), stringValue(activity.entity_type, "legacy"), activity.entity_id || null,
      stringValue(activity.metadata_json, "{}"), normalizeTime(activity.created_at),
    ]);
  }
  for (const audit of source.audit_logs) {
    if (!workspaceIds.has(audit.workspace_id) || !users.has(audit.actor_user_id)) continue;
    insert("audit_logs", ["id", "workspace_id", "actor_user_id", "request_id", "action", "target_type", "target_id", "outcome", "metadata_json", "created_at"], [
      audit.id, audit.workspace_id, audit.actor_user_id, audit.id, stringValue(audit.action, "legacy"), stringValue(audit.entity_type, "legacy"), audit.entity_id || null,
      "success", stringValue(audit.metadata_json, "{}"), normalizeTime(audit.created_at),
    ]);
  }

  warnings.push("Legacy sessions, email codes, password reset tokens and offline drafts were intentionally not imported; all old sessions must be re-authenticated after cutover.");
  const foreignKeys = beta.prepare("PRAGMA foreign_key_check").all();
  if (foreignKeys.length) throw new Error(`Beta migration produced foreign key violations: ${JSON.stringify(foreignKeys.slice(0, 5))}`);
  return { counts, warnings, source_counts: Object.fromEntries(Object.entries(source).map(([table, values]) => [table, values.length])) };
}

function exportDataSql(beta, output) {
  const excluded = new Set(["d1_migrations", "collaboration_operation_guard", "workspace_membership_epochs"]);
  const tables = beta.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
    .map((row) => row.name).filter((name) => !excluded.has(name) && !name.startsWith("search_documents_fts"));
  const parentOrder = [
    "users", "workspaces", "workspace_members", "workspace_membership_epochs", "folders", "tags", "notes", "note_revisions", "note_tags", "note_links",
    "databases", "database_properties", "database_records", "record_values", "database_views", "database_templates", "database_permissions", "field_permissions",
    "reminders", "attachments", "ocr_jobs", "saved_searches", "comments", "mentions", "notifications", "public_shares", "activity_logs", "audit_logs",
  ];
  const ordered = [...parentOrder, ...tables.filter((table) => !parentOrder.includes(table))];
  const statements = ["PRAGMA foreign_keys = OFF;"];
  for (const table of ordered) {
    if (!tables.includes(table)) continue;
    const columns = beta.prepare(`PRAGMA table_info("${table}")`).all().map((column) => column.name);
    for (const row of beta.prepare(`SELECT * FROM "${table}"`).all()) {
      statements.push(`INSERT INTO "${table}" (${columns.map((column) => `"${column}"`).join(",")}) VALUES (${columns.map((column) => quote(row[column])).join(",")});`);
    }
  }
  statements.push("PRAGMA foreign_keys = ON;");
  mkdirSync(dirname(resolve(output)), { recursive: true });
  writeFileSync(resolve(output), `${statements.join("\n")}\n`, "utf8");
  return { tables: tables.length, statements: statements.length - 2 };
}

export function prepareLegacyBetaMigration({ input, output, report } = {}) {
  const legacy = loadLegacy(input);
  const beta = loadBetaSchema();
  const migrationReport = migrate(legacy, beta);
  const exportReport = exportDataSql(beta, output);
  const finalReport = { ...migrationReport, export: exportReport, input: resolve(input), output: resolve(output) };
  if (report) {
    mkdirSync(dirname(resolve(report)), { recursive: true });
    writeFileSync(resolve(report), `${JSON.stringify(finalReport, null, 2)}\n`, "utf8");
  }
  return finalReport;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  try {
    const options = parseArgs(process.argv.slice(2));
    console.log(JSON.stringify(prepareLegacyBetaMigration(options), null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
