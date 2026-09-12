# Task 36: Isolate Attachment Upload Lifecycle

## Scope

Move the authenticated attachment upload flow from `AuthenticatedWorkspace`
into `useAttachmentUpload`.

## Reliability Contract

- Preserve the existing MIME, size, upload, cleanup, feedback, and editor-link
  behavior and API calls.
- Bind an upload to the exact knowledge client, workspace, role, selected note,
  and mounted lifecycle; a late result from another scope or note must not
  update attachments, errors, feedback, or the current draft.
- Pass an abort signal to the content upload where supported and clean up a
  reserved attachment after any failed or abandoned upload when possible.
- Keep editor insertion conditional on the original note still being selected
  and not being a new unsaved note.
- Preserve viewer and concurrent-upload restrictions.

## Boundary

No API routes, schema, permissions, OCR behavior, or visual styling changes.
