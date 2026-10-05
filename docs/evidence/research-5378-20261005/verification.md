# Partial research failure visibility

Issue: #5378. Scope: UI state projection only; report generation performance remains UNKNOWN under #5306. User observed 14→18 sources over more than half an hour, but source count does not establish model durations or backend health.

Regression: `/private/tmp/research-5378-red.log`: 3 failed / 8 passed with the original implementation. Running sibling tasks and running recovery attempts were hidden by failed tasks; active source organization was hidden by document errors.

Initial validation at 0754115f3 (superseded; main review REJECTED despite green CI):
- Web research suite: 37 files / 368 tests passed, exit 0 (`/private/tmp/research-5378-web-final.log`).
- Web typecheck: exit 0 (`/private/tmp/research-5378-types-final.log`).
- Scoped ESLint: exit 0 (`/private/tmp/research-5378-lint-final.log`).
- `./init.sh`: exit 0, quick default path (`/private/tmp/research-5378-init.log`); not a full monorepo test claim.
- Independent reviewer: 12 focused tests and web typecheck exit 0 (`/private/tmp/research-5378-review-tests.log`, `/private/tmp/research-5378-review-type.log`). Exact commit review follows submission.

Covered: active siblings, recovery attempts with retained failure, terminal failure, pause/interruption/expired lease/non-busy stale work, re-rendered snapshots, historical reading-started during a search retry, unchanged report prose. No source, task, report, lease or runtime is mutated by this projection.

No production speed, source quality, recovery or deployment acceptance. Direct browser diagnostic API navigation was blocked by the browser; no security-policy bypass was attempted. No new models, servers or Docker stacks were started. CI is tracked on the live PR and is not declared successful here.

## Main review correction

Main's `/private/tmp/rev5378-counterexample.ts` and `.log` reproduced historical reading-started at a new report destination with no active task/source. Two added regressions failed / 12 passed before correction (`/private/tmp/research-5378-main-red.log`). Null lease is not live execution proof. Initial ACCEPT is superseded; initial CI green does not override the REJECT.

New optional `executionVersion` fields bind activity and progress to the stable claim version. Only new record creation writes the stamp. Claim increments version; writes and lease extension do not. Copying progress preserves its original stamp, and legacy records remain valid without becoming active. UI requires a valid nonempty lease plus matching current execution proof. Unconfirmed busy state is explicitly described as unconfirmed.

Corrected validation:
- API pure 16 files / 422 tests passed; contracts research-trust 7 passed; API/contracts types and API lint exit 0. Logs `/private/tmp/research-5378-execution-version-*`.
- Original main counterexample rerun unchanged: exit 0 (`/private/tmp/research-5378-counterexample-fixed.log`).
- Web research 37 files / 372 tests passed (`/private/tmp/research-5378-version-final-web.log`); web types/lint and default init exit 0 (`/private/tmp/research-5378-current-{types,lint,init}.log`).
- Independent focused UI 16 passed (`/private/tmp/research-5378-stamp-review.log`); final exact verdict remains the live PR/main-review authority.

The stamp regressions cover new execution retaining old progress, new source-reading events, stable same-run version through persist/lease extension, new retry versions, pause, absent stamp and absent lease. Transition snapshots are updated to the actual newly stamped server progress; their real destination/loading assertions remain.
