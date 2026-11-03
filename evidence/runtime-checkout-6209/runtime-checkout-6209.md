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
