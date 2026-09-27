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

## Verification and operator commands

On the main session's already-running **isolated local** API database, with the standard isolation/PG environment loaded:

```sh
pnpm --filter api exec vitest run --config vitest.board-maintenance-acceptance.config.ts
```

This producer validates local/isolation restrictions **while loading the config, before the shared DB global setup can connect**. It uses real PostgreSQL transactions and separate primary/archive FsObjectStore roots. It seeds only synthetic tenants, cleans those tenants and temporary roots, and prints metadata-only `BOARD_MAINTENANCE_GC` / `BOARD_MAINTENANCE_RECOVERY` records. Historical backup/file/tombstone timestamps are fixtures; they do not claim that the retention interval elapsed during execution. The worker does not run this command.

Coverage: young backup rejection; active owner/admin versus viewer/foreign/revoked principal; dry-run zero mutation; replay after fresh permission check; two backups protecting one obsolete snapshot; live document/update/comment roots and the active asset-root family used by generic Undo; real mark/sweep and physical orphan deletion; archive restore after pin release; corrupt archive and restore-started-before-final-release refusal; missing snapshot repaired without PG body bytes or revision changes; a real canonical write between archive validation and pointer publication rejecting stale recovery. Generic Undo operation semantics themselves remain covered by its own lane; the retention producer verifies its shared root family, not a fabricated AI operation.

Operator release (set the normal DB credentials and both filesystem root environment variables without printing them):

```sh
BOARD_STORAGE_MAINTENANCE_OPERATOR=1 pnpm --filter api exec tsx scripts/board-storage-maintenance.ts release-pins --org "$ORG_ID" --actor "$ACTOR_ID" --backup "$BACKUP_ID" --request "$REQUEST_ID" --retention-days 30
# Review the dry-run, then repeat with the same request ID and --execute.
```

Pointer recovery uses the same opt-in and `recover-manifest --org ... --actor ... --backup ... --request ... --board ... --expected-epoch ... --expected-seq ... --target-version 1`. It also defaults to dry-run. An identical completed request replays its original receipt; use a new request ID for a later retention pass (for example after a newly completed restore creates more pins). A request ID cannot be reused with different options or a different actor.

Focused checks without DB:

```sh
pnpm --filter api exec vitest run --config vitest.whiteboard-unit.config.ts tests/whiteboard/backup-maintenance.test.ts tests/whiteboard/backup-maintenance-repository.test.ts tests/whiteboard/storage-backfill.test.ts tests/whiteboard/board-backup.test.ts
pnpm --filter api exec tsc --noEmit
```

## Remaining storage-format rollback boundaries

- Implemented: same-content filesystem manifest v1 pointer recovery, verified immutable bytes, fresh authority, final revision/hash CAS and idempotent receipt. This is a compatibility repair, **not** arbitrary historical state rollback.
- Historical content recovery is supported through the existing verified archive restore into a new Board. The maintenance tool does not replace a live Board with an older snapshot.
- No v2 format exists here, so a v2→v1 converter and old-binary compatibility matrix are not implemented. Unknown versions fail closed. A future format change must supply a tested FS-to-FS conversion and deployment stop-write/cutover protocol before claiming reversible downgrade.
- No FS→PG body migration is provided: user-required filesystem content storage remains invariant.
- In-place repair of missing image/comment blobs is not provided; use full archive restoration into a new Board. Failed/unverified captures retain their pins until an independently verified archive exists; they are never purged merely because they are old.
- PostgreSQL-loss recovery continues to require the joint PG-backup + independent archive drill. This maintenance lane assumes the trusted PG manifest metadata survived or was restored and does not substitute for that drill.

Candidate validation is recorded in the handoff; real PG acceptance remains pending the main session's execution and exact-SHA evidence.
