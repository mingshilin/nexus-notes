# Restore Verification: 2026-09-12

## Verified Scope

Source/PR head: `2a45542ef17b50c7a9018581b2103945860957a6`.
PR 14 remains Draft; CI run `34146400977` is successful for that head.
No deployment, remote migration, production write, or backup modification was
performed during this verification.

The production backup from `20260906-194244` was restored into an isolated,
in-memory Python SQLite database after applying the 27 checked-in migrations.
The existing membership epoch INSERT OR REPLACE preparation was applied in
memory. No user records or credential values were printed.

- Initial non-transactional import failed a foreign-key constraint.
- Wrapping the import in one transaction with deferred foreign-key checks
  succeeded; integrity_check returned ok, foreign_key_check returned zero rows.
- Restored counts: 9 users, 44 notes.
- SQL SHA-256 matched the recorded backup:
  `d996635706d7138310a0d462f8987e3f48883b4465c4fd88bff32754c652e695`.
- The 2 R2 manifest entries matched their byte lengths and SHA-256 values:
  601,990 bytes total. Resolve their relative file names under `r2-referenced`,
  not directly under the backup directory. Initial lookup in the latter failed;
  inspection confirmed both files exist in the subdirectory.
- `npm run verify:deploy:online` exited 0.

## Not Accepted Yet

This is SQLite restore evidence, not a Cloudflare D1 restore drill. Do not use
the local BEGIN/COMMIT wrapper as an unverified D1 remote command. It does not
prove backup encryption, freshness since September 6, complete R2 bucket
coverage, or recoverability of externally encrypted credentials.

The in-app browser bootstrap still reports an unavailable trusted native bridge;
no authenticated real-browser acceptance was completed. No authentication was
bypassed and no browser session stores were read. Latest-source Preview
deployment, authenticated UI/AI acceptance, provider credential rotation,
encrypted backup restoration, and release identity remain open release gates.

## Local Encryption Follow-up

At 15:44 Asia/Shanghai, five files from the existing September 6 production
backup (SQL, manifests and referenced R2 objects) were copied into encrypted
files under the repository-external directory
`D:\mingSL\Documents\nexus-notes-release-evidence\backups\encrypted-local-20260912-154436`.
Windows DPAPI CurrentUser protection was used. Every encrypted file was read
back and decrypted in memory; all SHA-256 comparisons matched its source.
Original files were not changed or deleted. No backup contents were logged.

This proves local encryption round-trip only. Recovery depends on the Windows
user's DPAPI material; it is not a portable off-machine disaster-recovery copy,
does not refresh the September 6 snapshot, and does not prove D1 restoration.

A separate Miniflare local D1 restore was started using all 27 migrations and
one batch of the parsed backup statements. As of 15:45 its Node/workerd process
was still live with no result. Treat the D1 gate as pending, not passed. No
remote database was targeted.

## D1 Runtime Diagnosis

The initial uninstrumented restore was explicitly stopped with Ctrl+C after
remaining live without output. A subsequent staged probe parsed the backup
successfully (104,208 bytes of JSON-encoded SQL) but stalled at
`Miniflare.getD1Database`, before any migrations or restore batch ran.
The workerd loopback HTTP listener returned 200 for its empty test handler.
The Node-side 60-second timer also did not report completion; the probe was
explicitly stopped rather than reported as passed or left indefinitely running.

This narrows the observed problem to local D1 binding initialization, not the
backup contents. It does not prove the root cause or successful D1 restoration.
No remote DB, browser state, or application records were modified. Production
dependency audit was rerun during diagnosis and reported zero vulnerabilities.

## Completed Local D1 Restore

At 15:54 the same snapshot was successfully restored using the repository's
Vitest/Miniflare environment rather than a standalone Node TypeScript command.
All 27 migrations and a batch of 227 prepared backup statements completed.
`PRAGMA foreign_key_check` returned zero violations; 9 users and 44 notes
matched the earlier SQLite restoration. D1 denies `PRAGMA integrity_check`
with SQLITE_AUTH, so physical integrity remains the separately recorded
SQLite result, not a claimed D1 query result.

Reproduce from `apps/worker` with `npx vitest run --config vitest.restore.config.ts`
and `NEXUS_RESTORE_STATEMENTS_FILE` pointing to the explicitly prepared external
JSON statement array. The file is required, cannot live under the repository,
and is intentionally not supplied to public CI. The dedicated acceptance test
is not included in the ordinary test glob. Failed imports omit private SQL.

Prepared JSON SHA-256:
`9cfeec3ee45e5096a539e39c01ea8382bda02fe1fbb083af27c17e019ca304eb`.
The statements file is outside Git and derived from the existing plain backup;
it is not itself encrypted. This validates local D1 compatibility, not a remote
restore, updated production snapshot, portable recovery, or external secrets.
