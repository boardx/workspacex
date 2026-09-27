# Real proposal storage + joint recovery acceptance producer

This is a real PostgreSQL/FsObjectStore producer for the **main session only**. Unit tests validate isolation/diagnostic gates and wiring; they do not claim PG acceptance. The fixture uses explicit synthetic AI commands and makes no model-inference claim.

## Required integration

- R9 proposal file storage and migration `20260928003000_whiteboard_proposal_bodies.sql` (909264dd6, or descendant).
- Generic operation Undo snapshot compatibility (f184c0a99, or descendant).
- R8 source-history joint backup/recovery (774c32938, included in db2b173f4). The producer refuses to run without `apps/api/scripts/board-joint-recovery-drill.ts`.
- Standard isolated test wrapper, Docker/PostgreSQL access owned by that wrapper, and configured application/migration credentials. No API/browser server or live model provider is required.

From the integrated repository root, in the **main session**:

```bash
BOARD_PROPOSAL_STORAGE_DRILL=1 \
BOARD_PROPOSAL_DRILL_DIRECTORY="/private/tmp/board-proposal-proof-$(date +%s)" \
pnpm exec tsx .harness/scripts/with-test-isolation.ts -- \
  pnpm --filter api exec tsx scripts/board-proposal-storage-drill.ts
```

Use a fresh non-existing private directory. The script invokes the official `ensureDatabase`/migration/organization fixture helpers and verifies that the PostgreSQL container belongs to `COMPOSE_PROJECT_NAME`. It derives the container ID rather than requiring a manually copied value. If `STARTER_POSTGRES_CONTAINER` is supplied, it must match that owned container. Local isolated `wsx_<20 hex>` database identity and loopback PG host are mandatory; deployment profiles are rejected.

## What must actually pass

1. Create a Board and source note; register an isolated synthetic AI actor using the migration identity, without changing runtime privileges.
2. Create and confirm a proposal using production services. Execute proposal Undo and compare actual canonical text. Confirm a second proposal; execute a generic operation with a durable before-image.
3. Seed one historical inline row using isolated owner DDL. The exact catalog CHECK is reinstated in the same transaction before commit, so new plaintext writes remain rejected. This is historical-fixture setup, not a production migration bypass.
4. Run repository migration in a real transaction and deliberately throw **after** pointer publication. Verify the old inline row is intact, the asset root rolled back, and the immutable orphan bytes exist. Retry through the authorized service and verify all PG payloads are `{}` with matching file hashes/sizes/MIME. An old plaintext writer must get PG `23514`.
5. Reuse the existing joint drill: verified FS archive → actual `pg_dump` → isolated PG restore → exact source files restored from independent archive → new-Board restore. History count must be nonzero.
6. Open fresh database/service instances, read the restored proposal, compare full content hashes, verify generic Undo before-image, and execute the generic Undo against the restored source Board.
7. Check the new Board has zero historical proposal/operation/Undo rows. Also perform the real portable export/import service path into another new Board and verify visible content survives while those authority rows remain zero.

Evidence is written only after all checks pass to `<directory>/proposal-storage-evidence.json`; the child drill writes `<directory>/joint/evidence.json`. Output contains IDs, hashes, counts and status, not bodies, credentials or connection strings. Failure diagnostics contain only stage and safe error code.

The wrapper owns stack cleanup. The source/target test databases and private output directories are deliberately identified for root inspection; do not delete another session's stack or data. This producer must run in a dedicated isolation rather than alongside writers to the same Board; source-history/PG snapshot mismatch must fail closed.

### Review correction: connection binding and portable authority

Before importing fixture helpers or calling `ensureDatabase`, the producer derives the expected isolation identity from the canonical repository path and wrapper seed using `deriveTestIsolation`. It inspects only compose project/service labels, running state and published `5432/tcp` bindings, then matches the actual endpoint against both application and migration configurations. A port, project, seed or database mismatch stops before any DB creation/migration. No container environment or connection secret is collected.

Portable export now reads the original source Board, which still owns verified proposal and generic Undo history after the restored generic Undo executes. Imported content must equal that current source state. The target must contain zero old authority rows and actual attempts to read/undo the source proposal or undo the source operation must each return `NOT_FOUND`; any success, stale-revision or dependency error fails. Target revision and canonical update hash must remain unchanged. Seven light tests cover these gates; real DB execution remains the main session's responsibility.
