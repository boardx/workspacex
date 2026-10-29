# AI usage page redesign — #5943

User approved the bill-style layout on 2026-10-27. Implemented in the existing worktree from main 26753a1cc.

- Removed internal call/user/run IDs and stacked ranking/matrix/project sections from the default view.
- Added Beijing calendar presets and inclusive custom dates, date-grouped model/token/fee/status ledger, model overview and drilldown, member display names in admin views, and expandable metering details.
- Kept current ledger endpoints, permissions, forced-self filtering and snapshot cursor pagination.
- Unknown usage is not zero. Native-only usage is not token usage. Missing cost is not zero. No aggregate cost is invented from the visible page.
- Review identified mixed-model zero ambiguity and absent native buckets; added regressions, observed both fail, then fixed. Independent re-review found no remaining important findings.
- Validation: init.sh baseline; 24 relevant UI/formatting tests; Web typecheck; ESLint on affected files; full design lint.
- Browser check uses the actual bundled components and design CSS with explicitly intercepted fixture ledger endpoints, not live production data.
- Coordination boundary: harness readiness/active-features ran; tick cannot run without COORD_GATEWAY_URL. No coordination identities or leases fabricated.
- PR: https://github.com/boardx/workspacex/pull/5944. Push hook also passed full Web lint and typecheck. Browser screenshots were visually inspected; dark capture now explicitly waits for theme transitions to settle before checking inherited table color.
- GitHub review found the API filters by request start rather than receipt time. Added and observed a failing Beijing-midnight regression, then changed display/grouping to startedAt ?? occurredAt and retained occurredAt/id cursors. Final affected test suite: 25 passed; browser checks and full Web lint/typecheck repeated.
- Human correction: all development PRs target develop. PR #5944 retargeted to develop; replayed only this task's four commits onto latest develop 97a08e7e3 (0 behind / 4 ahead before this evidence update), excluding main-only release commits. Re-ran init.sh, all 25 tests, Web typecheck/full lint and Chromium checks successfully on develop.
