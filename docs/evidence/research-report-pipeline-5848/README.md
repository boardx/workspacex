# Research report generation pipeline — #5848

Human approved the detailed design and Native execution on 2026-10-20. Issue: https://github.com/boardx/workspacex/issues/5848 . Worktree reused, branch worker/coord-deep-research-report-pipeline, base main 305c629c4.

## Result and scope

Real-document reports prepare the first remaining chapter separately, while all later chapters share a second evidence scope. The first chapter can write/review before tail evidence finishes; public prose and durable chapters retain confirmed outline order. All canonical eligible sources remain considered, prioritized by existing task links. Maximum two evidence scopes avoids multiplying source input by chapter count. Legacy excerpt-only sessions retain shared extraction semantics.

A report-wide queue caps evidence/prose/review/retry model requests at 4; concurrent scopes each extract at most 2 batches. Source reading retains existing concurrency3, timeout, eligibility and full preparation semantics. No source quota substitutes for question evidence or independent review.

Private complete-batch manifests reference existing verified ledger facts, including valid negative outcomes. Reuse binds exact request, question/brief/policy/material provenance, rule version and adapter configuration identity. Unknown identity disables reuse; identity lifetime may end on adapter restart. Positive ledger facts alone do not prove complete extraction. Exact manifest-backed repeated quote spans survive final ranking dedup, within the ledger limit. Invalid, interrupted and rejected batches are never marked complete.

Private diagnostics record source preparation/model stage durations, first real provider prose (not its JSON envelope), first newly approved chapter and report validation. They contain counts and character sizes, no prompts, source bodies or credentials. First provider prose may precede the existing stream flush by up to250ms; this is not browser paint telemetry. UI shows actual readable source count, current chapter and elapsed time from this execution's persisted activity, without estimated completion time.

## Validation

- Full research suite: **40 files / 909 tests PASS**; baseline before changes889 PASS.
- UI: **2 files / 35 tests PASS**.
- Real local Chromium: desktop1280/mobile375, **2 tests PASS**, approved prose and progress survive reload; routed runtime fixture, not database/model acceptance.
- Full API and Web TypeScript PASS; API lint and affected Web ESLint PASS; spec-to-CI coverage PASS; init.sh fast health PASS (not full-repository validation).
- Independent review finding fixed and re-reviewed; see review.md.
- Screenshots visually checked, mobile detail layout improved; own port3286 server exited, no Docker/DB created.

Commands (run from repository root):

```sh
pnpm --filter @repo/api exec vitest run --config vitest.research-unit.config.ts
pnpm --filter @repo/api typecheck
pnpm --filter @repo/api lint
pnpm --filter web exec tsc --noEmit
pnpm --filter web exec vitest run tests/ui/guided-research-execution-timeline.test.tsx tests/ui/guided-research-report-timeline.test.tsx
CI=1 WORKSPACEX_WEB_PORT=3286 pnpm --filter web exec playwright test --config playwright.prototype-audit.config.ts --grep 'report pipeline progress'
node .harness/scripts/lint-spec-gate-coverage.mjs
./init.sh
pnpm --filter @repo/api exec tsx scripts/benchmark-research-report-pipeline.ts
```

## Controlled timing and cost

See controlled-benchmark.json. This compares the old305c629c4 scheduler and new scheduler using current identical validators, fixed3-chapter inputs and deterministic model responses. Model delay is simulated, not real inference. Three chapters pass the schema and fixed reviewer response; that does not establish real semantic report quality.

| Metric | Old scheduler | New cold | Matching evidence |
| --- | ---: | ---: | ---: |
| First provider prose |485ms|71ms|24ms|
| First approved chapter |527ms|87ms|42ms|
| Total generation |575ms|380ms|94ms|
| Model calls |8|9|7|
| Evidence calls |1|2|0|
| Input characters |43884|46145|41437|

Cold costs one extra evidence scope, about5% extra input characters in this fixture; actual overhead depends on source length and chapter questions. No token estimate is presented as metered usage. Benchmark times are a single controlled observation, not a production SLA.

## Limits and handoff

No legitimately configured real-model keys or approved .env.local were available; no real-model/live-devapp timing or production deployment is claimed. Screenshot session grs_376014878c404d289522371c116e0d32 was not modified. Source reading remains globally prepared and can still dominate cold latency; new metrics identify it separately. Quality gates, question coverage, citation validation, prior formal report preservation and source exclusion behavior remain enforced by tests. Actual production timing/quality must be checked after authorized deployment with genuine model configuration.

Final dynamic CI/PR state belongs to GitHub, not this static report. No merge or feature passing status is claimed here.

## CI-only baseline fixture repair

verify-affected on4bd090a75 passed8224 Web tests but failed one unchanged survey publishing test: the active-collection fixture expiresAt was fixed to2026-10-20T10:00:00Z, already past the14:44Z CI run. The same isolated test failed locally, and git diff from305c629c4 and current origin/main confirmed the survey test was unchanged. The fixture now expires24hours after the test clock; all21 survey publishing tests pass. No survey production code, expiration behavior, assertion or retry threshold was changed. This minimal test-clock repair is necessary for the required all-green PR gate; see survey-expired-fixture-red/green.txt.
