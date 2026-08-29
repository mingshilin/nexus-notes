# Task 20: Browser Gate Evidence

## Gate Contract

Authenticated browser checks must use a Chrome or Edge profile stored outside the repository. The gate never falls back to a repository profile, session file, cookie export, or generated fixture.

When the profile is unavailable, the command emits one machine-readable line and exits non-zero:

```json
{"status":"BLOCKED","reason":"AUTHENTICATED_PROFILE_UNSET","requiredEnv":["NEXUS_NOTES_BETA_USER_DATA_DIR"],"profile":"external"}
```

If the profile exists but the raw avatar fixture is missing, the reason is `AVATAR_FIXTURE_UNSET`. An invalid external path is reported as `AUTHENTICATED_PROFILE_INVALID` or `AUTHENTICATED_FIXTURE_INVALID`.

The unauthenticated 390px shell remains independently runnable:

```powershell
npm run beta:build
npm run preview --workspace @nexus/web -- --host 127.0.0.1 --port 4173
npm run test:browser-shell -- --url=http://127.0.0.1:4173/
```

## Authenticated Commands

Configure only external paths in the operator environment, then run the standard gate commands sequentially:

```powershell
$env:NEXUS_NOTES_BETA_URL = "<preview-url>"
$env:NEXUS_NOTES_BETA_USER_DATA_DIR = "C:\external\nexus-beta-auth-profile"
$env:NEXUS_NOTES_BETA_AVATAR_FILE = "C:\external\fixtures\avatar.png"
npm run test:e2e
npm run test:a11y
npm run test:e2e:ai
npm run test:e2e:navigation
```

The authenticated scenarios cover note draft recovery, profile and avatar flows, 390px/200% geometry, keyboard focus, inspector containment, AI action availability, and navigation shell budgets. Do not record credentials, tokens, cookies, profile contents, or attachment bytes in Git.

## Current Local Evidence

- Public shell: PASS at 390px; no horizontal overflow, unnamed visible controls, or browser runtime diagnostics.
- Authenticated profile-dependent gates: BLOCKED until `NEXUS_NOTES_BETA_USER_DATA_DIR` and the external avatar fixture are supplied.
- A blocked authenticated gate is not equivalent to a passed release gate.

## Fresh Verification Evidence

Recorded on 2026-08-29 from `codex/nexus-notes-optimization`:

- `npx vitest run --config vite.config.ts tests/frontend/release-smoke.test.ts`: PASS, `14/14`.
- `npm run lint`: PASS, legacy and all workspace typechecks completed successfully.
- `npm run test:unit`: PASS, `35` files and `156` tests.
- `npm run test:integration`: PASS, `11` files and `63` tests.
- `npm run test:worker`: PASS, `97` files and `615` tests.
- `npm run beta:test`: PASS, Web `80` files/`556` tests, Worker `97` files/`615` tests, Contracts `62` tests, Domain `31` tests, UI `2` tests; testkit has no test files.
- `npm run build`: PASS; the main web chunk is `339.17 kB`, with no Vite `>500 kB` warning.
- `npm audit --omit=dev`: PASS, `0 vulnerabilities`.
- `npm run verify:deploy`: PASS; initial `markdown-vendor`, `ocr-vendor`, and `ai-vendor` preloads are absent.
- `npm run test:browser-shell -- --url=http://127.0.0.1:4173/`: PASS; viewport `390`, `scrollWidth=390`, unnamed controls `0`, console errors `0`, exceptions `0`.
- `npm run test:e2e`, `npm run test:a11y`, `npm run test:e2e:ai`, and `npm run test:e2e:navigation`: BLOCKED with `AUTHENTICATED_PROFILE_UNSET`, each requiring `NEXUS_NOTES_BETA_USER_DATA_DIR`; none used repository state.
