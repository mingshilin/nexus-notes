# Nexus Notes Public Beta Complete Rewrite Design

## 1. Decision Summary

Nexus Notes will be rebuilt as a Cloudflare-native public Beta while preserving the current product's visual language. The rewrite replaces the frontend application structure, client data layer, Worker routing, domain modules, database schema, offline synchronization, and operational foundation.

Approved decisions:

- Preserve the existing Nexus Notes colors, typography, glass surfaces, radii, spacing character, icons, and Chinese product tone.
- Use the approved B layout: an adaptive workbench with a narrow navigation rail, contextual list drawers, a flexible main canvas, and an on-demand inspector.
- Deliver the full feature map across Capture, Create, Organize, Collaborate, and Operate.
- Keep AI behind an inactive feature boundary. AI is not a Beta release gate.
- Keep the Cloudflare platform: React/Vite, Workers, D1, R2, Queues, Durable Objects, and Analytics Engine.
- Treat the implementation as a complete source rewrite, not a refactor of `App.tsx`, `DatabasePage.tsx`, or the current Worker route switch.
- Existing production data may be reset for the new Beta. A repository-external backup and an action-time confirmation are still mandatory before any destructive production operation.
- The production domain remains `https://notes.msl88ljctengxun.xyz/` after cutover.

## 2. Product and Release Goal

The target is a public Beta suitable for unknown users and multi-user workspaces. It must support public registration, durable data, tenant isolation, quotas, abuse controls, support diagnostics, backups, and a feedback loop. Billing and paid plans are excluded from this Beta.

The product must be designed for public SaaS growth without introducing a paid Postgres dependency. The initial Beta uses one D1 primary database with strict `workspace_id` partitioning and a repository layer that can later route workspaces to multiple D1 databases without changing domain APIs.

Success targets:

- 99.9% monthly Beta availability, excluding declared maintenance.
- LCP p75 below 2.5 seconds, INP p75 below 200 ms, CLS p75 below 0.1.
- Read API p95 below 500 ms and write API p95 below 800 ms under the Beta load profile.
- No silent note, database-record, attachment, or offline-operation data loss.
- Every failed user action has a visible state and a recovery path.
- Desktop, tablet, 390 px mobile, mobile keyboard, and 200% zoom retain one clear main scroll owner without navigation or inspector obstruction.

## 3. Information Architecture and UX

### 3.1 Product domains

The permanent navigation rail contains five domains:

1. Capture: unified inbox, daily notes, quick capture, Web Clipper, Markdown import, file import, OCR.
2. Create: notes, Markdown editor, attachments, templates, databases, table, board, calendar.
3. Organize: folders, tags, unified search, saved searches, graph, duplicate/orphan/unorganized diagnostics.
4. Collaborate: workspaces, comments, mentions, online presence, notifications, permissions, public sharing, revisions.
5. Operate: account/security, usage and quotas, audit log, import/export, backup/restore status, service status, Beta feedback, workspace administration.

AI summary, rewriting, knowledge Q&A, and semantic search remain hidden behind an `ai.enabled = false` capability flag.

### 3.2 Adaptive workbench

- At 1280 px and wider, show the navigation rail, optional contextual list, and main canvas. The inspector overlays or replaces the contextual list; it never permanently reduces the editor below its minimum readable width.
- From 768–1279 px, show the rail and main canvas. Lists, filters, properties, and the inspector use dismissible drawers.
- Below 768 px, render exactly one task pane at a time. Use bottom navigation for Home, Search, Create, Notifications, and Account.
- The mobile top and bottom chrome hide on downward content scroll and while a text field owns the visual viewport, then restore on upward scroll, navigation, or focus release.
- The editor, database, knowledge center, reminders, graph, settings, and dialogs each declare one scroll owner through a shared page-shell contract.
- `visualViewport` changes drive keyboard-safe insets. No fixed toolbar may rely only on `100vh`.
- Keep existing CSS variables and design-system primitives. New components must use the existing blue accent, surface hierarchy, shadows, radii, typography scale, and Lucide icon family.

## 4. Frontend Architecture

### 4.1 Application boundaries

The new frontend is organized by product domain rather than one application component:

- `app-shell`: routing, adaptive layout, error boundaries, capability flags, session bootstrap.
- `capture`: inbox, daily, quick capture, clipper, imports, OCR entry points.
- `editor`: note document, autosave, revisions, attachments, links, templates.
- `databases`: database metadata, properties, views, records, table, board, calendar.
- `organize`: folders, tags, search, saved searches, graph, diagnostics.
- `collaboration`: workspace members, comments, mentions, presence, notifications, sharing.
- `operations`: profile, security, usage, quotas, audit, export, feedback, status.
- `data`: API transport, normalized query cache, IndexedDB persistence, mutation queue, sync engine.

Every route is a lazy boundary with its own loading skeleton and recoverable error boundary. No page component may own unrelated domain state. Components over 500 lines or with more than 20 independent state variables require another responsibility split before merging.

### 4.2 Client data layer

