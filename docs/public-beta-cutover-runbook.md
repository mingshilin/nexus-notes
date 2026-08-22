# Public Beta Preview, Backup, and Rollback Runbook

Task 12 is complete only when the following evidence is attached to the release record. The commands below are examples and are intentionally not executed by the repository checks.

## Preview

1. Create a separate Cloudflare D1, R2 bucket, Queue, Durable Object deployment, and Analytics Engine dataset for the preview name in `apps/worker/wrangler.preview.example.toml`.
2. Replace only the preview D1 placeholder and preview URL in a local, untracked Wrangler file. Keep all secrets in `wrangler secret put` or the Cloudflare dashboard; never put them in TOML, Git, or the web bundle.
3. Apply migrations to the preview database, deploy the preview Worker, and record the deployment version. Do not reuse the production D1 ID or R2 bucket.
4. Run `npm run verify:preview`, `npm run verify:deploy:online -- --url=<preview-url>`, the authenticated `npm run test:e2e` and `npm run test:a11y` gates, and `npm run test:load` against the preview URL. Run `npm run test:e2e:cleanup-recovery` last because it consumes the authenticated session.

## Task 12 Browser Evidence

Run the authenticated browser checks only against the independently authorized Beta Preview or a local `apps/web` preview. The browser profile and avatar fixture must be created and maintained outside this repository:

```powershell
$env:NEXUS_NOTES_BETA_URL = "<preview-url>"
$env:NEXUS_NOTES_BETA_USER_DATA_DIR = "C:\external\nexus-beta-auth-profile"
$env:NEXUS_NOTES_BETA_AVATAR_FILE = "C:\external\fixtures\avatar.png"
$env:NEXUS_NOTES_BETA_REQUIRE_AUTH = "1"
npm run test:e2e
npm run test:a11y
npm run test:e2e:cleanup-recovery
```

The standard `test:e2e` and `test:a11y` commands both use the same external source profile and never call logout, account deletion, session revocation, or local-store cleanup. Run them sequentially before the explicit cleanup-recovery command. The package scripts pass authenticated mode flags and reject an appended `--public-shell`; the cleanup command is a separate authenticated mode and must be run last. The script never accepts a repository-local profile or fixture. It does not write cookies, passwords, verification codes, browser profiles, screenshots, or credentials. Without both external variables every authenticated command emits JSON `status=SKIP` with a machine-readable reason and exits `2`; this is blocked evidence, not a passed authenticated gate. An authenticated run must record the following evidence from the script output:

1. At 390 px and 200% device scale, “新建笔记” and “账户” are visible and do not cover the editor; mobile keyboard evidence records `visualViewport.height < window.innerHeight`, a nonzero product `--keyboard-inset`, editor focus, and the editor within the reduced visual viewport.
2. A new note survives a deliberately failed save and full reload through real IndexedDB recovery. The run records a live idempotency-key crash/replay with the same key observed on both attempts.
3. The avatar upload uses the browser-selected raw `File` at the authenticated avatar endpoint. The request has an image content type and contains no base64/data-URI substitute; the avatar response is `private` or `no-store`.
4. The last cleanup-recovery command opens a second real app tab holding the `nexus-notes-beta` connection, drives the product logout cleanup path to blocked recovery, releases the second tab connection, and retries cleanup. It does not delete the remote account. Standard gates record account Escape focus restoration, account tab keyboard focus, and inspector open/background inert/Tab/Shift+Tab/Escape/opener behavior.
5. Profile update survives a reload; the full Preview pass also checks that password change preserves the current session and revokes other sessions.
6. The full Preview pass checks that email change is atomic and one-time, account deletion clears the session and local data, and initial HTML does not preload Markdown, OCR, or AI chunks.

The public unauthenticated shell may be run locally with `npm run test:browser-shell -- --url=http://127.0.0.1:<port>` and is separate from the authenticated release decision. A Preview deployment remains a separate authorization checkpoint. Do not add a production deploy command, perform a remote migration, configure production secrets, switch domains, push, merge, or tag as part of Task 12.

## Local Verification Matrix

Record the exact command and exit status for each command. The workspace matrix covers Web, Worker, contracts, domain, UI, and their typechecks/builds; the root matrix covers the legacy shell/API compatibility gates.

```powershell
npm run lint
npm run test:unit
npm run test:integration
npm run test:worker
npm run beta:lint
npm run beta:test
npm run beta:build
npm run test:browser-shell -- --url=http://127.0.0.1:<local-preview-port>
npm run test:e2e
npm run test:a11y
npm run test:perf
npm run build
npm audit --omit=dev
npm run verify:deploy
npm run test:e2e:cleanup-recovery
```

