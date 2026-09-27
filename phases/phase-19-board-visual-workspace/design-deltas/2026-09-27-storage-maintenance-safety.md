# R8 — backup retention release and filesystem manifest compatibility recovery

## Invariants

Board bodies stay in immutable files. PostgreSQL retains metadata and pointers only. There is no bytea reverse migration, no release of live document/image/comment roots, and no direct physical deletion in these maintenance commands.

Both commands are trusted operator entry points using the application DB role and explicit tenant/actor/backup scope. They default to dry-run. Current organization membership and owner/admin authority are checked under locks on every invocation; the existing organization export authority defines the admin criterion. A revoked original backup owner does not regain access from an old receipt. Missing source boards may be maintained by their still-active original backup owner or current organization administrator.

## Release backup-specific pins

Eligible backups must be `verified`, older than the requested retention period (default 30 days, minimum one day), and have no `preparing` restore. The independent archive manifest and every blob are read back and checked for hash, length and MIME before releasing anything. A failed/preparing backup, corrupt/missing archive, active restore, fresh backup, foreign tenant or revoked actor fails closed.

Release marks only the selected backup's active pin rows as released and writes an immutable metadata receipt. It neither deletes the backup record/archive nor changes live references. GC root functions ignore released pins but continue including document, history, checkpoint, import, export, image and comment roots. Existing GC grace, fencing and fresh-root checks still control physical purge. Other backups' pins remain intact. Restoring from the verified independent archive remains supported after release; a new restore creates fresh target pins.

The backup row lock serializes release with prepare/publish restore. A restore already preparing blocks release. A later restore can safely start after release because it reads the independent archive and installs new target pins.

## Filesystem manifest compatibility recovery (not historical content rollback)

Only the existing supported filesystem manifest version 1 can be recovered. The caller must supply the current board epoch/sequence and a verified backup with the exact same revision and snapshot content hash/size. Newer content, an older backup, a different format version, a legacy inline body, missing authorization or mismatched manifest is rejected. There is no downgrade to a binary which cannot read filesystem manifests.

Archive verification/copy occurs before publication. The final transaction locks current membership, the board and the backup, then rechecks the full expected revision/hash before the pointer CAS. This creates a short commit pause; edits arriving during file verification cause a conflict instead of being overwritten. Plan a quiet editing window for a successful repair, but safety does not depend on clients honoring a voluntary pause. The verified snapshot is copied to a fresh immutable recovery key and read back before a compare-and-swap changes only the PG object pointer. Epoch, sequence, logical content, archive state, ACL and comment/image refs do not change. A unique request receipt provides idempotency. Failure before commit leaves the old pointer intact; an orphan file remains subject to normal GC. The command repairs/rebinds the document's filesystem manifest, including a missing primary snapshot, without overwriting newer collaboration edits.

This is deliberately narrower than restoring an older Board state. For historical rollback or missing auxiliary assets, use the existing full verified backup restore into a **new Board** and review it before any replacement. The in-place compatibility command does not claim to repair unrelated image/comment corruption.

## Operator boundaries

Provide explicit IDs, `BOARD_STORAGE_MAINTENANCE_OPERATOR=1`, existing `BOARD_OBJECT_ROOT`, and an independent `BOARD_BACKUP_OBJECT_ROOT`. Credentials remain in the established environment, never arguments/output. A successful dry-run verifies eligibility and archive integrity but changes no files, pins or PG pointers. Each action is bounded to one backup/board; deployments can schedule explicit batches around it.

Main-session real PG/FsObjectStore acceptance will cover retained live roots, released backup-only roots, independent pins, active restore refusal, revoked permission, missing/corrupt archive, metadata-only pointer recovery, stale revision refusal and replay. Implementation workers do not run DB/Docker/browser acceptance.

## WIP checkpoint — priority switch to issue #4335

Implementation currently includes service, PG repository, CLI, migration and 15 new unit cases; 36 focused/regression tests pass. **Not ready to merge:** API typecheck, dedicated repository permission/concurrency counterproofs and the main-session real PG producer remain outstanding. No DB/Docker/browser validation has run. Continue this package after the newly requested Create Board dialog.
