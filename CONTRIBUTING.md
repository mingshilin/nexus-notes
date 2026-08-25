# Contributing

## Before Opening a Change

1. Read the relevant design and release notes under `docs/`.
2. Keep the existing visual language and public API compatibility unless the change explicitly updates a contract.
3. Add or update a focused test before changing behavior.
4. Keep tenant, database, field and attachment authorization on the Worker side.
5. Do not include secrets, sessions, browser profiles, generated `output/`, D1 exports or R2 manifests.

## Local Checks

Run the narrowest relevant test first, then the release gates:

```bash
npm run lint
npm run test:unit
npm run test:integration
npm run test:fault
npm run beta:test
npm run build
npm audit --omit=dev
npm run verify:deploy
npm run verify:preview
```

Real authenticated browser profiles must live outside the repository. Production deployment, remote migrations, secret rotation, domain routing, GitHub merge and release tags require explicit operator authorization.

## Pull Requests

Describe the behavior change, affected API or migration, test commands, data-recovery impact, and any remaining external configuration. Keep commits focused and do not use `git add .` when generated or local files are present.