The readiness output must show no initial `markdown-vendor`, `ocr-vendor`, or `ai-vendor` preload and no JavaScript chunk over the exact decimal Vite warning budget of `500,000 bytes`. `npm run verify:deploy` is local/read-only; `verify:deploy:online`, Preview deployment, Preview migration, and authenticated browser execution against Preview are separate operator-authorized checkpoints.

## Backup and Restore Drill

Backups must be outside the repository and encrypted by the operator. This schema contains an FTS5 virtual table, so a bare `wrangler d1 export` is not a valid backup command: Wrangler rejects databases containing virtual tables. Export the ordinary application-table data only, and recreate the schema from the checked-in migrations during restore. Exclude FTS5 shadow tables, Cloudflare's `_cf_KV`/`d1_migrations` tables, and migration-seeded singleton rows such as `collaboration_operation_guard`.

A Windows example is:

```text
$stamp = Get-Date -Format yyyyMMdd-HHmmss
$backup = Join-Path (Split-Path $PWD -Parent) "nexus-notes-beta-backups\$stamp"
New-Item -ItemType Directory -Force $backup
$catalog = npx wrangler d1 execute <PREVIEW_D1_NAME> --remote --command "SELECT name, type FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name" --json | ConvertFrom-Json
$tables = @($catalog[0].results | Where-Object {
  $_.type -eq 'table' -and
  $_.name -notmatch '^search_documents_fts' -and
  $_.name -notin @('_cf_KV', 'd1_migrations', 'collaboration_operation_guard')
} | Select-Object -ExpandProperty name)
$wranglerArgs = @('wrangler', 'd1', 'export', '<PREVIEW_D1_NAME>', '--remote', '--output', "$backup\preview-data.sql", '--no-schema', '--skip-confirmation')
foreach ($table in $tables) { $wranglerArgs += @('--table', $table) }
& npx @wranglerArgs
Get-FileHash "$backup\preview-data.sql" -Algorithm SHA256
```

Restore the data SQL only into a disposable local or preview D1, never production. Use a fresh persistence directory so a previous local test database cannot contaminate the result:

```text
$restore = Join-Path (Split-Path $PWD -Parent) "nexus-notes-restore-runtime\$stamp"
New-Item -ItemType Directory -Force $restore
node scripts/prepare-beta-restore.mjs "$backup\preview-data.sql" "$backup\preview-data.restore.sql"
npx wrangler d1 migrations apply <PREVIEW_D1_NAME> --local --persist-to $restore
npx wrangler d1 execute <PREVIEW_D1_NAME> --local --persist-to $restore --file "$backup\preview-data.restore.sql"
npx wrangler d1 execute <PREVIEW_D1_NAME> --local --persist-to $restore --command "SELECT COUNT(*) FROM workspaces"
```

The restore copy changes only `workspace_membership_epochs` inserts to `INSERT OR REPLACE`. The membership trigger creates temporary epoch rows while `workspace_members` is imported; replacing those rows afterward preserves the exact exported security epoch instead of failing on a duplicate key or incrementing it. Keep `preview-data.sql` unchanged as the source backup.

Then rerun the migration/schema and tenant-isolation tests. For R2, first export an object manifest and copy objects to the external backup directory; verify object count, byte totals, and hashes before attempting a restore. Record the backup path, timestamp, D1 export hash, R2 manifest hash, and the restore test result. If the preview database is empty, an empty data export plus the migration version and hash is still the required evidence.

## Cutover Gate

Before any production write, migration, session rotation, secret change, or domain route change, obtain a separate explicit confirmation. The confirmation must name the backup, restore result, target deployment, target D1/R2 bindings, maintenance window, and rollback owner.

The production sequence is: freeze old writes, take and verify the final external backup, apply only additive migrations, deploy the selected Worker version, run online headers/health/API/browser checks, then change the route. Keep the previous Worker and database bindings available for at least 30 days.

## Rollback Evidence

Record the old Worker deployment ID, old bindings, route configuration, and the exact rollback command or dashboard version before cutover. If an online gate fails, stop new writes, restore the previous Worker version and route, preserve the failed preview data for diagnosis, and verify the old health endpoint plus a read/write smoke. Do not delete preview resources or backups until the retention period and a separate cleanup approval are complete.
