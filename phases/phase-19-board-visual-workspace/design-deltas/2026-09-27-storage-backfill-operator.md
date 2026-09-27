# R8 8F — bounded multi-tenant Board body backfill

## Boundary

The operator migrates the storage representation of existing canonical snapshots, historical Yjs updates, comment thread bodies and comment idempotency responses. It never changes document epoch/sequence, board archive state, membership, comment revision or logical content. Image bodies already use ObjectStore and need no bytea backfill.

Normal comment/archive behavior remains unchanged. New dedicated maintenance hooks use a single authorization function: lock current `org_memberships` first, then the board. Organization-wide authority reuses `domain/auth/org-lifecycle.canExportOrganization`; explicit board scopes also permit the current owner if they remain a current organization member. A viewer/editor role alone is insufficient. All-board enumeration requires the current organization administrator. Every batch rechecks authorization, including after a resume. No owner impersonation, superuser production connection or RLS bypass is used.

The deployment operator supplies **an explicit manifest of every authorized tenant to visit**. There is no automatic cross-tenant discovery or implication that an omitted tenant was inspected. This supports a deployment-wide backfill by supplying its full tenant manifest, and a narrower owner-authorized subset using explicit board IDs.

Example `scope.json` (identifiers are metadata):

```json
[
  {"orgId":"tenant-a","actorId":"administrator-a","allBoards":true},
  {"orgId":"tenant-b","actorId":"board-owner-b","boardIds":["00000000-0000-4000-8000-000000000001"]}
]
```

The CLI is an operator program using existing application DB credentials, not an HTTP endpoint that accepts arbitrary user IDs. Set `BOARD_BACKFILL_OPERATOR=1` and the existing `BOARD_OBJECT_ROOT`; do not put connection strings or credentials in command arguments.

## Execute and resume

```sh
pnpm --filter api exec tsx scripts/board-storage-backfill.ts --scope scope.json
pnpm --filter api exec tsx scripts/board-storage-backfill.ts --scope scope.json --execute --board-limit 20 --row-limit 100 --delay-ms 100
```

Default is dry-run: metadata counts only, no lazy load and no blob/PG body writes. Execution handles at most `board-limit` visits, and at most `row-limit` body rows per board transaction (snapshot + updates + threads + receipts share the budget). Values are bounded to 1–1000; delay is 0–60000ms, default 100ms between visits in the invocation. Operators should also pace separate invocations.

Save each JSON report. Pass its non-null `cursor` to the next invocation with `--cursor VALUE`. Cursor binds the exact scope and dry-run/execute mode. A partially migrated board remains at the front of the next batch. A failed board advances so healthy boards can continue; reports list only org/board IDs and safe failure codes, and the cumulative failure count follows the cursor. Retry failed boards with a new explicit subset manifest. Tenant-level authorization failure records `boardId:null`.

The cursor is a resumability marker, **not an authenticated audit certificate**. `scanComplete` means this traversal reached its end; `batchMigrated` only describes this report's successful visited boards. Neither proves omitted tenants or prior failures were migrated. Preserve all reports, retry all failures, then perform a complete metadata-only dry-run from the beginning and require zero remaining counts before considering format retirement. Production writes of legacy bodies must already be stopped. This tool does not remove old columns, release backup pins, or implement format rollback. Clearing body columns does not immediately shrink PostgreSQL relation files; ordinary vacuum/space reclamation remains database operations work, and this operator never runs VACUUM FULL.

Each row is blob-first, readback/hash verified, then PG refs are committed atomically. A failed board transaction retains the old body and may leave an unreferenced blob, which existing GC grace handles. Retrying is idempotent. Archived boards retain their archived status throughout.

## Main-session actual acceptance

Only the root session runs this command inside the standard local isolation wrapper:

```sh
pnpm --filter api exec vitest run --config vitest.board-backfill-acceptance.config.ts
```

The producer uses real PG and FsObjectStore: two tenants, three boards, one archived, twelve restored legacy body rows. It asserts dry-run leaves bytes unchanged, row-budget-one cursor resumption converges, replay is idempotent, a fresh connection reads identical canonical objects and sequence, comments are bodyless in PG and readable in verified files, archived normal comment reads remain blocked, and foreign-tenant/viewer attempts fail closed. The fixture seeds legacy rows only with the isolated migration role; the actual operator runs using `app_rw`.

No real DB/Docker/browser execution is claimed by the implementation worker.

## Worker verification boundary

Focused unit coverage includes dry-run/no mutation, cursor scope/mode binding, partial-board resume, failure continuation/rate pacing, current member/admin/owner authorization, and shared document/comment row budgets. Existing comment/file-manifest regression suites remain applicable. The worker's API typecheck found one pre-existing base `099a18459` error in `tests/whiteboard/collaboration-gateway-gap.test.ts:113` (mock missing `loadInTransaction`); this package's added sources and producer had no remaining diagnostics. Root integration must resolve that baseline mock and rerun the full check. Real-PG acceptance remains unexecuted until the main session runs it.
