# Nexus Notes Beta Product Completion and AI Design

Date: 2026-08-22
Status: Approved in conversation
Branch: `codex/public-beta-rewrite`

## 1. Context

The Public Beta has rebuilt substantial backend foundations for notes, structured databases, knowledge recovery, attachments/OCR, collaboration, offline synchronization, and public sharing. The current product does not expose those capabilities clearly enough. In particular, note creation is hidden behind an icon-only action, account management is not a coherent product area, several legacy features have no Beta UI entry, and AI is available only as an OCR binding rather than a user-facing assistant.

The approved direction is to evolve the existing Beta instead of starting another rewrite. The existing visual language, `/api/v2` contracts, workspace isolation model, D1/R2/Queue architecture, offline data layer, and preview deployment remain the foundation.

## 2. Goals

1. Make note creation and account management immediately discoverable on desktop and mobile.
2. Restore every useful legacy capability with a visible entry, correct permissions, recoverable failure behavior, mobile support, and automated coverage.
3. Add a server-mediated, OpenAI-compatible AI assistant that can use explicitly authorized note context without exposing provider credentials.
4. Improve responsiveness and stability through clearer component boundaries, lazy loading, bounded data access, cancellation, deduplication, optimistic rollback, and offline recovery.
5. Deliver each phase through a separately verifiable Preview before any production cutover.

## 3. Non-goals and Boundaries

- Do not redesign the established Nexus Notes visual style.
- Do not expose AI provider keys to the browser, repository, logs, or generated assets.
- Do not allow AI to silently edit, delete, reorganize, or bulk-rewrite user data.
- Do not use AI, OCR, email, presence, or queue availability as a prerequisite for editing and saving notes.
- Do not switch the production domain, mutate the production D1 database, configure production secrets, or delete legacy resources without separate explicit authorization.
- Do not migrate every feature in one unreviewable release. Each phase has its own implementation and verification checkpoint.

## 4. Delivery Architecture

The program is split into four ordered phases:

1. **Core UX and account center**: clear navigation, visible note creation, resilient draft creation, and full account management.
2. **Legacy parity and product completeness**: expose and complete legacy note, knowledge, database, collaboration, and operations capabilities.
3. **AI assistant**: add conversations, authorized retrieval, citations, and confirmation-gated write actions.
4. **Performance and reliability**: complete application decomposition, performance budgets, load tests, fault tests, and release readiness.

Work remains in the current npm workspace structure:

- `apps/web`: route-level workspaces, account center, AI UI, offline and cache coordination.
- `apps/worker`: profile/security routes, AI gateway, permission-aware retrieval, usage limits, and observability.
- `packages/contracts`: Zod request/response schemas and stable API error contracts.
- `packages/domain`: profile, capability, AI action, permission, and validation rules.
- `packages/ui`: reusable controls that preserve the current visual language.
- `packages/testkit` and `tests/e2e`: fixtures, fault injection, browser flows, accessibility, and performance tests.

The current large `apps/web/src/app/App.tsx` becomes a composition root. Product behavior moves into independently testable `NotesWorkspace`, `KnowledgeWorkspace`, `DatabaseWorkspace`, `CollaborationWorkspace`, `AiWorkspace`, and `AccountCenter` modules.

## 5. Phase 1: Core UX and Account Center

### 5.1 Information Architecture

The primary navigation uses direct product names:

- 笔记
- 数据库
- 知识整理
- 协作
- AI 助手

Settings and the signed-in account remain anchored at the bottom of the navigation rail. Labels such as “Collect”, “Create”, and “Operations” are removed from primary navigation because they do not identify destinations.

Chinese remains the default user-interface language. English names in this document identify code modules or API concepts, not replacement UI copy.

On desktop, a contextual panel follows the selected product domain. On mobile, the same destinations are available from a bottom navigation or drawer without permanently reducing the main canvas. Keyboard appearance hides mobile chrome that would otherwise cover the editor.

### 5.2 Note Creation

Note creation has four equivalent, visible entries:

- A labeled blue `+ New note` button at the top of the note list.
- A `New note` action in empty states.
- A mobile floating action that respects safe area and editor focus.
- `Ctrl+N` on Windows/Linux and `Cmd+N` on macOS.

Activation immediately creates a local draft, opens the editor, and focuses the title. The draft is durable before the network request completes. Successful persistence reconciles the local identity with the server note. Failure keeps the local draft and exposes retry; it never clears user input or silently reports success.

### 5.3 Account Entry and Pages

The lower navigation area displays avatar, display name, and an account menu with:

- Account center
- Notifications
- Workspace switcher
- Sign out

The account center contains four pages:

