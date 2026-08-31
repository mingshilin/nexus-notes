# Task 30: Account Center Data Lifecycle Report

## Outcome

Extracted profile and login-session query orchestration from `AccountCenter`
into `useAccountCenterData`. Existing tabs, child panels, ProfileClient API
methods, callback ordering, and visual markup remain compatible.

## Reliability Guarantees

- Profile and session caches are keyed by ProfileClient identity and explicit
  `userId:workspaceId` scope with a five-minute TTL.
- Fresh cache entries hydrate during render without mutating the cache
  registry. StrictMode replays and simultaneous consumers share one request.
- Request leases abort only after the last consumer leaves; a later remount can
  start a clean replacement request.
- Expired cache entries stay visible during background refresh. Success updates
  the cache; failure preserves stale data and exposes the existing retry error.
- Client/scope changes immediately hide old profile/session data, reset
  Profile/Security local form state, and reject old query, setter,
  retry/invalidate, and revoke-all-session callbacks.
- Profile/session writes invalidate the affected resource generation so an
  older shared response cannot overwrite committed values.
- Session updates accept functional state updates, preserving sequential and
  concurrent changes without stale-array replacement.
- Compatibility callers that omit `cacheScope` derive it from existing
  `currentUserId` and `activeWorkspaceId` props.

## Verification Evidence

| Check | Result |
| --- | --- |
| Account center + hook | `51/51` passed |
| Account depth UI | `2/2` passed |
| Full Beta Web | `89 files / 623 tests` passed |
| Worker regression | `97 files / 615 tests` passed |
| Full lint | passed |
| Full build | passed; initial entry `349.75 kB`, AccountCenter lazy chunk `55.64 kB`, no Vite `>500 kB` warning |
| Production dependency audit | `0 vulnerabilities` |
| Deploy readiness | passed; initial preload excludes `markdown-vendor`, `ocr-vendor`, and `ai-vendor` |
| Independent review | `PASS`; no Critical, Important, or Minor findings remain |

Authenticated browser validation remains
`BLOCKED AUTHENTICATED_PROFILE_UNSET` until a repository-external Chrome
profile is supplied. No deployment, remote migration, secret change, GitHub
push/merge, or tag action was performed.

## Files

- `apps/web/src/account/use-account-center-data.ts`
- `apps/web/src/account/AccountCenter.tsx`
- `apps/web/src/account/ProfilePanel.tsx`
- `apps/web/src/account/SecurityPanel.tsx`
- `apps/web/src/account/index.ts`
- `apps/web/src/app/domains/AccountAndAIDomain.tsx`
- `apps/web/tests/use-account-center-data.test.tsx`
- `apps/web/tests/account-center.test.tsx`
