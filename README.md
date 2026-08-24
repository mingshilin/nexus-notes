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

The current acceptance deployment is [Nexus Notes Public Beta Preview](https://nexus-notes-public-beta-preview.shilinming9.workers.dev/). It uses independent Preview bindings and does not replace the production domain. Preview deployment and production cutover are separate operator-authorized actions; see [docs/public-beta-cutover-runbook.md](docs/public-beta-cutover-runbook.md).

## Security and Contributions

- Report vulnerabilities through the process in [SECURITY.md](SECURITY.md).
- Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a change.
- Review [CHANGELOG.md](CHANGELOG.md) for release notes.

## License

MIT. See [LICENSE](LICENSE).
