# Durable whiteboard image assets

`POST /whiteboards/:boardId/assets` accepts one multipart `file`. The authenticated principal needs current editor/owner access to an unarchived board. The response is `WhiteboardAssetMetadata`: opaque asset ID, server-derived SHA-256, byte length, verified MIME, original pixel dimensions and `persistence: durable`. It never returns an ObjectStore key or public URL. Commit ready canonical content only after this response succeeds.

`GET /whiteboards/:boardId/assets/:assetId/content` delivers verified bytes to a current board reader. ACL is checked before and after ObjectStore I/O, including archived boards. IDs are not bearer credentials. Delivery is private/no-store with nosniff. A frontend uses authenticated fetch and owns/revokes the resulting blob URL; another browser resolves the same canonical handle independently. Session blob URLs never belong in canonical state.

`WHITEBOARD_ASSET_LIMITS` is the capacity source: 25 MiB compressed input, 16 Mi pixels across all frames, 32,768 per dimension, 100 frames, two simultaneous pixel decodes. Decode timeout is five seconds. Raster bytes must completely decode and match the claimed format. SVG forbids active/external content and is decoded to PNG; metadata describes the stored PNG. Invalid or oversized data never becomes ready content.

PostgreSQL stores references and metadata only. Immutable bytes use the existing ObjectStore. Existing `whiteboard_asset_refs` supplies the GC root guard/tombstone fence; delivery joins only active, unreleased roots. Uploads remain retained roots if a subsequent canonical create fails. Release remains an explicit asset-governance action. Corrupt/missing blobs fail closed without a raw storage redirect.

ZIP import uses the same verifier and durable service. Content records original pixel dimensions and digest independently of its layout rectangle. Bad images are reported as skipped/missing assets. Preflight does not publish roots; execution publishes them before canonical commands.

The frontend uploads and reads back verified bytes before creating ready content. Each mounted board/user owns a private blob URL cache; refresh and peer mounts authenticate and resolve canonical handles again. Revocation/denied delivery aborts pending reads and clears previews. The editor header exposes the import dialog on demand. Unit tests cover these transitions; real browser refresh, peer, revocation and import acceptance remain the integration gate.
