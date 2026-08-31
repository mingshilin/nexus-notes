# Task 35: Isolate Knowledge Recovery Actions

## Scope

Move unfiled-note classification, orphan handling, duplicate-title merge, and
their feedback/error orchestration out of `AuthenticatedWorkspace` into
`useKnowledgeRecoveryActions`.

## Reliability Contract

- Preserve existing API calls, source labels, result messages, and panel
  callback behavior.
- Bind every async action to the exact notes client, workspace, role, request
  version, and component lifecycle.
- Abort or ignore late results after workspace/client/role changes or unmount.
- Reject note entities returned for another workspace before updating local
  state.
- Keep original note content recoverable; duplicate notes are archived rather
  than permanently deleted.

## Boundary

Attachment upload and OCR retry orchestration remain in their existing data and
upload handlers. No API, schema, permission, or visual changes are included.
