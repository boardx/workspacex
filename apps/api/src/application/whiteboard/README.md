# Whiteboard durability and import boundaries

The authoritative board body is a Yjs snapshot in `ObjectStore`. PostgreSQL stores the
current immutable manifest (`object_key`, SHA-256, byte size, epoch and sequence), accepted
update receipts and audit data. Production composition always injects `OBJECT_STORE` into
`PgWhiteboardCollaborationStore`; the nullable `snapshot` and `update` columns only support
rolling reads of rows written before migration `20260926160000`.

Those rolling reads are a read-through backfill: snapshot and idempotency-update bytes are
uploaded under tenant/board-scoped immutable keys, read back, hash/size verified, and then
published with a compare-and-swap. New writes fail closed when ObjectStore is absent and never
fall back to PostgreSQL bytea. A tenant-scoped worker can call the bounded
`backfillLegacyBoard` hook for update rows that may never be replayed naturally. After every
legacy board and update has migrated, run `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f
apps/api/scripts/whiteboard-object-backfill-complete.sql`. It raises
`WHITEBOARD_OBJECT_BACKFILL_INCOMPLETE` while any inline body remains; only a passing gate permits
a later migration to drop the legacy columns.

A write validates against the current snapshot, writes the next snapshot and accepted Yjs
update under tenant-hashed, board-scoped immutable keys, reads both objects back and verifies
their hashes, then publishes their manifests in the locked PostgreSQL transaction. A store
failure leaves at most an unreferenced immutable object. It never exposes a half-written head.
The store has no ordinary delete capability. GC must derive a complete live set from document,
update, checkpoint and import manifests plus asset refs in canonical snapshots before using a
separate physical-purge capability; this module deliberately cannot delete blobs.

Checkpoint creation checks the metadata receipt before sampling a moving head, so an exact
request retry returns its original manifest. Restore validates immutable bytes and atomically
CASes `(epoch, seq)` to a new epoch through `PgWhiteboardRecoveryMetadata`; snapshot bytes never
cross the metadata port.

Miro/Mural import uses five closed routes: upload, preflight, execute, status and report. JSON,
CSV and ZIP inputs are bounded by byte count, entry count, depth, expanded size and compression
ratio. Archive paths, symbolic links, MIME confusion and unverified image formats fail closed.
Every source item becomes a canonical command or a report issue; no item is silently discarded.
Raster bytes are written to `ObjectStore` and canonical image objects contain only the asset ref.
Execution claims one request id, then submits one command batch, which is one collaboration
transaction and one structural undo step.

The upload route uses a route-local JSON parser sized for the reviewed 32 MiB binary limit plus
base64 overhead. Other API routes keep Express's default body limit.

## Agent canonical object read

`GET /v1/whiteboards/:boardId/objects?actorId=<registered-actor-id>` uses the normal
Bearer principal and the shared 120 requests/minute board/principal API bucket. The actor
must be enabled, belong to the principal's tenant, be delegated by that principal and have
`board:read`. Owner, editor and viewer board membership can read; archived boards remain
readable. Missing or inaccessible boards return 404; invalid/disabled actors and missing
read scope return 403. Caller-supplied role/scopes are not accepted.

The response is `{ boardId, revision: { epoch, seq }, role, archived, objects }`.
`objects` contains complete canonical objects (including text, geometry, parentId, style and
connector data), excluding tombstones and dangling connectors. It never includes the storage
manifest, ObjectStore key or raw Yjs bytes. The role and revision come from the same locked
snapshot read as the content. Feed `revision` into the next operation's `expectedRevision`;
a concurrent edit is rejected by the existing stale-revision guard.

This is one full snapshot, not a paginated live traversal: the existing canonical limit is
10,000 objects and the persisted Yjs document limit is 32 MiB. JSON encoding can be larger than
the binary snapshot. Reading all objects in one response avoids mixing revisions across
pages or silently omitting later objects. ObjectStore integrity checks precede bounded worker
validation/decoding; dependency or integrity failure is fail-closed (503). No DOM or Fabric
projection is involved.

## 10,000-object capacity boundary (issue #4256)

The canonical count limit is now 10,000, still defined only by `WHITEBOARD_LIMITS.objects`.
It counts retained object records, including tombstoned objects; the tombstone limit remains
10,000 and does not provide extra object slots. The command batch limit remains 200, public
operation limit 200, command payload 256 KiB, inbound Yjs update 64 KiB, document 32 MiB and
history 200,000 structs. Ten thousand maximally large text/extension objects are not promised:
all byte, history, heap and time bounds still apply independently.

`validator-capacity.test.ts` exercises real disposable workers, not an in-process substitute.
Its 10,000 styled Chinese/English sticky objects encode to 3,356,665 bytes and 110,000 Yjs
structs. Original 128 MiB workers decoded this fixture, but incremental validation and the
final 200-object creation batch failed with `ERR_WORKER_OUT_OF_MEMORY` (about 0.5 seconds,
not the 5-second deadline). At 256 MiB, measured decode/validate/final-batch times were
374/575/561 ms on the development machine. Concurrency is reduced from four to two so the
aggregate old-generation limit stays 512 MiB; the 5-second deadline, 64 queued requests,
64 MiB retained queue bytes and 10-second queue wait are unchanged.

Regression coverage requires all 10,000 canonical objects to survive decode and a raw text
edit, accepts the 9,800-to-10,000 final ordinary command batch, and rejects 10,001-object
snapshots and the next create command. Oversized command batches, inbound updates and
snapshots continue to fail closed. Browser/Fabric rendering performance is a separate gate;
these measurements establish API validation capacity only.
