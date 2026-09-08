# Independent full regression jobs (#2084)

The user authorized the Actions strategy optimization. This patch depends on #3156 and keeps the full regression outside PR events.

`full-regression-core` retains `TURBO_FORCE=true pnpm run verify:full`, including its sequential tests and smoke. `chat-read` and `self-service-profile` each use their existing public isolation wrapper on a separate hosted runner. `e2e-full` aggregates all three required results and fails on failed, canceled, skipped, missing or unknown results. The manual boolean switch controls all three and the aggregate.

Budgets are core 80/90, Chat 50/60, profile 10/20 minutes (execution/job). This separates the measured ~45 minute core, ~25 minute Chat, and ~1.5 minute profile paths and leaves cleanup/upload headroom. Shared account capacity can still delay jobs; this change does not increase account limits or guarantee a shorter queue.

Each lane keeps its own verdict and artifact. The existing core readiness manifest still describes only `verify:full`; the full regression verdict is the aggregate check. Optional scorecards remain separate. No test sharding, test selection reduction, merge policy or production deployment changes are included.

Validation: isolated `./init.sh` passed. Targeted workflow/aggregation/dedup/artifact/Python/isolation tests: 5 files, 58 tests passed (targeted-tests.log). GitHub dispatch and full harness evidence are recorded in the PR as they complete.

Full harness validation passed: 85 files, 989 tests (harness-validation.log). Independent review accepted the final non-hidden journey log fix; targeted rerun passed. Live GitHub validation is pending.
