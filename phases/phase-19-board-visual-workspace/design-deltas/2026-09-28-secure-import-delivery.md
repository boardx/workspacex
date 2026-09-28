# R8 secure import and asset delivery boundary

This slice closes the in-process security boundary for Board import originals and Board image assets. It does not change the canonical Miro/Mural mapping rules or store Fabric JSON.

## Upload and scanner boundary

`WhiteboardImportService.uploadStream` accepts an `AsyncIterable<Uint8Array>` and an optional `AbortSignal`. The orchestrator awaits each scanner write before pulling another chunk, so a slow scanner applies backpressure to the producer. It rejects empty chunks, declared-size overruns, the global upload limit, final size/hash mismatch, cancellation, scanner failure, and a non-clean verdict before parsing or publishing metadata.

`WhiteboardImportContentScanner` is a session port (`open`, `write`, `finish`, `abort`). Its constructor default is deny-all. The kernel explicitly installs the local baseline scanner, which detects the EICAR marker across chunk boundaries. A hosted ICAP/antimalware adapter can replace the port without changing import orchestration. Archive traversal, expansion, compression-ratio and active-image-content checks remain the independent parser/verifier boundary.

The existing JSON/base64 endpoint is retained for current browsers and calls the same streaming/scanning path with one chunk. A future raw-body or multipart transport should delegate directly to `uploadStream`; it must not reimplement hashing, limits or scanner decisions.

## Encryption at rest

All Board import originals, standard exports and image uploads in the kernel use `SecureWhiteboardObjectStore`.

- Local/self-hosted filesystem mode is an explicit host-managed encryption boundary. Operators remain responsible for an encrypted volume and backup destination.
- Hosted OSS requires `WORKSPACEX_BOARD_OBJECT_SSE=AES256` or `KMS`. Missing or invalid configuration fails application bootstrap.
- KMS also requires `WORKSPACEX_BOARD_OBJECT_KMS_KEY_ID`. It is validated, sent only as an OSS request header, and is never included in public Board/asset metadata or error text.
- The OSS adapter's new encrypted-write capability sends the SSE header and reads object encryption metadata back. A missing or mismatched algorithm/key fails the write before Board metadata becomes active.
- The shared `ObjectStore.putOnce` path is unchanged; non-Board callers do not silently acquire a different storage policy.

## Short-lived asset downloads

`POST /whiteboards/:boardId/assets/:assetId/download-grant` verifies current Board ACL and stored-byte integrity, then issues a 120-second HMAC token. `GET /whiteboards/:boardId/assets/downloads/:token` requires the authenticated principal, verifies signature/scope/expiry in constant time, and rechecks current Board ACL before delivering bytes. Forwarding a token to another user does not grant access, and revocation takes effect before expiry.

`WORKSPACEX_BOARD_DOWNLOAD_SIGNING_KEY` must contain at least 32 bytes. When absent, grant issuance fails closed while the existing authenticated content endpoint remains available for compatibility. Multiple API replicas must share this secret; rotation intentionally invalidates outstanding grants.

## Remaining vendor connector boundary

This slice handles uploaded vendor exports. OAuth-based Miro/Mural acquisition is still outside the implemented boundary. It needs provider-specific authorization-code/PKCE flows, an allowlisted official API host per provider, encrypted refresh-token custody, fixed revoke endpoints, rate-limit/retry receipts, and token-redacted audit logging. OAuth bytes must enter the same `uploadStream` scanner and mapping path; a connector must not write canonical Board objects directly.
