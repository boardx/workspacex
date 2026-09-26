# Whiteboard durability and import boundaries

The authoritative board body is a Yjs snapshot in `ObjectStore`. PostgreSQL stores the
current immutable manifest (`object_key`, SHA-256, byte size, epoch and sequence), accepted
update receipts and audit data. Production composition always injects `OBJECT_STORE` into
`PgWhiteboardCollaborationStore`; the nullable `snapshot` and `update` columns only support
rolling reads of rows written before migration `20260926160000`.

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