1. **Profile**: display name, avatar, biography, locale, and time zone.
2. **Security**: verified email change, password change, active sessions, and revocation of other sessions.
3. **Workspaces**: memberships, current role, switching, invitations, and role-appropriate member administration.
4. **Data and privacy**: export, usage, backup status, account deletion, and audit-visible destructive confirmations.

Sensitive operations require the current password or a short-lived email verification code. Email changes do not become active until the new address is verified. Password reset or security-sensitive changes revoke older sessions where appropriate.

### 5.4 Phase 1 Interfaces

The exact schemas live in `packages/contracts`, but the route surface is:

```text
GET    /api/v2/profile
PATCH  /api/v2/profile
POST   /api/v2/profile/avatar
DELETE /api/v2/profile/avatar
POST   /api/v2/profile/email/change
POST   /api/v2/profile/email/confirm
POST   /api/v2/profile/password/change
GET    /api/v2/profile/sessions
DELETE /api/v2/profile/sessions/:sessionId
DELETE /api/v2/profile
```

Profile records are user-scoped. Workspace membership remains workspace-scoped. New D1 changes are additive and preserve existing Beta data.

## 6. Phase 2: Legacy Parity and Product Completeness

Every parity item requires five pieces of evidence before completion: a visible entry, correct authorization, recoverable failure behavior, mobile usability, and automated tests.

### 6.1 Notes

- Inbox, all notes, daily notes, recent notes, archive, and trash.
- Folders, tags, favorites, pinning, templates, and quick capture.
- Markdown editing, task blocks, slash commands, properties, and attachment management.
- Reminders, history and restore, import/export, and public sharing.

### 6.2 Knowledge

- Full-text search with title, body, tag, property, filename, and OCR hit sources.
- Complete saved-search filters.
- Global graph, local graph, and backlinks.
- Attachment/OCR center with combined filters and individual or batch retry.
- Unorganized notes, orphan notes, and duplicate-title recovery without content loss.
- Web Clipper, offline drafts/conflicts, and calendar feed.

### 6.3 Structured Databases

- Table, board, and calendar views.
- Typed properties, field validation, filters, sorts, grouping, saved views, and templates.
- Bulk edit, transactional CSV import, bounded export, comments, database permissions, and field permissions.
- Pagination or virtualization for large result sets, undated calendar assignment, and optimistic drag rollback.

### 6.4 Collaboration

- Workspace invitations and member roles.
- Comments, mentions, notifications, activity, and audit records.
- Public sharing with password, expiration, revocation, and an isolated public-token permission boundary.

### 6.5 Operations and New Product Capabilities

- Unified task center for OCR, import, export, sync, and other background jobs.
- Usage and quota views, service status, feedback, support request IDs, and backup status.
- Global command palette for navigation and actions.
- Onboarding and action-oriented empty states.
- Favorites, pinning, and recent-opened navigation.
- Recoverable export and backup evidence rather than a save indicator alone.

## 7. Phase 3: AI Assistant

### 7.1 User Experience

AI is available as both a primary `AI Assistant` workspace and an editor side panel. They share stored conversations. Users can stream, stop, retry, copy, and save responses.

Three write actions are supported initially:

- Create a new note from a response.
- Insert a response at the cursor.
- Replace the current selection.

Every write action presents a preview and requires explicit confirmation. Bulk organization, destructive actions, automatic deletion, and unattended workspace-wide rewriting are excluded from the initial release.

### 7.2 Provider Boundary

The Worker owns a provider-neutral adapter:

```ts
interface AiProvider {
  streamChat(input: AiChatRequest, signal: AbortSignal): ReadableStream<AiStreamEvent>;
}
```

The first adapter targets an OpenAI-compatible chat-completions endpoint. Deployment configuration uses:

- `AI_BASE_URL`
- `AI_API_KEY`
- `AI_MODEL`

These values are Worker secrets or environment configuration. The base URL is deployment-controlled and validated against an explicit HTTPS policy; it is never accepted from a browser request. Provider credentials are never returned to clients.

### 7.3 AI Routes

```text
GET    /api/v2/ai/capabilities
GET    /api/v2/ai/conversations
POST   /api/v2/ai/conversations
GET    /api/v2/ai/conversations/:conversationId
DELETE /api/v2/ai/conversations/:conversationId
POST   /api/v2/ai/conversations/:conversationId/messages
POST   /api/v2/ai/actions/preview
POST   /api/v2/ai/actions/commit
```

Message generation streams server events. Each request has a request ID, timeout, cancellation signal, bounded context and output, rate limit, usage accounting, and stable error codes.

### 7.4 Authorized Retrieval

Context is opt-in and can be restricted to the current note, selected notes, current search results, or the current workspace. The server performs permission-aware FTS retrieval and sends only a bounded set of relevant fragments to the provider. Database and field permissions are applied before retrieval results are constructed.

