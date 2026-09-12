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
