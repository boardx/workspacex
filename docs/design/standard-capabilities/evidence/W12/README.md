# W12 trusted memory identity component

Executed from the worktree root:

```bash
pnpm exec tsx packages/contracts/scripts/generate-standard-capabilities-schema.ts
pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter @repo/api exec vitest run tests/agent-runtime/deep-agent-resume-forwards-skills.test.ts tests/agent-runtime/attachment-notice-in-context.test.ts
pnpm --filter @repo/contracts exec vitest run tests/standard-capabilities.test.ts
git diff --check
```

All commands exit 0. API: 21/21 tests; contracts: 20/20 tests including generated-schema
freshness. Logs: `trusted-memory-api.txt`, `trusted-memory-contracts.txt`. The isolated
wrapper finished and cleaned its own stack (total four seconds, peak one connection).
The actual executeQueuedRuns invocation forwards the claimed requester. HTTP provider
capture proves fresh/resume scope transmission outside messages; absent/mismatched
org is refused before a run request, and text-only never projects the scope.

This is a component result only. No persistent memory consumer, source-message proof,
CAS revisions, write idempotency, deletion semantics or production Store integration
is claimed. No memory tables or Python dependency changes were made.
