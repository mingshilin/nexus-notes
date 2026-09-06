# Task 51: Browser Measurement Stability

## Failures

- A recovered input could refocus after the first mobile navigation visibility
  check, hiding the fixed navigation between hit testing and click.
- Navigation performance used a 200 ms generic polling interval while enforcing
  a 100 ms shell budget, producing a false `209ms` database measurement.

## Fix

- Standalone authenticated scenarios require four consecutive 250 ms visible
  mobile-navigation checks. Any hidden sample restarts blur/reveal recovery.
- Navigation shell detection uses a dedicated 16 ms polling interval. The
  existing 100 ms shell and 250 ms cached-page budgets are unchanged.

## Evidence

- Release smoke: `21/21` passed.
- Performance budget: `3/3` passed.
- Real Preview navigation measurements: databases `5ms`, knowledge `5ms`,
  reminders `5ms`, AI `4ms`, cached databases `4ms`.
- Real Preview OrcaRouter AI action gate passed twice consecutively.
