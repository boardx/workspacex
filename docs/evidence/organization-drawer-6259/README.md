# Organization detail drawer — #6259

First approved UI interaction slice under #6256. Uses existing Dialog primitives and product tokens to replace the bottom detail section with a right-side modal drawer. Existing authenticated data fetching, organization/account scoping and financial operations remain intact in this slice; no fabricated balance/cap data or new API/permission is introduced.

The first added real UI behavior test fails on the existing section (red.txt: 1 failed / 4 passed). After the drawer change, all 5 focused tests pass (green.txt), including Escape dismissal and trigger focus restoration alongside existing financial receipt persistence, search/paging and outage handling. Both test processes exited and the coordinated single-worker window was released. No build, tsc, Docker or push was run in that window.

Pending: focused race/accessibility additions, independent review, typecheck/lint, real browser visual verification and normal PR/CI integration. This slice is not completion of the entire approved organization model, unique upgrade flow or member-credit-cap implementation. Human sidebar correction is recorded in the approval evidence: platform-backoffice navigation/pages/APIs are platform-admin only; org admins manage own-org caps via organization administration.

## Organization/account isolation follow-up

`race-first.txt` records 6 passes / 2 failures: the newly added assertion rejected any page alert and incorrectly matched the current organization's usage-panel error. The fixture now explicitly rejects usage API reads; the race tests verify the API was called for organization B and that B's actual usage alert remains visible after organization A's late success or rejection. They separately reject A's old detail data and parent detail-error message. No production error is suppressed or usage panel mocked out.

`race-green.txt`: 8 passed, exit 0, 4.08s. Includes account-scope change clearing a pending drawer, Escape dismissal and focus restoration. Test process exited before the short resource window was released. Typecheck/lint, independent exact-SHA review, visual verification and CI/integration remain outstanding.

## Eleven-case P2 regression RED

Single-worker run: `11-red.txt`, exit 1, 4 failed / 7 passed, Vitest duration 7.58s. Failures reproduce detached-trigger focus restoration and drawer visibility of detail HTTP 403/503 and save HTTP 409 errors. No conflicting test processes before or after the run. Resource window released immediately after exit.

Minimal fix now separates catalog and drawer errors and restores focus to the stable search input when the original trigger was detached. `git diff --check` passed. Eleven-case GREEN, type/lint, exact-SHA review and browser acceptance remain pending.

## Eleven-case GREEN after P2 fixes

`11-green.txt`: actual exit0,11/11 tests passed, Vitest6.51s. Current original UI diff, no unverified i18n imports. Fresh pre/post process checks showed no conflicting or residual test/type/hook processes. Resource window released immediately after actual exit. This verifies drawer-contained detail403/503 and save409 errors, detached-trigger search focus fallback, existing5 cases and late-response/account-scope races. Type/lint, exact-SHA review, normal PR CI and real-browser layout acceptance remain pending.

## Static verification

Current `pnpm --filter web typecheck` and `pnpm --filter web lint` both exited0 in the coordinated serial window; logs typecheck.txt and lint.txt. Normal commit/push hooks, exact-SHA independent review, PR CI and browser acceptance remain to be observed.