Use a normalized client cache keyed by workspace and entity type. Persist only resumable user data to IndexedDB: query snapshots, note drafts, pending operations, upload metadata, and sync cursors. UI preferences remain in local storage and are versioned.

All requests flow through one transport:

```ts
type RequestClass = "query" | "idempotent-command" | "command" | "upload";

interface RequestPolicy {
  timeoutMs: number;
  retry: 0 | 1 | 2;
  dedupeKey?: string;
  idempotencyKey?: string;
  signal?: AbortSignal;
}

interface ApiErrorPayload {
  code: string;
  message: string;
  request_id: string;
  retryable: boolean;
  details?: Record<string, unknown>;
}
```

Rules:

- Cancel obsolete list/search/detail requests when route, workspace, query, filter, page, or selected entity changes.
- Retry GET queries at most twice with bounded jitter only for network, 408, 429, and 5xx failures.
- Retry writes only when an idempotency key is present.
- Deduplicate identical active queries and share their result.
- Show cached data immediately, mark it stale, and reconcile in the background.
- Keep optimistic updates local until the server revision confirms them; rollback or present a conflict card on rejection.

### 4.3 Offline synchronization

Offline editing is a core capability, not a separate knowledge-center form.

```ts
interface SyncOperation {
  operation_id: string;
  workspace_id: string;
  entity_type: "note" | "database_record" | "comment" | "attachment";
  entity_id: string;
  base_revision: number;
  kind: "create" | "update" | "delete";
  patch: Record<string, unknown>;
  created_at: string;
}
```

- `POST /api/v2/sync/push` accepts an ordered operation batch and returns per-operation status plus the next cursor.
- `GET /api/v2/sync/pull?cursor=` returns workspace changes after the cursor.
- The server stores operation IDs for idempotent replay.
- Conflicting text creates a conflict revision that compares local and server content. It never silently overwrites either version.
- Attachments upload after their parent entity exists. Failed uploads remain retryable without blocking text synchronization.

## 5. Backend Architecture

### 5.1 Worker gateway

Replace the central pathname switch with a typed route registry. The gateway owns request IDs, API version selection, auth bootstrap, CORS, security headers, body limits, deadlines, rate limits, quota checks, and response serialization. Domain handlers never parse unrelated routes.

All API responses use:

```ts
type ApiResponse<T> =
  | { success: true; data: T; meta?: Record<string, unknown>; request_id: string }
  | { success: false; error: ApiErrorPayload; request_id: string };
```

The new API is rooted at `/api/v2`. Because the Beta database may reset, old API compatibility is not required after cutover. The old production deployment stays live until the new acceptance gates pass.

### 5.2 Domain modules

- Identity/Tenant: users, sessions, email verification, password reset, workspaces, membership, capabilities, quotas.
- Knowledge Core: notes, revisions, folders, tags, links, graph, reminders, search documents.
- Structured Data: databases, properties, records, typed values, views, templates, comments, field permissions.
- Collaboration: comments, mentions, notifications, activity, audit, sharing, presence events.
- Files/Capture: attachments, uploads, OCR, imports, Clipper captures, export packages.
- Operations: health, status, feedback, support diagnostics, retention jobs, usage counters.

Each module exposes application services and repository interfaces. Cross-domain writes use one application service and one D1 transaction where possible. Derived work is queued after the primary transaction succeeds.

### 5.3 Realtime and background jobs

- Durable Objects provide workspace/document presence, typing/activity events, and client cache invalidation. They do not become the primary data store.
- Cloudflare Queues run OCR, search indexing, imports, exports, emails, notifications, and retention cleanup.
- Every queued message has an idempotency key, attempt count, deadline, and dead-letter path.
- Optional subsystems degrade independently. OCR, email, or presence failure cannot block note editing.

## 6. Data Model

The new schema is additive within a new Beta D1 database. Core tables include:

- Identity: `users`, `sessions`, `email_codes`, `password_resets`.
- Tenancy: `workspaces`, `workspace_members`, `workspace_capabilities`, `workspace_quotas`, `usage_counters`.
- Notes: `notes`, `note_revisions`, `folders`, `tags`, `note_tags`, `note_links`, `reminders`.
- Databases: `databases`, `database_properties`, `database_records`, `record_values`, `database_views`, `database_templates`, `database_permissions`, `field_permissions`.
- Collaboration: `comments`, `mentions`, `notifications`, `public_shares`, `activity_logs`, `audit_logs`.
- Files/jobs: `attachments`, `uploads`, `import_jobs`, `export_jobs`, `ocr_jobs`, `job_attempts`.
- Reliability: `processed_operations`, `sync_changes`, `rate_limits`, `feedback_items`.

Every tenant-owned row includes `workspace_id`. Repositories require a `WorkspaceContext`; raw workspace-free reads are forbidden. Mutable entities carry an integer `revision` and timestamps. List APIs use cursor pagination with a deterministic `(updated_at, id)` or domain-specific keyset.

R2 stores private objects using workspace-prefixed keys. Downloads use authorized Worker streaming or short-lived signed URLs. HTML is `no-store` or revalidated; hashed frontend assets use one-year immutable caching.

