# F04 backend Tasks 3–6 report

Date: 2026-08-15

Starting backend base: `e40a5fcbeb07e8658accfd48fc5c8c5620dbcdd5`

Branch: `worker/coord-user-research-04-f04-langgraph-persistence`

## Delivered

- Added the normalized F04 migration: revision, topic/expert/question versions, question rows,
  durable Skill threads/messages/proposals, and idempotency receipts. All business tables carry
  `org_id`, use composite tenant foreign keys, and have enabled + forced RLS.
- Installed the exact registry-resolved TypeScript packages
  `@langchain/langgraph@0.4.9`, `@langchain/langgraph-checkpoint-postgres@0.1.2`,
  `@langchain/core@0.3.80`, and `zod-to-json-schema@3.24.6`.
- Installed the package's exact PostgresSaver migration levels 0–4 in deployment SQL. Runtime uses
  `thread_id=interviewId`, `checkpoint_ns=digital-interview:v1`, schema
  `langgraph_interview`, and never calls `setup()` at application boot.
- Added the LangGraph state, three dynamic human-interrupt confirmation nodes, generation edges,
  Skill return-to-origin node, and one-effect-per-confirmation boundary.
- Added PostgreSQL effects with transaction-scoped request advisory locks, receipt-first replay,
  canonical payload digests, row locking/OCC, normalized business writes, one aggregate version,
  and durable response receipts.
- Added recovery for both process recreation and a crash after the business receipt commits but
  before the graph checkpoint advances.
- Added authorization before checkpoint operations, before the Skill model call, after the model
  response, and immediately before its business write. A midway revocation maps to
  `PERMISSION_REVOKED_MIDWAY` without persisting the assistant response.
- Bound one runtime/checkpointer provider in `KernelModule`, including pool shutdown through the
  Nest provider lifecycle.
- Exposed create, GET recovery, all three confirmations, Skill send/apply/reject, shared-Zod input
  parsing, and safe HTTP error translation.
- Expanded the authoritative HTTP gate through the complete confirmation flow, Skill apply/reject,
  restart recovery, aggregate-version assertions, and permission revocation without Skill writes.
- Repaired the two legacy application callers exposed by Task 2's corrected name/tags-only
  `DigitalInterviewDraftInput`: their separately required topic now parses through the canonical
  topic operation schema.

## Verification evidence

- `pnpm --filter api typecheck`: PASS, exit 0 (fresh run after all TypeScript changes).
- Pure graph gate, run with a temporary no-global-setup Vitest config so it did not touch a database:
  `pnpm --filter api exec vitest run tests/itv/digital-interview-graph.test.ts --config vitest.f04-graph.config.ts --pool=forks --maxWorkers=1 --minWorkers=1`:
  PASS, 1 file / 2 tests.
- `git diff --check`: PASS (no output).
- Isolated PostgreSQL command attempted once after implementation:

  ```text
  pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter api exec vitest run \
    tests/itv/digital-interview-graph.test.ts \
    tests/itv/digital-interview-workflow-migration.test.ts \
    tests/itv/digital-interview-langgraph-persistence.test.ts \
    tests/itv/digital-interview-setup.test.ts \
    tests/itv/digital-interview-controller.test.ts --pool=forks --maxWorkers=1 --minWorkers=1
  ```

  Admission refused before Docker/database creation: `load1=213.45`, `cores=10`,
  `perCore=21.35`, `running=0/2`, against the `2.5` per-core ceiling. After bounded retries the
  final observed value at 30 seconds was `perCore=19.40`; the command was stopped with exit 130.
  No shared database was used. Therefore the migration replay/migrate-check, persistence, and
  authoritative HTTP gates are **blocked by resource admission**, not claimed passing. The pure
  graph gate was executed independently and passed as recorded above.

## Known risks / review focus

- The database-backed gates could not execute under the machine admission ceiling. Migration SQL,
  PostgresSaver DDL compatibility, RLS/catalog assertions, graph checkpoint behavior, and full HTTP
  behavior still require one isolated run when admission opens.
- The corrected shared `DigitalInterviewWorkflowView` schema omits `scope`, while the authoritative
  Task 1 create/GET acceptance test requires scope recovery. The repository intentionally preserves
  `scope` on the runtime HTTP object without editing Task 2-owned contracts. The contract owner
  should reconcile this single-source mismatch.
- The global plan states that changing an already-confirmed upstream step creates a new revision and
  supersedes downstream versions. Tasks 3–6 provide the versioned schema, but the signed operation
  flow and current graph only accept the next pending confirmation; no re-confirm/edit acceptance
  route exists in Task 6. This behavior remains a product-contract gap rather than silently inventing
  an unreviewed checkpoint-reset API.
