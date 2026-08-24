# Security Policy

## Supported Versions

Security fixes are currently applied to the `codex/public-beta-rewrite` release line and the active Preview deployment. The legacy root application is retained for compatibility and is not the recommended deployment target for new installations.

## Reporting a Vulnerability

Please use GitHub's private vulnerability reporting for this repository when available. Do not open a public issue for an unpatched vulnerability.

Include:

- affected commit, route or package;
- reproducible steps and impact;
- whether the issue can cross workspace, database, field or attachment boundaries;
- logs or screenshots with all credentials, tokens, cookies, note content and personal data removed.

Do not submit passwords, reset tokens, session cookies, API keys, D1 exports or R2 manifests in an issue or pull request.

## Secret Handling

Production secrets are managed by Wrangler or Cloudflare. The repository must never contain `TURNSTILE_SECRET_KEY`, `RESEND_API_KEY`, `RATE_LIMIT_SECRET`, AI provider keys, session material or private browser state. If a secret is exposed, revoke and rotate it before investigating the code change.
