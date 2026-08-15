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

## Final-review fix round

- Made `DigitalInterviewWorkflowView` the strict browser/recovery source of truth for scope,
  visible expert candidates, generated question candidates, and Skill draft context. Controller
  success bodies now parse through the corresponding shared operation output schemas.
- Replaced both no-op generation nodes with durable effects. Topic confirmation snapshots the real
  visible formal expert catalog; expert confirmation creates three stable-ID default questions per
  newly selected expert. Expert reconfirmation retains confirmed questions for still-selected
  experts, generates defaults only for new experts, and leaves removed experts/questions in the
  superseded revision history.
- Scoped all existing-aggregate receipts and advisory locks by interview while retaining the signed
  org-level create replay key. Added the two-interview/same-request counterexample.
- Added upstream reconfirmation through the installed LangGraph `Command` API, revision branching,
  downstream invalidation, immutable superseded history, proposal staling, and crash recovery when
  the confirmation receipt committed before its generation node.
- Skill prompts now include confirmed scope/workflow, persistent conversation history, and the
  step-matched page draft. Provider patches are strict step-specific schemas. Only an applied patch
  equal to the confirmed payload is committed; other pending/applied proposals become stale.
- Moved the final current-actor visibility/membership decision into the mutation transaction and
  pass the current collaborator into each graph resume. A controlled pre-write revocation test and
  collaborator attribution assertion cover the race.

## Verification evidence

- `pnpm --filter @repo/contracts typecheck`: PASS, exit 0.
- `pnpm --filter @repo/contracts test -- digital-interview-contract.test.ts`: PASS, 13/13.
- `pnpm --filter api typecheck`: PASS, exit 0 (fresh sequential run after all fix-round changes).
- Pure graph gate, run with a temporary no-global-setup Vitest config so it did not touch a database:
  `pnpm --filter api exec vitest run tests/itv/digital-interview-graph.test.ts --config vitest.f04-graph.config.ts --pool=forks --maxWorkers=1 --minWorkers=1`:
  PASS, 1 file / 4 tests, including completed-checkpoint upstream reconfirmation, current-actor
  propagation, and namespace isolation. The temporary config was removed after the run.
- `git diff --check`: PASS (no output).

## Known risks / review focus

- Question generation is intentionally deterministic from the signed three-question template and
  the persisted visible expert snapshot; it does not claim model-produced evidence. Candidate
  material boundaries remain explicitly exploratory.

## Post-review PostgreSQL fix round (`a537680b` base)

- Replaced the NUL-delimited advisory-lock input with a canonical SHA-256 digest. PostgreSQL now
  receives a safe text key while preserving the full org/interview/operation/request identity.
- Added a fixed-namespace saver adapter because LangGraph 0.4.9 reserves non-empty root namespaces
  for subgraphs and clears them before saver calls. Runtime configs keep `thread_id=interviewId`;
  the adapter durably maps every get/list/put/write to `checkpoint_ns=digital-interview:v1`.
  A shared-MemorySaver regression proves the same thread ID is isolated across two namespaces.
- Extended the formal expert catalog and browser contract with the immutable Agent definition ID,
  published Agent version ID, and structured Context Pack/material version pointers. Candidate and
  confirmed snapshot tables persist the complete expert projection with org-first composite FKs.
- Recovery now handles both receipt/checkpoint crash windows: confirmation committed before its
  checkpoint and generation committed before its checkpoint. Receipt replay advances the stale
  interrupt instead of returning a business response while leaving the graph behind.
- Upstream reconfirmation now forks from the durable routing checkpoint with `updateState`; this
  supersedes the paused downstream interrupt instead of scheduling two confirmation tasks beside
  each other.
- Made the authoritative HTTP restart gate bind its replacement application before closing the old
  listener and derive the base URL from the exact returned server, eliminating port-handoff races.

## Post-review final verification

- `pnpm --filter @repo/contracts typecheck`: PASS, exit 0.
- `pnpm --filter @repo/contracts exec vitest run tests/digital-interview-contract.test.ts`:
  PASS, 13/13.
- `pnpm --filter @repo/api typecheck`: PASS, exit 0.
- Focused pure graph gate: PASS, 4/4, including same-thread/different-namespace isolation and
  upstream reconfirmation from a completed checkpoint.
- Exact isolated PostgreSQL command requested by review:

  ```text
  pnpm exec tsx .harness/scripts/with-test-isolation.ts -- \
    pnpm --filter @repo/api exec vitest run \
    tests/itv/digital-interview-workflow-migration.test.ts \
    tests/itv/digital-interview-langgraph-persistence.test.ts \
    tests/itv/digital-interview-setup.test.ts \
    tests/itv/digital-interview-controller.test.ts \
    --pool=forks --maxWorkers=1 --minWorkers=1
  ```

  PASS, 4 files / 22 tests, exit 0. Isolated DB
  `wsx_c404abff9be09a6cfafd`; peak connections 13.
- Isolated `migrate:check`: PASS, exit 0. All 122 migrations applied from empty, every migration
  force-replayed, and the before/after schema digests were identical.
- The suite emits an upstream `pg` deprecation warning about concurrent `client.query()` calls.
  It does not fail the gate, but should be removed before upgrading to pg 9.
