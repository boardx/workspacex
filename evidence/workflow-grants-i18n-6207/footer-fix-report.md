# Mobile footer wrapping fix

Status: minimal responsive fix applied; root verification pending.

Cause: root's second actual fresh-browser run passed grant PUT, new audit ID, reload, date/raw-name checks and grant-footer scrolling, then found mobile revoke Cancel visibility ratio 0.70037. The long Confirm revoke label squeezed Cancel partly outside the horizontal scrollport. DELETE and member stages were not reached. Evidence: evidence/workflow-grants-i18n-6207/browser-second/test-failed-1.png. This is newly observed responsive evidence, within the existing dialog usability scope.

Delta: added only `flex-wrap` to the existing DialogFooter className `flex justify-end gap-2` in apps/web/components/org-admin/workflow-grant-dialog.tsx. Callbacks, element order, canonical levels, state, copy, DialogContent scrolling class and shared Dialog component remain unchanged.

Self-review: inspected both footer and existing scroll class, then applied an exact single-occurrence replacement. No E2E assertions or timeouts changed, and other files preserved.

Checks actually run: read-only rg inspection and exact replacement occurrence assertion. No tests, typecheck, lint, build, browser, PG, Git, external actions or subagents.

Pending: root's serial verification with the existing actual-RED real-wheel/full-viewport guard, followed by the remaining revoke/member journey and required review/static checks.

Rootactualchecks at89a22aeb2a7faf0d2392615d94298ef86e502cc4:25/25PASS2.62s, webtype0, Dialog+E2EESLint0,testid0,isolatedexactlist1test/1file2s0. Freshactualbrowserstillpending; fullCancelvisibilityassertionunchanged.

Rootcoveringactualbrowser source89a22/docsHEADc053 byteequalclean:1/1PASS10.2s,total4m1/cleanup1. Allnewaudit/reload/mobilefullaction/memberdenialassertionsexecuted. scopewsx-57d5c526c41d17fee319 docker0andownedportsnoLISTENafteractualexit. Command:pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter web exec playwright test --config=playwright.fullstack-smoke.config.ts --project=seeded-github-import --no-deps entity-localization.spec.ts --grep="workflow grant management persists canonical permissions" --max-failures=1. Evidence:evidence/workflow-grants-i18n-6207/final-run/browser.txt;15screensrootQApending.
