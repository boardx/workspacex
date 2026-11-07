# CI policy v5: lightweight merge checks and hourly full regression

Issue #6397 implements the user's 2026-11-07 decision: expensive regression runs after merge on hourly frozen develop snapshots, while PRs and cumulative merge-queue candidates run real lightweight checks. This supersedes older workflow comments requiring every full suite before merge. Production release/deployment remains manual and retains its own identity, migration and health requirements.

The objective is **PR creation/submission → merged within 20 minutes**, including runner and queue wait. It is not a timeout setting or a guarantee. Record createdAt, job creation/start/completion, enqueue time and mergedAt when measuring; do not reset the clock after a fix. No new-policy live timing has yet established the objective.

## Mandatory merge evidence

All six existing required names are produced by `harness-verify.yml` for both PRs (including forks) and merge_group:

| Required check | Actual work |
| --- | --- |
| verify-full-compile | Full build, then full typecheck and lint |
| verify-control-plane | Root/security/static invariants and the base-aware lightweight graph guard |
| verify-affected | Three baseline schema/contract files plus known affected contract/CI unit tests and reviewed database-free API unit configurations |
| backend-required | Backend contract-source, architecture dependency and edition capability boundaries |
| merge-gate | Existing live PR/cumulative-candidate admission |
| queue-ready | `always()` convergence: all five preceding jobs must succeed on this run; declares `lightweight`, never full regression |

Selection receipts identify source/base, run/attempt, chosen unit files/configurations and deferred paths. Unknown impact still runs baseline contracts and full compilation; it is explicitly deferred to broad regression, not reported as full test coverage. Missing/empty/mismatched unit reports fail. No automatic cross-workflow proof polling or runner-holding supervisor remains. The graph guard runs as an actual mandatory step and rejects restored API matrices, whole harness/web/chat tests, browsers, smokes and candidate lookup waits from older queued branches; a v5 base cannot downgrade to v4.

## Heavy-suite inventory and routes

Limits below are job budgets, **not measured execution durations**.

| Workflow/job group | Former recurring cost | New route |
| --- | --- | --- |
| backend-gates: API default/exclusive, native lanes, RLS/migration, core-loop, prototype/design browser | 8 API shards plus independent runtime/browser runners | Hourly reusable + direct manual full; hourly default/exclusive API belongs to the mandatory same-SHA acceptance base producer, so it executes once |
| harness-acceptance: full build/harness/packages, API, web/chat, product/Board/directory/profile smokes | Broad suites on every queue candidate | Hourly/manual full only, retaining actual verdicts, discovery, reports and logs |
| Board/Skill/Billing specialist workflows | 6 Board lanes + Skill/Billing runtimes | Hourly reusable; manual remains available |
| whiteboard-outbox/native-cwd/home browser/devportal browser | 10–25 minute browser budgets | Hourly test-only fixtures; scoped home/devportal static/unit validation and manual deployment stay separate |
| local-windows core-stack | 45-minute Windows fixture | Hourly/manual; optional 180-minute portable packaging remains manual/explicitly selected, not claimed by hourly core coverage |
| self-host-upgrade/minimal-Docker/unified-release/web-only-release tests | 10–60 minute local-container/browser fixtures | Hourly/manual, ephemeral hosted runners only; no production runner/environment/secrets |
| CN content synchronization + release simulation | Isolated PostgreSQL and sandboxed lifecycle matrices | Hourly/manual fixtures, bounded matrices; no real customer-state synchronization |
| archive-bridge | Scoped contract tests + browser fixture | Scoped contracts remain PR checks; browser fixture moves hourly/manual |
| Other scoped release/bootstrap/carrier/installer/proof/runtime contracts | Path-specific contract/unit tests, mostly 5–15 minute budgets | Retained scoped PR tests, not repeated for every candidate |
| Reviewed-SHA CN package/delivery workflows and live diagnostics | Explicit identities/operator or label guards | Unchanged manual delivery semantics; not invoked by hourly regression |

The retained path-specific packaging checks can still be expensive (20–30 minute budgets), so the policy does not claim every specialized PR now meets 20 minutes. Automatic production/deployment workflows are not called from cron.

## Hourly identity and capacity

`harness-acceptance` keeps its name/path and runs at `17 * * * *`. GitHub schedules on the default branch; the source guard requires repository boardx/workspacex, develop ref and checkout HEAD equal to the immutable event SHA. Every local reusable call uses that same event SHA. Scheduled runs force full mode and fresh evidence. API/web/chat matrices have max-parallel 4/2/1. Backend full waits for the real complete base API proof; extended fixtures are serialized after the core and backend suites. These bounds reduce demand; they do not reserve organization runner slots or bound unrelated actors.

One unfinished hourly run continues; at most one pending run is retained. A later pending snapshot can replace an earlier pending snapshot. Cron can be delayed and a full run can last longer than an hour: **not every intermediate commit is fully tested**. Manual `all` preserves complete regression; `base` and chat diagnostics remain explicitly narrower and cannot publish the full receipt.

The final full result requires the exact complete declared producer set, every result successful, and matching frozen SHA. Its receipt identifies the verified SHA and run/attempt. SHA A's successful hourly evidence never certifies newer SHA B. Scheduled failures are reported separately by `hourly-regression-report.yml` as issues with source `大规模测试发现`, bound to original run evidence.

## Risk and rollout

A regression can merge after compile/selected tests pass and be found by hourly full suites later. That tradeoff is explicit user policy. Hourly failure is not relabeled as a pre-merge success, and missing hourly evidence is not fabricated. Policy v1–4 historical obligations and full API/native/runtime evidence remain frozen; v5 source-admission receipts explicitly say lightweight/fullRegression=false. Release safety checks remain separate.

This change takes effect only after review and normal merge/default-workflow adoption. It does not merge, enqueue, reorder or cancel candidates, change rulesets, deploy production, or claim the 20-minute objective has been achieved.
