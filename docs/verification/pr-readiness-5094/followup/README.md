Follow-up source SHA: 41dc4e69dbb15f32c4d941d9c34ef363934a4e27. Only E2E files changed; production code unchanged.

CI at c83bf46 exposed six fullstack failures: five selection-layout scenarios shared the old immediate text creation step; R09 asserted whole visible status text including a tooltip rather than the acknowledged status contract. Adapt real canvas placement in layout, final journey and visual tests; use existing expectBoardSynced for R09 (visible status/icon, data-sync-phase=synced, exact acknowledged aria-label). All content, geometry, ACL, reload and focus assertions preserved. Independent static review ACCEPT exact 41dc4e69d.

Validation on Node 22.23.2:
- Layout full spec: five passed. The combined first R09 attempt was rejected by exact-clean-source gate while tracked test edits existed; not counted as passing.
- R09 rerun on clean 41dc4e69d: one passed, exit 0, including frozen 403, cross-tenant ACL, refresh/download, source identity and cleanup.
- Official journey config Panel/Diagram/Visual Research: three passed with diagnostics, then three passed in normal mode without diagnostics; both exit 0. CI had intermittent Panel/Diagram failures, whose product root cause is not established. Do not claim they were repaired by a production change. Retain assertions and inspect recurrence.
- Official visual/accessibility config: Chromium visual and keyboard tests passed. Initial Firefox/WebKit launch failures were missing local executables; after installing exact Playwright builds, both passed in a focused rerun, exit 0. Tests and thresholds unchanged.
- Affected ESLint and git diff --check passed. All wrappers cleaned their isolated resources.

Commands:
`pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter web exec playwright test --config playwright.fullstack-smoke.config.ts --project=seeded-github-import --no-deps e2e/board-files-acceptance.spec.ts e2e/board-selection-layout.spec.ts`
`pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter web exec playwright test --config playwright.fullstack-smoke.config.ts --project=seeded-github-import --no-deps e2e/board-files-acceptance.spec.ts`
`BOARD_DRAG_DIAGNOSTIC=1 pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter web exec playwright test --config e2e/board-journey-acceptance.config.ts --grep "Panel:|Diagram:|Visual Research:"`
`pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter web exec playwright test --config e2e/board-journey-acceptance.config.ts --grep "Panel:|Diagram:|Visual Research:"`
`pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter web exec playwright test --config e2e/board-visual-accessibility-acceptance.config.ts`
`pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter web exec playwright test --config e2e/board-visual-accessibility-acceptance.config.ts --project=firefox --project=webkit`

New-head GitHub CI remains required. No PR merged and no main write.
