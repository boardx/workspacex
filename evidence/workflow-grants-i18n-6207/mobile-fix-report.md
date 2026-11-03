# Mobile dialog fix report

Status: minimal product fix applied; root verification pending.

Root cause: root's first fresh browser run at 375px found that the fourteen-workflow needs list filled the fixed 85vh DialogContent. Without vertical overflow scrolling, the confirmation footer stayed outside the viewport and no PUT was issued. This dynamic observation is distinct from the previous two static E2E findings.

Delta: added only `overflow-y-auto` to the existing `max-w-lg` className on DialogContent in apps/web/components/org-admin/workflow-grant-dialog.tsx. All children, state, guards, canonical mutation logic and the shared Dialog component remain unchanged.

Self-review: inspected the existing DialogContent line and used an exact single-occurrence replacement. No E2E assertions or timeouts changed. Other agents' edits preserved.

Checks actually run: read-only rg inspection and exact replacement occurrence assertion. No tests, typecheck, lint, build, browser, PG, Git or external actions performed.

Pending root: serial verification, real mouse-wheel scrolling and fully visible footer assertions on mobile, followed by any required static checks and review.

Rootactualcoveringstatic/interactionregressions atb38ba26fc:25/25PASS2.23s,webtype0,Dialog+E2EESLint0,testid0,isolatedexactlist1test/1file2s0. Freshactualbrowserstillpending; noPASSclaim.

Rootcoveringactualbrowser source89a22/docsHEADc053 byteequalclean:1/1PASS10.2s,total4m1/cleanup1. Allnewaudit/reload/mobilefullaction/memberdenialassertionsexecuted. scopewsx-57d5c526c41d17fee319 docker0andownedportsnoLISTENafteractualexit. Command:pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter web exec playwright test --config=playwright.fullstack-smoke.config.ts --project=seeded-github-import --no-deps entity-localization.spec.ts --grep="workflow grant management persists canonical permissions" --max-failures=1. Evidence:evidence/workflow-grants-i18n-6207/final-run/browser.txt;15screensrootQApending.
