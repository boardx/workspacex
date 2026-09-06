# WX-E005 first increment evidence

Scope: complete MCP discovery schemas and descriptions, PostgreSQL persistence, canonical
fingerprints and reauthorization after change. No MCP execution bridge is implemented
by this increment; legacy inputSchema absence remains absent and is not executable proof.

## Dynamic verification

Executed from the worktree root:

```bash
pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter @repo/api exec vitest run tests/mcp/complete-tool-schema.test.ts tests/mcp/complete-tool-schema-real-db.test.ts tests/mcp/http-mcp-gateway-real-protocol.test.ts tests/mcp/pg-mcp-server-persistence-real-db.test.ts tests/kernel/mcp-tool-discovery.test.ts tests/mcp/tool-scope-cap-recheck-on-side-effect-change.test.ts
```

Final result: exit 0; **6 files, 38 tests passed**. Raw output: `schema-tests.txt`.
The wrapper provisioned and cleaned its own PostgreSQL/Redis stack; total 32 seconds,
including one second cleanup, with peak three database connections.

Coverage includes same-name type and nested constraint changes; output-schema and
description changes; recursive object-key reorder stability; closing changed tool
scope to 未开放; legacy field absence and upgrade; real SDK HTTP tools/list schema
retention; actual PostgreSQL JSON roundtrip and tenant isolation; existing discovery,
server persistence and side-effect cap regression cases. No mocked database is used
for the roundtrip assertion.

Initial invocation: 36/38 passed (`schema-tests-initial.txt`). Two existing discovery
expectations described the former intermediate side-effect cap rather than the new
final 未开放 scope. The implementation now records the final applied scope and the
regression expectations reflect it. The complete six-file set then passed on rerun.

`git diff --check` passed. This bounded evidence does not claim full-repository
compilation, all MCP runtime execution, credential decryption or completed E005.
The temporary four-line contract-size exception and required extraction deadline are
recorded in `../../mcp-execution-delta.md`.

Migration replay fix: nullable MCP schema columns now use ADD COLUMN IF NOT EXISTS.
The actual full empty-build + forced replay check passed; shared raw log and detailed
RLS-preservation evidence are in `../WX-T042/migrations-replay.txt` and that README.
