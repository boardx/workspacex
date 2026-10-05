# #5366 question-bound private evidence ledger

Branch: codex/research-question-evidence-ledger. Base freshly fetched main 9ccdb5e27c752344ea89f58936f0daa15c23a3ac; existing session worktree reused.

Production scope: server-private exact fetched-document evidence records after existing quoteRef validation; question/full-confirmation identity, provenance/hash/span invalidation, duplicate-span budget discipline; persisted JSON schema and public positive-selection projection. No public schema expansion, embeddings, new connectors, whole-run 180/600-second deadline or full writer migration. ADR-122 is Proposed.

Actual validation (2026-10-05):
- Pure API: 20 files, 475 PASS, exit 0 (`vitest run --config vitest.research-unit.config.ts`).
- Isolated actual PostgreSQL runtime persistence: 49 PASS, exit 0 (`with-test-isolation -- pnpm --filter @repo/api exec vitest run tests/research/guided-runtime-persistence.test.ts`). Final pause/CAS recheck dedicated wsx_e28dc23802f1b669a69f (earlier wsx_605142967b4a91ad10cf); wrapper completed cleanup, peak six connections. Controlled model/search, not real-provider quality evidence.
- API typecheck, API lint, git diff check: exit 0.
- ./init.sh: exit 0, installed-tree quick health path; not full repository verification.
- New public boundary suite: 10 PASS. GET, ordinary execution, steering early returns, replay, controller full/fingerprint commands/SSE/progress; entire response bytes exclude private sentinel and future private property.
- New ledger suite: 25 PASS. Exact spans/hash, reordered/deleted questions, context-only gaps, source exclusion/document mismatch, URL/retrieval identity, chapter confirmation changes, legacy/mismatched documents, duplicate chunk deduplication.

Red evidence actually executed: initial public boundary 5 FAIL; provenance/fullscope 7 FAIL; repeated-span budget 1 FAIL; high-cardinality reconciliation hash-count 1 FAIL (33,024 full-body hashes versus expected 2). Corrections passed, rather than weakening the evidence validator or making the public runtime schema permissive.

Private machine logs: /private/tmp/research-5366-{boundary-red,provenance-red,repeat-red,root-pure,root-type,root-init,db,review-lint}.log. These paths supplement reproducible commands, do not claim portable repository attachments.

Limits: actual user session grs_4e804e5504fc4ca7bbcb28e54835daa8 backend delay/interruption remains UNKNOWN. Ledger sidecar does not yet switch the writer to reuse records (#5369); no overall ten-minute result, deploy or merge is asserted. Full bounded-loop acceptance remains #5365.

## Review correction: bounded reconciliation work

1511e51f8c426ddb4073b686ee1018eeaff21157 was rejected on P2 after a public synthetic real-helper experiment showed repeated full-ledger parsing and body hashes before identity rejection. Corrected pass parses once, buckets stable question identities and caches source material only within one synchronous call. The same 128-question/256-record/two-60k-body fixture asserts full-body hash computations 33,024 → 2, one ledger parse, and zero body hashes after basis invalidation; no flaky wall-clock assertion or cross-call cache. All span/provenance/source-policy/confirmed-question checks remain. Final full pure 452 PASS; API types/lint exit 0. Final real PG 49 PASS includes pause retained through a late persistence write and stale version rejection. Additional actual logs: /private/tmp/research-5366-{computation-red,computation-green,perf-full,perf-type,perf-lint,pause-db}.log.

## CI failures corrected

684b826175c39dc770e309b46b7c4a46e7fed919 CI failed on real gates, not infrastructure: backend z.object declarations violated contract-single-source; two old quote-reference fixtures omitted tasks. Private record/envelope schemas now live once in packages/contracts/src/research-private-evidence-ledger.ts with an explicit subpath API re-export, no public-operation registration or public-runtime-field expansion. Quote tests retain original evidence assertions with tasks:[]; both previously omitted suites are included in the pure research config. Focused actual 22 PASS, final full pure 20 files474 PASS; API/contracts types exit0. Logs: /private/tmp/research-5366-ci-fix-{focus,pure,api-type,contract-type}.log. Older SHA CI is not borrowed.

## Preserve concurrent remote corrections

Normal push of 310810ea065e2a4328d8d41088162845f34be15c was rejected because remote added 8a039d0acaecba1ad59c3f4d3b9646cd894479ec (selected quote occurrence offset) and 7f1da982f91940a87c99f6a36bdbdaab177cc4bf (private-contract schema and complete quote fixtures). Normal merge preserves both, selects richer remote fetched-document fixtures and only research-private-evidence-ledger schema, retaining local CI gate inclusion and documentation. No force push or writer identity inference. Post-merge actual pure 20 files475 PASS; selected occurrence ledger regression included. Private log /private/tmp/research-5366-merged-pure.log. Exact review and CI must apply to resulting merge head, not either previous SHA.
