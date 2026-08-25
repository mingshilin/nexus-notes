# Changelog

## Unreleased / Public Beta

- Added the isolated npm-workspaces Beta application under `apps/` and `packages/`.
- Added tenant-scoped `/api/v2` contracts, D1 repositories, permission filtering, revision checks and sync recovery.
- Added account overview, preferences, session controls, data privacy flows and secure avatar handling.
- Added reminder recurrence, snooze, delivery outbox, Web Push plumbing and failure recovery.
- Added encrypted per-user OpenAI-compatible AI configuration without returning plaintext keys.
- Added database management panels, typed values, CSV preview/transactional import and stable pagination.
- Added real Chrome/CDP shell and authenticated acceptance smoke coverage, 390px/200% zoom checks and release readiness gates.
- Added Preview backup/restore evidence, security headers, lazy-chunk checks and deployment handoff documentation.
- Fixed account deletion so immutable workspace audit records are preserved by archiving the affected personal workspace instead of failing the deletion flow.

## Release Notes

Production cutover, secret rotation, domain switching, GitHub merge and release tagging remain separate operator-authorized actions. See [docs/preview-acceptance-handoff.md](docs/preview-acceptance-handoff.md).
