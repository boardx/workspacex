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

Final complete run: `pnpm exec vitest run --config .harness/vitest.config.ts --dir .harness --bail=1` — 236 files passed, 2705 tests passed, 4 existing skips (2709 total), exit0. The repaired lane/artifact conditions, supervisor tests and real Turbo termination are included. Pre-push typecheck/lint: 20/20 tasks successful. Independent read-only reviewer ACCEPT for implementation06ee1be48a888dce4c38eab71644c21d4697011c; independently reran 24 fail-fast tests including actual Turbo sibling termination.

Conditional-request follow-up: API polling now runs every30s with authenticated ETag requests and endpoint-specific cloned snapshots, reducing repeated quota consumption. Mandatory pre-cancel reads bypass that cache and request no-cache; an unexpected304 on those reads fails closed. Writes never use ETags, invalidate the run cache, and API errors never reuse cached success. The same focused command above rerun after this API-client change:182 tests passed/11 files, with six additional conditional-request boundaries; Node syntax and diff checks passed. The complete-suite numbers above belong to the preceding implementation; updated-head CI remains required.

## Trust and rollout
workflow_run supervisor executes only github.workflow_sha from the trusted default branch, with no candidate checkout/artifacts/install. actions:write stays in that supervisor. It polls only the triggering run/attempt, checks identity again before cancel, and requests normal cancellation, retaining existing cleanup/evidence conditions. GitHub may label unfinished work cancelled; this never means PASS. Supervisor success means monitoring completed, not target tests passed. API errors and monitor deadline failures remain visible.

The workflow becomes active only after merging into the default branch. Current PR/queue and billing #6058 remain separate; no claim that code is merged or automatic cancellation is live yet.

GitHub references: [workflow_run privileges and default-branch trigger](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_run), [cancellation conditions and signals](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-cancellation).

[GitHub conditional-request polling guidance](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api#use-conditional-requests).

## Develop queue cutover integration
Merged develop800807157 (PR6059) without dropping queue compile reuse or queue-ready checks. Preserved manual compile conditions while removing continuation. Added cancellation handling to the new queue aggregate. Synced root Vitest/Playwright first-failure flags and affected-test forwarding; primary API compound command uses its own bail while forwarded arguments reach exclusive tests without duplicate bail flags. Actual Turbo, Vitest compound-command and browser-free Playwright failure fixtures assert later work stops and test cleanup still runs.

Integration validation:14 files/199 tests passed, node affected-tests19/19 passed; git diff --check clean. Updated old exact-command assertions for removed --continue and added --bail=1. Full harness verification remains in progress; these focused counts do not claim remote CI or merge success.
