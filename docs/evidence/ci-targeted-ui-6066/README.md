# Bounded UI regression — #6066

Status: implementation being validated; `ci-targeted-ui.json` remains disabled.
Activation requires actual complete matrix evidence from #6065. No production
configuration, branch protection or payment state is changed.

## First supported change
Only an M change to `apps/web/components/chat/chat-task-workbench-empty-state.tsx`
is eligible. It must preserve reviewed React/cn imports, public signatures,
existing identifiers, call capabilities, element/attribute capabilities, and
regular source files. Unknown paths, additional files, deleted/renamed inputs,
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
