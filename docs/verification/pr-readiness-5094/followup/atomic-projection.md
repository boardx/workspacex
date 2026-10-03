# Atomic drag projection follow-up

PR #5130 journeys failed on Diagram drag displacement (90 > 32), despite containing the prior ACK boundary repair. The intermittent CI root cause remains unproven.

Source: `2edefb8941fd8c23bb31859b342b8db7e6c038e9`.
`objectPoint` now reads surface rectangle, object projection, viewport and hit candidate in one browser evaluation, eliminating mixed snapshots across protocol awaits. Mouse gestures, parent/geometry assertions, candidate order and tolerances are unchanged. Independent exact-source static review accepted; it does not establish consistency with Fabric internal state.

Validation: `pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter web exec playwright test --config e2e/board-journey-acceptance.config.ts --grep 'Panel:|Diagram:' --repeat-each=3`

Ordinary Chromium run: 6 passed, exit 0; production build/type verification succeeded; resource cleanup 1s. Log: `/tmp/pr-atomic-projection-validation.log`. ESLint and diff check passed. This local evidence is not a claim that latest PR CI is green. Follow the new branch checks for confirmation.
