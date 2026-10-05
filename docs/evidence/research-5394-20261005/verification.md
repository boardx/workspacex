# Supplemental query task attribution (#5394)

Controlled real pipeline RED: sibling-B supplemental material was screened under task-A/question0 and correctly rejected by the strict relevance gate; the same material under task-B/question1 passed. This demonstrates a query attribution defect, not the cause of the original online 44-minute incident.

Derived question queries now carry their corresponding current section/question task. Complete objective equality proves the saved question; missing, stale or ambiguous bindings are skipped. Questions exceeding the contract objective capacity cannot be proven from a truncated prefix, so derived supplements are skipped. Legacy chapter tasks retain their existing chapter-wide scope. General section queries use an eligible section task. Per-task durable attempt deduplication, limits, primary status and failure/report gates remain intact.

Historical controlled artifacts are checked in byte-for-byte under [retained/](retained/), with sizes and SHA-256 hashes in [sha256.json](retained/sha256.json). They include the original synthetic counterexample source/output, six-failure RED log, and final 469-test/typecheck/lint logs. These are historical owner-run records; their absolute workstation paths are not portable commands. The counterexample is retained for inspection, while the maintained regression is `apps/api/tests/research/guided-supplement-task-scope.test.ts` (12-case matrix). The zero-byte historical typecheck log records silent output, not an independent proof of exit status.

Reproduce the maintained matrix and full pure suite from a fresh initialized checkout:

```sh
pnpm --filter api exec vitest run --config vitest.research-unit.config.ts guided-supplement-task-scope
pnpm --filter api exec vitest run --config vitest.research-unit.config.ts
pnpm --filter api exec tsc --noEmit
pnpm --filter api lint
git diff --check
```

Current-head rerun output is retained as `retained/current-validation.log`; its explicit exit codes distinguish successful silent commands from missing output. All original assertions and production scope/caps remain unchanged.

Fresh main baseline f2f688b98a80b6e01465c6c27a653dcff39becd0. Independent of negative cache PR #5392. No actual-session retry, real model, deployment, online latency or completed report acceptance is claimed. Original five failed-task underlying causes remain unknown.

## CI follow-up: report snapshot precision

Run 37314375134 shard 2 failed the existing native receipt count assertion (2 instead of 3). PostgreSQL snapshot time was converted through JavaScript Date, truncating microseconds and potentially excluding a receipt committed in the same millisecond. The new isolated PostgreSQL regression reproduced exact `.123456Z` becoming `.123Z` (1 failed, 11 passed); preserving the database timestamp/clamp in SQL produced 12 passed, including original count, native provenance, late-receipt and tenant isolation assertions. API typecheck/lint exit 0; independent review accepted the two-file fix. RED/GREEN logs are retained and hashed. Reproduce with `pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter api exec vitest run tests/auth/ai-usage-repository.test.ts`. No report counters or assertions were relaxed.
