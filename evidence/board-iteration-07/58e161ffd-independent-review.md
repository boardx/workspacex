# R7 complete candidate review and follow-up authorization fix

Reviewed candidate: `58e161ffd00edcc5b01d03b43cf4391950d0cf9f`.
R6 merged baseline: `a04fa21914e9b3f8fea822a3adc9c54629e7a97b` (PR 4313).
Review is code inspection plus a real Node/Y.Doc counterexample, without DB,
Docker or browser execution. This is **not approval of the subsequent fixes**.

## Blocking findings

1. **P1 — comments can retain the pre-revocation role after waiting for a lock.**
   `pg-whiteboard-comment-store.ts` access joined membership in the same
   `SELECT ... FOR UPDATE OF b`. Member removal/role update locks the board but
   does not update its tuple. A waiter keeps the statement snapshot from before
   that commit, then discloses comments, replays a response, or publishes a new
   comment using the old role. Acquire board lock first, then read membership in a
   distinct statement. Candidate follow-up fixes this; root must review the fix.
2. **P1 — recovery has the same stale membership snapshot and a publication gap.**
   `pg-whiteboard-recovery.ts` used the same joined lock. Additionally,
   `saveCheckpoint` checked neither current write role nor archive state before
   its first insert; the service's earlier head authorization cannot protect the
   final transaction after downgrade/archive. Candidate follow-up adds both final
   checks before replay or insertion. Root must independently review and run the
   provided real-PG race producer.
3. **P1 — structural undo/redo deletes another editor's new relationship.**
   In `undo.ts`, structural create undo and delete redo compare only the stored
   history objects; delete command cascades through newly added connectors too.
   Real Y.Doc experiment: create remote-node; local history creates local-node;
   remote origin creates remote-edge from local-node to remote-node; local undo
   returns `undone` and leaves only remote-node. No conflict is reported.
   Create-undo is an inherited R6 gap; R7's delete-redo path retains the same
   unsafe behavior. A separate owner is fixing this; not changed here.

## Existing four browser scenarios and remaining evidence

`whiteboard-live.spec.ts` covers presence/convergence, object/world comment
anchors and commenter downgrade, offline delete+undo followed by reconnect and
checkpoint fallback, and two users undoing text on different objects. These are
useful but do not establish the three lock/cascade boundaries above. They also
lack browser proof of comment status restoration after original-ID delete undo,
concurrent edits to the same object, and restart between offline delete→undo→redo
with a lost ACK. Real Y.Doc/fake IndexedDB tests cover the latter replay logic;
that is not browser evidence. Keep scope claims aligned with what was executed.

The encrypted outbox generation/regrant/rebind and part of provider cancellation
were previously implemented by this reviewer. They cannot receive independent
approval from this review; root/another reviewer must retain ownership of that
assessment. Typed deletion receipt and inverse-delta logic was implemented by a
separate worker. Its actor/epoch binding, exact tombstone/digest checks, comment
revision CAS and full before/after inverse checks are present in this candidate.

## Follow-up verification

The minimal patch changes only comment/recovery ACL locking and checkpoint final
publication authorization. Focused unit tests include gate-controlled lock waits
for comment list/new/replay and every recovery read/publication method; removed
membership is `NOT_FOUND`, an authorized viewer's write is `FORBIDDEN`. Archive
and owner/editor write gates run before replay and insertion.

Real race producer (not run by the worker):

```
BOARD_ACL_RACE_ISOLATED=1 node --import tsx apps/api/tests/whiteboard/support/comment-recovery-acl-race.mjs
```

Provide `BOARD_ACL_API_URL`, `BOARD_ACL_OWNER_TOKEN`, `BOARD_ACL_MEMBER_TOKEN`,
`BOARD_ACL_ORG_ID`, `BOARD_ACL_MEMBER_ID`, and the isolated stack's normal `PG*`
credentials. It creates a disposable board through the authenticated API, then
holds an actual PG board lock while starting the competing request. It waits for
`pg_blocking_pids` to prove the request blocked before committing removal,
downgrade or archive. It verifies comments list/new/replay return 404 without
secret text, recovery read returns NOT_FOUND, checkpoint publication returns
FORBIDDEN with no metadata row. It archives its board in finally and starts no
services. PG credentials must use the same tenant role as the app and permit
inspection of its own sessions; no privileged production credential is needed.

Worker verification: comment/recovery focused unit suite **29/29 passed**;
`lint-permission-paths` passed (1,560 files); producer `node --check` and
`git diff --check` passed. API typecheck intentionally deferred by root to one
post-integration run while the sole Next build owns heavy-check resources.
The real-PG producer has not been executed; do not treat its presence as evidence
that the race acceptance passed.
