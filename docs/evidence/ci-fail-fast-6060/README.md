# CI failure stops remaining validation — #6060

Scope: module continuation, test shard cancellation, follow-up validation conditions, and trusted same-workflow cancellation. Production deployment workflows and repository protection rules are unchanged.

## Verified
- Red: ci-fail-fast-wiring tests initially failed 3/3. Real Turbo continued a sibling after another task failed, leaving the forbidden completion marker.
- Green: `pnpm exec vitest run --config .harness/vitest.config.ts --dir .harness ci-fail-fast ci-lane-dedup ci-base-ownership ci-static-ownership ci-api-shards ci-base-api ci-aggregate-cancellation ci-queue-wiring ci-fullstack fullstack-smoke --bail=1` — 176 passed across 11 files. Real Turbo now terminates the running sibling. Supervisor API tests cover failure, timeout, healthy completion, pagination, newer attempts, changed identity, authentication errors, budget expiry and completion/cancellation races. These are controlled API tests, not a live deployed supervisor claim.
- `node --check .harness/scripts/ci-fail-fast.mjs`, `pnpm run lint:execution-plan`, `git diff --check` passed.
- Review caught overly broad changes suppressing artifact collection and later sticky/geometry validations still running after primary failure. Artifact/log/verdict conditions restored; subsequent validations now require success, with actual expression regression tests.
- Live incident run41192730887 had chat-read FAILURE and full-regression-core still running. Normal cancel was resisted by its old always() job condition. After confirming the same candidate SHA/attempt, force-cancel was requested. GitHub reported completed/cancelled and zero running jobs. This is manual incident handling, not automated supervisor acceptance.

## Full-suite boundary
An intermediate broad harness run caught the artifact-condition regression, repaired above. It also hit a Darwin process-group EPERM in unchanged cn_auto_prepare.py/test_cn_auto_prepare.py. Exact HEAD baseline files were exported to an ordinary temporary directory (no new worktree), run in five full rounds, then removed: one of five rounds reproduced that same error. A fresh complete harness run is tracked separately; do not call the initial run all green.

## Trust and rollout
workflow_run supervisor executes only github.workflow_sha from the trusted default branch, with no candidate checkout/artifacts/install. actions:write stays in that supervisor. It polls only the triggering run/attempt, checks identity again before cancel, and requests normal cancellation, retaining existing cleanup/evidence conditions. GitHub may label unfinished work cancelled; this never means PASS. Supervisor success means monitoring completed, not target tests passed. API errors and monitor deadline failures remain visible.

The workflow becomes active only after merging into the default branch. Current PR/queue and billing #6058 remain separate; no claim that code is merged or automatic cancellation is live yet.

GitHub references: [workflow_run privileges and default-branch trigger](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_run), [cancellation conditions and signals](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-cancellation).
