# Public Beta Preview, Backup, and Rollback Runbook

Task 12 is complete only when the following evidence is attached to the release record. The commands below are examples and are intentionally not executed by the repository checks.

## Preview

1. Create a separate Cloudflare D1, R2 bucket, Queue, Durable Object deployment, and Analytics Engine dataset for the preview name in `apps/worker/wrangler.preview.example.toml`.
2. Replace only the preview D1 placeholder and preview URL in a local, untracked Wrangler file. Keep all secrets in `wrangler secret put` or the Cloudflare dashboard; never put them in TOML, Git, or the web bundle.
3. Apply migrations to the preview database, deploy the preview Worker, and record the deployment version. Do not reuse the production D1 ID or R2 bucket.
4. Run `npm run verify:preview`, `npm run verify:deploy:online -- --url=<preview-url>`, `npm run test:e2e`, `npm run test:a11y`, and `npm run test:load` against the preview URL.

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
npx wrangler d1 migrations apply <PREVIEW_D1_NAME> --local --persist-to $restore
npx wrangler d1 execute <PREVIEW_D1_NAME> --local --persist-to $restore --file "$backup\preview-data.sql"
npx wrangler d1 execute <PREVIEW_D1_NAME> --local --persist-to $restore --command "SELECT COUNT(*) FROM workspaces"
```

Then rerun the migration/schema and tenant-isolation tests. For R2, first export an object manifest and copy objects to the external backup directory; verify object count, byte totals, and hashes before attempting a restore. Record the backup path, timestamp, D1 export hash, R2 manifest hash, and the restore test result. If the preview database is empty, an empty data export plus the migration version and hash is still the required evidence.

## Cutover Gate

Before any production write, migration, session rotation, secret change, or domain route change, obtain a separate explicit confirmation. The confirmation must name the backup, restore result, target deployment, target D1/R2 bindings, maintenance window, and rollback owner.

The production sequence is: freeze old writes, take and verify the final external backup, apply only additive migrations, deploy the selected Worker version, run online headers/health/API/browser checks, then change the route. Keep the previous Worker and database bindings available for at least 30 days.

## Rollback Evidence

Record the old Worker deployment ID, old bindings, route configuration, and the exact rollback command or dashboard version before cutover. If an online gate fails, stop new writes, restore the previous Worker version and route, preserve the failed preview data for diagnosis, and verify the old health endpoint plus a read/write smoke. Do not delete preview resources or backups until the retention period and a separate cleanup approval are complete.
