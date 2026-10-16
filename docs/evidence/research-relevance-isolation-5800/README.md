# Invalid source relevance isolation (#5800)

User symptom: continuing the report for devapp session grs_b04e4cd3c8554396b8fa10526e3e70a7 returns RESEARCH_SOURCE_RELEVANCE_INVALID. The screenshot identifies the failure category; no claim is made about the exact provider validation issue or successful execution of that live session.

Root cause reproduced locally: runtime `reviewSources` directly awaits strict batch screening. After two invalid outputs from one old-source batch, screening throws and independently healthy batches cannot be admitted. This occurs both before search recovery and before report preparation.

Fix: runtime source re-evaluation explicitly chooses discard-batch after bounded strict validation/repair exhaustion. Such batches admit no evidence; independent validated batches continue. Strict helper callers, new-hit task error handling, report evidence and quality gates remain unchanged. Invalid assessments are not persisted as semantic negative-cache entries or provider refusal tombstones. Provider/storage errors and cancellation still propagate. Existing per-call safe validation diagnostics remain available; no model outputs are newly recorded.

Reproduction: helper regression on original implementation failed twice (adaptive/nonadaptive). Controller regression with the original runtime review call failed for both retry and generate_report: terminal event was failed instead of completed. Restore the fix and the same tests pass. This uses the real controller stream adapter and GuidedRuntimeService with an in-memory persisted-state fixture plus deterministic loopback model, not a live HTTP server, browser, production database, or paid provider.

Coverage: mixed legacy batches retain eight validated sources and discard one invalid source; retry reuses admitted evidence. Empty surviving evidence still cannot be completed. Invalid output is never negative-cached; a later valid assessment can succeed. Strict helper rejection, cancellation, provider error, privacy-safe diagnostics and the complete research suite remain tested. Two controller cases exercise report continuation and regeneration through independent evidence/quality validation, ending in NDJSON completed with a formal report and completed timeline; no invalid-source ID enters downstream model input.

Commands: `pnpm --filter @repo/api exec vitest run --config vitest.research-unit.config.ts`; `pnpm --filter @repo/api typecheck`; `pnpm --filter @repo/api lint`; `./init.sh` quick health checks. Final results are attached alongside this receipt. No deployments or live-session mutations.

Final local results: 38 research test files / 867 tests PASS, API typecheck PASS, API lint PASS, init quick health PASS. Original-runtime controller RED: 2 failed as expected; fixed-runtime controller suite: 44 PASS.


## Follow-up: a discarded batch removes a task’s only source

An additional regression found that report preparation captured allowPartial before re-evaluation. A failed task created by removing its sole invalid source could therefore stop the whole command with TASKS_INCOMPLETE despite healthy documents for other tasks. This is distinct from merely retaining healthy batches of the same task.

Runtime review now returns a local signal only for exhausted invalid-output discards. After successful source preparation, this signal plus the existing canRecoverPartialReport predicate may select the existing honest partial-report path. Verified document hashes/policy, failed-task facts, evidence extraction, full chapter quality review and formal persistence all remain required. Ordinary valid-negative assessment does not activate this new path. No persistent protocol fields or fake task success are introduced.

Controlled controller cases exercise retry and generate_report with: unaffected task evidence; lost task evidence with only independently validated context remaining (the original questions have explicit evidence-gap prose and concrete verification, formal reportPartial stays true); independent reviewer refusal (failed/no formal report); a valid-negative assessment without partial consent (original TASKS_INCOMPLETE); and an entirely empty chapter (quality refusal). Save/reload preserves report, partial flag and failed task. Reviewer inputs retain exact context provenance and contain no retrieval-gap label; no failed-source ID reaches later model calls.

Before the follow-up, both cross-task positive cases failed at the public stream terminal. With the fix they complete, while negative cases remain failed. No-source chapters are deliberately not forced through the unchanged quality gate. This remains deterministic in-memory/controller evidence, not a live HTTP/browser/PG or devapp execution.

Follow-up final local results: 38 files / 875 tests PASS, 52 controller/composite cases PASS including the 10-case matrix, API typecheck/lint PASS. task-gap-red.txt captures the two failures when the local invalid-discard partial recovery is disabled; task-gap-controller-green.txt captures the full fixed controller suite. Earlier helper/stream logs document the initial red/green step, not a claim that the earlier source included this follow-up.
