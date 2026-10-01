# R8 root storage evidence — 2026-09-27

## Real PostgreSQL and filesystem lifecycle

At `0df78deea`, main session executed `vitest.board-storage-acceptance.config.ts` inside the repository isolation wrapper: **2 files, 15 tests passed**, 24.33 seconds. Legacy bytea migration, idempotency, rollback after file publication, checkpoint restoration and continued editing, physical orphan purge, root fencing, archive restoration after deleting source Board and its primary bodies, comment restoration and fresh viewer reads all passed.

Real PostgreSQL negative checks rejected wrong hash/key migration (23514), receipt mutation (42501) and rewriting an already migrated update (23514). With equal object/update counts, 100 versus 10,000 text bytes both used 832 bytes of PG document/update row metadata. This does not claim operation-count growth, indexes or WAL are constant.

## Independent PG dump plus object archive

At `8e0c5b90f33e6e2f688b618fd4f23d3097056ddd`, main session created an isolated synthetic board with a sticky, decoded PNG and object-bound comment. The included fixture producer invokes the repository's `board-joint-recovery-drill.ts`, which composes the existing `backupStarterDatabase` and `restoreStarterDatabase` implementations. It restored the dump into a new database and recreated the selected Board into an empty filesystem root from an independent archive. Fresh app connections verified canonical object hash, image bytes/hash/MIME, comment body and PG snapshot NULL. The command exited 0 in 11 seconds. See allowlisted `joint-recovery.json` for dump and manifest hashes.

Source database/files were not destroyed: the drill demonstrates restoration to new destinations, not a destructive production outage. The isolation wrapper removed its disposable Docker stack after completion; the archive/fixture files are retained locally. The producer records the exact local checkout used; adapt that path when reproducing elsewhere.

## Not yet accepted

This evidence does not establish full-site recovery, all-tenant backfill, pin cleanup/retention release, storage-format rollback, portable vendor migration, or final visual/performance score. The browser image chain passed upload/readback/pixels/export/refresh/peer/copy, then stopped at revoked-client UI cleanup. Monitor error mapping has since been integrated; full browser rerun remains required. R8 is not complete solely because this lane passes.

No database dump, credential, browser trace or raw service log is published here.
