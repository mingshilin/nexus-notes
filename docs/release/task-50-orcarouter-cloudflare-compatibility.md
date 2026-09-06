# Task 50: OrcaRouter Cloudflare Compatibility

## Failure

Both verified OrcaRouter free models returned successful Chat Completions and
tool calls from a direct client, but the Preview Worker returned
`AI_PROVIDER_UNAVAILABLE` before receiving an upstream response.

## Root Cause

A minimal remote Cloudflare Worker probe showed:

- Default redirect handling to `https://api.orcarouter.ai/v1/models`: HTTP 200.
- `redirect: "error"` to the same endpoint: `TypeError` before a Response.

OrcaRouter is served through Tencent EdgeOne. The Cloudflare runtime/provider
combination does not support this fetch redirect mode even when no redirect is
returned.

## Fix

Use `redirect: "manual"` and continue rejecting every non-2xx response. This
preserves the security contract: the Worker never follows a provider redirect,
so the Authorization header cannot be forwarded to another destination.

Standalone authenticated browser scenarios also require mobile navigation to
remain visible for four consecutive 250 ms checks before navigation. A delayed
draft-focus effect can otherwise hide the bar between hit testing and click.

## Evidence

- Redirect behavior test failed against `"error"` and passed with `"manual"`.
- AI chat service: `13/13` passed.
- Provider, trusted chat, and tool execution: `15/15` passed.
- Release smoke startup/navigation stability: `21/21` passed.
- Full lint passed.
- Preview `preview-0ed66eb` returned HTTP 200 from
  `qwen/qwen3.8-27b-free`, produced a confirmation-gated `create_note`, and
  completed the confirmation endpoint successfully in two consecutive browser
  runs.
