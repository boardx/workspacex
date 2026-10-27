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
