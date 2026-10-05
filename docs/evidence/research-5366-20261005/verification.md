# #5366 question-bound private evidence ledger

Branch: codex/research-question-evidence-ledger. Base freshly fetched main 9ccdb5e27c752344ea89f58936f0daa15c23a3ac; existing session worktree reused.

Production scope: server-private exact fetched-document evidence records after existing quoteRef validation; question/full-confirmation identity, provenance/hash/span invalidation, duplicate-span budget discipline; persisted JSON schema and public positive-selection projection. No public schema expansion, embeddings, new connectors, whole-run 180/600-second deadline or full writer migration. ADR-122 is Proposed.

Actual validation (2026-10-05):
- Pure API: 18 files, 451 PASS, exit 0 (`vitest run --config vitest.research-unit.config.ts`).
- Isolated actual PostgreSQL runtime persistence: 49 PASS, exit 0 (`with-test-isolation -- pnpm --filter @repo/api exec vitest run tests/research/guided-runtime-persistence.test.ts`). Dedicated wsx_605142967b4a91ad10cf; wrapper completed cleanup, peak six connections. Controlled model/search, not real-provider quality evidence.
- API typecheck, API lint, git diff check: exit 0.
- ./init.sh: exit 0, installed-tree quick health path; not full repository verification.
- New public boundary suite: 10 PASS. GET, ordinary execution, steering early returns, replay, controller full/fingerprint commands/SSE/progress; entire response bytes exclude private sentinel and future private property.
- New ledger suite: 23 PASS. Exact spans/hash, reordered/deleted questions, context-only gaps, source exclusion/document mismatch, URL/retrieval identity, chapter confirmation changes, legacy/mismatched documents, duplicate chunk deduplication.

Red evidence actually executed: initial public boundary 5 FAIL; provenance/fullscope 7 FAIL; repeated-span budget 1 FAIL. Corrections passed, rather than weakening the evidence validator or making the public runtime schema permissive.

Private machine logs: /private/tmp/research-5366-{boundary-red,provenance-red,repeat-red,root-pure,root-type,root-init,db,review-lint}.log. These paths supplement reproducible commands, do not claim portable repository attachments.

Limits: actual user session grs_4e804e5504fc4ca7bbcb28e54835daa8 backend delay/interruption remains UNKNOWN. Ledger sidecar does not yet switch the writer to reuse records (#5369); no overall ten-minute result, deploy or merge is asserted. Full bounded-loop acceptance remains #5365.
