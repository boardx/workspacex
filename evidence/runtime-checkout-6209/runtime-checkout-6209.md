# Runtime gate current-source checkout — #6209

Spec: the human/main-assigned isolated fix, recorded in issue6209. Native job126174296929 spent20:08:08.392→20:22:21.149 fetching all branch/tag history. Install18.4s then15-minute deadline canceled before runtime assertions. Audit of verify-rls.sh, verify-runtime-gates.sh, verify-migrations.sh, lib.sh, rls-assert.ts, runtime-gate-assert.ts, migrate-cli.ts, migrate-check.ts, migrator.ts and pg-config.ts shows filesystem/PG/current-source dependencies only. Runtime child spawns current src/main.ts; migration discovery reads current SQL directory. No history/merge-base/diff/log/tag reference is required. Main explicitly assigned this repair; unrelated CI optimization is out of scope.

## Global Constraints
Only gates-runtime checkout changes. Preserve exact default event-selected ref/SHA, repository, timeout15, all test commands/steps/env, required dependencies and all other jobs. No ref override, test omission, cache/retry/timeout/product change. Root owns test/evidence/GitHub/Git. Reuse existing worktree; no subagents from implementer.

## Task 1: Make runtime checkout shallow
In `.github/workflows/backend-gates.yml`, ONLY under `gates-runtime`, replace `with: { fetch-depth: 0 }` with:

```yaml
        with:
          fetch-depth: 1
          fetch-tags: false
```

Do not alter any other file. Root already added an existing-workflow regression in `.harness/scripts/ci-api-shards.test.ts`: actual RED expected1 received0 in619ms. Implement exact YAML change, inspect diff, write self-review to `.superpowers/sdd/runtime-checkout-6209/task-1-report.md`. Do not run tests/type/lint/build/browser/PG or commit/push/checkout/createworktree; root serializes resources. You are not alone; do not revert others or spawn subagents. Report status/files/concerns only.


## Task 2: Include the actually timed-out API test shards
Main explicitly expanded this same PR after native6205source4aa shard2job126173873145/run41708729893 showed allhistoryfetch11m35.929 and actualtest5m05.265 before20-minute deadline. Whole-suite audit: defaultvitestinclude tests/**/*.test.ts; native-live with only executablegit `rev-parse HEAD` is excluded and would still work atdepth1. Remaininggit mentions are comments/GitHubHTTPmock. Childprocess calls use currentnode/tsx/Python/build/lint/seed/SQL/docker/tsc scripts. SharedDBsetup/cleanup uses currentSQL/PG. api-test-plan only reads current .harness/api-test-shards.json and writes matrix toGITHUB_OUTPUT; leave it untouched. No full-history dependency was found.

The earlier Global Constraints are extended ONLY to allow the same shallowcheckout inputs for `gates-test`. Its20-minute budget, matrix/needs/8shards/failfast/env, all actualtest commands and cleanup remain unchanged. Runtime fix and all otherjobs unchanged.

Own only `.github/workflows/backend-gates.yml` under gates-test: replace `with: { fetch-depth: 0 }` with exact multiline `with:` / `fetch-depth: 1` / `fetch-tags: false`, at existing indent. Root owns test/evidence/actions. No other edits, tests/type/lint/build/browser/PG/Git actions/worktree/subagents. You are not alone; do not revert others. Write `.superpowers/sdd/runtime-checkout-6209/task-2-report.md` status/self-review/concerns. This task is complete literal code transcription; implement promptly.
