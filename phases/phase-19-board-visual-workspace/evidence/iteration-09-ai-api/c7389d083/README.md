# Root proposal filesystem + PG recovery acceptance — c7389d083

2026-09-27: real isolated PostgreSQL plus independent filesystem archive. Exit 0, 18s including cleanup. Concurrent 923a5bdd6 added only UI evidence.

Ran the documented isolation-wrapper command with BOARD_PROPOSAL_STORAGE_DRILL=1 and a fresh private directory. The wrapper started its owned postgres service; the producer verified container identity and database endpoint before writes.

Passed: 3 proposal bodies stored as verified files with empty PG payloads; legacy migration rollback preserves body and rolls back roots; retry migrates; old plaintext writer rejected; proposal Undo works; PG dump plus separate archive restore retains 9 history blobs; restored proposal and generic Undo work. Restoring/importing into a new board copies zero old proposal/Undo/operation authority rows; requests using old authority IDs are rejected without mutating revision/content.

Synthetic storage fixture, not real-model inference. No images/comments in this fixture; those require separate recovery tests. Scope is selected-board data and history, not all-tenant disaster recovery. JSON files contain hashes and fixture IDs only. Wrapper removed the isolated compose stack; private filesystem artifacts remain for inspection.
