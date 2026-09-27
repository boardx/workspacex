# R9 Agent public API acceptance scope

Base: `cbd292404`. Worker prepares implementation and tests; only the main session executes real HTTP/PG acceptance. No new PR: this belongs to the existing R9 iteration.

| Capability | Existing path | Evidence at inspection | Work in this package |
|---|---|---|---|
| Create / Update / Move / Arrange / Connect / Delete | POST `/v1/whiteboards/:id/operations` with typed commands | Application/repository unit tests; not a complete live Agent journey | Real HTTP sequence with canonical Read after every operation, PG audit cross-check and rejection zero-write checks |
| Canonical Read | GET `/objects?actorId=...` | Actor/scope/delegator unit and contract checks | Real authorized/foreign/viewer/revoked assertions |
| Event subscription | GET `/events` cursor polling | In-memory ordering test only | Actor-bound polling, `(epoch,seq)` cursor across recovery, pagination/replay/denial evidence |
| Undo | AI proposal confirm returns receipt; POST `/ai-proposals/:id/undo` | Proposal unit tests; no generic operation Undo endpoint | Verify actual proposal batch Undo without claiming model generation or generic operation-history Undo |

Found event cursor defect: using only `afterSeq` skips events after checkpoint recovery increments epoch and resets sequence. The new cursor preserves `afterEpoch` and returns `nextEpoch`; clients retain the pair. The existing human event read remains available, while Agent subscribers pass `actorId` and require the same enabled delegation plus `board:read` scope as canonical Read.

The existing `board-ai-api.spec.ts` seeds a proposal directly. It proves proposal confirmation, not model-produced semantic clustering or complete Agent API parity. The producer in this package is explicitly API acceptance, not a real-model or visual score gate.

Remaining boundary: generic operation receipt Undo is not currently exposed. Sending caller-built inverse commands cannot be reported as that missing capability. AI proposal Undo is the currently implemented server-proof surface. Event delivery is cursor polling, not SSE/push. The main session must execute the new producer and retain its fresh evidence before marking the API lane passing.

## Root-only execution (first candidate)

Reuse an already running isolated fullstack API and its fullstack seed; do not run `e2e-up.sh` or use global PID files. Start that API with a fresh `WORKSPACEX_DEPLOYMENT_MARKER`, export the same value as `BOARD_API_RUNTIME_MARKER`, and keep its source checkout clean at `BOARD_ACCEPTANCE_SHA`. Load the existing isolated environment through the main session's protected environment loader; never echo PG or login secrets.

Additional variables: `BOARD_AGENT_API_ACCEPTANCE=1`, `BOARD_AGENT_API_ACCEPTANCE_RUN=1`, `BOARD_AGENT_API_EVIDENCE=/private/tmp/<new-evidence-file>.json`, `WORKSPACEX_ISOLATION_ID`, `PGHOST`, `PGPORT`, `PGDATABASE`, standard migration/app DB credentials, and `WORKSPACEX_API_PORT`. Run from the exact checkout root:

```sh
pnpm --filter api exec tsx scripts/verify-board-agent-api.ts
```

The producer uses official seeded identities and new uniquely named service actors/Board. It performs only real HTTP operations, reads canonical objects after mutations, cross-checks PG receipt/event counts, exercises recovery epoch pagination, and asserts rejected requests preserve both content and audit counts. It archives its Board and deletes only its own temporary actor rows. It writes evidence only after cleanup succeeds. `kind=board-agent-api-basic` deliberately excludes generic receipt Undo until the follow-up is implemented; it cannot satisfy the complete Agent lane by itself. It makes no browser or model requests, but the worker has not executed even this HTTP/PG producer.
