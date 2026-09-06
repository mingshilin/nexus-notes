# Task 49: Navigation and Recovery Race

## Failures

The standalone authenticated AI gate exposed two separate races:

1. The browser runner inspected authentication before React completed async
   session bootstrap.
2. A late `draftController.recover()` response unconditionally navigated back
   to Notes after the user had already selected AI.

Persistent profiles could also reopen with a text input focused, which correctly
hides mobile navigation and made the standalone runner attempt to click an
inert control.

## Fix

- Standalone authenticated scenarios now wait for an explicit authenticated or
  unauthenticated application boundary.
- They release stale text focus and reveal mobile chrome before navigating.
- Draft recovery still restores local content, but only requests the Notes
  domain when Notes remains the user's latest requested destination.

## Evidence

- The auth-boundary and mobile-chrome runner tests failed before their helpers
  existed, then passed after implementation.
- The product race test reproduced a late local draft overriding AI navigation,
  then passed after the requested-domain guard.
- Release smoke: `21/21` passed.
- Navigation, AI, and performance regression: `3 files / 93 tests` passed.
- Full lint and production build passed; entry chunk `382.43 kB`.
- Preview AI browser rerun is required after deploying this commit.
