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

Still missing product/acceptance paths:
1. Operator command and manifest-pinned state machine for joint PG + secondary object-store backup; independently restoring both into an isolated target with ACL/revision/hash equality and resumed collaboration.
2. Preparing/verified/failed-pending-cleanup backup and legal-hold roots participating in GC fencing; current root union covers document/update/checkpoint/import/assets only.
3. Storage-format rollback after acknowledged ObjectStore-primary writes (no equivalent PG mirror/reverse migration operator found). The completion SQL is only an audit guard, not a migration or rollback executor.
4. Automated enumeration/backfill across all tenant Boards; backfillLegacyBoard is a bounded per-board hook.
5. ObjectStore outage/corruption and migration/GC/backup races on real PG; production OSS/S3 verification is separate from filesystem.

No DB, Docker, browser or this suite was executed by its author. Main session must record actual command output and exact commit before treating these scenarios as passed.
