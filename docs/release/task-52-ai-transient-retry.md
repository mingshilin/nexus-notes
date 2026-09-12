# Task 52: AI Transient Provider Retry

## Failure

The OrcaRouter Preview flow passed multiple times but one release batch received
a transient provider failure. The immediately repeated chat and confirmation
both returned HTTP 200, proving the configuration and action path remained
valid.

## Fix

Retry the provider inference request once for:

- network failures before a Response,
- HTTP 429,
- HTTP 5xx.

Do not retry other 4xx responses or aborted requests. The retry occurs before
tool proposals are processed; database, reminder, notification, and email side
effects still run only after one final successful provider response and remain
protected by their existing confirmation and idempotency boundaries.

## Evidence

- The transient-503 test failed before implementation and passed after it.
- AI chat service: `14/14` passed.
- Provider, trusted chat, and tool execution: `15/15` passed.
- Full lint passed.
- Real Preview AI stability must be rechecked after deployment.
