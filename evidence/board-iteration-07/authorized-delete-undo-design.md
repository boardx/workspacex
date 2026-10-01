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

## Implemented candidate and verification boundary

The implementation adds typed `restore-deletion`, an actor/epoch/delete-gesture receipt, worker-verified retained-object SHA-256 and tombstone Yjs identity, atomic comment revision checking/restoration, idempotent server ACK/audit, and encrypted FIFO intent replay. IndexedDB allocates monotonically increasing sequence numbers in the same transaction as encrypted entries, including same-millisecond writes and generation rebind. No content body is duplicated in receipt metadata. Ordinary Yjs tombstone removal remains rejected.

Mixed transactions store only per-object before/after digests alongside deletion proofs. The worker checks the current after-state, clears only receipt-proven tombstones, validates the supplied inverse delta through the unchanged ordinary update validator, then requires exact before-state digests and no unrelated live/hidden object changes. Core compound compensation retains existing Y.Map/Y.Text identities and tombstones newly created objects rather than removing shared object records. Undo and Redo each generate a new gesture receipt, so repeated mixed delete/text/parent/create operations stay atomic and original-ID safe. Remote field changes, extra inverse writes and omitted required inverses are rejected.

A peer review found and fixed the initial base candidate's restart flaw: replaying all raw updates before an ID-based restore could clear a later Redo tombstone. Every intent now stores the exact inverse delta. Fresh server synchronization precedes optimistic replay, and replay applies each raw/typed delta in persisted FIFO order. The inverse refers to the original Yjs Item, so it cannot clear a later tombstone even when the server committed Redo but its ACK was lost. Legacy intents without an inverse fail closed, preserving their draft rather than inventing an unsafe replay.

Migration is `20260927220000_whiteboard_deletion_receipts.sql`, avoiding R8's 2100 backup migration. It applies tenant RLS and the standard organization freeze policies. Before/after hashes and prior comment metadata remain in PostgreSQL; canonical object/comment bodies remain in their existing content storage. R8's bodyless comment payload is updated only at status/revision/archivedAt.

Final focused verification: core 129 tests; web provider/outbox 42; contract transport/collaboration four; API worker/store/permission guard and transaction tests cover real worker inverse validation and mocked transaction rollback. Full API TypeScript check session 30552 and web TypeScript check session 49436 both exited 0. An earlier concurrent core run exhausted a worker deadline; the unchanged deadline passed in the isolated rerun. No Docker, browser, PostgreSQL or model requests were executed by this worker.

Main-session acceptance still required: migrate on isolated PG, original pure-delete/Undo E2E with exact ACK/original IDs, mixed transaction round trip and reload, actual comment status recovery and role revocation. R9 proposal Undo uses its existing server proof and needs integrated comments recovery verification. Unit coverage does not mark these acceptance gates passing.
