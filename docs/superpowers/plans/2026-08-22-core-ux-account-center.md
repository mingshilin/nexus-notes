# Core UX and Account Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make note creation immediately discoverable and durable, and add a complete Chinese account center for profile, security, workspaces, data export, and account deletion.

**Architecture:** Keep `apps/web/src/app/App.tsx` as the composition root while moving navigation, local-draft behavior, and account UI into focused modules. Add a user-scoped profile domain beside the existing authentication domain, backed by additive D1 migration `0010`, private R2 avatar objects, session-aware `/api/v2/profile/*` routes, and shared Zod contracts.

**Tech Stack:** TypeScript, React 19, Vite, Vitest, Testing Library, Zod, Cloudflare Workers, D1, R2, IndexedDB, Lucide, npm workspaces.

## Global Constraints

- Preserve the existing Nexus Notes visual language; Chinese remains the default UI language.
- Keep all existing `/api/v2` response envelopes, workspace isolation, and public-share behavior compatible.
- Use additive D1 migration only; do not rewrite published migrations `0001` through `0009`.
- A new note must be visible without discovery and enter editing in one activation.
- Account center must be reachable in at most two activations.
- Every mutation must preserve local user input on failure and expose retry or recovery.
- Every sensitive account operation requires the current password or a short-lived email verification code and emits account audit metadata without user content.
- Avatar objects remain private, accept only PNG/JPEG/WebP, and are limited to 2 MiB after magic-byte validation.
- Each route has one scroll owner; 390 px, mobile keyboard, safe-area, and 200% zoom must not hide controls or content.
- Build must emit no Vite chunk warning above 500 kB and must not initial-preload Markdown, OCR, or AI chunks.
- Do not mutate production D1/R2, configure production secrets, deploy, cut over domains, merge PRs, or create tags without separate explicit authorization.
- Follow strict red-green-refactor TDD and commit only the files named by each task.

---

## File Structure

### Shared contracts and domain

- Create `packages/contracts/src/profile.ts`: profile, account-session, security-command, and data-privacy schemas.
- Modify `packages/contracts/src/index.ts`: export the profile contracts.
- Create `packages/contracts/tests/profile-contracts.test.ts`: reject malformed profile/security payloads.
- Create `packages/domain/src/profile.ts`: normalize and validate profile values and avatar metadata.
- Modify `packages/domain/src/index.ts`: export profile rules.
- Create `packages/domain/tests/profile.test.ts`: unit coverage for normalization and magic bytes.

### Worker

- Create `apps/worker/migrations/0010_profile_account_center.sql`: profile columns, email-change requests, session user agent, and account audit table.
- Modify `apps/worker/tests/helpers/d1.ts`: apply migration `0010` in test databases.
- Create `apps/worker/tests/profile-migration.test.ts`: prove additive migration preserves users and creates constraints.
- Create `apps/worker/src/profile/profile-model.ts`: repository/service interfaces and stable errors.
- Create `apps/worker/src/profile/d1-profile-repository.ts`: user-scoped profile, security, session, and deletion persistence.
- Create `apps/worker/src/profile/profile-avatar-store.ts`: private R2 avatar access.
- Create `apps/worker/src/profile/profile-service.ts`: validation, password verification, email change, avatar lifecycle, and account deletion orchestration.
- Create `apps/worker/src/routes/profile.ts`: `/api/v2/profile/*` route registry.
- Modify `apps/worker/src/auth/auth-service.ts`: record session user agent and expose the repository password/session primitives used by the profile service.
- Modify `apps/worker/src/auth/d1-auth-repository.ts`: persist user agent on newly created sessions.
- Modify `apps/worker/src/auth/resend-email.ts`: send email-change codes.
- Modify `apps/worker/src/routes/auth.ts`: pass user agent into login.
- Modify `apps/worker/src/bootstrap.ts`: construct and register profile services/routes.
- Modify `apps/worker/src/index.ts`: export profile modules for tests.
- Create `apps/worker/tests/d1-profile-repository.test.ts`.
- Create `apps/worker/tests/profile-service.test.ts`.
- Create `apps/worker/tests/profile-routes.test.ts`.

### Web

- Modify `apps/web/src/data/api-client.ts`: support bounded raw command bodies while preserving JSON envelopes.
- Create `apps/web/src/data/profile-client.ts`: typed user-scoped profile API client.
- Modify `apps/web/src/data/index.ts`: export `ProfileClient`.
- Create `apps/web/src/notes/note-draft-controller.ts`: IndexedDB-backed creation draft lifecycle.
- Modify `apps/web/src/data/local-store.ts`: list and remove drafts.
- Create `apps/web/src/navigation/ProductNavigation.tsx`: direct Chinese destinations and account trigger.
- Create `apps/web/src/account/AccountMenu.tsx`.
- Create `apps/web/src/account/AccountCenter.tsx`.
- Create `apps/web/src/account/ProfilePanel.tsx`.
- Create `apps/web/src/account/SecurityPanel.tsx`.
- Create `apps/web/src/account/WorkspacePanel.tsx`.
- Create `apps/web/src/account/DataPrivacyPanel.tsx`.
- Create `apps/web/src/account/index.ts`.
- Modify `apps/web/src/app/App.tsx`: compose navigation, note draft, knowledge view, AI status view, and account center.
- Modify `apps/web/src/layout/AdaptiveWorkbench.tsx`: keep custom mobile navigation and modal state consistent.
- Modify `apps/web/src/styles.css`: labeled primary actions, account views, mobile FAB, focus, safe-area, and zoom behavior.
- Modify `apps/web/src/index.ts`: export new public web modules.
- Create `apps/web/tests/profile-client.test.ts`.
- Create `apps/web/tests/note-draft-controller.test.ts`.
- Create `apps/web/tests/product-navigation.test.tsx`.
- Create `apps/web/tests/account-center.test.tsx`.
- Create `apps/web/tests/core-ux-mobile.test.tsx`.
- Modify `apps/web/tests/live-notes-flow.test.tsx`.

### Browser verification

- Modify `scripts/smoke-beta-browser.mjs`: assert visible new-note action, note reload, account-center reachability, and profile update in a test account.
- Modify `scripts/verify-deploy-readiness.mjs`: retain lazy-chunk and size checks after account code is added.
- Modify `docs/public-beta-cutover-runbook.md`: add Phase 1 Preview checks without authorizing production deployment.

---

### Task 1: Shared Profile Contracts and Domain Rules

**Files:**
- Create: `packages/contracts/src/profile.ts`
- Modify: `packages/contracts/src/index.ts`
- Test: `packages/contracts/tests/profile-contracts.test.ts`
- Create: `packages/domain/src/profile.ts`
- Modify: `packages/domain/src/index.ts`
- Test: `packages/domain/tests/profile.test.ts`

**Interfaces:**
- Consumes: existing Zod, `assertPasswordPolicy`, and API response conventions.
- Produces: `Profile`, `UpdateProfileInput`, `AccountSession`, `RequestEmailChangeInput`, `ConfirmEmailChangeInput`, `ChangePasswordInput`, `DeleteAccountInput`, `normalizeProfilePatch`, and `detectAvatarMimeType`.

- [ ] **Step 1: Write failing contract and domain tests**

```ts
// packages/contracts/tests/profile-contracts.test.ts
import { describe, expect, it } from "vitest";
import {
  AccountSessionSchema,
  ChangePasswordInputSchema,
  ProfileSchema,
  UpdateProfileInputSchema,
} from "../src/profile";

describe("profile contracts", () => {
  it("accepts a complete profile and rejects unknown fields", () => {
    const profile = {
      id: "user-1",
      email: "user@example.com",
      display_name: "明实林",
      biography: "记录与整理",
      locale: "zh-CN",
      timezone: "Asia/Shanghai",
      avatar_url: "/api/v2/profile/avatar",
      updated_at: "2026-08-22T00:00:00.000Z",
    };
    expect(ProfileSchema.parse(profile)).toEqual(profile);
    expect(() => ProfileSchema.parse({ ...profile, password_hash: "secret" })).toThrow();
  });

  it("bounds profile and password changes", () => {
    expect(UpdateProfileInputSchema.parse({ display_name: " User ", locale: "zh-CN", timezone: "Asia/Shanghai" }))
      .toEqual({ display_name: "User", locale: "zh-CN", timezone: "Asia/Shanghai" });
    expect(() => UpdateProfileInputSchema.parse({ biography: "x".repeat(501) })).toThrow();
    expect(() => ChangePasswordInputSchema.parse({ current_password: "x", new_password: "short" })).toThrow();
  });

  it("marks only the caller session as current", () => {
    expect(AccountSessionSchema.parse({
      id: "session-1", current: true, user_agent: "Chrome",
      created_at: "2026-08-22T00:00:00.000Z",
      last_seen_at: "2026-08-22T00:00:00.000Z",
      expires_at: "2026-09-21T00:00:00.000Z",
    }).current).toBe(true);
  });
});
```

