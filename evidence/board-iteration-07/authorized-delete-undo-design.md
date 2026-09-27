# Same-ID delete Undo: authenticated server compensation

Status: base implementation and unit counterproofs complete; PostgreSQL/browser acceptance not run by worker.
Base: R7 `6e6cc8dd52b0e65fcf1535ec5355d1b89a2f9f69`. Root explicitly requires original object IDs, comment bindings, and external Agent references to survive Undo. Clone/new-ID recovery is rejected for this task.

## Proven failure

`WhiteboardUndo.undoStructural` executes `restore` and clears `deletedObjects[id]` locally. `prepareWhiteboardUpdate` correctly rejects any client deletion of an authoritative tombstone (`TOMBSTONE_CHANGED`). FIFO offline delete → Undo therefore accepts delete, rejects Undo, and blocks the provider before Undo ACK. Existing create → Undo → Redo coverage passes because that direction recreates objects. A dedicated test now exercises a Panel, child, cascading Connector and external endpoint: local Undo restores original IDs, the server rejects the raw update and its state remains byte-identical. This security rejection must remain after the fix.

## Required trust boundary

Add a **typed deletion-undo intent**, not an exception to raw Yjs validation. Inputs identify a prior actor-bound delete receipt; they do not supply restored content or arbitrary object IDs. The server restores only the receipt's exact deleted subgraph, with original IDs and authoritative hidden content. Server-origin diff remains trusted by peers. Do not expose unrestricted restore through a new transport message.

1. During a validated deletion commit, derive the actual live-before/deleted-after IDs, including cascading connectors. Persist a receipt in the same board transaction: org, board, epoch, principal actor, original update/gesture IDs, deletion revision, each object digest and resulting tombstone identity, and prior comment-thread statuses/revisions. No object text/content is duplicated into receipt metadata. The existing retained tombstoned objects supply authoritative content; stored digests are the before-image integrity proof.
2. A restore intent carries its own immutable update ID and Undo gesture ID plus the original delete gesture/update reference and epoch. Validate fresh board role/archive/access, ownership of the delete receipt, same epoch, unconsumed receipt, exact tombstone identities and hidden-object digests. Reject foreign/replayed-conflicting/missing receipts, changed objects, stale epoch, missing external parent/connector dependencies, and incompatible comments without mutation.
3. Under the same board/document lock, preflight the whole restore batch with the existing command validator, then atomically clear only those authorized tombstones, update document revision, mark receipt consumed, persist Undo idempotency receipt and audit event, and restore comment statuses only if their deletion revisions still match. Replies/content are never overwritten. Duplicate identical Undo intent returns the original receipt; another intent cannot consume it twice.
4. Broadcast only the server-produced Yjs diff and ACK the exact Undo gesture. The raw client update validator remains unchanged; submitting the same clearing delta through ordinary `update` must still fail.

## Offline and client ordering

- Local Undo keeps immediate original-ID feedback. Mark its transaction origin as a typed restoration intent referencing the captured delete gesture. Provider intercepts that origin and must not enqueue its tombstone-clearing delta as an ordinary update.
- Encrypted outbox stores the typed intent with immutable IDs and original delete reference. Reconnect reauthorizes normally; send the restore intent only after the matching delete is durably ACKed, preserving causal ordering. Persist enough acknowledged delete-receipt identity to survive tab reload/crash before restoration is sent. Do not rewrite an old revoked generation.
- Intents share existing bounded pending limits and exact ACK correlation. Denial blocks access and preserves the draft/error semantics; no success notice before server ACK. Peers receive the trusted server diff. Provider must not interpret the local staged clear as new permission to send arbitrary tombstone changes.
- Redo is a new ordinary validated delete gesture and produces its own receipt; subsequent Undo references that receipt. Restore-of-create-Undo and mixed structural/layout manager transactions require explicit handling or a clear unsupported conflict, never silently shipping forbidden raw deltas.

## R9 compatibility

R9 already exposes server command execution and `proposal-service.inverse(delete) -> restore`, with role/CAS/audit around proposal Undo. R7 does not yet include that operation service. Reuse the core `restore` command and the board transaction/durability boundary, not a fake R9 endpoint. The new human delete receipt should become the proof used by a later shared operation adapter. R9 proposal Undo retains its existing server-issued proposal receipt and before-object/CAS proof; these are distinct proof types for the same trusted server compensation. Neither should relax raw Yjs permissions. Include comment-restoration behavior when integrating R9 so IDs alone do not masquerade as complete semantic recovery.

## Required verification

- Existing malicious tombstone removal/replacement tests remain green.
- Actual validator FIFO delete and denied raw Undo counterproof (included).
- Server receipt ownership, revoked roles, wrong epoch/gesture, changed hidden text/geometry, duplicate request mismatch and missing dependency: zero writes.
- Atomic Panel+children+Connector original-ID restoration with unchanged external endpoint; comment bindings/status and external references preserved.
- Delete ACK → restore intent sequencing, encrypted reload recovery, revoke/rebind interleaving, duplicate ACK and duplicate intent across reconnect.
- Root-only browser: original failing offline delete/Undo scenario retains its original IDs, waits for exact server Undo ACK, reloads and verifies target/edge, then recovery/checkpoint flow. No weakening to existence-only or changed IDs.

## Implemented candidate and remaining boundary

The base candidate implements typed `restore-deletion`, an actor/epoch/delete-gesture receipt, worker-verified retained-object SHA-256 and tombstone Yjs identity, atomic comment revision checking/restoration, idempotent server ACK/audit, and encrypted FIFO intent replay. IndexedDB stores a monotonically allocated sequence in the same transaction as each encrypted entry, including same-millisecond writes and generation rebind. No content body is duplicated in receipt metadata. Ordinary Yjs tombstone removal remains rejected.

Core unit suite: 127 passed, plus the expanded seven-test Undo conflict suite (mixed transaction rejection and repeat delete/Undo/Redo receipts). Web provider/outbox suites: 40 passed. API restore suite: 12 passed including hidden-object/dependency counterproofs; repository guard five passed in the same final run. Repository guard: five tests, strict table/actor/lock/proof mutation counterexamples. Web full TypeScript check passed; API full TypeScript check was still running at candidate handoff. A concurrent full-core run temporarily exhausted the worker's unchanged production deadline; isolated worker rerun passed. This is not a claim of real PostgreSQL or browser acceptance.

**Open implementation work:** mixed delete + field-change history entries currently fail closed before local mutation and preserve the history, because an untyped Yjs inverse cannot clear authoritative tombstones. Root explicitly requires completing typed atomic restoration plus field inverses/CAS in the follow-up; this temporary boundary is not a completed PRD capability. Base candidate is handed off first so root can run the original failing pure-delete/Undo E2E. R9 proposal Undo uses its existing server proof and still needs integrated comments recovery verification. Migration and SQL rollback/permissions must be executed by the main session against isolated PostgreSQL.
