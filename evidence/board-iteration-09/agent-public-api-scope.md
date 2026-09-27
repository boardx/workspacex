# R9 Agent public API acceptance scope

Base: `cbd292404`. Worker prepares implementation and tests; only the main session executes real HTTP/PG acceptance. No new PR: this belongs to the existing R9 iteration.

| Capability | Existing path | Evidence at inspection | Work in this package |
|---|---|---|---|
| Create / Update / Move / Arrange / Connect / Delete | POST `/v1/whiteboards/:id/operations` with typed commands | Application/repository unit tests; not a complete live Agent journey | Real HTTP sequence with canonical Read after every operation, PG audit cross-check and rejection zero-write checks |
| Canonical Read | GET `/objects?actorId=...` | Actor/scope/delegator unit and contract checks | Real authorized/foreign/viewer/revoked assertions |
| Event subscription | GET `/events` cursor polling | In-memory ordering test only | Actor-bound polling, `(epoch,seq)` cursor across recovery, pagination/replay/denial evidence |
| Undo / Redo | New POST `/operations/:operationId/undo` | Service denial, ObjectStore integrity and real Worker compensation tests | Real HTTP per-operation Undo and Undo-of-Undo, canonical identity/content checks, comment binding restore |

Found event cursor defect: using only `afterSeq` skips events after checkpoint recovery increments epoch and resets sequence. The new cursor preserves `afterEpoch` and returns `nextEpoch`; clients retain the pair. The existing human event read remains available, while Agent subscribers pass `actorId` and require the same enabled delegation plus `board:read` scope as canonical Read.

The existing `board-ai-api.spec.ts` seeds a proposal directly. It proves proposal confirmation, not model-produced semantic clustering or complete Agent API parity. The producer in this package is explicitly API acceptance, not a real-model or visual score gate.

Generic operation Undo now uses a server-recorded immutable before-snapshot reference. It never accepts caller inverse commands. Fresh Board role/archive checks, original authenticated owner, enabled delegated actor and exact whole-Board revision CAS protect compensation. Intervening edits conflict rather than being overwritten. The Undo operation gets its own receipt and before-reference, so Undo-of-Undo provides Redo. Object IDs and comment bindings remain stable. Event delivery is cursor polling, not SSE/push. The main session must execute the new producer and retain its fresh evidence before marking the API lane passing.

## Root-only execution

Reuse an already running isolated fullstack API and its fullstack seed; do not run `e2e-up.sh` or use global PID files. Start that API with a fresh `WORKSPACEX_DEPLOYMENT_MARKER`, export the same value as `BOARD_API_RUNTIME_MARKER`, and keep its source checkout clean at `BOARD_ACCEPTANCE_SHA`. Load the existing isolated environment through the main session's protected environment loader; never echo PG or login secrets.

Additional variables: `BOARD_AGENT_API_ACCEPTANCE=1`, `BOARD_AGENT_API_ACCEPTANCE_RUN=1`, `BOARD_AGENT_API_EVIDENCE=/private/tmp/<new-evidence-file>.json`, `WORKSPACEX_ISOLATION_ID`, `PGHOST`, `PGPORT`, `PGDATABASE`, standard migration/app DB credentials, and `WORKSPACEX_API_PORT`. Run from the exact checkout root:

```sh
pnpm --filter api exec tsx scripts/verify-board-agent-api.ts
```

The producer uses official seeded identities and new uniquely named service actors/Board. It performs only real HTTP operations, reads canonical objects after mutations, cross-checks PG receipt/event counts, exercises recovery epoch pagination, and asserts rejected requests preserve both content and audit counts. It archives its Board and deletes only its own temporary actor rows. It writes evidence only after cleanup succeeds. `kind=board-agent-api` includes a second private Board for Create/Update/Move/Arrange/Connect/Parent/Delete receipt Undo and Redo, each compared with real canonical API snapshots. Separate Boards preserve the existing per-Board request quota. It makes no browser or model requests, but the worker has not executed even this HTTP/PG producer.


## Generic Undo storage and safety

Migration `20260927234000_whiteboard_operation_undo.sql` contains only immutable snapshot references, original authenticated owner, server-chosen Undo identity and comment status/revision metadata. Content remains in ObjectStore. Existing `whiteboard_asset_refs` roots retain those snapshots and participate in the current GC fencing mechanism. The resource-limited validator computes compensation from the trusted snapshot and preserves shared text/style identity; raw Yjs still rejects the same tombstone-removing delta. Comment body payloads are never duplicated or rebuilt; status restoration requires the archived revision and exactly one affected row.

The receipt CAS is intentionally whole-Board. It does not selectively undo through intervening Board writes; attempting that returns a conflict instead of discarding another user's work. History retention currently follows Board/root retention; this package does not introduce time-based pruning. Before this migration, operations have no generic Undo reference and return NOT_FOUND rather than inventing a before-image.

## Verification boundary

No worker Docker, PostgreSQL, browser or model execution took place. The main session must run migrations plus the HTTP producer before accepting this lane. A full API unit attempt was not all green: socket tests hit sandbox EPERM, `objects-read` mocks initially lacked `diff` (fixed using actual Y.Doc diff, all 13 then passed), and the existing worker burst test timed out. A dependency-link drift exposed external-checkout contracts in one capacity run; the local core dependency was relinked to this checkout before focused revalidation. These are not reported as successful dynamic acceptance. Permission lint also reports existing image-assets and organize-actor-directory boundaries; the new Undo adapter has a separate bounded exemption with mutation tests.

Final focused API verification: 69 tests passed across 10 files, including 3 real isolated Worker compensation checks; API `tsc --noEmit` exit 0. These are unit/static results, not the unexecuted HTTP/PG producer.
