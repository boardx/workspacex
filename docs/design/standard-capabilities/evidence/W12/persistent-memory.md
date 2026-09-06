# W12 persistent personal memory integration

Implementation uses exact `langmem==0.0.30` and existing
`langgraph-checkpoint-postgres==3.1.2`. LangMem brings only `dydantic==0.0.8`
and `trustcall==0.0.39`; the resolved lock contains 118 packages. Official
`create_manage_memory_tool`/`create_search_memory_tool` remain the CRUD/search
implementation. WorkspaceX adds trusted scope, current source authorization,
revision/receipt checks and bounded literal result filtering.

## Entrances and authorization

`standard_memory.standard_memory_tools()` supplies `wx_memory_search`,
`wx_memory_write`, `wx_memory_delete`. The actual ToolRuntime call ID and trusted
`run_control_callback`/`wsx_memory_scope` supply context; model arguments contain
neither user/org identity nor namespace. `PgStandardMemoryProof` calls the existing
ToolExecutionAuthority, then binds the claimed run's human input author to the
requested user. Write source must be that run's actual input message. Every search
rechecks source references with existing `getThread`/`resolveVisibility`, including
current organization membership and personal/project visibility.

Write/delete require existing HITL permission. Source validation is not a language
classifier pretending to prove the user said “remember”; explicit tool approval is
the mutation authorization. Search advertises `mode: literal`, with no embeddings
or semantic-search claim. These tools do not inject all stored memories into model
prompts. Consumers must call search, and revoked sources are omitted before the
new ToolMessage is returned.

## Persistence and transaction boundary

Each operation owns one psycopg AsyncConnection and outer transaction. A namespace-scoped
Postgres advisory transaction lock precedes official Store operations. The same
connection is passed to official `AsyncPostgresStore`; its pipeline does not commit the outer
transaction. The whole database operation has a 15-second deadline, and a process-wide
nonblocking 16-operation admission bound. Sync tool calls use asyncio.run of the same
async implementation; no database work runs in an orphan to_thread worker. Cancellation
uses psycopg async cancellation and awaits transaction/connection cleanup. A commit
that already won the cancellation race is not claimed undone: uncertain outcomes remain
non-retryable automatically and explicit replay uses the receipt. A regression throws after official create/update but before receipt
write and verifies no record persisted. Concurrent revision updates yield one winner.

Items, idempotency receipts and delete tombstones use distinct private namespaces
inside the official Store tables, not a second memory table. Receipt capacity is
256 per user/org scope; exhausted capacity explicitly refuses new write keys rather
than deleting receipts and allowing old requests to repeat. Delete keeps only an
ID/revision tombstone; content is removed by official LangMem delete. Repeated
same-revision deletion succeeds; an old/conflicting revision fails.

## Deployment

Do not pass this Store to a public LangGraph Store API or expose namespace-selecting
endpoints. Model code and sandbox containers receive no memory database credentials.
Configure `MEMORY_STORE_DATABASE_URL` to a dedicated runtime role restricted to
the configured `MEMORY_STORE_SCHEMA` (default `workspacex_memory`), with only schema
USAGE and Store-table SELECT/INSERT/UPDATE/DELETE. It must not own tables, have DDL,
or have access to application tables. Use a separately held
`MEMORY_STORE_MIGRATION_DATABASE_URL` only in an explicit deployment bootstrap:

```bash
python -c 'from deep_agent_service.standard_memory import setup_memory_store; setup_memory_store()'
```

The bootstrap uses official Store.setup migrations. Provision runtime grants through
the deployment's database role management after setup, then remove the migration
credential from the serving process. No external production database was provisioned
by this task. Missing DSN/schema/tables fails unavailable; there is no InMemory fallback.

## Evidence boundary

`tests/agent-runtime/standard-memory-real-db.test.ts` exercises actual Python
ToolNode sync/async calls through Nest HTTP source proof and the isolated PostgreSQL
Store. It covers process restart, another thread/run for the same user, changed
organization membership, changed private-thread ownership, real call context,
forged source, cross-user/org and stale lease. The nested Python tests cover
concurrent CAS, lost-response replay, double delete, rollback and namespace separation.
Real pg_sleep cancellation and total-deadline tests verify rollback after an official
write but before receipt commit; a pg_stat_activity-confirmed advisory Lock wait is
cancelled and its connection closes before unlocking the blocker. No later write appears.
The component Store tests use a dedicated non-owner role with only schema/table DML
grants; the serving role is separate from bootstrap credentials.

Production factory/DI registration now passed actual createApp DI resolution with the real PgStandardMemoryProof and controller. The 3-test database suite plus 5 native invocation tests passed; the latter verifies search is L0 while writes/deletes require approval. Nested Python tests remain real PostgreSQL operations. These tests do not claim deployed availability or real-model acceptance.

## Commands and recorded output

```bash
pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter @repo/api exec vitest run tests/agent-runtime/standard-memory-real-db.test.ts
node --test apps/api/scripts/tests/memory-proof-boundary.test.mjs
node --import tsx packages/contracts/scripts/generate-standard-memory-schema.ts --check
pnpm --filter @repo/contracts exec vitest run src/standard-memory.test.ts
```

Recorded final DB run: 3 API tests plus 5 native invocation tests passed, nested Python 7 tests passed. Production-DI assertion passed. Boundary: 12 tests passed; contracts: 1 passed; generated
schema freshness passed. `lint-permission-paths` proved this reader with no allowlist
increase (201 tables, 91 allowlisted); later shared-worktree check reports only the
peer's in-progress pg-native-run-inputs reader, outside W12. API typecheck similarly
reported only peer context-tool/attachment-input fixture changes, no W12 failures.
