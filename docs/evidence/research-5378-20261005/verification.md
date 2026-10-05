# Partial research failure visibility

Issue: #5378. Scope: UI state projection only; report generation performance remains UNKNOWN under #5306. User observed 14→18 sources over more than half an hour, but source count does not establish model durations or backend health.

Regression: `/private/tmp/research-5378-red.log`: 3 failed / 8 passed with the original implementation. Running sibling tasks and running recovery attempts were hidden by failed tasks; active source organization was hidden by document errors.

Final root validation:
- Web research suite: 37 files / 368 tests passed, exit 0 (`/private/tmp/research-5378-web-final.log`).
- Web typecheck: exit 0 (`/private/tmp/research-5378-types-final.log`).
- Scoped ESLint: exit 0 (`/private/tmp/research-5378-lint-final.log`).
- `./init.sh`: exit 0, quick default path (`/private/tmp/research-5378-init.log`); not a full monorepo test claim.
- Independent reviewer: 12 focused tests and web typecheck exit 0 (`/private/tmp/research-5378-review-tests.log`, `/private/tmp/research-5378-review-type.log`). Exact commit review follows submission.

Covered: active siblings, recovery attempts with retained failure, terminal failure, pause/interruption/expired lease/non-busy stale work, re-rendered snapshots, historical reading-started during a search retry, unchanged report prose. No source, task, report, lease or runtime is mutated by this projection.

No production speed, source quality, recovery or deployment acceptance. Direct browser diagnostic API navigation was blocked by the browser; no security-policy bypass was attempted. No new models, servers or Docker stacks were started. CI is tracked on the live PR and is not declared successful here.