Retrieved note content is treated as untrusted data, separated from system instructions, and cannot define tools or override authorization. Responses include clickable source references derived by the server. If a claim has no reliable workspace source, the UI does not fabricate a citation.

### 7.5 Privacy and Failure Behavior

Conversation content is user data and follows workspace isolation and deletion rules. Operational logs exclude prompts, note bodies, responses, passwords, tokens, cookies, verification codes, and provider credentials.

Timeout, cancellation, 429, and provider 5xx errors preserve partial output and expose a retry action. AI failure never blocks note editing, local drafts, search, or sync. The OCR Workers AI binding remains separate from conversational AI.

## 8. Phase 4: Performance and Reliability

### 8.1 Frontend

- Route-level lazy loading for knowledge, database advanced views, collaboration, account, and AI.
- Markdown, OCR, and AI code excluded from initial preload.
- One explicit scroll owner per route.
- Cursor pagination or virtualization for note and database lists.
- Stable domain-scoped state and selectors to avoid global rerenders.
- Request cancellation, deduplication, stale-while-revalidate, and bounded caches.
- Service Worker limited to app shell and hashed assets; IndexedDB remains the API-data source of truth offline.

### 8.2 Mutation and Recovery Rules

- GET requests retry at most twice and only for network errors, 408, 429, and 5xx.
- Writes retry only with an idempotency key.
- Optimistic updates always define rollback and reconciliation behavior.
- Autosave, session expiry, sync failure, upload failure, and service updates preserve unsynchronized local data.
- Page error boundaries expose retry, local recovery, and request ID.
- OCR, email, presence, Queue, R2, and AI failures degrade independently.

### 8.3 Performance Budgets

- LCP p75 below 2.5 seconds.
- INP p75 below 200 milliseconds.
- CLS p75 below 0.1.
- API read p95 below 500 milliseconds.
- API write p95 below 800 milliseconds.
- No Vite chunk warning above 500 kB.
- No initial modulepreload for Markdown, OCR, or AI chunks.
- Interactive behavior with 10,000 notes and 5,000 database records.
- New-note entry visible without discovery and operational in one activation.
- Account center reachable in at most two activations.

## 9. Error Model and Observability

All new APIs use the existing response envelope and stable error payloads. Errors identify whether they are retryable and include a request ID. Client presentation distinguishes validation, authorization, conflict, quota, transient service, offline, and unknown failures.

Structured logs include request ID, workspace hash, route, status, latency, error code, queue attempt, and deployment version. Analytics collect Web Vitals, API latency, error rates, queue age, sync conflicts, AI usage/failures, registration completion, and quota rejection without collecting user content.

## 10. Testing Strategy

Implementation follows test-driven development. Each behavior is introduced by a failing test, followed by the minimal implementation and refactoring with the suite green.

Required coverage includes:

- Domain validation and permission unit tests.
- D1 repository and migration integration tests.
- Worker route contracts, rate limits, session revocation, field filtering, and AI provider failure mapping.
- Component tests for navigation, note creation, account center, editor actions, AI confirmations, and recovery states.
- Real-browser registration, login, profile update, note creation/autosave/reload, offline recovery, search, databases, sharing, collaboration, AI chat, and AI write confirmation.
- Accessibility, keyboard navigation, 390 px, mobile keyboard, and 200% zoom.
- Load tests for 10,000 notes and 5,000 records.
- Fault injection for D1, R2, Queue, email, OCR, presence, and AI outages.

Final gates are:

```text
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

## 11. Release and Authorization

Each phase receives a separate detailed implementation plan. It is implemented on `codex/public-beta-rewrite`, committed in reviewable slices, pushed to GitHub, and deployed to the independent Beta Preview only after its local gates pass. Preview validation includes authenticated real-browser checks and 390 px verification.

The existing production application and resources remain unchanged during implementation. Production secrets, production D1 migrations, production deployment, domain cutover, destructive cleanup, PR merge, and release tags require separate explicit authorization at the corresponding stage. Before any production cutover, the process must produce verified external backups and a tested rollback path.

## 12. Completion Criteria

The program is complete only when:

1. Note creation and account management are obvious and usable on desktop and mobile.
2. Every legacy capability in the parity matrix has visible, authorized, recoverable, mobile-tested behavior.
3. The additional command, task, onboarding, usage, and backup capabilities are usable end to end.
4. AI conversations, authorized retrieval, citations, and confirmation-gated write actions work without credential exposure or cross-workspace leakage.
5. Performance, reliability, security, accessibility, load, and browser gates pass.
6. Preview is verified, and any later production release has independently satisfied backup, migration, online verification, and rollback requirements.
