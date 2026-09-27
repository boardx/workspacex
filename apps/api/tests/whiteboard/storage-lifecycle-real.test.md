# R8 storage acceptance — actual PG + filesystem

Run from the main session only, after the standard isolated API test stack is ready. Reuse its WORKSPACEX_ISOLATION_ID, WORKSPACEX_DB, PGDATABASE, PGHOST and credentials; never echo credentials. The new test rejects nonlocal/shared database configuration before its setup starts.

```sh
pnpm --filter api exec vitest run --config vitest.board-storage-acceptance.config.ts
```

The dedicated config extends the default API Vitest configuration and composes real PostgreSQL setup. Its .acceptance.ts suffix keeps this operator-only test out of ordinary CI discovery. Do not use vitest.whiteboard-unit.config.ts. Do not run while another suite uses the same seeded tenants.

Coverage of the added file:
- Actual legacy bytea rows, read-through snapshot migration and explicit update backfill, bytea NULL checks, idempotent second pass, fresh-connection canonical equality.
- Exception after real transactional writes and object publication: PostgreSQL rollback, no returned ACK, unchanged fresh read, next successful sequence. This is transaction rollback, NOT reverting storage format.
- Equal object/update counts at 100/10,000 text bytes: actual pg_column_size document + update metadata, bytea NULL, filesystem body growth. Metadata increase <128 bytes while body increases >9KB. Physical table/index/WAL sizes are intentionally not claimed constant; metadata grows with operation count.
- Actual checkpoint creation/restoration with PG metadata + FS content, fresh connection equality, incremented epoch and continued editing. This is NOT independent joint database/object-store disaster recovery.
- Actual filesystem orphan with historical timestamps, PG mark/sweep fence and deletion receipt, FsPhysicalPurge, all live roots retained. Production one-day grace is unchanged; the historical fixture does not claim a day elapsed during testing.

Existing coverage: pgsql-metadata-only-growth imports collaboration-persistence (real PG/FsObjectStore, fresh-connection, large object count), plus real root/purge fencing and lease scenarios. blob-pointer-atomicity is fake DB; blob-backup-restore imports fake-port checkpoint tests; blob-retention-gc combines mocked repository tests and isolated filesystem purge tests. These cannot substitute for this real lane.

Joint Board backup now has a separate real scenario: create comments and viewer ACL, capture to an independent FS archive, remove the source Board and primary snapshot/comment bytes, prove the backup pin remains a GC root, restore a new Board, read canonical objects and comment body through a fresh viewer connection, assert PG payload is bodyless, replay idempotently and continue editing. Missing archive bytes must not publish a target.

For actual loss of PG as well, `scripts/board-joint-recovery-drill.ts` composes the existing system PG dump/restore path with the Board archive. See the protocol document for explicit local-only opt-in and cleanup. Neither the real suite nor the dual-media drill has been executed by this worker.

Remaining boundaries:
1. Backup pins are retained indefinitely, including failed attempts; there is no automatic release/cleanup policy yet.
2. Storage-format rollback after acknowledged ObjectStore-primary writes (no PG mirror/reverse migration operator). Transaction rollback is independently tested, not a substitute.
3. Automated enumeration/backfill across all tenant Boards; backfillLegacyBoard remains a bounded per-board hook.
4. Remote OSS/S3 and entire-site identity/org remapping are not supported by this same-tenant selected-Board restore.
5. Historical Undo/outbox requests/checkpoints are not replayed into the new Board; current document and complete comment threads are restored instead.

No DB, Docker, browser or this suite was executed by its author. Main session must record actual command output and exact commit before treating these scenarios as passed.
