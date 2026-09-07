# Shared trusted run authorization extraction

`withAuthorizedStandardToolRun` moves the existing memory proof's current run,
requester and current-thread visibility checks into one helper for memory and SQL
source selection. It returns bounded identity facts to an internal callback, not a
reusable authorization token or a promise that future remote work cannot be cancelled.
It reuses ToolExecutionAuthority and resolveVisibility; no new permission policy,
extra lock, permission allowlist entry or second facts query was introduced.

Commands:

```bash
pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter @repo/api exec vitest run tests/agent-runtime/standard-memory-real-db.test.ts tests/agent-runtime/standard-sql-database.test.ts
node --test apps/api/scripts/tests/memory-proof-boundary.test.mjs apps/api/scripts/tests/standard-tool-run-boundary.test.mjs
node apps/api/scripts/lint-permission-paths.mjs
```

The combined dynamic run preserves its red SQL probe evidence: memory passed all 3
tests, SQL initially failed its async cursor integration. This extraction does not
claim that first SQL probe passed. Memory includes actual HTTP/PG/current membership
revocation and production DI; nested Python memory tests remain green. Structural
checks pass 19 positive/mutation tests. Permission lint passes with 201 tenant tables
and 91 allowlisted paths, unchanged. The wrapper cleaned its disposable stack.
