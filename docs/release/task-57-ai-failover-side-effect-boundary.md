# Task 57: AI Failover Side-Effect Boundary

## Finding

Independent release review found that a provider could return valid automatic
tool calls together with an invalid oversized message. The previous flow could
persist and execute those tools, reject the response afterward, then fail over
to another provider with new action IDs.

## Fix

- Validate provider message length and the 20-call tool bound before proposing
  or executing any action.
- Track the first proposal-side-effect boundary inside `AiChatService`.
- Add `safeToFailover` to provider errors. Any error after proposal processing
  starts is marked unsafe, including timeout and unexpected execution errors.
- Provider selection falls back only when the error explicitly remains safe.

This keeps failover available for malformed providers before writes while
preventing replay after action persistence begins.

## Evidence

- Oversized message plus valid tool call did not invoke proposal or execution.
- Twenty-one action calls did not persist proposals.
- Personal and system invalid responses fell through to Workers AI with zero
  proposal rows.
- A provider-invalid error raised after proposal persistence had
  `safeToFailover=false`.
- AI chat/provider/trusted/tool suites: `4 files / 35 tests` passed.
- Full lint, production build, and production dependency audit passed.
