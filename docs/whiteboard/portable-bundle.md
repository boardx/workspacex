# Portable canonical board bundle v1

`POST /whiteboards/:boardId/portable/export` returns a downloadable `*.board.json` file envelope (`sha256`, `sizeBytes`, `contentBase64`, `fileName`, `mime`). Owner/editor access is checked before reads and again before delivery. Its contents use `workspacex.board.bundle.v1`:

- `revision`: the canonical snapshot epoch/seq.
- `objects`: fixed path `objects.json`, hash/byte size of `JSON.stringify(content)`, and validated canonical objects.
- `media`: fixed `images/<sha256>` paths, source asset IDs, MIME/hash/size and base64 image bytes. These paths are logical manifest entries, never filesystem or ObjectStore instructions.

The file is JSON, not ZIP: there is no decompression or archive extraction. Whole-file and decoded aggregate limits reuse `WHITEBOARD_IMPORT_LIMITS.uploadBytes`; media count uses its files limit. Object count uses `WHITEBOARD_LIMITS.objects`, including future changes to that single source. The current base checkout has 5000; this implementation does not independently claim 10000 support. PNG/JPEG/WebP/GIF are fully decoded before import; exports use durable stored raster bytes. Pending/failed images, local-session assets, missing bytes and unsupported tile cover assets fail the whole export/import instead of creating placeholders. Other canonical content is preserved; vendor conversion is not involved.

`POST /whiteboards/:boardId/portable/import` accepts `{requestId,expectedEpoch,file:{sha256,sizeBytes,contentBase64}}`. It validates the entire package, image bytes, unique object/asset/path IDs and parent/connector graph before publishing. Object IDs become `portable_<sha256(requestId + ':' + oldId).slice(0,32)>`; parent and connector references follow that map. Source tombstone provenance is removed. Image source URLs are cleared; verified media is written under the destination tenant/board asset prefix with fresh server metadata. Imported locks, hidden flags, geometry, text, styles, contentObject and spatial settings remain intact.

All image files are verified first. Destination asset refs, canonical commands and the idempotency receipt publish in **one** tenant transaction under the fresh board ACL lock. Commands use existing small import-sized chunks in that transaction. A later chunk, epoch conflict or commit failure rolls back all PG roots and objects; unreferenced immutable files may remain for normal grace-period GC. There is no partial-success result. The metadata-only receipt binds actor/board/request to the entire input digest and epoch. Equal retries replay; changed packages conflict. No ACK is issued until commit.

The existing `/imports/standard-export` remains unchanged and returns single canonical JSON without media. This legacy `workspacex.board.v1` JSON is also accepted by portable import when it has no image content. This is not advertised as a media migration path. Comments/backups are separate features and are not included in portable v1.

## Real acceptance producer

`apps/web/e2e/support/board-portable-producer.ts` exports `producePortableRoundtripEvidence`. Call it from the isolated fullstack lane with an APIRequestContext, source/target URLs and authenticated tokens, and a disposable source fixture board containing nested objects, a connector and a real durable image. Different URLs/tokens support separate instances/tenants. It creates a target board, exports/imports/replays, compares complete remapped canonical objects, authenticated image bytes and real decoded pixel hashes, and verifies changed-input idempotency rejection. It does not start a service. Root must additionally run the existing image refresh/independent-peer browser checks on the returned targetBoardId and capture actual PG/ObjectStore refs; unit tests cannot replace those checks.

Targeted tests use real Y.Doc and FsObjectStore/Sharp with a transactional test adapter, including cross-tenant keys, corrupted media, commit rollback and 401 objects across multiple atomic chunks. They do not claim a live PostgreSQL or browser acceptance run.
