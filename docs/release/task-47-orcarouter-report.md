# Task 47: OrcaRouter Provider Presets Report

## Outcome

Added an OrcaRouter provider preset using `https://api.orcarouter.ai/v1`, with
one-click model choices for `deepseek/deepseek-v4-flash-free` and
`qwen/qwen3.8-27b-free`. Existing custom model entry and encrypted personal
configuration behavior remain available.

Direct provider checks confirmed both model IDs accept Chat Completions and
produce a valid `create_note` tool call. `orcarouter/auto` was not selected as
the Nexus Notes system default because the current provider account returned a
payment-required response, while both named free models returned successful
responses.

## Verification Evidence

| Check | Result |
| --- | --- |
| Red test before implementation | failed because OrcaRouter did not populate the URL |
| AI provider component | `3/3` passed |
| AI Web flows | `38/38` passed |
| Worker provider/trusted/tool execution | `15/15` passed |
| Full Beta Web | `101 files / 759 tests` passed |
| Web typecheck | passed |
| Production build | passed; entry chunk `382.38 kB` |
| Provider Chat Completions | both free model IDs responded successfully |
| Provider tool calling | both free model IDs returned valid `create_note` calls |

## Security

The provider key is not present in source, docs, test fixtures, frontend state,
or build configuration. Runtime setup uses an environment variable for Codex
and a Cloudflare Worker Secret for Nexus Notes.