## 7. Reliability, Security, and Observability

### 7.1 Failure behavior

- Queries have deadlines and route-level cancellation.
- Optional panels show partial failure without replacing the main work area.
- Autosave exposes `saving`, `saved`, `offline`, `conflict`, and `failed` states.
- Queue failures surface in Operations with retry and support IDs.
- Session expiry preserves unsynced local work, signs the user out, and resumes synchronization after login.
- A global error boundary handles only unknown failures; each domain route owns ordinary recovery.

### 7.2 Security baseline

Retain and reimplement the current hardening work: explicit CORS allowlist, CSP/HSTS/security headers, private attachment caching, magic-byte validation, PBKDF2 share passwords, atomic tokens, session revocation, per-IP/account rate limits, tenant and field authorization, audit logs, and secret scanning. Configure `RATE_LIMIT_SECRET`, Turnstile, email, D1, R2, Queue, Durable Object, and Analytics bindings before public registration opens.

### 7.3 Observability

- Emit structured logs with `request_id`, workspace hash, route, status, latency, error code, queue attempt, and deployment version.
- Never log note content, passwords, tokens, attachment bytes, email codes, or session cookies.
- Track API latency/error rates, browser Web Vitals, crash-free sessions, queue age, OCR/import failure, synchronization conflicts, active workspaces, registration completion, and quota rejection.
- Alert on sustained 5xx, auth failure spikes, queue backlog, sync failure, backup failure, and SLO burn.

## 8. Full Beta Feature Acceptance

The Beta is feature-complete only when all five domains are usable end to end:

- Capture: inbox, daily, quick capture, Web Clipper, Markdown/file import, OCR with retry.
- Create: Markdown editing, attachment management, templates, databases, table/board/calendar, typed properties, bulk operations.
- Organize: folders, tags, unified source-aware search, saved filters, graph, duplicate/orphan/unorganized workflows.
- Collaborate: workspace roles, comments, mentions, notifications, presence, public shares with password/expiry/revoke, revisions and restore.
- Operate: account security, quota/usage display, audit, import/export jobs, backup status, service health, feedback, workspace admin.

AI controls must not be visible unless the capability is enabled in a future release.

## 9. Verification Strategy

Required automated layers:

- Unit tests for domain services, validators, reducers, sync merge, error mapping, retry policies, and responsive layout state.
- D1 integration tests for tenant isolation, permissions, transactions, cursor pagination, idempotency, revisions, and queue outbox behavior.
- Contract tests generated from the v2 route registry and shared schemas.
- Component tests for every route loading, empty, partial-error, offline, conflict, and permission state.
- Real browser tests for registration, login, note editing, autosave, offline/reconnect, search, database views, sharing, collaboration, export, and account recovery.
- Accessibility tests for keyboard navigation, focus restoration, labels, dialog trapping, reduced motion, 200% zoom, and 390 px reflow.
- Performance tests for initial chunks, 10,000-note search, 5,000-record table/board/calendar, API p95, cache behavior, and service-worker update safety.
- Fault tests for API timeout, D1 failure, R2 failure, Queue delay, Durable Object disconnect, expired session, duplicate operation replay, and browser crash recovery.
- Backup restore drill before public registration and before every destructive schema reset.

Release gates remain zero frontend/Worker test failures, zero high production-dependency vulnerabilities, no Vite chunk warning above the configured budget, lazy Markdown/OCR chunks absent from initial preload, security headers present online, and authenticated real-browser smoke passing.

## 10. Delivery and Cutover

Implementation is divided into independently gated programs even though the source is a complete rewrite:

1. Foundation: new isolated worktree, v2 package structure, design tokens, app shell, route registry, test harness, CI, preview deployment.
2. Reliability core: transport, cache, IndexedDB, sync protocol, auth, tenant context, quotas, logs, backup and restore.
3. Knowledge core: notes, editor, revisions, capture, folders, tags, search, graph, reminders, attachments.
4. Structured data: databases, typed properties, views, templates, table/board/calendar, bulk and CSV flows.
5. Collaboration: workspaces, permissions, comments, mentions, notifications, presence, sharing, activity and audit.
6. Operations and Beta: imports/exports, OCR jobs, status, feedback, admin, abuse controls, performance/load/accessibility closure.
7. Cutover: freeze old writes, export a final backup, obtain destructive-reset confirmation, initialize the new D1 database, deploy, run online acceptance, switch the production domain, and retain the old Worker deployment for rollback.

The old production site remains available until program 6 passes. No production data reset, remote migration, DNS/domain switch, secret rotation, deployment, GitHub merge, or tag is implied by approving this design; each is executed only in its implementation phase with the required checks and confirmations.

## 11. Out of Scope for This Beta

- Billing, paid subscriptions, invoices, taxes, refunds, and entitlement purchase flows.
- Platform-hosted AI or user-provided model keys.
- CRDT-based simultaneous rich-text coediting. Presence, comments, mentions, and conflict-safe offline editing are included.
- Native iOS, Android, Windows, or macOS applications.
- Guaranteed enterprise compliance certifications or formal SLA contracts.
