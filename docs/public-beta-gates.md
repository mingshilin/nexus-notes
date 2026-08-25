# Public Beta Verification Gates

The automated gates are split by failure domain so a failed check identifies the affected layer:

```text
npm run lint
npm run test:unit
npm run test:integration
npm run test:worker
npm run test:fault
npm run beta:lint
npm run beta:test
npm run beta:build
npm run test:perf
npm run test:load
npm audit --omit=dev
npm run verify:deploy
npm run verify:preview
```

`test:browser-shell` uses a real Chrome or Edge process through the Node CDP client for the unauthenticated shell. The authenticated `test:e2e` and `test:a11y` gates fail closed without the external profile/avatar fixture, preserve the source session, and are safe to run sequentially. `test:e2e:cleanup-recovery` is a separate session-consuming gate and must run last. Run the public shell against a local preview in a second terminal:

```text
npm run beta:build
npm run preview --workspace @nexus/web -- --host 127.0.0.1 --port 4173
npm run test:browser-shell
npm run test:load
```

`test:load` sends bounded concurrent requests to the preview shell and checks a deterministic p95 budget. It is intentionally unauthenticated and does not write data. `test:fault` runs the real-D1 OCR consumer and outbox recovery cases, including retry, dead-letter, duplicate delivery, and partial batch failures.

Set `NEXUS_NOTES_BETA_URL` or pass `--url=...` for a preview URL. Set `NEXUS_NOTES_BETA_USER_DATA_DIR` only when a separately managed authenticated browser profile is required; the repository does not store browser state. Production browser flows remain a preview/cutover gate and are not silently run against the live site.
