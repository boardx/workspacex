# Bounded UI regression — #6066

Status: phase2 runtime prerequisite met; this PR enables the bounded pilot.
The rollout must still pass its own full candidate validation and a real eligible
canary before acceleration acceptance is claimed. No production
configuration, branch protection or payment state is changed.

## First supported change
Only an M change to `apps/web/components/chat/chat-task-workbench-empty-state.tsx`
is eligible. It must preserve reviewed React/cn imports, public signatures,
the complete syntax tree outside JSX copy and existing literal presentation
attributes/classes, and regular source files. Directives, callback arguments,
context wiring, numeric values and executable syntax are frozen. URL-bearing
CSS values cannot enter the pilot. Unknown paths, additional files, deleted/renamed inputs,
shared/config/lock/CI changes, missing history or runtime/public boundary changes
retain full regression. This is a pilot for local presentation/copy changes,
not a general proof that arbitrary JavaScript dependencies can be inferred.

The policy is the suite inventory authority. Current installed discovery selects
2 unit files (9 assertions) and 6 chat-read browser files (25 cases, no declared
skips). A direct component test covers selection callbacks, real context counts,
project scope and briefing composition. Backend gates, complete compilation and
control-plane/static gates remain mandatory in this first rollout.

## Execution and proof
Both PR preview source and actual merge-group candidate use explicit source/base
commits. A cheap preflight can request runtime preparation; its `candidate-ui`
result cannot authorize tests or acceptance. Only the complete AST/history plan
can select UI scope. Disabled/non-candidate plans do not require dependencies in
the cheap router. Unknown selection always retains full coverage.

PR affected tests use the actual selected Vitest runner; PR browser feedback runs
only in harness-verify. Queue execution runs selected unit/browser producers in
harness-acceptance. The latter is the authoritative candidate receipt. Cheap
selected units can repeat in the affected check; the heavy browser suite is not
run twice on the same queue candidate. No cross-SHA result reuse is enabled.

Stable `full-regression-core` and `e2e-full` checks validate the active route.
Full mode still requires original producers and actual browser verdicts. UI mode
requires selected producers plus compile/control-plane coverage, actual reports,
exact suite identities, the current plan/policy digests and SHA/run/attempt.
Inactive jobs must be skipped and are never described as executed/passed tests.
Queue-ready requires matching verified aggregate metadata. Release admission
continues to require that exact candidate's aggregates and queue-ready predicate;
it cannot accept an isolated green/skipped selected job.

Artifacts are current-attempt-only; partial reruns must rerun their producers.
Dedicated JSON files keep wrapper/config diagnostics out of reports. UI child
processes do not receive GH_TOKEN/GITHUB_TOKEN. Browser execution preserves the
heavy E2E lock and independent database/port/compose scope. Failed execution
removes previous success metadata and receipts.

## Validation boundaries
Boundary/history counterexamples, real installed Vitest/Playwright fixtures,
missing/replayed/changed evidence, failed/cancelled/skipped prerequisites and
actual CLI delegation are tested. Full fallback static spec registration remains
verified without exemptions. Actual service/browser execution, independent final
review and a real eligible PR/queue canary remain rollout evidence requirements.
No elapsed-time speedup is claimed until those runs are recorded.

## Final review fix pass (2026-11-01)
The independent review of `b75407c61f2e54640b1e45286c1f6c1ddcb74f00`
returned REVISE. Both important findings were reproduced as failing tests and
fixed in the author pass: executable tagged templates no longer fit the syntax
boundary; pending/todo/skipped or omitted unit assertions cannot become a success
receipt. Installed Vitest case discovery must exactly match executed identities;
the mandatory aggregate rediscovers selected cases from the current checkout.
Nested suite names use the reporter's ancestor/title structure rather than
assuming Vitest's two JSON outputs use identical full-name delimiters.

Local real service diagnostic on the reviewed source: the original chat-read
configuration executed all 25 selected cases in 6m26s, with no skips, failures or
flakiness. The current selected unit reports contain 9 passing assertions and
match installed discovery. These local executions are compatibility diagnostics,
not GitHub candidate admission or a measured end-to-end CI improvement.

The reviewer did not judge actual phase2 queue proof, activation, canary, or speed;
those remain separate requirements. A minor trailing blank-line finding in the
workflow diff is deferred. No new approval claim replaces the review verdict.

Post-fix canonical `pnpm run verify:harness:raw`: 248 files passed, 2,804
assertions passed and 4 existing declared skips (none from the selected pilot),
636.95s Vitest duration. `node --test .github/scripts/run-affected-tests.test.mjs`:
21/21 passed. `pnpm --filter web exec tsc --noEmit`: exit 0. Source boundary
counterexamples, both pending-assertion reproductions and real nested Vitest
discovery/report reconciliation pass in the complete suite.

## Phase2 admission prerequisite satisfied
PR #6065 merged on 2026-10-31 at 18:39:10Z. Its actual merge-group candidate
`de530c255fd882df80ba369ecb86e84ebdf14a10` passed all active producers and the
mandatory aggregates (`full-regression-core`, `chat-read`, `e2e-full`,
`queue-ready`) in run 41227906350, attempt 1. The archived API snapshot is
`phase2-queue-proof.json`; current-attempt Web and Chat artifact bundles were
independently downloaded and verified, including complete 959-file Web coverage
(240/240/240/239) and both original chat-read partitions.

The acceptance run took 30m50s, versus 69m01s for the immediately preceding
pre-parallel baseline 41218718251. This one before/after observation is about
55% lower wall time, not a controlled benchmark or long-term percentile. The
remaining longest lane was chat shard 1 (27m24s); fullstack-smoke was 25m13s.
Full core completed in 18m23s rather than the prior 49m22s. This evidence permits
the bounded pilot flag to be enabled; it does not itself prove the pilot route.
Rollback remains setting the single policy flag false, with full fallback and
stable required checks retained.