```ts
// packages/domain/tests/profile.test.ts
import { describe, expect, it } from "vitest";
import { detectAvatarMimeType, normalizeProfilePatch } from "../src/profile";

describe("profile domain", () => {
  it("normalizes supported profile values", () => {
    expect(normalizeProfilePatch({ display_name: "  User  ", biography: "  Bio  ", locale: "zh-CN", timezone: "Asia/Shanghai" }))
      .toEqual({ display_name: "User", biography: "Bio", locale: "zh-CN", timezone: "Asia/Shanghai" });
  });

  it("detects real avatar bytes instead of trusting Content-Type", () => {
    expect(detectAvatarMimeType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("image/png");
    expect(detectAvatarMimeType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(detectAvatarMimeType(new TextEncoder().encode("<svg onload=alert(1)>"))).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run:

```powershell
npm run test --workspace @nexus/contracts -- tests/profile-contracts.test.ts
npm run test --workspace @nexus/domain -- tests/profile.test.ts
```

Expected: both commands fail because `profile.ts` and its exports do not exist.

- [ ] **Step 3: Add the contracts and domain implementation**

```ts
// packages/contracts/src/profile.ts
import { z } from "zod";

const TimestampSchema = z.string().datetime({ offset: true });
export const ProfileSchema = z.object({
  id: z.string().min(1),
  email: z.string().email(),
  display_name: z.string().max(80),
  biography: z.string().max(500),
  locale: z.string().min(2).max(16),
  timezone: z.string().min(1).max(64),
  avatar_url: z.string().min(1).nullable(),
  updated_at: TimestampSchema,
}).strict();

export const UpdateProfileInputSchema = z.object({
  display_name: z.string().trim().min(1).max(80).optional(),
  biography: z.string().trim().max(500).optional(),
  locale: z.string().trim().min(2).max(16).optional(),
  timezone: z.string().trim().min(1).max(64).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "At least one profile field is required");

export const AccountSessionSchema = z.object({
  id: z.string().min(1), current: z.boolean(), user_agent: z.string().max(512),
  created_at: TimestampSchema, last_seen_at: TimestampSchema, expires_at: TimestampSchema,
}).strict();
export const RequestEmailChangeInputSchema = z.object({
  new_email: z.string().email(), current_password: z.string().min(1).max(128),
}).strict();
export const ConfirmEmailChangeInputSchema = z.object({
  new_email: z.string().email(), code: z.string().regex(/^\d{6}$/),
}).strict();
export const ChangePasswordInputSchema = z.object({
  current_password: z.string().min(1).max(128), new_password: z.string().min(10).max(128),
}).strict();
export const DeleteAccountInputSchema = z.object({
  current_password: z.string().min(1).max(128), confirmation: z.literal("永久删除我的账户"),
}).strict();

export type Profile = z.infer<typeof ProfileSchema>;
export type UpdateProfileInput = z.infer<typeof UpdateProfileInputSchema>;
export type AccountSession = z.infer<typeof AccountSessionSchema>;
export type RequestEmailChangeInput = z.infer<typeof RequestEmailChangeInputSchema>;
export type ConfirmEmailChangeInput = z.infer<typeof ConfirmEmailChangeInputSchema>;
export type ChangePasswordInput = z.infer<typeof ChangePasswordInputSchema>;
export type DeleteAccountInput = z.infer<typeof DeleteAccountInputSchema>;
```

```ts
// packages/domain/src/profile.ts
import type { UpdateProfileInput } from "@nexus/contracts";

const localePattern = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/u;
const timezonePattern = /^(?:UTC|[A-Za-z_]+(?:\/[A-Za-z0-9_+.-]+)+)$/u;

export function normalizeProfilePatch(input: UpdateProfileInput): UpdateProfileInput {
  const result = {
    ...(input.display_name !== undefined ? { display_name: input.display_name.trim() } : {}),
    ...(input.biography !== undefined ? { biography: input.biography.trim() } : {}),
    ...(input.locale !== undefined ? { locale: input.locale.trim() } : {}),
    ...(input.timezone !== undefined ? { timezone: input.timezone.trim() } : {}),
  };
  if (result.locale && !localePattern.test(result.locale)) throw new Error("PROFILE_LOCALE_INVALID");
  if (result.timezone && !timezonePattern.test(result.timezone)) throw new Error("PROFILE_TIMEZONE_INVALID");
  return result;
}

export type AvatarMimeType = "image/png" | "image/jpeg" | "image/webp";
export function detectAvatarMimeType(bytes: Uint8Array): AvatarMimeType | null {
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((v, i) => bytes[i] === v)) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 12 && new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" && new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP") return "image/webp";
  return null;
}
```

Export `./profile` from both package index files.

- [ ] **Step 4: Run tests and typecheck GREEN**

```powershell
npm run test --workspace @nexus/contracts -- tests/profile-contracts.test.ts
npm run test --workspace @nexus/domain -- tests/profile.test.ts
npm run beta:lint
```

Expected: profile tests pass and workspace typecheck reports no errors.

- [ ] **Step 5: Commit**

```powershell
git add packages/contracts/src/profile.ts packages/contracts/src/index.ts packages/contracts/tests/profile-contracts.test.ts packages/domain/src/profile.ts packages/domain/src/index.ts packages/domain/tests/profile.test.ts
git commit -m "feat(profile): define shared account contracts"
```

---

### Task 2: Additive Profile and Session Migration

**Files:**
- Create: `apps/worker/migrations/0010_profile_account_center.sql`
- Modify: `apps/worker/tests/helpers/d1.ts`
- Create: `apps/worker/tests/profile-migration.test.ts`
- Modify: `apps/worker/tests/schema.test.ts`

**Interfaces:**
- Consumes: `users`, `sessions`, and published Beta schema.
- Produces: profile columns, `email_change_requests`, `account_audit_logs`, and `sessions.user_agent`.

- [ ] **Step 1: Write the failing real-D1 migration test**

```ts
// apps/worker/tests/profile-migration.test.ts
import { describe, expect, it } from "vitest";
import { applyMigration, createTestD1 } from "./helpers/d1";

