# Task 36: Attachment Upload Lifecycle Report

## Outcome

Moved the authenticated attachment upload lifecycle from `AuthenticatedWorkspace`
into `useAttachmentUpload` without changing the existing API routes or editor
behavior.

## Reliability Guarantees

- Validates supported MIME types and the 25 MB size limit before reserving an
  attachment.
- Binds every upload to the exact knowledge client, workspace, role, logout
  state, selected note, creation state, request generation, and mounted
  lifecycle.
- Aborts content transfer when the scope changes or the upload is explicitly
  cancelled, and ignores late results from an old scope.
- Cleans up reservations that fail before completion starts.
- Treats the completion request as a one-way safety boundary: once it starts,
  the client does not automatically delete the reservation after a timeout,
  abort, invalid response, or scope change because the server may already have
  committed the attachment. Any stale post-completion reservation requires the
  server's existing retention/cleanup policy or an explicit operator action;
  this client change does not claim to add that worker behavior.
- Inserts an encoded, editor-safe Markdown attachment link only for the
  original selected persisted note.
- Does not publish attachments, feedback, draft changes, or recovery refreshes
  after logout, workspace changes, role changes, note changes, or unmount.

## Verification Evidence

| Check | Result |
| --- | --- |
| Attachment hook regression | `7/7` passed |
| Focused upload/notes/recovery/navigation regression | `5 files / 58 tests` passed |
| Full Beta Web suite | `95 files / 693 tests` passed |
| Legacy frontend suite | `35 files / 161 tests` passed |
| Legacy Worker suite | `11 files / 63 tests` passed |
| Full Beta Worker suite | `97 files / 615 tests` passed |
| Web and workspace typechecks | passed |
| Lint | passed |
| Build | passed; initial entry `363.00 kB`, no Vite `>500 kB` warning |
| Production dependency audit | `0 vulnerabilities` |
| Deploy readiness | passed; initial preload excludes `markdown-vendor`, `ocr-vendor`, and `ai-vendor` |
| Independent review | no Critical or Important findings |

No API, schema, deployment, GitHub, or production changes were performed.
Authenticated browser validation remains blocked until a repository-external
Chrome profile is configured.

## Files

- `apps/web/src/app/App.tsx`
- `apps/web/src/app/use-attachment-upload.ts`
- `apps/web/tests/live-notes-flow.test.tsx`
- `apps/web/tests/use-attachment-upload.test.tsx`
