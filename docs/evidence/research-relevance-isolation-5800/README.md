# Invalid source relevance isolation (#5800)

User symptom: continuing the report for devapp session grs_b04e4cd3c8554396b8fa10526e3e70a7 returns RESEARCH_SOURCE_RELEVANCE_INVALID. The screenshot identifies the failure category; no claim is made about the exact provider validation issue or successful execution of that live session.

Root cause reproduced locally: runtime `reviewSources` directly awaits strict batch screening. After two invalid outputs from one old-source batch, screening throws and independently healthy batches cannot be admitted. This occurs both before search recovery and before report preparation.

Fix: runtime source re-evaluation explicitly chooses discard-batch after bounded strict validation/repair exhaustion. Such batches admit no evidence; independent validated batches continue. Strict helper callers, new-hit task error handling, report evidence and quality gates remain unchanged. Invalid assessments are not persisted as semantic negative-cache entries or provider refusal tombstones. Provider/storage errors and cancellation still propagate. Existing per-call safe validation diagnostics remain available; no model outputs are newly recorded.

Reproduction: helper regression on original implementation failed twice (adaptive/nonadaptive). Controller regression with the original runtime review call failed for both retry and generate_report: terminal event was failed instead of completed. Restore the fix and the same tests pass. This uses the real controller stream adapter and GuidedRuntimeService with an in-memory persisted-state fixture plus deterministic loopback model, not a live HTTP server, browser, production database, or paid provider.

Coverage: mixed legacy batches retain eight validated sources and discard one invalid source; retry reuses admitted evidence. Empty surviving evidence still cannot be completed. Invalid output is never negative-cached; a later valid assessment can succeed. Strict helper rejection, cancellation, provider error, privacy-safe diagnostics and the complete research suite remain tested. Two controller cases exercise report continuation and regeneration through independent evidence/quality validation, ending in NDJSON completed with a formal report and completed timeline; no invalid-source ID enters downstream model input.

Commands: `pnpm --filter @repo/api exec vitest run --config vitest.research-unit.config.ts`; `pnpm --filter @repo/api typecheck`; `pnpm --filter @repo/api lint`; `./init.sh` quick health checks. Final results are attached alongside this receipt. No deployments or live-session mutations.

Final local results: 38 research test files / 867 tests PASS, API typecheck PASS, API lint PASS, init quick health PASS. Original-runtime controller RED: 2 failed as expected; fixed-runtime controller suite: 44 PASS.
