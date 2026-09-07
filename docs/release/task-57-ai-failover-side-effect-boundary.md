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

## Recovery Verification (2026-09-08)

CI run `34040894322` failed because the proposal-storage failure test still
expected `AI_PROVIDER_UNAVAILABLE`. The failure was reproduced locally before
updating the test. Once proposal handling starts, an unknown storage outcome
must instead report `AI_ACTION_EXECUTION_FAILED` with `safeToFailover=false`.
The correction asserts that boundary without weakening runtime protections.

Fresh local checks on `e6241cc` plus this test correction:

| Check | Result |
| --- | --- |
| Legacy frontend / Worker | 163 / 63 tests passed |
| Beta Web | 102 files, 761 tests passed |
| Beta Worker | 97 files, 622 tests passed |
| Contracts / Domain / UI | 62 / 31 / 2 tests passed |
| Lint and workspace typechecks | Passed |
| Build | Passed; entry 382.43 kB; no >500 kB warning |
| Production dependency audit | 0 vulnerabilities |
| Local and online deploy readiness | Passed |
| Preview configuration readiness | Passed; not live authenticated acceptance |
| Initial preload | No markdown-vendor, ocr-vendor, or ai-vendor |

Read-only health checks confirmed Preview `preview-e6241cc` and production
`release-aedbc80`. No deployment, migration, credential rotation, or production
write was performed in this recovery. Authenticated browser acceptance was not
rerun. Independent security review and a fresh remote CI result remain release
gates; this local verification is not a release approval.

The existing `v1.1.0` release must not be overwritten. Release naming, exposed
provider credential rotation, and encrypted backup restoration evidence remain
separate unresolved release work.
