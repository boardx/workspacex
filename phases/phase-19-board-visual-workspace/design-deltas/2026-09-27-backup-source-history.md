# Source-only history in joint Board backups

`BoardBackupManifest.sourceHistory` adds metadata-only `{key,hash,bytes,mime}` references for active Board asset roots not already covered by the current snapshot/images/comments. This includes AI proposal/Undo JSON and generic operation Undo snapshots. All captured refs are pinned in the same Board-locked capture transaction; the archive verifies every body before publishing the manifest. Retention release now verifies history blobs as well as the visible Board content.

The optional field is deliberately not defaulted: old v1 manifest hashes must remain byte-compatible. Old archives remain valid for their original new-Board restore, but cannot be claimed as source-history disaster backups.

## Two distinct restores

- `restore(..., newBoardId)` copies visible Board snapshot, images and comments. It does not publish old proposal commands, actor identities, authorization or idempotency receipts into a new Board.
- `restoreSourceFiles(..., backupId)` requires the original PG Board and backup metadata already restored. It verifies owner/org access, snapshot revision/pointer, comment body refs and the complete captured active history ref set against that PG state. Mismatches fail `SOURCE_CHANGED` before filesystem publication. It verifies archive hashes and then restores exact original keys under the Board/backup transaction locks. Existing different bytes are never overwritten.

Stop writes to the selected Board while taking the verified archive followed by PG snapshot. If a concurrent AI operation adds or changes a file reference between them, restoring a mismatched pair fails closed. This is a selected-Board recovery, not a claim that every Board in the PG database was archived. Existing legacy proposal payloads must be migrated through the authorized R9 repository first. Unsupported active ref MIME fails capture rather than silently dropping history. Pending, unacknowledged upload roots are not operation history. R8's archive scope still does not claim all independent system audit tables.

## Main-session drill

The existing isolated `apps/api/scripts/board-joint-recovery-drill.ts` now restores source files after PG restore, then exercises a normal new-Board restore. It verifies every source blob at its original key and reports `sourceHistoryBlobCount` without text or credentials. Run through the existing isolation wrapper with `BOARD_JOINT_DRILL=1`, `BOARD_OBJECT_ROOT`, `BOARD_DRILL_DIRECTORY`, `STARTER_POSTGRES_CONTAINER` and isolated PG identity; arguments remain `<orgId> <ownerId> <boardId>`. Seed a confirmed AI proposal/Undo before capture to exercise nonzero history, and separately change a history pointer to prove `SOURCE_CHANGED` rejection. No DB/Docker execution was performed by the worker.

Focused unit tests prove active-ref SQL filtering, backup pin insertion, owner recheck, reference mismatch, missing/tampered history, old manifest compatibility, cross-Board/traversal rejection, no old commands in a new-Board restore, and retention refusal when history is absent. The main session owns real PG/FS acceptance.
