# Interview report finite claim boundaries — #5332

## Scope and evidence

Refs #5327. This completes only the finite local syntax gate, not overall report semantic acceptance. No new model requests, browser claims, deployment or private incident diagnosis.

The unmodified public synthetic failing output and server source snapshot are in `apps/api/tests/itv/fixtures/claim-boundaries-5332/`. They contain invented coffee procurement evidence. The original report SHA256 is `53a1b1aba3295a8bb37c19c3117b6c9f8871a7b28000f724908a17db058726f4`.

The gate rejects three observed patterns: executed incompatibility counts without an exact bound source supporting the object/value/execution, unqualified installation/product defect exclusions, and whole site/physical check exemptions. Exact quotations alone remain source data, not narrator assertions. An unrelated valid quotation does not support a count. Negation, local future conditions, examples, plans, numeric formats, table rows, duplicate citations and excluded code are covered.

This is a finite Chinese syntax boundary. It cannot prove matching time/site/cause, arbitrary paraphrases, or general truth. Passing this gate is not semantic approval. Structural analysis and exact grounding remain separate required checks. Default grounding table-cell scope stays unchanged; quality checks may group table rows.

## Validation

- Stub baseline: 16 failing / 25 passing boundary tests (`red.txt`); the real synthetic report expected all three missing categories.
- Follow-up scope counterexamples: 5 failing / 41 passing (`scope-red.txt`), repaired without relaxing source grounding.
- API full controlled Markdown/model/controller test suite: 124 passed (`green.txt`); run `pnpm --filter @repo/api test:interview-markdown-unit`.
- Contracts: `pnpm --filter @repo/contracts exec vitest run tests/interview-markdown.test.ts tests/interview-evidence-single-source.test.ts` — 39 passed.
- API and contracts `typecheck`; API `lint` passed.
- Saved invalid report with no configured model returns the existing quality reason, performs zero model calls/writes and retains failed status/bytes/version. Generated reports retain failed bytes/hash, stop after two attempts; saved repair makes at most one call and can pass with bounded concrete recommendations. Existing CAS, source-version and permission regressions remain tested.
- Safe diagnostics contain only fixed claim-category enums, not report/source text. No new public rejection enum.
- Local gate benchmark on the 3,481-character retained report: 200 measured iterations after 10 warmups, zero model calls; initial median 1.41ms / p95 1.96ms (`benchmark.json`). This is local validation overhead, not end-to-end generation latency.

Original private report rejection reason and deployed SHA remain UNKNOWN. The previous real synthetic output was mechanically accepted but independently failed semantic review; this change rejects its three finite counterexamples. A new real semantic trial is not run or claimed.
