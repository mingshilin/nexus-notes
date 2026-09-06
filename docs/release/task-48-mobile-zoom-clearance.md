# Task 48: Mobile Zoom Editor Clearance

## Failure

The authenticated Preview browser gate reproduced a real overlap at 390 px and
200% zoom. The fixed account navigation occupied `y=797.64..847.64` while the
note body textarea extended to `y=864.72`.

## Root Cause

Zoom intentionally keeps mobile navigation visible for accessibility, but the
note body retained the normal mobile `max(55dvh, 360px)` minimum height. Canvas
bottom padding did not change the textarea's own geometry, so the fixed control
overlapped the editable element.

## Fix

Only under mobile `data-zoomed="true"`, bound the note body minimum height to
`min(42dvh, 360px)`. Normal mobile writing space, keyboard behavior, navigation
visibility, and desktop/tablet layouts are unchanged.

## Evidence

- The CSS contract test failed before the fix for the expected missing rule.
- Mobile zoom/style plus core UX regression: `2 files / 9 tests` passed.
- Production build passed with entry chunk `382.38 kB` and no chunk-budget
  warning.
- Authenticated Preview geometry recheck is required after deployment.
