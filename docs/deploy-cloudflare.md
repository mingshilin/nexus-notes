# Cloudflare Deployment Guide (Worker + D1 + Auth + Resend)

## 1) Create Cloudflare project

```bash
npm install
wrangler login
```

Set Worker name in `wrangler.toml` (`name = "modern-notes-saas"`).

## 2) Create D1 database

```bash
wrangler d1 create notes_db
```

Copy `database_id` and update `wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "notes_db"
database_id = "your-d1-database-id"
```

## 3) Run migrations

Local:

```bash
npm run db:migrate:local
```

Remote:

```bash
npm run db:migrate:remote
```

This applies both `0001_init.sql` and `0002_hardening_v2.sql`.

## 4) Configure `wrangler.toml`

Required sections:

- `main = "worker/index.ts"`
- `[assets] directory = "./dist", binding = "ASSETS"`
- `[[d1_databases]]` with binding `DB`
- `[vars]` for non-secret runtime config

Example:

```toml
[vars]
APP_NAME = "Modern Notes"
APP_BASE_URL = "https://your-domain.example"
EMAIL_FROM = "Modern Notes <noreply@your-domain.example>"
```

## 5) Set secrets (Resend)

```bash
wrangler secret put RESEND_API_KEY
```

If `RESEND_API_KEY` is not set, register/forgot-password still works, but verification/reset emails are not sent.

## 6) Local run

Frontend only:

```bash
npm run dev
```

Full Worker + D1:

```bash
npm run build
npm run worker:dev
```

## 7) Deploy

```bash
npm run build
npm run deploy
```

## 8) Bind D1 (after deployment changes)

Any `database_id` or binding change requires redeploy:

```bash
npm run deploy
```

## 9) Common issues

1. `D1_ERROR: no such table ...`
   Run migrations again (`db:migrate:local` / `db:migrate:remote`).

2. `UNAUTHORIZED` on API calls after login
   Check same origin and cookie behavior. API and frontend must be served from the same Worker origin in production.

3. `INVALID_CREDENTIALS` / `EMAIL_EXISTS`
   Validate account lifecycle inputs and expected auth flow.

4. Email not received
   Verify `RESEND_API_KEY`, `EMAIL_FROM`, and `APP_BASE_URL`.

5. Static app 404
   Ensure `dist/` exists and `[assets] directory` points to `./dist`.
