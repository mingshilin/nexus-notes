# Nexus Notes

Nexus Notes is an open-source, full-stack knowledge workspace for notes, daily logs, folders, tags, backlinks, reminders, attachments, OCR, collaboration, public sharing, and structured databases.

The repository contains the current Beta implementation and the earlier compatible application surface. The Beta implementation is the isolated workspace under `apps/` and `packages/`; the legacy root remains available for compatibility and migration reference.

## Stack

- Web: React 19, TypeScript, Vite, Zustand, Tailwind-compatible CSS
- Worker: Cloudflare Workers, typed route registry, D1, R2, Queues, Durable Objects
- Contracts and domain: Zod schemas and pure TypeScript validation rules
- Tests: Vitest, Testing Library, real Chrome/CDP smoke, accessibility and load gates

## Repository Layout

- `apps/web/`: Beta web application and service worker
- `apps/worker/`: Beta Worker routes, repositories, queues and migrations
- `packages/contracts/`: API contracts and sync schemas
- `packages/domain/`: tenant, permission, recurrence and typed-value rules
- `packages/ui/`: shared visual primitives and tokens
- `packages/testkit/`: test helpers
- `tests/`: legacy compatibility tests
- `scripts/`: build, deployment readiness, load and browser smoke tools
- `docs/`: architecture, security, deployment and acceptance handoff
- `src/`, `worker/`, `migrations/`: legacy-compatible application surface

## Local Development

```bash
npm ci
npm run dev
```

To typecheck and test the Beta workspaces:

```bash
npm run beta:lint
npm run beta:test
npm run beta:build
```

Worker development requires a local Wrangler configuration and local D1/R2 state. Never copy Preview or production secrets into the repository.

## Configuration

Copy `.env.example` to a local, ignored env file when the web app needs a Turnstile site key. Configure Worker secrets with Wrangler or the Cloudflare dashboard:

- `TURNSTILE_SECRET_KEY`
- `RESEND_API_KEY`
- `RATE_LIMIT_SECRET`
- `USER_SECRETS_ENCRYPTION_KEY`
- `WEB_PUSH_VAPID_PUBLIC_KEY`
- `WEB_PUSH_VAPID_PRIVATE_KEY`
- `WEB_PUSH_SUBJECT`

AI provider keys must remain Worker Secrets or user-encrypted configuration. They must never be placed in `wrangler.toml`, `.env.example`, IndexedDB, logs, or the frontend bundle.

## Verification

The standard local gates are:

```bash
npm run lint
npm run test:unit
npm run test:integration
npm run test:worker
npm run test:fault
npm run beta:test
npm run build
npm audit --omit=dev
npm run verify:deploy
npm run verify:preview
```

For a Preview or local browser gate, use a Chrome profile outside this repository. See [docs/preview-acceptance-handoff.md](docs/preview-acceptance-handoff.md). Do not put cookies, reset tokens, passwords, browser profiles, D1 exports, R2 manifests or provider keys in Git.

## Preview

The production deployment is [Nexus Notes](https://notes.msl88ljctengxun.xyz/). The independent [Public Beta Preview](https://nexus-notes-public-beta-preview.shilinming9.workers.dev/) remains available for acceptance testing. See [docs/production-cutover-2026-08-26.md](docs/production-cutover-2026-08-26.md) and [docs/public-beta-cutover-runbook.md](docs/public-beta-cutover-runbook.md).

External calendar import is read-only and opt-in. Configure `CALENDAR_OAUTH_REDIRECT_URI` as a non-secret Worker variable and store `GOOGLE_CALENDAR_CLIENT_ID`, `GOOGLE_CALENDAR_CLIENT_SECRET`, `OUTLOOK_CALENDAR_CLIENT_ID`, and `OUTLOOK_CALENDAR_CLIENT_SECRET` with Wrangler Secrets. If a provider is not configured, the UI reports that state and does not start OAuth.

## Security and Contributions

- Report vulnerabilities through the process in [SECURITY.md](SECURITY.md).
- Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a change.
- Review [CHANGELOG.md](CHANGELOG.md) for release notes.

## License

MIT. See [LICENSE](LICENSE).
