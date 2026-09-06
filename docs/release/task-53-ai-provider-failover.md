# Task 53: AI Provider Failover

## Problem

The selected personal provider previously fell back only when its configuration
was missing, not when it failed at runtime. An external system provider also had
no fallback to the existing Workers AI binding. A free or rate-limited provider
could therefore make AI unavailable despite a healthy system model.

## Solution

- Retry provider inference once for network errors, HTTP 429, and HTTP 5xx.
- Fall back from a failed personal provider to the configured system provider.
- Fall back from a failed external system provider to Workers AI.
- Pin the Workers AI fallback to
  `@cf/meta/llama-3.3-70b-instruct-fp8-fast`; never reuse an external model ID
  with the Cloudflare binding.
- Fall back only for provider/configuration failures before tool execution.
  Permission, read-tool, confirmation, and action execution errors remain
  visible and are never replayed through another model.

## Evidence

- Provider selection/failover integration: `6/6` passed.
- AI chat, trusted chat, and tool execution: `25/25` passed.
- Full lint and production build passed.
- Entry chunk remains `382.43 kB` with no chunk-budget warning.
- Real Preview stability must be rerun after deployment.
