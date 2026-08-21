# Nexus Notes Public Beta Rewrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` or `executing-plans` to implement this plan task-by-task. Track progress with the checkboxes below.

**Goal:** Rebuild Nexus Notes as a Cloudflare-native public Beta while preserving its established visual language and keeping the current production site available until cutover gates pass.

**Architecture:** New code lives in npm workspaces under `apps/*` and `packages/*`. The frontend uses an adaptive workbench, a resilient local-first data layer, and `/api/v2`; the Worker uses typed routes, strict workspace context, D1/R2/Queues/Durable Objects, and independently testable domain services.

**Tech Stack:** React 19, Vite, TypeScript, Zod, Cloudflare Workers, D1, R2, Queues, Durable Objects, Analytics Engine, Vitest, Testing Library, and Playwright.

## Global Constraints

- Work only in `D:\mingSL\Documents\nexus-notes-public-beta-rewrite` on `codex/public-beta-rewrite`.
- Treat `D:\mingSL\Documents\nexus-notes-release-1.1.0` as read-only reference material.
- Preserve the current colors, glass surfaces, typography, spacing, radii, icons, and Chinese product tone.
- Keep the current production deployment live until preview acceptance passes.
- Do not perform production writes, secret changes, remote migrations, data reset, deployment, domain switching, GitHub merge, or tag creation without separate authorization.
- Use test-first development for behavior changes and independently reviewable commits.

---

- [x] Task 1: Create the isolated workspace, npm workspaces, shared configuration, CI, and preview configuration.
- [x] Task 2: Add shared `/api/v2` contracts, typed route registry, response envelope, and Beta D1 schema.
- [x] Task 3: Build the preserved design system and adaptive workbench shell.
- [x] Task 4: Add the API transport, normalized cache, IndexedDB persistence, mutation queue, and sync engine.
- [x] Task 5: Add authentication, tenant isolation, security controls, and configurable Beta quotas.
- [ ] Task 6: Deliver Capture, notes, revisions, search, graph, reminders, attachments, and diagnostics.
  - [x] Task 6A: Add tenant-scoped note CRUD, keyset pagination, quick capture, optimistic revisions, restore, and 800 ms autosave conflict preservation.
  - [ ] Task 6B: Add folders, tags, links, reminders, graph, FTS search documents, and saved-search filters.
    - [x] Task 6B.1: Add atomic note search indexing, FTS5 synchronization, complete search filters, hit sources, and owner-scoped saved searches.
    - [ ] Task 6B.2: Add folder/tag assignment, note links, reminders, and global/local graph APIs.
  - [ ] Task 6C: Add private attachments, OCR retry flows, and knowledge diagnostics.
- [ ] Task 7: Deliver structured databases, typed properties, views, bulk operations, CSV, and virtualized views.
- [ ] Task 8: Deliver workspace collaboration, sharing, notifications, audit, and Durable Object presence.
- [ ] Task 9: Deliver R2 files, queued OCR/index/import/export/email jobs, status, feedback, and administration.
- [ ] Task 10: Add structured observability, partial failure handling, and recovery workflows.
- [ ] Task 11: Close unit, integration, contract, browser, accessibility, performance, load, security, and fault gates.
- [ ] Task 12: Prepare preview readiness, backup/restore evidence, cutover checklist, and rollback evidence; stop before production actions.
