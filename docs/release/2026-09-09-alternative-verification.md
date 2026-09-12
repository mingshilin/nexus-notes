# Alternative Verification: 2026-09-09

## Scope

Source: `2a45542ef17b50c7a9018581b2103945860957a6`.
Checked at approximately 01:09 Asia/Shanghai. No deployment, migration,
credential change, browser-profile extraction, or production write occurred.

## Observed Results

- GitHub PR 14 CI run `34146400977`: SUCCESS for the source commit.
- `npm run verify:deploy:online`: exit 0; local and production readiness passed.
- Production health: `release-aedbc80`, status ok, OCR ready; HTML HTTP 200.
- Preview health: `preview-e6241cc`, status ok, OCR ready; HTML HTTP 200.
- Unauthenticated GET `/api/v2/notes` with a synthetic workspace header:
  HTTP 401 on both sites. No existing user or workspace identifiers were used.
- Both sites expose CSP, HSTS, nosniff, DENY, and strict-origin-when-cross-origin.
- Production readiness found no initial markdown-vendor, ocr-vendor, or
  ai-vendor preload; Preview HTML inspection found none either.
- Worker focused tests: 5 files / 49 tests, exit 0: ai-chat, ai-chat-tools,
  ai-provider-selection, security-gateway, route-registry.
- Web component tests: 5 files / 58 tests, exit 0: auth-panel, ai-chat-panel,
  ai-action-recovery, workspace-query-cache, mobile-zoom-editor-clearance.

## Limitations And Release Decision

PASS applies only to the checks above. Desktop/browser-extension control is
unavailable. No real browser smoke was run in this verification. Component
tests are not proof of visual layout, real keyboard behavior, or live latency.
Mock provider tests do not verify current external AI provider availability.
HTTP 401 probes are not a complete authenticated tenant/field permission audit.

Neither deployed environment matches the latest source commit. The live checks
therefore cannot accept the new cancellation fix as deployed. Authenticated
end-to-end acceptance, exposed provider credential rotation, encrypted backup
restoration evidence, and version-consistent Preview acceptance remain pending.
Production release remains gated; no claim of complete launch readiness.
