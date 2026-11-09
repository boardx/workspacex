# Board insertion recovery #6450

Canonical transport is prepared on confirmation even when an editing artifact already exists. Placement can move beyond the original preview extent, with reframing after a gesture. Error text no longer assumes permission failure.

Validation: web typecheck exit 0; targeted Next ESLint exit 0; git diff --check exit 0. Worker unit coverage: 21 passed.

Real fullstack command: `pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter web exec playwright test --config playwright.fullstack-smoke.config.ts --project=seeded-github-import e2e/chat-board-target-placement.spec.ts --workers=1 --max-failures=1`
Result: 1 passed (6.0m), exit 0. Isolated run run-mw8q8izr-019f9e98-0709722dbf75; cleanup completed in 1s. Covers project/organization target placement, cancel, reload and access revocation. Saved artifact regression covered by unit test, not separately exercised in this browser run.

PR targets develop. Do not merge automatically.
