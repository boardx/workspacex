# WebKit encrypted outbox compatibility (#5008)

WebKit cannot structured-clone an AES CryptoKey on the tested Linux/macOS
Playwright port: direct, object and array containers, both extractability flags,
fail before an IndexedDB transaction is involved. Chromium and Firefox retain
the existing native CryptoKey storage path.

The compatibility adapter selects encrypted envelopes only when a fresh native
key write raises DataCloneError. Quota, abort, existing-key corruption and missing
key material for durable rows fail closed. A board namespace contains immutable
per-generation key identities. A rebind keeps its source key identity and commits
the successor token envelope together with the prepared journal. Existing target
keys cannot be overwritten. A nonextractable runtime key is unwrapped for ordinary
operations. Only the local rewrap helper temporarily unwraps an extractable handle
to wrap its successor; raw key bytes never leave WebCrypto.

Existing random 256-bit session tokens derive a nonextractable wrapping key using
versioned, board/key/generation-separated HKDF and AES-GCM. This is encrypted local
queue storage, not protection from active same-origin script execution or theft of
a complete browser profile that includes its session token. Envelopes do not grant
permission: generation pointers, tombstones, prepared journals and server sync
remain authoritative. Reauthorization never migrates revoked rows or removes the
old tombstone. There is no runtime key cache in this adapter.

Run the related native/atomic and compatibility unit counterproofs:

```sh
pnpm --filter web exec vitest run tests/whiteboard/whiteboard-outbox-indexeddb.test.ts tests/whiteboard/whiteboard-outbox-atomic.test.ts tests/whiteboard/whiteboard-outbox-key-store.test.ts tests/whiteboard/whiteboard-outbox-key-envelope.test.ts
```

Run the actual current modules against real native browsers and IndexedDB:

```sh
pnpm --filter web exec playwright install chromium firefox webkit
pnpm --filter web run verify:outbox-browser
```

The native runner owns a temporary localhost server and sequential browser
processes and closes them in finally blocks. It bundles actual source, records all
compiler-input hashes and the served bundle hash, identifies the source HEAD and
whether it is dirty, and checks that inputs did not change during execution. It
covers refresh, two-tab first-key competition, rebind, new-token-only recovery
after an injected post-prepare failure, revoked late writes, authorized fresh
generation creation, runtime export/wrap rejection and ciphertext storage.
The dedicated CI job installs three engines only for changes in this subsystem.

These subsystem checks do not replace the board's existing API/WebSocket,
revocation and visual acceptance lanes. Native OS touch/pen and a subjective
visual score are not claimed by this repair.