describe("profile account migration", () => {
  it("preserves users and adds profile/security persistence", async () => {
    const test = await createTestD1({ through: 9 });
    try {
      await test.db.prepare(
        "INSERT INTO users (id,email,password_hash,display_name,status,created_at,updated_at) VALUES ('u1','u@example.test','hash','User','active',?,?)",
      ).bind("2026-08-22T00:00:00.000Z", "2026-08-22T00:00:00.000Z").run();
      await applyMigration(test.db, "../../migrations/0010_profile_account_center.sql");
      const user = await test.db.prepare("SELECT display_name, biography, locale, timezone FROM users WHERE id='u1'").first();
      expect(user).toEqual({ display_name: "User", biography: "", locale: "zh-CN", timezone: "Asia/Shanghai" });
      const tables = await test.db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('email_change_requests','account_audit_logs') ORDER BY name",
      ).all();
      expect(tables.results.map((row) => row.name)).toEqual(["account_audit_logs", "email_change_requests"]);
    } finally { await test.dispose(); }
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

```powershell
npm run test --workspace @nexus/worker -- tests/profile-migration.test.ts
```

Expected: FAIL because migration `0010_profile_account_center.sql` does not exist.

- [ ] **Step 3: Add migration and register it in the helper**

```sql
-- apps/worker/migrations/0010_profile_account_center.sql
ALTER TABLE users ADD COLUMN biography TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN locale TEXT NOT NULL DEFAULT 'zh-CN';
ALTER TABLE users ADD COLUMN timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai';
ALTER TABLE users ADD COLUMN avatar_key TEXT;
ALTER TABLE users ADD COLUMN deletion_requested_at TEXT;
ALTER TABLE sessions ADD COLUMN user_agent TEXT NOT NULL DEFAULT '';

CREATE TABLE email_change_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  new_email TEXT NOT NULL COLLATE NOCASE,
  code_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX email_change_user_active_idx ON email_change_requests(user_id, consumed_at, expires_at);

CREATE TABLE account_audit_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event TEXT NOT NULL,
  request_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX account_audit_user_created_idx ON account_audit_logs(user_id, created_at DESC, id DESC);
```

Append `"../../migrations/0010_profile_account_center.sql"` to `migrationPaths` and add `profileMigrationPath` assertions to `schema.test.ts` for both new tables and all added columns.

- [ ] **Step 4: Run migration and worker tests GREEN**

```powershell
npm run test --workspace @nexus/worker -- tests/profile-migration.test.ts tests/schema.test.ts
```

Expected: both test files pass against real Miniflare D1.

- [ ] **Step 5: Commit**

```powershell
git add apps/worker/migrations/0010_profile_account_center.sql apps/worker/tests/helpers/d1.ts apps/worker/tests/profile-migration.test.ts apps/worker/tests/schema.test.ts
git commit -m "feat(profile): add account center migration"
```

---

### Task 3: D1 Profile Repository

**Files:**
- Create: `apps/worker/src/profile/profile-model.ts`
- Create: `apps/worker/src/profile/d1-profile-repository.ts`
- Create: `apps/worker/tests/d1-profile-repository.test.ts`
- Modify: `apps/worker/src/index.ts`

**Interfaces:**
- Consumes: migrated D1 tables and shared `Profile`/`AccountSession` types.
- Produces: `ProfileRepository` and `D1ProfileRepository` with atomic email, password, session, audit, and deletion operations.

- [ ] **Step 1: Write failing repository tests**

```ts
// apps/worker/tests/d1-profile-repository.test.ts
import { describe, expect, it } from "vitest";
import { createTestD1 } from "./helpers/d1";
import { D1ProfileRepository } from "../src/profile/d1-profile-repository";

const now = "2026-08-22T00:00:00.000Z";

async function seed(db: D1Database) {
  await db.prepare("INSERT INTO users (id,email,password_hash,display_name,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?)")
    .bind("user-1", "one@example.test", "hash", "One", "active", now, now).run();
}

describe("D1ProfileRepository", () => {
  it("updates profile fields without exposing password data", async () => {
    const test = await createTestD1();
    try {
      await seed(test.db);
      const repository = new D1ProfileRepository(test.db, () => "id-1");
      await repository.updateProfile("user-1", { display_name: "New", biography: "Bio", locale: "zh-CN", timezone: "Asia/Shanghai" }, now);
      await expect(repository.getProfile("user-1")).resolves.toMatchObject({ display_name: "New", biography: "Bio" });
    } finally { await test.dispose(); }
  });

  it("revokes only an owned non-current session", async () => {
    const test = await createTestD1();
    try {
      await seed(test.db);
      for (const id of ["current", "other"]) {
        await test.db.prepare("INSERT INTO sessions (id,user_id,token_hash,expires_at,last_seen_at,created_at,user_agent) VALUES (?,?,?,?,?,?,?)")
          .bind(id, "user-1", `hash-${id}`, "2026-09-22T00:00:00.000Z", now, now, "Chrome").run();
      }
      const repository = new D1ProfileRepository(test.db, () => "id-1");
      expect(await repository.revokeOwnedSession("user-1", "current", "current", now)).toBe(false);
      expect(await repository.revokeOwnedSession("user-1", "other", "current", now)).toBe(true);
    } finally { await test.dispose(); }
  });

  it("atomically consumes an email code and updates the email once", async () => {
    const test = await createTestD1();
    try {
      await seed(test.db);
      const repository = new D1ProfileRepository(test.db, () => "request-1");
      await repository.createEmailChange("user-1", "new@example.test", "code-hash", "2026-08-22T00:15:00.000Z", now);
      expect(await repository.consumeEmailChange("user-1", "new@example.test", "code-hash", now)).toBe(true);
      expect(await repository.consumeEmailChange("user-1", "new@example.test", "code-hash", now)).toBe(false);
      await expect(repository.getProfile("user-1")).resolves.toMatchObject({ email: "new@example.test" });
    } finally { await test.dispose(); }
  });
});
```

- [ ] **Step 2: Run the repository test and verify RED**

```powershell
npm run test --workspace @nexus/worker -- tests/d1-profile-repository.test.ts
```

Expected: FAIL because `D1ProfileRepository` does not exist.

- [ ] **Step 3: Define repository contracts and implementation**

```ts
// apps/worker/src/profile/profile-model.ts
import type { AccountSession, Profile, UpdateProfileInput } from "@nexus/contracts";

export interface StoredProfile extends Profile { password_hash: string; avatar_key: string | null }
export interface ProfileRepository {
  getProfile(userId: string): Promise<StoredProfile | null>;
  findActiveUserByEmail(email: string): Promise<{ id: string } | null>;
  updateProfile(userId: string, patch: UpdateProfileInput, now: string): Promise<void>;
  replaceAvatar(userId: string, avatarKey: string | null, now: string): Promise<string | null>;
  listSessions(userId: string, currentSessionId: string, now: string): Promise<AccountSession[]>;
  listOwnedTeamWorkspaces(userId: string): Promise<Array<{ id: string; name: string }>>;
  revokeOwnedSession(userId: string, sessionId: string, currentSessionId: string, now: string): Promise<boolean>;
  createEmailChange(userId: string, email: string, codeHash: string, expiresAt: string, now: string): Promise<void>;
  consumeEmailChange(userId: string, email: string, codeHash: string, now: string): Promise<boolean>;
  changePasswordAndRevokeOthers(userId: string, currentSessionId: string, passwordHash: string, now: string): Promise<void>;
  deleteAccount(userId: string, anonymizedEmail: string, passwordHash: string, now: string): Promise<string | null>;
  appendAudit(userId: string, event: string, requestId: string, now: string): Promise<void>;
}

export class ProfileServiceError extends Error {
  readonly retryable = false;
  constructor(readonly code: string, message: string, readonly status = 400) { super(message); }
}
```

Implement `D1ProfileRepository` with parameterized SQL. Use `UPDATE ... RETURNING` for owned-session revocation, and D1 `batch()` for:

```ts
async consumeEmailChange(userId: string, email: string, codeHash: string, now: string) {
  const consume = this.db.prepare(
    `UPDATE email_change_requests SET consumed_at=?
     WHERE user_id=? AND new_email=? COLLATE NOCASE AND code_hash=?
       AND consumed_at IS NULL AND expires_at>?
     RETURNING id`,
  ).bind(now, userId, email, codeHash, now);
  const update = this.db.prepare(
    `UPDATE users SET email=?, email_verified_at=?, updated_at=?
     WHERE id=? AND EXISTS (
       SELECT 1 FROM email_change_requests
       WHERE user_id=? AND new_email=? COLLATE NOCASE AND code_hash=? AND consumed_at=?
     )`,
  ).bind(email, now, now, userId, userId, email, codeHash, now);
  const result = await this.db.batch([consume, update]);
  return Boolean(result[0]?.results?.length);
}
```

`deleteAccount` is called only after `listOwnedTeamWorkspaces` returns an empty list. If it does not, the service returns `OWNERSHIP_TRANSFER_REQUIRED` with the workspace names. Once ownership is clear, deletion removes the user's personal workspace (tenant rows cascade), removes team memberships, deletes pending auth tokens, revokes sessions, and anonymizes the retained tombstone user so team-authored content keeps valid foreign keys:

```ts
await this.db.batch([
  this.db.prepare("DELETE FROM workspaces WHERE owner_user_id=? AND workspace_type='personal'").bind(userId),
  this.db.prepare("DELETE FROM workspace_members WHERE user_id=?").bind(userId),
  this.db.prepare("DELETE FROM email_codes WHERE user_id=?").bind(userId),
  this.db.prepare("DELETE FROM password_resets WHERE user_id=?").bind(userId),
  this.db.prepare("DELETE FROM email_change_requests WHERE user_id=?").bind(userId),
  this.db.prepare("UPDATE sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL").bind(now, userId),
  this.db.prepare(
    "UPDATE users SET email=?,password_hash=?,display_name='已删除用户',biography='',avatar_key=NULL,status='deleted',deletion_requested_at=?,updated_at=? WHERE id=?",
  ).bind(anonymizedEmail, passwordHash, now, now, userId),
]);
```

Export the repository and model from `apps/worker/src/index.ts`.

- [ ] **Step 4: Run repository tests GREEN**

```powershell
npm run test --workspace @nexus/worker -- tests/d1-profile-repository.test.ts
```

Expected: all repository tests pass, including one-time email consumption and session ownership.

- [ ] **Step 5: Commit**

```powershell
git add apps/worker/src/profile/profile-model.ts apps/worker/src/profile/d1-profile-repository.ts apps/worker/tests/d1-profile-repository.test.ts apps/worker/src/index.ts
git commit -m "feat(profile): add account repository"
```

---

### Task 4: Profile Service, Private Avatar Store, and Security Flows

**Files:**
- Create: `apps/worker/src/profile/profile-avatar-store.ts`
- Create: `apps/worker/src/profile/profile-service.ts`
- Create: `apps/worker/tests/profile-service.test.ts`
- Modify: `apps/worker/src/auth/resend-email.ts`
- Test: `apps/worker/tests/resend-email.test.ts`

**Interfaces:**
- Consumes: `ProfileRepository`, `WebCryptoPasswordHasher`, `SecureTokenService`, R2, Resend sender, and profile/domain contracts.
- Produces: `ProfileService` methods used only by profile routes.

- [ ] **Step 1: Write failing service tests**

```ts
// apps/worker/tests/profile-service.test.ts
import { describe, expect, it, vi } from "vitest";
import { ProfileService } from "../src/profile/profile-service";

function dependencies() {
  return {
    repository: {
      getProfile: vi.fn(async () => ({ id: "u1", email: "old@example.test", display_name: "User", biography: "", locale: "zh-CN", timezone: "Asia/Shanghai", avatar_url: null, avatar_key: null, password_hash: "hash", updated_at: "2026-08-22T00:00:00.000Z" })),
      findActiveUserByEmail: vi.fn(async () => null), updateProfile: vi.fn(), replaceAvatar: vi.fn(async () => null),
      listSessions: vi.fn(async () => []), listOwnedTeamWorkspaces: vi.fn(async () => []), revokeOwnedSession: vi.fn(async () => true), createEmailChange: vi.fn(),
      consumeEmailChange: vi.fn(async () => true), changePasswordAndRevokeOthers: vi.fn(), deleteAccount: vi.fn(async () => null), appendAudit: vi.fn(),
    },
    password: { verify: vi.fn(async () => true), hash: vi.fn(async () => "new-hash") },
    tokens: { createEmailCode: vi.fn(() => "123456"), hash: vi.fn(async (value: string) => `hash:${value}`) },
    email: { sendEmailChange: vi.fn() },
    avatars: { put: vi.fn(async () => undefined), get: vi.fn(), delete: vi.fn(async () => undefined) },
    createId: () => "avatar-1", clock: () => new Date("2026-08-22T00:00:00.000Z"),
  };
}

describe("ProfileService", () => {
  it("requires the current password before sending an email-change code", async () => {
    const deps = dependencies();
    deps.password.verify.mockResolvedValue(false);
    const service = new ProfileService(deps as any);
    await expect(service.requestEmailChange("u1", { new_email: "new@example.test", current_password: "wrong" }, "req-1"))
      .rejects.toMatchObject({ code: "CURRENT_PASSWORD_INVALID", status: 403 });
    expect(deps.email.sendEmailChange).not.toHaveBeenCalled();
  });

  it("rejects SVG bytes even when the declared type is PNG", async () => {
    const service = new ProfileService(dependencies() as any);
    await expect(service.uploadAvatar("u1", "image/png", new TextEncoder().encode("<svg/>"), "req-2"))
      .rejects.toMatchObject({ code: "AVATAR_TYPE_INVALID" });
  });

  it("changes password and revokes other sessions", async () => {
    const deps = dependencies();
    const service = new ProfileService(deps as any);
    await service.changePassword("u1", "session-1", { current_password: "old-password", new_password: "new-password-123" }, "req-3");
    expect(deps.repository.changePasswordAndRevokeOthers).toHaveBeenCalledWith("u1", "session-1", "new-hash", "2026-08-22T00:00:00.000Z");
  });

  it("blocks account deletion until owned team workspaces are transferred", async () => {
    const deps = dependencies();
    deps.repository.listOwnedTeamWorkspaces.mockResolvedValue([{ id: "team-1", name: "团队空间" }]);
    const service = new ProfileService(deps as any);
    await expect(service.deleteAccount("u1", { current_password: "old-password", confirmation: "永久删除我的账户" }, "req-delete"))
      .rejects.toMatchObject({ code: "OWNERSHIP_TRANSFER_REQUIRED", status: 409 });
    expect(deps.repository.deleteAccount).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run service tests and verify RED**

```powershell
npm run test --workspace @nexus/worker -- tests/profile-service.test.ts tests/resend-email.test.ts
```

Expected: profile service import fails and Resend sender lacks `sendEmailChange`.

- [ ] **Step 3: Implement service and avatar store**

```ts
// apps/worker/src/profile/profile-avatar-store.ts
export class ProfileAvatarStore {
  constructor(private readonly files?: R2Bucket) {}
  async put(key: string, bytes: Uint8Array, contentType: string) {
    if (!this.files) throw new Error("PROFILE_AVATAR_STORAGE_UNAVAILABLE");
    await this.files.put(key, bytes, { httpMetadata: { contentType, cacheControl: "private, no-store" } });
  }
  get(key: string) { return this.files?.get(key) ?? Promise.resolve(null); }
  async delete(key: string) { await this.files?.delete(key); }
}
```

```ts
// apps/worker/src/profile/profile-service.ts (public method surface)
export interface ProfileServiceApi {
  getProfile(userId: string): Promise<Profile>;
  updateProfile(userId: string, input: UpdateProfileInput, requestId: string): Promise<Profile>;
  uploadAvatar(userId: string, declaredType: string, bytes: Uint8Array, requestId: string): Promise<Profile>;
  getAvatar(userId: string): Promise<R2ObjectBody | null>;
  deleteAvatar(userId: string, requestId: string): Promise<Profile>;
  requestEmailChange(userId: string, input: RequestEmailChangeInput, requestId: string): Promise<{ accepted: true }>;
  confirmEmailChange(userId: string, input: ConfirmEmailChangeInput, requestId: string): Promise<Profile>;
  changePassword(userId: string, sessionId: string, input: ChangePasswordInput, requestId: string): Promise<{ changed: true }>;
  listSessions(userId: string, sessionId: string): Promise<AccountSession[]>;
  revokeSession(userId: string, sessionId: string, targetSessionId: string, requestId: string): Promise<{ revoked: true }>;
  deleteAccount(userId: string, input: DeleteAccountInput, requestId: string): Promise<{ deleted: true }>;
}
```

Implement `ProfileService` as `implements ProfileServiceApi`; each method applies the validation, audit, and compensation rules shown below before returning the parsed contract value.

Implement methods with these invariants:

```ts
const bytes = inputBytes.byteLength;
if (bytes === 0 || bytes > 2 * 1024 * 1024) throw new ProfileServiceError("AVATAR_SIZE_INVALID", "Avatar must be between 1 byte and 2 MiB", 413);
const mime = detectAvatarMimeType(inputBytes);
if (!mime || mime !== declaredType) throw new ProfileServiceError("AVATAR_TYPE_INVALID", "Avatar content type is invalid", 415);
const key = `profiles/${userId}/${this.dependencies.createId()}`;
await this.dependencies.avatars.put(key, inputBytes, mime);
try {
  const oldKey = await this.dependencies.repository.replaceAvatar(userId, key, now);
  if (oldKey && oldKey !== key) {
    try { await this.dependencies.avatars.delete(oldKey); }
    catch { this.dependencies.logger.log(JSON.stringify({ type: "profile.avatar_cleanup_failed", request_id: requestId })); }
  }
} catch (error) {
  await this.dependencies.avatars.delete(key);
  throw error;
}
```

Before an email-change request, normalize the address, reject the current address, reject an existing active user with `EMAIL_EXISTS`, and verify the current password. Before password change or account deletion, verify the current password; validate the new password through `assertPasswordPolicy`. If an old avatar delete fails after the new key commits, log the request ID without user ID or object key and return success because the orphan is private and unreachable.

Email-change hashes must bind user, normalized email, and code: `email_change:${userId}:${email}:${code}`. Add this sender method:

```ts
sendEmailChange(email: string, code: string) {
  return this.send({
    to: email,
    subject: "确认你的 Nexus Notes 新邮箱",
    text: `你的邮箱变更验证码是 ${code}。验证码将在 15 分钟后失效。`,
  });
}
```

Emit only these account audit event names: `profile.updated`, `avatar.updated`, `avatar.deleted`, `email.change_requested`, `email.changed`, `password.changed`, `session.revoked`, and `account.deleted`. Audit rows contain user ID, event name, request ID, and timestamp only.

- [ ] **Step 4: Run service and email tests GREEN**

```powershell
npm run test --workspace @nexus/worker -- tests/profile-service.test.ts tests/resend-email.test.ts
```

Expected: invalid passwords and avatar bytes are rejected, valid password changes revoke other sessions, and email output contains no secret beyond the one-time code.

- [ ] **Step 5: Commit**

```powershell
git add apps/worker/src/profile/profile-avatar-store.ts apps/worker/src/profile/profile-service.ts apps/worker/tests/profile-service.test.ts apps/worker/src/auth/resend-email.ts apps/worker/tests/resend-email.test.ts
git commit -m "feat(profile): add secure account service"
```

---

### Task 5: Session-Aware Profile Routes and Worker Wiring

**Files:**
- Create: `apps/worker/src/routes/profile.ts`
- Create: `apps/worker/tests/profile-routes.test.ts`
- Modify: `apps/worker/src/auth/auth-service.ts`
- Modify: `apps/worker/src/auth/d1-auth-repository.ts`
- Modify: `apps/worker/src/routes/auth.ts`
- Modify: `apps/worker/src/bootstrap.ts`
- Modify: `apps/worker/src/index.ts`
- Test: `apps/worker/tests/auth-routes.test.ts`
- Test: `apps/worker/tests/d1-auth-repository.test.ts`

**Interfaces:**
- Consumes: `ProfileService`, `SessionPrincipal`, profile schemas, R2, auth password/token/email dependencies.
- Produces: all approved `/api/v2/profile/*` routes and session user-agent persistence.

- [ ] **Step 1: Write failing route and session tests**

```ts
// apps/worker/tests/profile-routes.test.ts
import { describe, expect, it, vi } from "vitest";
import { createRouteRegistry, registerProfileRoutes } from "../src";

describe("profile routes", () => {
  it("requires a session and scopes profile reads to the principal", async () => {
    const service = { getProfile: vi.fn(async () => ({ id: "u1" })) };
    const registry = createRouteRegistry({ requestId: () => "req-profile", authenticate: vi.fn(async () => ({ userId: "u1", sessionId: "s1" })) });
    registerProfileRoutes(registry, () => service as any);
    const response = await registry.fetch(new Request("https://beta.test/api/v2/profile"), {});
    expect(response.status).toBe(200);
    expect(service.getProfile).toHaveBeenCalledWith("u1");
  });

  it("passes current session and request id into password changes", async () => {
    const service = { changePassword: vi.fn(async () => ({ changed: true })) };
    const registry = createRouteRegistry({ requestId: () => "req-password", authenticate: vi.fn(async () => ({ userId: "u1", sessionId: "s1" })) });
    registerProfileRoutes(registry, () => service as any);
    const response = await registry.fetch(new Request("https://beta.test/api/v2/profile/password/change", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ current_password: "old-password", new_password: "new-password-123" }),
    }), {});
    expect(response.status).toBe(200);
    expect(service.changePassword).toHaveBeenCalledWith("u1", "s1", expect.anything(), "req-password");
  });

  it("clears the cookie after account deletion", async () => {
    const service = { deleteAccount: vi.fn(async () => ({ deleted: true })) };
    const registry = createRouteRegistry({ requestId: () => "req-delete", authenticate: vi.fn(async () => ({ userId: "u1", sessionId: "s1" })) });
    registerProfileRoutes(registry, () => service as any);
    const response = await registry.fetch(new Request("https://beta.test/api/v2/profile", {
      method: "DELETE", headers: { "content-type": "application/json" },
      body: JSON.stringify({ current_password: "old-password", confirmation: "永久删除我的账户" }),
    }), {});
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });
});
```

Extend auth tests to expect `userAgent: "Test Browser"` from the login request and persisted `sessions.user_agent`.

- [ ] **Step 2: Run the focused worker tests and verify RED**

```powershell
npm run test --workspace @nexus/worker -- tests/profile-routes.test.ts tests/auth-routes.test.ts tests/d1-auth-repository.test.ts
```

Expected: profile route exports are missing and login does not pass/persist user agent.

- [ ] **Step 3: Implement route registry and wiring**

Register these exact routes with `auth: "session"`:

```ts
GET    /api/v2/profile
PATCH  /api/v2/profile
GET    /api/v2/profile/avatar
POST   /api/v2/profile/avatar
DELETE /api/v2/profile/avatar
POST   /api/v2/profile/email/change
POST   /api/v2/profile/email/confirm
POST   /api/v2/profile/password/change
GET    /api/v2/profile/sessions
DELETE /api/v2/profile/sessions/:sessionId
DELETE /api/v2/profile
```

Apply IP rate limits of 5 requests per 30 minutes to email-change request, password change, and account deletion; 10 requests per 30 minutes to email confirmation; and 30 requests per minute to profile/session/avatar reads and profile updates.

Use `UpdateProfileInputSchema`, `RequestEmailChangeInputSchema`, `ConfirmEmailChangeInputSchema`, `ChangePasswordInputSchema`, and `DeleteAccountInputSchema` directly as body schemas. Raw avatar upload must read a bounded stream, not call unbounded `arrayBuffer()`:

```ts
async function readAvatar(request: Request, maximum = 2 * 1024 * 1024) {
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maximum) { await reader.cancel(); throw new ProfileServiceError("AVATAR_SIZE_INVALID", "Avatar exceeds 2 MiB", 413); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}
```

In `bootstrap.ts`, construct `ProfileService` from `D1ProfileRepository`, `ProfileAvatarStore`, `WebCryptoPasswordHasher`, the auth token service, and `ResendEmailSender`, then call `registerProfileRoutes(registry, createProfileService)`. Pass `request.headers.get("user-agent") ?? ""` to `AuthService.login` and persist it in `createSession`.

- [ ] **Step 4: Run route, auth, and full worker tests GREEN**

```powershell
npm run test --workspace @nexus/worker -- tests/profile-routes.test.ts tests/auth-routes.test.ts tests/d1-auth-repository.test.ts
npm run test:worker
```

Expected: focused and full Worker suites pass with secure cookie, user-agent, profile scoping, and avatar limits.

- [ ] **Step 5: Commit**

```powershell
git add apps/worker/src/routes/profile.ts apps/worker/tests/profile-routes.test.ts apps/worker/src/auth/auth-service.ts apps/worker/src/auth/d1-auth-repository.ts apps/worker/src/routes/auth.ts apps/worker/src/bootstrap.ts apps/worker/src/index.ts apps/worker/tests/auth-routes.test.ts apps/worker/tests/d1-auth-repository.test.ts
git commit -m "feat(profile): expose account center routes"
```

---

### Task 6: Typed Web Profile Client and Raw Avatar Commands

**Files:**
- Modify: `apps/web/src/data/api-client.ts`
- Test: `apps/web/tests/api-client.test.ts`
- Create: `apps/web/src/data/profile-client.ts`
- Create: `apps/web/tests/profile-client.test.ts`
- Modify: `apps/web/src/data/index.ts`

**Interfaces:**
- Consumes: `ApiClient.request`, profile contracts, and JSON API envelopes.
- Produces: `ProfileClient` used by account panels and raw-body support that still applies timeout, credentials, and idempotency.

- [ ] **Step 1: Write failing API and profile-client tests**

```ts
// append to apps/web/tests/api-client.test.ts
it("sends a raw avatar body without JSON encoding", async () => {
  const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ success: true, data: { uploaded: true }, request_id: "req-1" }), { status: 200 }));
  const client = new ApiClient({ fetchImpl: fetchImpl as any });
  const file = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: "image/png" });
  await client.request({ path: "/api/v2/profile/avatar", method: "POST", body: file, bodyMode: "raw", headers: { "content-type": "image/png" }, requestClass: "command", policy: { timeoutMs: 8000, retry: 0, idempotencyKey: "avatar-1" } });
  expect(fetchImpl).toHaveBeenCalledWith("/api/v2/profile/avatar", expect.objectContaining({ body: file }));
});
```

```ts
// apps/web/tests/profile-client.test.ts
import { describe, expect, it, vi } from "vitest";
import { ProfileClient } from "../src/data/profile-client";

describe("ProfileClient", () => {
  it("uses user-scoped paths and never sends a workspace header", async () => {
    const request = vi.fn(async () => ({ id: "u1", display_name: "User" }));
    const client = new ProfileClient({ request } as any, { createId: () => "id-1" });
    await client.getProfile();
    await client.updateProfile({ display_name: "New" });
    expect(request).toHaveBeenNthCalledWith(1, expect.objectContaining({ path: "/api/v2/profile" }));
    expect(request).toHaveBeenNthCalledWith(2, expect.not.objectContaining({ headers: expect.objectContaining({ "x-workspace-id": expect.anything() }) }));
  });
});
```

- [ ] **Step 2: Run web tests and verify RED**

```powershell
npm run test --workspace @nexus/web -- tests/api-client.test.ts tests/profile-client.test.ts
```

Expected: `bodyMode` and `ProfileClient` do not exist.

- [ ] **Step 3: Add raw mode and typed client**

Add `bodyMode?: "json" | "raw"` to `ApiRequestOptions`. In `execute`:

```ts
const bodyMode = options.bodyMode ?? "json";
if (options.body !== undefined && bodyMode === "json") headers["content-type"] = "application/json";
const requestBody = options.body === undefined
  ? undefined
  : bodyMode === "raw"
    ? options.body as BodyInit
    : JSON.stringify(options.body);
```

Create `ProfileClient` methods: `getProfile`, `updateProfile`, `uploadAvatar`, `deleteAvatar`, `requestEmailChange`, `confirmEmailChange`, `changePassword`, `listSessions`, `revokeSession`, and `deleteAccount`. Queries use retry `2` and dedupe keys; commands use retry `0` and generated idempotency keys. Parse all returned objects with shared schemas before returning them.

```ts
uploadAvatar(file: File) {
  return this.client.request<Profile>({
    path: "/api/v2/profile/avatar", method: "POST", body: file, bodyMode: "raw",
    headers: { "content-type": file.type }, requestClass: "command",
    policy: { timeoutMs: 15_000, retry: 0, idempotencyKey: this.createId() },
  }).then((value) => ProfileSchema.parse(value));
}
```

- [ ] **Step 4: Run web client tests GREEN**

```powershell
npm run test --workspace @nexus/web -- tests/api-client.test.ts tests/profile-client.test.ts
```

Expected: raw bytes are sent unchanged and profile requests remain user-scoped.

- [ ] **Step 5: Commit**

```powershell
git add apps/web/src/data/api-client.ts apps/web/tests/api-client.test.ts apps/web/src/data/profile-client.ts apps/web/tests/profile-client.test.ts apps/web/src/data/index.ts
git commit -m "feat(profile): add typed web profile client"
```

---

### Task 7: Durable One-Activation Note Creation

**Files:**
- Modify: `apps/web/src/data/local-store.ts`
- Test: `apps/web/tests/local-store.test.ts`
- Create: `apps/web/src/notes/note-draft-controller.ts`
- Create: `apps/web/tests/note-draft-controller.test.ts`
- Modify: `apps/web/src/app/App.tsx`
- Modify: `apps/web/tests/live-notes-flow.test.tsx`

**Interfaces:**
- Consumes: `BetaLocalStore`, `NotesClient`, current note editor state.
- Produces: `NoteDraftController`, labeled creation buttons, `Ctrl/Cmd+N`, title focus, reload recovery, and draft reconciliation.

- [ ] **Step 1: Write failing draft and interaction tests**

```ts
// apps/web/tests/note-draft-controller.test.ts
import { describe, expect, it, vi } from "vitest";
import { NoteDraftController } from "../src/notes/note-draft-controller";

describe("NoteDraftController", () => {
  it("persists before returning a new draft and removes it after reconciliation", async () => {
    const calls: string[] = [];
    const store = {
      saveDraft: vi.fn(async () => { calls.push("save"); }),
      listDrafts: vi.fn(async () => []),
      removeDraft: vi.fn(async () => { calls.push("remove"); }),
    };
    const controller = new NoteDraftController(store as any, { createId: () => "local-1", clock: () => new Date("2026-08-22T00:00:00.000Z") });
    const draft = await controller.create("ws-1");
    expect(draft.entity_id).toBe("local-1");
    await controller.reconcile("ws-1", "local-1");
    expect(calls).toEqual(["save", "remove"]);
    expect(store.removeDraft).toHaveBeenCalledWith("ws-1", "local-1");
  });
});
```

Add to `live-notes-flow.test.tsx`:

```ts
it("shows a labeled primary action, focuses title, and handles Ctrl+N", async () => {
  const apiClient = createApiClient();
  renderWorkspace(apiClient);
  fireEvent.click(await screen.findByRole("button", { name: "打开笔记列表" }));
  const create = await screen.findByRole("button", { name: "新建笔记" });
  expect(create).toHaveTextContent("新建笔记");
  fireEvent.keyDown(window, { key: "n", ctrlKey: true });
  expect(await screen.findByRole("textbox", { name: "笔记标题" })).toHaveFocus();
});
```

- [ ] **Step 2: Run focused tests and verify RED**

```powershell
npm run test --workspace @nexus/web -- tests/local-store.test.ts tests/note-draft-controller.test.ts tests/live-notes-flow.test.tsx
```

Expected: draft controller/list/remove methods are missing and the icon-only action lacks visible text/focus behavior.

- [ ] **Step 3: Implement durable draft lifecycle and App integration**

Add to `BetaLocalStore`:

```ts
async listDrafts(workspaceId: string): Promise<LocalDraft[]> {
  const database = await this.database;
  const transaction = database.transaction("drafts", "readonly");
  const done = transactionDone(transaction);
  const drafts = await requestResult(transaction.objectStore("drafts").getAll()) as LocalDraft[];
  await done;
  return drafts.filter((draft) => draft.workspace_id === workspaceId)
    .sort((left, right) => right.updated_at.localeCompare(left.updated_at));
}

async removeDraft(workspaceId: string, entityId: string) {
  const database = await this.database;
  const transaction = database.transaction("drafts", "readwrite");
  const done = transactionDone(transaction);
  transaction.objectStore("drafts").delete(this.entityKey(workspaceId, entityId));
  await done;
}
```

`NoteDraftController.create()` must await `saveDraft` before returning. Integrate one controller instance in `AuthenticatedWorkspace`; keep `activeDraftId`, save title/content changes to IndexedDB, recover the newest unsaved draft when notes finish loading, and remove it only after the server note succeeds. Replace the context header action with:

```tsx
<button className="primary-create-note" type="button" onClick={() => void startNewNote()}>
  <Plus aria-hidden="true" size={17} />
  <span>新建笔记</span>
</button>
```

Add the same labeled action to the empty state, focus the title through `useRef`, and install a window keydown effect that prevents default and calls `startNewNote()` for `Ctrl/Cmd+N` outside editable elements.

- [ ] **Step 4: Run draft and live-note tests GREEN**

```powershell
npm run test --workspace @nexus/web -- tests/local-store.test.ts tests/note-draft-controller.test.ts tests/live-notes-flow.test.tsx
```

Expected: one activation opens and focuses a durable draft, failure keeps it, and successful creation removes it.

- [ ] **Step 5: Commit**

```powershell
git add apps/web/src/data/local-store.ts apps/web/tests/local-store.test.ts apps/web/src/notes/note-draft-controller.ts apps/web/tests/note-draft-controller.test.ts apps/web/src/app/App.tsx apps/web/tests/live-notes-flow.test.tsx
git commit -m "feat(notes): make new note visible and durable"
```

---

### Task 8: Direct Product Navigation and Account Menu

**Files:**
- Create: `apps/web/src/navigation/ProductNavigation.tsx`
- Create: `apps/web/src/account/AccountMenu.tsx`
- Create: `apps/web/tests/product-navigation.test.tsx`
- Modify: `apps/web/src/app/App.tsx`
- Modify: `apps/web/src/styles.css`
- Modify: `apps/web/src/index.ts`

**Interfaces:**
- Consumes: current domain state, `AuthUserSummary`, unread count, and collaboration capability.
- Produces: `ProductDomain`, direct Chinese rail/mobile navigation, and account-menu callbacks.

- [ ] **Step 1: Write the failing navigation test**

```tsx
// apps/web/tests/product-navigation.test.tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ProductNavigation } from "../src/navigation/ProductNavigation";

describe("ProductNavigation", () => {
  it("uses direct destinations and opens account center from the signed-in identity", () => {
    const change = vi.fn();
    const logout = vi.fn();
    render(<ProductNavigation active="notes" user={{ id: "u1", email: "u@example.test", displayName: "用户" }} unreadCount={0} collaborationEnabled onChange={change} onNotifications={vi.fn()} onLogout={logout} />);
    for (const label of ["笔记", "数据库", "知识整理", "协作", "AI 助手", "设置"]) {
      expect(screen.getByRole("button", { name: label })).toBeVisible();
    }
    expect(screen.queryByText("收集")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "设置" }));
    expect(change).toHaveBeenCalledWith("account");
    fireEvent.click(screen.getByRole("button", { name: "账户" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "退出登录" }));
    expect(logout).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

```powershell
npm run test --workspace @nexus/web -- tests/product-navigation.test.tsx
```

Expected: `ProductNavigation` is missing.

- [ ] **Step 3: Implement navigation and menu**

```ts
export type ProductDomain = "notes" | "databases" | "knowledge" | "collaboration" | "ai" | "account";
```

Render labeled rail buttons for `笔记`, `数据库`, `知识整理`, `协作`, and `AI 助手`; render `设置` and account identity at the bottom. `AccountMenu` contains `个人中心`, `通知`, `工作区`, and `退出登录`, closes on Escape/outside click, restores focus to its trigger, and never renders over an active modal. `onLogout` calls `AuthClient.logout()`, clears user-scoped local state, and returns `AuthGate` to anonymous state without storing session data in browser-readable storage.

In `App.tsx`, map `knowledge` to the existing `KnowledgeRecoveryPanel`, map `ai` to an honest `AI 助手尚未配置` status page, and map `account` to the account center added in Tasks 9-10. Do not leave buttons that silently redirect to notes.

- [ ] **Step 4: Run navigation and adaptive-workbench tests GREEN**

```powershell
npm run test --workspace @nexus/web -- tests/product-navigation.test.tsx tests/adaptive-workbench.test.tsx
```

Expected: direct destinations are visible, keyboard behavior passes, and the workbench still has one scroll owner.

- [ ] **Step 5: Commit**

```powershell
git add apps/web/src/navigation/ProductNavigation.tsx apps/web/src/account/AccountMenu.tsx apps/web/tests/product-navigation.test.tsx apps/web/src/app/App.tsx apps/web/src/styles.css apps/web/src/index.ts
git commit -m "feat(navigation): expose direct product destinations"
```

---

### Task 9: Profile and Security Account Panels

**Files:**
- Create: `apps/web/src/account/AccountCenter.tsx`
- Create: `apps/web/src/account/ProfilePanel.tsx`
- Create: `apps/web/src/account/SecurityPanel.tsx`
- Create: `apps/web/src/account/index.ts`
- Create: `apps/web/tests/account-center.test.tsx`
- Modify: `apps/web/src/app/App.tsx`
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- Consumes: `ProfileClient`, `Profile`, account sessions, and App domain callback.
- Produces: accessible four-tab account shell, profile/avatar forms, email verification, password change, and session revocation.

- [ ] **Step 1: Write failing account-center tests**

```tsx
// apps/web/tests/account-center.test.tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AccountCenter } from "../src/account/AccountCenter";

const profile = { id: "u1", email: "u@example.test", display_name: "用户", biography: "", locale: "zh-CN", timezone: "Asia/Shanghai", avatar_url: null, updated_at: "2026-08-22T00:00:00.000Z" };

describe("AccountCenter", () => {
  it("updates profile and keeps entered values when the request fails", async () => {
    const client = { getProfile: vi.fn(async () => profile), updateProfile: vi.fn(async () => { throw new Error("offline"); }), listSessions: vi.fn(async () => []) };
    render(<AccountCenter client={client as any} workspaces={[]} activeWorkspaceId={null} onWorkspaceChange={vi.fn()} onDeleted={vi.fn()} />);
    fireEvent.change(await screen.findByLabelText("昵称"), { target: { value: "新昵称" } });
    fireEvent.click(screen.getByRole("button", { name: "保存个人资料" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("保存失败");
    expect(screen.getByLabelText("昵称")).toHaveValue("新昵称");
  });

  it("requires confirmation before revoking another session", async () => {
    const client = { getProfile: vi.fn(async () => profile), listSessions: vi.fn(async () => [{ id: "s2", current: false, user_agent: "Chrome", created_at: profile.updated_at, last_seen_at: profile.updated_at, expires_at: "2026-09-22T00:00:00.000Z" }]), revokeSession: vi.fn(async () => undefined) };
    render(<AccountCenter client={client as any} workspaces={[]} activeWorkspaceId={null} onWorkspaceChange={vi.fn()} onDeleted={vi.fn()} />);
    fireEvent.click(await screen.findByRole("tab", { name: "安全" }));
    fireEvent.click(await screen.findByRole("button", { name: "撤销此会话" }));
    fireEvent.click(screen.getByRole("button", { name: "确认撤销" }));
    await waitFor(() => expect(client.revokeSession).toHaveBeenCalledWith("s2"));
  });
});
```

- [ ] **Step 2: Run test and verify RED**

```powershell
npm run test --workspace @nexus/web -- tests/account-center.test.tsx
```

Expected: account components are missing.

- [ ] **Step 3: Implement account shell, profile, and security panels**

`AccountCenter` owns loading/error state and tabs `个人资料`, `安全`, `工作区`, `数据与隐私`. `ProfilePanel` uses controlled inputs for display name, biography, locale, and timezone; avatar selection validates type/size before upload. `SecurityPanel` implements two-step email change, password change, and session listing. All command errors remain next to the relevant form and never reset controlled values.

Use an accessible tab contract:

```tsx
<div role="tablist" aria-label="账户中心">
  {tabs.map((tab) => <button key={tab.id} role="tab" aria-selected={active === tab.id} onClick={() => setActive(tab.id)}>{tab.label}</button>)}
</div>
<section role="tabpanel" aria-labelledby={`account-tab-${active}`}>{panel}</section>
```

After profile success, update the account identity shown in navigation through `onProfileChange(profile)`.

- [ ] **Step 4: Run account-center tests GREEN**

```powershell
npm run test --workspace @nexus/web -- tests/account-center.test.tsx tests/product-navigation.test.tsx
```

Expected: profile failures preserve input, security actions require confirmation, and updated names reach navigation.

- [ ] **Step 5: Commit**

```powershell
git add apps/web/src/account/AccountCenter.tsx apps/web/src/account/ProfilePanel.tsx apps/web/src/account/SecurityPanel.tsx apps/web/src/account/index.ts apps/web/tests/account-center.test.tsx apps/web/src/app/App.tsx apps/web/src/styles.css
git commit -m "feat(account): add profile and security center"
```

---

### Task 10: Workspace and Data-Privacy Panels

**Files:**
- Create: `apps/web/src/account/WorkspacePanel.tsx`
- Create: `apps/web/src/account/DataPrivacyPanel.tsx`
- Modify: `apps/web/src/account/AccountCenter.tsx`
- Modify: `apps/web/tests/account-center.test.tsx`
- Modify: `apps/web/src/app/App.tsx`

**Interfaces:**
- Consumes: session workspace summaries, `CollaborationClient`, `OperationsClient`, `ProfileClient`.
- Produces: workspace switch/member-management entry, usage/export/status view, and destructive account-deletion flow.

- [ ] **Step 1: Add failing workspace/privacy tests**

```tsx
it("switches workspace and creates an idempotent export job", async () => {
  const changeWorkspace = vi.fn();
  const profileClient = {
    getProfile: vi.fn(async () => profile),
    listSessions: vi.fn(async () => []),
  };
  const operations = { getUsage: vi.fn(async () => ({ notes: 1, databases: 0, attachment_bytes: 0, queued_jobs: 0 })), getStatus: vi.fn(async () => ({ queue: "ready", storage: "ready", ocr: "ready", version: "test" })), createJob: vi.fn(async () => ({ id: "job-1" })) };
  render(<AccountCenter client={profileClient as any} operations={operations as any} workspaces={[{ id: "ws-1", name: "个人", slug: "personal", role: "owner", revision: 1 }]} activeWorkspaceId="ws-1" onWorkspaceChange={changeWorkspace} onDeleted={vi.fn()} />);
  fireEvent.click(await screen.findByRole("tab", { name: "数据与隐私" }));
  fireEvent.click(screen.getByRole("button", { name: "导出全部数据" }));
  await waitFor(() => expect(operations.createJob).toHaveBeenCalledWith(expect.objectContaining({ kind: "export" })));
});

it("requires the exact destructive phrase before deleting the account", async () => {
  const profileClient = {
    getProfile: vi.fn(async () => profile),
    listSessions: vi.fn(async () => []),
    deleteAccount: vi.fn(async () => ({ deleted: true })),
  };
  render(<AccountCenter client={profileClient as any} workspaces={[]} activeWorkspaceId={null} onWorkspaceChange={vi.fn()} onDeleted={vi.fn()} />);
  fireEvent.click(await screen.findByRole("tab", { name: "数据与隐私" }));
  fireEvent.change(screen.getByLabelText("删除确认文字"), { target: { value: "永久删除我的账户" } });
  fireEvent.change(screen.getByLabelText("当前密码"), { target: { value: "current-password" } });
  fireEvent.click(screen.getByRole("button", { name: "永久删除账户" }));
  expect(profileClient.deleteAccount).toHaveBeenCalledWith({ current_password: "current-password", confirmation: "永久删除我的账户" });
});
```

- [ ] **Step 2: Run test and verify RED**

```powershell
npm run test --workspace @nexus/web -- tests/account-center.test.tsx
```

Expected: workspace and data/privacy panels are absent.

- [ ] **Step 3: Implement workspace and privacy panels**

`WorkspacePanel` displays each session workspace and role, invokes `onWorkspaceChange(id)`, and exposes member administration only to owners by embedding existing `CollaborationClient` member methods. `DataPrivacyPanel` loads usage and service status, displays backup honestly as `未配置自动备份，可立即导出`, and creates an export job with:

```ts
operations.createJob({
  kind: "export",
  idempotency_key: crypto.randomUUID(),
  payload: { format: "zip", scope: "workspace" },
});
```

Deletion requires current password, exact phrase, a second confirmation dialog, and then `ProfileClient.deleteAccount`. On success, clear local user-scoped IndexedDB through `BetaLocalStore.destroy()`, call `onDeleted()`, and navigate to the signed-out screen.

- [ ] **Step 4: Run account and collaboration tests GREEN**

```powershell
npm run test --workspace @nexus/web -- tests/account-center.test.tsx tests/collaboration-client.test.ts
```

Expected: role-sensitive workspace controls, export job creation, honest backup state, and destructive confirmation pass.

- [ ] **Step 5: Commit**

```powershell
git add apps/web/src/account/WorkspacePanel.tsx apps/web/src/account/DataPrivacyPanel.tsx apps/web/src/account/AccountCenter.tsx apps/web/tests/account-center.test.tsx apps/web/src/app/App.tsx
git commit -m "feat(account): add workspace and privacy controls"
```

---

### Task 11: Mobile, Keyboard, Focus, and Accessibility Closure

**Files:**
- Create: `apps/web/tests/core-ux-mobile.test.tsx`
- Modify: `apps/web/src/layout/AdaptiveWorkbench.tsx`
- Modify: `apps/web/src/styles.css`
- Modify: `apps/web/tests/adaptive-workbench.test.tsx`
- Modify: `apps/web/tests/auth-mobile-overflow.test.ts`

**Interfaces:**
- Consumes: account center, custom mobile navigation, `useMobileChrome`, safe-area CSS.
- Produces: one scroll owner, keyboard-safe bottom navigation/FAB, focus restoration, and 390 px/200% zoom layout invariants.

- [ ] **Step 1: Write failing mobile/accessibility tests**

```tsx
// apps/web/tests/core-ux-mobile.test.tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { App } from "../src/app/App";

const mobileSession = {
  user: { id: "user-1", email: "user@example.test", displayName: "用户" },
  workspaces: [{ id: "ws-1", name: "个人", slug: "personal", role: "owner" as const, revision: 1 }],
  active_workspace_id: "ws-1",
};

function renderMobile() {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
  const request = vi.fn(async (input: { path: string }) => {
    if (input.path === "/api/v2/notes?limit=50") return { items: [], next_cursor: null };
    if (input.path.startsWith("/api/v2/attachments")) return { items: [], next_cursor: null };
    if (input.path.startsWith("/api/v2/knowledge/diagnostics")) return { items: [], next_cursor: null };
    if (input.path.startsWith("/api/v2/notifications/unread")) return { unread_count: 0 };
    if (input.path === "/api/v2/profile") return { id: "user-1", email: "user@example.test", display_name: "用户", biography: "", locale: "zh-CN", timezone: "Asia/Shanghai", avatar_url: null, updated_at: "2026-08-22T00:00:00.000Z" };
    return { items: [], next_cursor: null };
  });
  return render(<App authClient={{ session: vi.fn(async () => mobileSession) } as any} apiClient={{ request } as any} turnstileSiteKey="test" />);
}

describe("core UX mobile", () => {
  it("keeps one scroll owner and exposes new note and account actions at 390 px", async () => {
    renderMobile();
    expect(await screen.findByRole("button", { name: "新建笔记" })).toBeVisible();
    expect(screen.getByRole("button", { name: "账户" })).toBeVisible();
    expect(document.querySelectorAll('[data-scroll-owner="page"]')).toHaveLength(1);
  });

  it("hides mobile chrome while an editor input is focused", async () => {
    renderMobile();
    fireEvent.click(await screen.findByRole("button", { name: "新建笔记" }));
    fireEvent.focus(screen.getByRole("textbox", { name: "笔记内容" }));
    expect(screen.getByRole("navigation", { name: "移动端主导航" })).toHaveAttribute("data-visible", "false");
  });
});
```

- [ ] **Step 2: Run mobile tests and verify RED**

```powershell
npm run test --workspace @nexus/web -- tests/core-ux-mobile.test.tsx tests/adaptive-workbench.test.tsx tests/auth-mobile-overflow.test.ts
```

Expected: visible mobile create/account actions and keyboard hiding are not all satisfied.

- [ ] **Step 3: Implement mobile and focus behavior**

Add a mobile `+` button with `aria-label="新建笔记"`, use the custom mobile navigation from `ProductNavigation`, and add these bounded styles:

```css
.primary-create-note { display: inline-flex; min-height: 40px; align-items: center; gap: 8px; padding: 0 14px; }
.mobile-create-note { position: fixed; right: 16px; bottom: calc(64px + env(safe-area-inset-bottom)); z-index: 8; }
.account-center { min-width: 0; height: 100%; overflow: hidden; }
.account-panel-scroll { height: 100%; overflow: auto; overscroll-behavior: contain; }
@media (max-width: 767px) {
  .account-center { display: flex; flex-direction: column; }
  .account-tabs { overflow-x: auto; flex: 0 0 auto; }
  .mobile-bottom-nav[data-visible="false"] + .mobile-create-note { display: none; }
}
@media (max-width: 390px), (min-resolution: 2dppx) {
  .account-form-grid { grid-template-columns: minmax(0, 1fr); }
}
```

Use focus-visible outlines, `aria-live` for save states, `role="alert"` for failures, Escape close semantics, and opener focus restoration. Verify no fixed element remains in layout when hidden.

- [ ] **Step 4: Run mobile and full web tests GREEN**

```powershell
npm run test --workspace @nexus/web -- tests/core-ux-mobile.test.tsx tests/adaptive-workbench.test.tsx tests/auth-mobile-overflow.test.ts
npm run test:unit
```

Expected: focused tests and the full web suite pass with one mobile scroll owner.

- [ ] **Step 5: Commit**

```powershell
git add apps/web/tests/core-ux-mobile.test.tsx apps/web/src/layout/AdaptiveWorkbench.tsx apps/web/src/styles.css apps/web/tests/adaptive-workbench.test.tsx apps/web/tests/auth-mobile-overflow.test.ts
git commit -m "fix(mobile): keep account and editor controls visible"
```

---

### Task 12: Browser Smoke, Release Gates, and Phase 1 Handoff

**Files:**
- Modify: `scripts/smoke-beta-browser.mjs`
- Modify: `scripts/verify-deploy-readiness.mjs`
- Modify: `docs/public-beta-cutover-runbook.md`

**Interfaces:**
- Consumes: completed Phase 1 UI/API and authenticated browser fixture supplied outside the repository.
- Produces: repeatable evidence for note visibility, profile update, persistence, bundle budgets, and Preview readiness.

- [ ] **Step 1: Add failing smoke assertions before product changes are accepted**

Add selectors and assertions that require:

```js
await page.getByRole("button", { name: "新建笔记" }).waitFor({ state: "visible" });
await page.getByRole("button", { name: "账户" }).click();
await page.getByRole("menuitem", { name: "个人中心" }).click();
await page.getByRole("tab", { name: "个人资料" }).waitFor({ state: "visible" });
const title = `Phase 1 ${Date.now()}`;
await page.getByLabel("昵称").fill(title);
await page.getByRole("button", { name: "保存个人资料" }).click();
await page.reload();
await page.getByText(title, { exact: true }).waitFor({ state: "visible" });
```

Use only credentials supplied through process environment variables. Do not write cookies, passwords, codes, or profiles into the repository.

- [ ] **Step 2: Run local gates and capture any legitimate RED**

```powershell
npm run lint
npm run test:unit
npm run test:integration
npm run test:worker
npm run build
npm audit --omit=dev
npm run verify:deploy
```

Expected before final corrections: any remaining failure names the exact unmet Phase 1 behavior; there must be no unrelated skipped gate.

- [ ] **Step 3: Correct only gate failures and update the runbook**

Document these Preview acceptance checks in `docs/public-beta-cutover-runbook.md`:

```text
1. At 390 px, “新建笔记” and “账户” are visible and do not cover the editor.
2. New note survives failed save and full reload through IndexedDB recovery.
3. Profile update survives reload; avatar response is private/no-store.
4. Password change preserves the current session and revokes other sessions.
5. Email change is atomic and one-time; account deletion clears session and local data.
6. Initial HTML does not preload Markdown, OCR, or AI chunks.
```

Do not add a production deploy command. Record Preview deployment as a separate authorization checkpoint.

- [ ] **Step 4: Run the complete verification matrix GREEN**

```powershell
npm run lint
npm run test:unit
npm run test:integration
npm run test:worker
npm run test:e2e
npm run test:a11y
npm run test:perf
npm run build
npm audit --omit=dev
npm run verify:deploy
```

Expected:

```text
All tests pass.
No production high vulnerability.
No Vite >500 kB warning.
No initial markdown-vendor, ocr-vendor, or AI modulepreload.
Preview readiness passes without mutating production.
```

- [ ] **Step 5: Commit Phase 1 verification artifacts**

```powershell
git add scripts/smoke-beta-browser.mjs scripts/verify-deploy-readiness.mjs docs/public-beta-cutover-runbook.md
git commit -m "test(release): gate core UX and account center"
```

After this commit, inspect `git status --short`, push only after explicit repository authorization if required by the current session, and request separate authorization before Preview deployment or any remote migration.
