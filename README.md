# Nexus Notes

Nexus Notes is a modern full-stack notes app built with React, TypeScript, Vite, and Cloudflare Workers. It includes notes, folders, tags, daily notes, workspace collaboration, public sharing, reminders, attachments, OCR, backlinks, and database-style views.

## Stack

- Frontend: React, TypeScript, Vite, Tailwind CSS
- Backend: Cloudflare Workers
- Storage: Cloudflare D1 and R2
- Tests: Vitest and Testing Library

## Project Structure

- `src/`: React frontend, state hooks, API client, and UI components
- `worker/`: Cloudflare Worker API routes, DB access, and backend utilities
- `migrations/`: D1 database migrations
- `tests/`: frontend and Worker test suites
- `scripts/`: deployment readiness and browser smoke helpers
- `docs/`: deployment and release notes
- `public/`: static assets and service worker

## Local Development

```bash
npm install
npm run dev
```

For Worker development:

```bash
npm run worker:dev
```

## Environment

Create a local env file from the example:

```bash
cp .env.example .env.local
```

Set `VITE_TURNSTILE_SITE_KEY` when Turnstile is enabled. Worker secrets and Cloudflare bindings should be configured through Wrangler or the Cloudflare dashboard, not committed to Git.

## Verification

```bash
npm run lint
npx vitest run --config vite.config.ts
npx vitest run --config vitest.worker.config.ts
npm run build
npm run verify:deploy
```

## Deploy

Update `wrangler.toml` for your own Cloudflare account, D1 database, R2 bucket, and domain, then run:

```bash
npm run deploy
```

## License

MIT
