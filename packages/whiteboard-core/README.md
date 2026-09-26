# Whiteboard core

A renderer- and host-independent Yjs content kernel. The contract source is
`@repo/contracts/whiteboard-document`; this package does not provide authentication,
network transport, persistence, durable idempotency storage or trusted author attribution.

`executeCommands(doc, batch, origin)` validates the entire bounded batch on an
isolated clone before mutating the live document in one transaction. Commands are
shared by UI, API and AI hosts, which must authorize and serialize them per board.
`readObjects` returns detached plain values and hides tombstoned objects and their
connections. `copyObjects` remaps internal IDs, containers and edges. Persist a
Yjs state update, not the plain rendering projection, to preserve CRDT history.

Text commands are character splices; a DOM/IME binding must wait for composition
commit and submit the changed range, not replace the whole string each keystroke.
Geometry is an atomic value. Style properties merge independently.

`BoardCommandPort` is the canonical local gesture boundary. It requires a stable
`(boardId, clientId, gestureId)` envelope, applies an accepted batch in one Yjs
transaction and reuses the first result for same-payload retries during the Y.Doc
lifetime. Reusing the tuple with another payload is rejected. Durable replay and
ACK identity still belong to the collaboration host.

Rich visual objects use the versioned `extensionData.contentObject` model. This
keeps the public V1 object envelope compatible while giving Shape, vector
Drawing, Image, Tile/WebTile, Table, Icon and Template strict structured data.
`createContentObjectEnvelope` returns one ordinary create command.
`ContentObjectCommandPort` replaces rich metadata atomically under the same
stable caller identity and returns a typed before/after event. Both paths retain
unknown inert JSON extension fields for forward-compatible plugins. The shared
validator recursively rejects binary values and `data:`/`blob:` strings on
create, replace and remote-update validation. Structured titles are mirrored to
the outer collaborative text in the same transaction. Renderers should
call `readContentObject` and project its typed result; they must composite eraser
strokes against their explicit `erases` target IDs from the retained vectors
rather than flattening drawings into bitmaps. `instantiateTemplateEnvelope`
creates a template's caller-ID-mapped object set in one replay-safe envelope.

`WhiteboardUndo` tracks only its own origin. Creation undo returns
`creation-requires-explicit-delete` without changing anything, even when no peer
edit is currently visible: a collaborator's edit may still be in flight. The UI
must explain this and offer a separate confirmed delete command. Deletion uses
monotonic tombstones and cannot be undone by removing them. Restore means creating
a new ID with `restoredFrom`. This deliberately conservative behavior satisfies
collaborator preservation without pretending a local observation is a global lock.

**Security boundary:** `validateDocument` validates semantic content, not arbitrary
Yjs binary structure/resource usage. Never expose raw `Y.applyUpdate` to anonymous
or untrusted public writers based only on this function. Use authenticated,
validated commands at the authoritative host; peer updates in the tests model
trusted synchronization. Hosts must reject incompatible schema/epoch and enforce
limits, authorization, idempotency, durable ACK and revocation independently.

Dependencies: exact Yjs 13.6.32 (MIT). This package's source is licensed under
Apache-2.0; `private: true` in `package.json` only means it is not currently
published to npm. References: https://github.com/yjs/yjs and
https://docs.yjs.dev/api/undo-manager .

Run `pnpm --filter @repo/whiteboard-core test` and
`pnpm --filter @repo/whiteboard-core typecheck` after workspace dependency install.

## Offline update preflight

`prepareWhiteboardUpdate(authority, update)` returns a validated differential
update without modifying authority. It bounds bytes, struct counts, logical
length and resulting document size, rejects missing causal dependencies, checks
all semantic invariants, and preserves existing object/text/style identities and
monotonic tombstone struct identities. The latter detects delete-then-recreate
attacks which a final-value-only check misses. The adapter deliberately accesses
Yjs internals and must be regression-tested before changing the pinned version.

**This is not a decoder sandbox.** For untrusted input, run this function in an
isolated worker/process with a hard memory budget and timeout; kill and discard
that worker on violation. These limits must surround decode/clone/apply, not run
after them. The authoritative host must serialize base-state selection,
validation, persistence and adoption. It must not apply the caller's original
bytes before preflight, nor expose this helper directly as an unauthenticated
network endpoint. Missing dependencies require a full state-vector diff/rebase;
they are not retained as an unbounded pending queue.
